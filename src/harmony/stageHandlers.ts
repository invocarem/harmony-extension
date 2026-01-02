import { WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { CodeContext } from "./codeContext";
import { NativeToolsManager } from "../nativeToolManager";
import { ConversationContextManager } from "./conversationContext";
import { ProgressPlanManager } from "../progressPlanManager";
import { AutoTransitionManager } from "./autoTransitionManager";
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
  async handlePreProcessing(
    context: ConversationContext | null,
    prompt: string,
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager,
    progressPlanManager?: ProgressPlanManager
  ): Promise<{ shouldSkipLLM: boolean; response?: any }> {
    if (!context || !nativeToolsManager) {
      return { shouldSkipLLM: false };
    }

    // Check for @cmd:next_step command (processed earlier, but prompt might be empty or contain other text)
    // For Phase 1, we detect if prompt is empty or just whitespace after command extraction
    // This indicates next_step command was used
    const promptTrimmed = prompt.trim();
    const isNextStepRequest = promptTrimmed.length === 0 || 
                              /^\s*(next\s+step|continue|proceed|advance)\s*$/i.test(promptTrimmed);
    
    // Follow ProgressPlan/PlanStep to determine action, not hardcode it
    const plan = context.progressPlan;
    const codeContexts = contextManager?.getCodeContexts() || [];
    let shouldUseCodeContext = false;
    let shouldCallLLM = false;

    // Handle next_step command if detected
    if (isNextStepRequest && plan && progressPlanManager) {
      // Find current step (in_progress or pending)
      const currentStep = plan.steps.find(step => 
        step.status === 'pending' || step.status === 'in_progress'
      );

      if (currentStep) {
        // Mark current step as completed
        progressPlanManager.updateStepStatus(
          plan.taskId,
          currentStep.stepNumber,
          'completed'
        );
        console.log(`[StageHandler:Implementation] @cmd:next_step - Marked step ${currentStep.stepNumber} (${currentStep.goal}) as completed`);
      }

      // Find next pending step
      const nextStep = plan.steps.find(step => step.status === 'pending');
      
      if (nextStep) {
        // Mark next step as in_progress
        progressPlanManager.updateStepStatus(
          plan.taskId,
          nextStep.stepNumber,
          'in_progress'
        );
        console.log(`[StageHandler:Implementation] @cmd:next_step - Advanced to step ${nextStep.stepNumber}: ${nextStep.goal}`);
        
        // Continue with step processing logic below
        // The next step will be processed using existing logic
      } else {
        // No more steps - all completed
        const updatedPlan = progressPlanManager.getPlan(plan.taskId);
        if (updatedPlan?.completedAt) {
          return {
            shouldSkipLLM: true,
            response: {
              content: '✅ All steps in the plan have been completed!',
              verboseInfo: { stage: 'implementation' as const, isComplete: true }
            }
          };
        }
      }
    }

    if (plan && progressPlanManager) {
      // Get current step (pending or in_progress)
      const currentStep = plan.steps.find(step => 
        step.status === 'pending' || step.status === 'in_progress'
      );

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
          shouldCallLLM = true;
          console.log(`[StageHandler:Implementation] ProgressPlan: Step doesn't require file creation, calling LLM to determine action`);
        }
      } else {
        // No active step - call LLM to determine next action
        shouldCallLLM = true;
        console.log(`[StageHandler:Implementation] ProgressPlan: No active step found, calling LLM to determine action`);
      }
    } else {
      // No plan - fallback to CodeContext check
      if (codeContexts.length > 0) {
        shouldUseCodeContext = true;
        console.log(`[StageHandler:Implementation] No ProgressPlan: Using CodeContext (no LLM call needed)`);
      } else {
        shouldCallLLM = true;
        console.log(`[StageHandler:Implementation] No ProgressPlan: No CodeContext, calling LLM to generate tool calls`);
      }
    }

    // Execute action based on plan decision
    if (shouldUseCodeContext) {
      console.log(`[StageHandler:Implementation] Found ${codeContexts.length} code context(s), creating files from CodeContext...`);
      const createdFiles: string[] = [];
      const toolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
        result?: any;
      }> = [];

      for (const codeContext of codeContexts) {
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

            if (!createResult.isError) {
              createdFiles.push(filePath);
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
                if (contextManager) {
                  contextManager.markCodeContextCreated(filePath);
                }
                toolCalls.push({
                  name: 'replace_file',
                  arguments: { file_path: filePath, content: content },
                  result: replaceResult
                });
              }
            }
          } catch (error: any) {
            console.warn(`[StageHandler:Implementation] Error creating file ${codeContext.name}:`, error);
          }
        }
      }

      if (createdFiles.length > 0) {
        // Update progressPlan if it exists
        if (plan && progressPlanManager) {
          const stepToComplete = plan.steps.find(step => 
            step.status === 'pending' || step.status === 'in_progress'
          );
          if (stepToComplete) {
            progressPlanManager.updateStepStatus(
              plan.taskId,
              stepToComplete.stepNumber,
              'completed'
            );
            console.log(`[StageHandler:Implementation] ProgressPlan: Marked step ${stepToComplete.stepNumber} (${stepToComplete.goal}) as completed after creating files from CodeContext`);
          }
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
      }
    }

    // If shouldCallLLM is true or shouldUseCodeContext but no files were created, call LLM
    if (shouldCallLLM || (shouldUseCodeContext && codeContexts.length === 0)) {
      console.log(`[StageHandler:Implementation] ProgressPlan determined: LLM call needed`);
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

      // Create ProgressPlan for complex tasks
      if (!context.progressPlan) {
        try {
          const complexity = autoTransitionManager.detectTaskComplexity(
            content,
            parsed.reasoning,
            toolCalls
          );
          
          if (complexity === 'hard') {
            const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const originalPrompt = context.originalPrompt;
            
            // Extract steps from content
            const steps: Array<{ goal: string; description?: string; tools?: string[] }> = [];
            const stepMatches = content.match(/(?:^|\n)(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)(.+?)(?=\n(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?|$))/gi);
            
            if (stepMatches && stepMatches.length >= 3) {
              stepMatches.forEach((match) => {
                const goal = match.replace(/^(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)/i, '').trim();
                if (goal) {
                  steps.push({ goal, description: goal });
                }
              });
            } else {
              // Fallback: create generic steps
              for (let i = 1; i <= 3; i++) {
                steps.push({ 
                  goal: `Step ${i}: Complete part ${i} of the task`, 
                  description: `Execute step ${i} of the implementation plan` 
                });
              }
            }
            
            const plan = progressPlanManager.createPlan(
              taskId,
              originalPrompt,
              'hard',
              steps.length > 0 ? steps : [
                { goal: 'Step 1: Analyze requirements', description: 'Understand the task requirements' },
                { goal: 'Step 2: Design solution', description: 'Plan the implementation approach' },
                { goal: 'Step 3: Implement solution', description: 'Execute the implementation' }
              ]
            );
            
            contextManager.setProgressPlan(plan);
            console.log(`[StageHandler:Assumptions] Created ProgressPlan with ${plan.totalSteps} steps`);
          }
        } catch (error) {
          console.warn(`[StageHandler:Assumptions] Error creating plan:`, error);
        }
      }
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

  constructor() {
    // Register handlers
    this.handlers.set('init', new InitStageHandler());
    this.handlers.set('chat', new ChatStageHandler());
    this.handlers.set('assumptions', new AssumptionsStageHandler());
    this.handlers.set('implementation', new ImplementationStageHandler());
  }

  /**
   * Get handler for a stage
   */
  getHandler(stage: WorkflowStage): StageHandler {
    return this.handlers.get(stage) || new InitStageHandler();
  }
}

