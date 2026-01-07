import { WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { CodeContext } from "./codeContext";
import { NativeToolsManager } from "../nativeToolManager";
import { ConversationContextManager } from "./conversationContext";
import { ProgressPlanManager, PlanStep } from "../progressPlanManager";
import { AutoTransitionManager } from "./autoTransitionManager";
import { ImplementationManager } from "./implementationManager";
import { HarmonyParseResult } from "../harmonyProcessor";
import { MCPToolCall } from "../mcpClient";

/**
 * Stage handler interface
 * Each stage has its own handler that processes stage-specific logic
 */
export interface StageHandler {
  /**
   * Handle pre-LLM processing (before API call)
   */
  handlePreProcessing?(
    context: ConversationContext | null,
    prompt: string,
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager,
    progressPlanManager?: ProgressPlanManager
  ): Promise<{ shouldSkipLLM: boolean; response?: any }>;

  /**
   * Handle post-LLM processing (after response parsing)
   */
  handlePostProcessing?(
    context: ConversationContext | null,
    content: string,
    parsed: HarmonyParseResult,
    toolCalls: MCPToolCall[],
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: any }> | undefined,
    contextManager: ConversationContextManager,
    progressPlanManager: ProgressPlanManager,
    autoTransitionManager: AutoTransitionManager,
    nativeToolsManager?: NativeToolsManager
  ): Promise<void>;
}

/**
 * Implementation stage handler
 */
class ImplementationStageHandler implements StageHandler {
  private implementationManager?: ImplementationManager;

  constructor(implementationManager?: ImplementationManager) {
    this.implementationManager = implementationManager;
  }

  /**
   * Filter code contexts to match the current step
   * Matches based on filename mentioned in step goal/description
   * Delegates to ImplementationManager if available, otherwise uses local implementation
   */
  private filterCodeContextsForStep(codeContexts: CodeContext[], step: PlanStep): CodeContext[] {
    if (this.implementationManager) {
      return this.implementationManager.filterCodeContextsForStep(codeContexts, step);
    }
    
    // Fallback to local implementation if manager not available
    return this.filterCodeContextsForStepLocal(codeContexts, step);
  }

  private filterCodeContextsForStepLocal(codeContexts: CodeContext[], step: PlanStep): CodeContext[] {
    if (!codeContexts || codeContexts.length === 0) {
      return [];
    }

    // Extract potential filenames from step goal and description
    const stepText = `${step.goal} ${step.description || ''}`.toLowerCase();
    
    // Find code contexts whose filename is mentioned in the step
    const matchedContexts = codeContexts.filter(codeContext => {
      const fileName = codeContext.name.toLowerCase();
      const baseName = fileName.split('.')[0]; // e.g., "hello" from "hello.py"
      const fullFileName = fileName; // e.g., "hello.py"
      
      // Check if the filename or base name is mentioned in the step
      // Support patterns like "hello.py", "hello.test.py", "hello.md"
      const fileNamePattern = new RegExp(`\\b${this.escapeRegex(fileName)}\\b`, 'i');
      const baseNamePattern = new RegExp(`\\b${this.escapeRegex(baseName)}\\.(?:test\\.)?py\\b`, 'i');
      
      // Also check for variations like "create hello.test.py" or "write hello.md"
      return fileNamePattern.test(stepText) || 
             (stepText.includes(baseName) && this.isFileTypeMatch(fileName, stepText));
    });

    // If we found matches, return them. Otherwise, if there's only one context, use it.
    // This handles cases where the step doesn't explicitly mention the filename
    if (matchedContexts.length > 0) {
      return matchedContexts;
    }
    
    // Fallback: if only one code context remains, use it
    const remainingContexts = codeContexts.filter(cc => cc.waitForCreate);
    if (remainingContexts.length === 1) {
      return remainingContexts;
    }

    // If multiple contexts remain and none match, return empty to let LLM decide
    return [];
  }

  /**
   * Check if file type matches step description
   */
  private isFileTypeMatch(fileName: string, stepText: string): boolean {
    if (fileName.endsWith('.test.py') || fileName.endsWith('_test.py')) {
      return stepText.includes('test') || stepText.includes('test.');
    }
    if (fileName.endsWith('.md')) {
      return stepText.includes('document') || stepText.includes('doc') || stepText.includes('.md');
    }
    if (fileName.endsWith('.py')) {
      return stepText.includes('.py') || (!stepText.includes('test') && !stepText.includes('document') && !stepText.includes('.md'));
    }
    return false;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async handlePreProcessing(
    context: ConversationContext | null,
    prompt: string,
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager,
    progressPlanManager?: ProgressPlanManager
  ): Promise<{ shouldSkipLLM: boolean; response?: any }> {
    if (!context || !nativeToolsManager || !progressPlanManager || !this.implementationManager) {
      return { shouldSkipLLM: false };
    }

    // Ensure ImplementationManager is initialized with taskId if we have a plan
    const updatedContext = contextManager?.getContext() || context;
    const plan = updatedContext.progressPlan;
    if (plan && !this.implementationManager.getTaskId()) {
      this.implementationManager.initialize(plan.taskId);
    }

    // Check for @cmd:next_step command (processed earlier, but prompt might be empty or contain other text)
    // For Phase 1, we detect if prompt is empty or just whitespace after command extraction
    // This indicates next_step command was used
    const promptTrimmed = prompt.trim();
    const isNextStepRequest = promptTrimmed.length === 0 || 
                              /^\s*(next\s+step|continue|proceed|advance)\s*$/i.test(promptTrimmed);
    
    const codeContexts = contextManager?.getCodeContexts() || [];
    let shouldUseCodeContext = false;
    let shouldCallLLM = false;

    // Handle next_step command if detected - delegate to ImplementationManager
    if (isNextStepRequest && plan) {
      const currentStep = this.implementationManager.getCurrentStep();
      
      if (!currentStep) {
        // No current step - all completed or no plan
        const updatedPlan = this.implementationManager.getProgressPlan();
        if (updatedPlan?.completedAt) {
          return {
            shouldSkipLLM: true,
            response: {
              content: '✅ All steps in the plan have been completed!',
              verboseInfo: { stage: 'implementation' as const, isComplete: true }
            }
          };
        }
        // Continue with normal flow
        console.log(`[StageHandler:Implementation] @cmd:next_step - No current step found`);
      } else if (currentStep.status === 'in_progress') {
        // Second call: step is already in_progress (from previous advance) - process it
        console.log(`[StageHandler:Implementation] @cmd:next_step - Step ${currentStep.stepNumber} is in_progress, processing it now`);
        // Continue with normal flow - don't return early, let it process the step
      } else if (currentStep.status === 'pending') {
        // Current step is pending - advance to it (set to in_progress) and PROCESS it
        // This happens when step 1 completes and step 2 becomes current but is still pending
        const advancedStep = this.implementationManager.advanceToNextStep();
        if (advancedStep) {
          console.log(`[StageHandler:Implementation] @cmd:next_step - Advanced to step ${advancedStep.stepNumber}: ${advancedStep.goal}, processing it now`);
          // Continue with normal flow - process the step (don't return early)
        }
      } else if (currentStep.status === 'completed') {
        // Current step is completed - advance to next step and PROCESS it
        console.log(`[StageHandler:Implementation] @cmd:next_step - Step ${currentStep.stepNumber} already completed, advancing to next step`);
        
        // Try to advance to next step
        const nextStep = this.implementationManager.advanceToNextStep();
        if (!nextStep) {
          // No more steps - all completed
          const updatedPlan = this.implementationManager.getProgressPlan();
          if (updatedPlan?.completedAt) {
            return {
              shouldSkipLLM: true,
              response: {
                content: '✅ All steps in the plan have been completed!',
                verboseInfo: { stage: 'implementation' as const, isComplete: true }
              }
            };
          }
        } else {
          // We advanced to a new step - PROCESS it (don't stop)
          console.log(`[StageHandler:Implementation] @cmd:next_step - Advanced to step ${nextStep.stepNumber}: ${nextStep.goal}, processing it now`);
          // Continue with normal flow - process the step (don't return early)
        }
      }
    }

    // All tasks should have a ProgressPlan (created in assumptions stage)
    // If plan doesn't exist, treat as error case and call LLM
    if (plan) {
      // Get current step using ImplementationManager
      const currentStep = this.implementationManager.getCurrentStep();

      if (currentStep) {
        // Check if step needs file creation tools
        const fileCreationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
        const needsFileCreation = currentStep.tools?.some(tool => 
          fileCreationTools.includes(tool)
        ) || false;

        console.log(`[StageHandler:Implementation] ProgressPlan: Current step ${currentStep.stepNumber} - goal: "${currentStep.goal}", needsFileCreation: ${needsFileCreation}, hasCodeContext: ${codeContexts.length > 0}`);

        if (needsFileCreation && codeContexts.length > 0) {
          // Step needs file creation and we have CodeContext - use CodeContext
          shouldUseCodeContext = true;
          console.log(`[StageHandler:Implementation] ProgressPlan: Step requires file creation, using CodeContext (no LLM call needed)`);
        } else if (needsFileCreation && codeContexts.length === 0) {
          // Step needs file creation but no CodeContext - call LLM to generate tool calls
          shouldCallLLM = true;
          console.log(`[StageHandler:Implementation] ProgressPlan: Step requires file creation but no CodeContext, calling LLM to generate tool calls`);
        } else {
          // Step doesn't explicitly need file creation or unclear - call LLM to determine action
          // Also use CodeContext if available (even if step doesn't explicitly require file creation)
          if (codeContexts.length > 0) {
            shouldUseCodeContext = true;
            console.log(`[StageHandler:Implementation] ProgressPlan: Using CodeContext (no LLM call needed)`);
          } else {
            shouldCallLLM = true;
            console.log(`[StageHandler:Implementation] ProgressPlan: Step doesn't require file creation, calling LLM to determine action`);
          }
        }
      } else {
        // No active step - call LLM to determine next action
        // But first check if we have CodeContext that can be used
        if (codeContexts.length > 0) {
          shouldUseCodeContext = true;
          console.log(`[StageHandler:Implementation] ProgressPlan: No active step but CodeContext available, using CodeContext`);
        } else {
          shouldCallLLM = true;
          console.log(`[StageHandler:Implementation] ProgressPlan: No active step found, calling LLM to determine action`);
        }
      }
    } else {
      // No plan exists (shouldn't happen in normal flow, but handle gracefully)
      console.warn(`[StageHandler:Implementation] No ProgressPlan found (unexpected) - falling back to CodeContext check or LLM`);
      if (codeContexts.length > 0) {
        shouldUseCodeContext = true;
        console.log(`[StageHandler:Implementation] Fallback: Using CodeContext (no LLM call needed)`);
      } else {
        shouldCallLLM = true;
        console.log(`[StageHandler:Implementation] Fallback: No CodeContext, calling LLM to generate tool calls`);
      }
    }

    // Filter code contexts to match the current step using ImplementationManager
    let filteredCodeContexts = codeContexts;
    const currentStepForFilter = this.implementationManager.getCurrentStep();
    
    if (currentStepForFilter) {
      // Match CodeContexts to the current step based on filename mentioned in step goal/description
      filteredCodeContexts = this.implementationManager.filterCodeContextsForStep(codeContexts, currentStepForFilter);
      console.log(`[StageHandler:Implementation] Filtered ${codeContexts.length} code context(s) to ${filteredCodeContexts.length} matching step ${currentStepForFilter.stepNumber}`);
    }

    // Execute action based on plan decision
    // IMPORTANT: Only use CodeContext if we have matching contexts for the current step
    // If shouldUseCodeContext is true but filteredCodeContexts is empty, we need to call LLM instead
    let createdFiles: string[] = [];
    if (shouldUseCodeContext && filteredCodeContexts.length > 0) {
      console.log(`[StageHandler:Implementation] Found ${filteredCodeContexts.length} code context(s) for current step, creating files from CodeContext...`);
      createdFiles = [];
      const toolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
        result?: any;
      }> = [];

      for (const codeContext of filteredCodeContexts) {
        if (codeContext.waitForCreate && codeContext.content && codeContext.content.length > 0) {
          try {
            const filePath = codeContext.name;
            const content = codeContext.getContentAsString();

            if (!content || content.trim().length === 0) {
              continue;
            }

            const createResult = await nativeToolsManager.callTool('create_file', {
              file_path: filePath,
              content: content
            });

            const currentStep = this.implementationManager.getCurrentStep();
            const stepNumber = currentStep?.stepNumber || 0;
            
            if (!createResult.isError) {
              createdFiles.push(filePath);
              // Record file creation in ImplementationManager
              this.implementationManager.recordFileCreated(filePath, stepNumber, 'created');
              if (contextManager) {
                contextManager.markCodeContextCreated(filePath);
              }
              toolCalls.push({
                name: 'create_file',
                arguments: { file_path: filePath, content: content },
                result: createResult
              });
              console.log(`[StageHandler:Implementation] Successfully created file ${filePath} from CodeContext`);
            } else if (createResult.content?.[0]?.text?.includes('already exists')) {
              const replaceResult = await nativeToolsManager.callTool('replace_file', {
                file_path: filePath,
                content: content
              });
              if (!replaceResult.isError) {
                createdFiles.push(filePath);
                // Record file replacement in ImplementationManager
                this.implementationManager.recordFileCreated(filePath, stepNumber, 'replaced');
                if (contextManager) {
                  contextManager.markCodeContextCreated(filePath);
                }
                toolCalls.push({
                  name: 'replace_file',
                  arguments: { file_path: filePath, content: content },
                  result: replaceResult
                });
              } else {
                // Record error in ImplementationManager
                this.implementationManager.recordFileCreated(filePath, stepNumber, 'error', replaceResult.content?.[0]?.text || 'Unknown error');
              }
            } else {
              // Record error in ImplementationManager
              this.implementationManager.recordFileCreated(filePath, stepNumber, 'error', createResult.content?.[0]?.text || 'Unknown error');
            }
          } catch (error: any) {
            console.warn(`[StageHandler:Implementation] Error creating file ${codeContext.name}:`, error);
          }
        }
      }

      if (createdFiles.length > 0) {
        // Mark step as completed using ImplementationManager
        const stepToComplete = this.implementationManager.getCurrentStep();
        if (stepToComplete) {
          this.implementationManager.completeStep(stepToComplete.stepNumber);
          console.log(`[StageHandler:Implementation] ProgressPlan: Marked step ${stepToComplete.stepNumber} (${stepToComplete.goal}) as completed after creating files from CodeContext`);
        }

        const verboseInfo = {
          stage: 'implementation' as const,
          isComplete: true,
          toolCalls: toolCalls.map(tc => ({
            name: tc.name,
            stage: 'implementation' as WorkflowStage,
            success: !tc.result?.isError,
            error: tc.result?.isError ? (tc.result?.content?.[0]?.text || 'Unknown error') : undefined
          }))
        };
        
        return {
          shouldSkipLLM: true,
          response: {
            content: `Successfully created ${createdFiles.length} file(s) from code snippets: ${createdFiles.join(', ')}`,
            toolCalls: toolCalls,
            verboseInfo: verboseInfo
          }
        };
      } else {
        // We had code contexts but couldn't create files - need to call LLM
        console.log(`[StageHandler:Implementation] CodeContexts available but no files were created - calling LLM to generate tool calls`);
        return { shouldSkipLLM: false };
      }
    }

    // If shouldCallLLM is true, or shouldUseCodeContext but no matching contexts found, call LLM
    if (shouldCallLLM || (shouldUseCodeContext && filteredCodeContexts.length === 0)) {
      const reason = shouldCallLLM 
        ? 'step requires LLM call' 
        : 'no matching code contexts for current step';
      console.log(`[StageHandler:Implementation] ProgressPlan determined: LLM call needed (${reason})`);
      return { shouldSkipLLM: false };
    }

    // Fallback: no plan decision and no CodeContext
    return { shouldSkipLLM: false };
  }
}

/**
 * Assumptions stage handler
 */
class AssumptionsStageHandler implements StageHandler {
  async handlePostProcessing(
    context: ConversationContext | null,
    content: string,
    parsed: HarmonyParseResult,
    toolCalls: MCPToolCall[],
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: any }> | undefined,
    contextManager: ConversationContextManager,
    progressPlanManager: ProgressPlanManager,
    autoTransitionManager: AutoTransitionManager,
    nativeToolsManager?: NativeToolsManager
  ): Promise<void> {
    if (!context) return;

    const hasToolCalls = parsed.rawToolCalls && parsed.rawToolCalls.length > 0;
    
    // Extract code snippets and create CodeContext objects
    if (content && !hasToolCalls && toolCalls.length === 0) {
      console.log(`[StageHandler:Assumptions] Extracting code snippets from content...`);
      const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
      const matches = content.matchAll(codeBlockPattern);
      let codeBlockCount = 0;
      
      for (const match of matches) {
        try {
          const codeBlock = match[0];
          const codeContext = CodeContext.fromCodeBlock(codeBlock);
          
          if (codeContext) {
            // Get the current user prompt from context for description extraction
            // Use the most recent prompt from stage history, or fall back to originalPrompt
            const recentPrompt = context.stageHistory.length > 0 
              ? context.stageHistory[context.stageHistory.length - 1].prompt 
              : context.originalPrompt;
            contextManager.addCodeContext(codeContext, recentPrompt, content);
            codeBlockCount++;
            console.log(`[StageHandler:Assumptions] Extracted code context for file: ${codeContext.name} (version: ${codeContext.version})`);
          }
        } catch (error) {
          console.warn(`[StageHandler:Assumptions] Failed to extract code context:`, error);
        }
      }
      
      if (codeBlockCount > 0) {
        console.log(`[StageHandler:Assumptions] Added ${codeBlockCount} code context(s)`);
      }

      // Plan creation/update is now handled by AssumptionsManager in harmonyClient.ts
      // This handler only processes code context extraction (handled above)
    }
  }
}

/**
 * Chat stage handler (minimal - mostly pass-through)
 */
class ChatStageHandler implements StageHandler {
  // Chat stage doesn't need special processing
}

/**
 * Init stage handler (minimal - just pass-through, will transition to chat)
 */
class InitStageHandler implements StageHandler {
  // Init stage doesn't need special processing, transitions to chat immediately
}

/**
 * Stage handler registry
 * Table-based lookup for stage handlers
 */
export class StageHandlerRegistry {
  private handlers: Map<WorkflowStage, StageHandler> = new Map();

  constructor(implementationManager?: ImplementationManager) {
    // Register handlers
    this.handlers.set('init', new InitStageHandler());
    this.handlers.set('chat', new ChatStageHandler());
    this.handlers.set('assumptions', new AssumptionsStageHandler());
    this.handlers.set('implementation', new ImplementationStageHandler(implementationManager));
  }

  /**
   * Get handler for a stage
   */
  getHandler(stage: WorkflowStage): StageHandler {
    return this.handlers.get(stage) || new InitStageHandler();
  }
}