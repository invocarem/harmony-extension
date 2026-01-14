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
import { ChatManager } from "./chatManager";
import { ChatMessage } from "../conversationManager";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

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
   * Filter tool calls before execution (after extraction, before execution)
   * Returns filtered tool calls and any that were blocked
   */
  filterToolCalls?(
    toolCalls: MCPToolCall[],
    context: ConversationContext | null,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<{ filtered: MCPToolCall[]; blocked: MCPToolCall[] }>;

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
    nativeToolsManager?: NativeToolsManager,
    conversationHistory?: readonly ChatMessage[]
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
      // No plan exists - this should not happen as we check before transition
      // But handle it gracefully by requiring a plan
      console.error(`[StageHandler:Implementation] ❌ No ProgressPlan found - implementation stage requires a plan!`);
      return {
        shouldSkipLLM: true,
        response: {
          content: '⚠️ Implementation stage requires a ProgressPlan. Please complete the assumptions/analysis stage first to create a plan, then transition to implementation.',
          verboseInfo: {
            stage: 'implementation' as const,
            error: 'No ProgressPlan found - cannot proceed without a plan'
          }
        }
      };
    }

    // Filter code contexts to match the current step using ImplementationManager
    // Implementation stage always has a plan, so we can safely use ImplementationManager
    let filteredCodeContexts = codeContexts;
    const currentStepForFilter = this.implementationManager.getCurrentStep();
    
    if (currentStepForFilter) {
      // Match CodeContexts to the current step based on filename mentioned in step goal/description
      filteredCodeContexts = this.implementationManager.filterCodeContextsForStep(codeContexts, currentStepForFilter);
      console.log(`[StageHandler:Implementation] Filtered ${codeContexts.length} code context(s) to ${filteredCodeContexts.length} matching step ${currentStepForFilter.stepNumber}`);
      
      // Generate diagnostic file for this step if next_step command was used
      if (isNextStepRequest) {
        await this.implementationManager.generateImplementationStepFile(
          currentStepForFilter.stepNumber,
          filteredCodeContexts,
          nativeToolsManager,
          contextManager
        );
      }
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
              // Record file creation in ImplementationManager (plan always exists in implementation stage)
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
                // Record file replacement in ImplementationManager (plan always exists in implementation stage)
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
                // Record error in ImplementationManager (plan always exists in implementation stage)
                this.implementationManager.recordFileCreated(filePath, stepNumber, 'error', replaceResult.content?.[0]?.text || 'Unknown error');
              }
            } else {
              // Record error in ImplementationManager (plan always exists in implementation stage)
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
    if (!context || !this.implementationManager) return;

    const plan = context.progressPlan;
    if (!plan) return;

    // Get current step
    const currentStep = this.implementationManager.getCurrentStep();
    if (!currentStep || currentStep.status !== 'in_progress') {
      return;
    }

    // Check if step requires file creation tools
    const fileCreationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
    const needsFileCreation = currentStep.tools?.some(tool => 
      fileCreationTools.includes(tool)
    ) || false;

    // Check if any file creation tool calls were executed
    const hasFileCreationToolCalls = executedToolCalls?.some(tc => 
      fileCreationTools.includes(tc.name)
    ) || false;

    // If step doesn't require file creation AND no file creation tool calls were executed,
    // mark the step as complete (the LLM has responded, which is sufficient for non-file-creation steps)
    if (!needsFileCreation && !hasFileCreationToolCalls) {
      this.implementationManager.completeStep(currentStep.stepNumber);
      console.log(`[StageHandler:Implementation] ProgressPlan: Marked step ${currentStep.stepNumber} (${currentStep.goal}) as completed after LLM response (step doesn't require file creation)`);
    }
  }
}

/**
 * Assumptions stage handler
 */
class AssumptionsStageHandler implements StageHandler {
  async handlePreProcessing(
    context: ConversationContext | null,
    prompt: string,
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager,
    progressPlanManager?: ProgressPlanManager
  ): Promise<{ shouldSkipLLM: boolean; response?: any }> {
    // No special handling for convert command - let LLM generate the plan naturally
    // The improved step extraction logic will properly extract execution steps from LLM's response
    return { shouldSkipLLM: false };
  }

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

    // Assumptions stage should NOT extract code snippets
    // The goal is analysis, planning, and listing assumptions - NOT code generation
    // Code generation happens in Implementation stage
    
    // Check if model mistakenly generated code snippets (should not happen with proper instructions)
    const hasCodeSnippets = /```[\s\S]*?```/.test(content);
    if (hasCodeSnippets) {
      console.warn(`[StageHandler:Assumptions] ⚠️ Code snippets detected in assumptions stage (unexpected). Assumptions stage should focus on analysis and planning, not code generation. Code should be generated in Implementation stage.`);
      // We still won't extract them - let Implementation stage handle code generation
    }

    // Plan creation/update is handled by AssumptionsManager in harmonyClient.ts
    // This handler doesn't need to do anything else for assumptions stage
    console.log(`[StageHandler:Assumptions] Assumptions stage post-processing complete. Plan creation handled by AssumptionsManager.`);
  }
}

/**
 * Chat stage handler
 * Handles chat stage logic: validates tool calls, tracks queries, extracts problem summaries
 */
class ChatStageHandler implements StageHandler {
  private chatManager: ChatManager;

  constructor(chatManager: ChatManager) {
    this.chatManager = chatManager;
  }

  /**
   * Filter tool calls in chat stage
   * Prevents reading files that don't exist and were mentioned in conversation as files to create
   */
  async filterToolCalls(
    toolCalls: MCPToolCall[],
    context: ConversationContext | null,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<{ filtered: MCPToolCall[]; blocked: MCPToolCall[] }> {
    const filtered: MCPToolCall[] = [];
    const blocked: MCPToolCall[] = [];

    // Extract files mentioned in conversation that should be created
    const filesToCreate = this.extractFilesToCreate(conversationHistory || []);

    for (const toolCall of toolCalls) {
      // Check if it's a read_file call
      if (toolCall.name === 'read_file') {
        const filePath = toolCall.arguments?.file_path || toolCall.arguments?.filePath;
        if (filePath) {
          // Check if this file was mentioned as something to create
          const isFileToCreate = filesToCreate.some(ftc => 
            this.pathMatches(filePath, ftc)
          );

          if (isFileToCreate) {
            // Check if file exists
            const fileExists = await this.checkFileExists(filePath, nativeToolsManager);
            
            if (!fileExists) {
              // Block this read_file call - file doesn't exist and was mentioned as file to create
              console.log(`[StageHandler:Chat] Blocking read_file for ${filePath} - file doesn't exist and was mentioned as file to create`);
              blocked.push(toolCall);
              continue;
            }
            // If file exists, allow the read (file was created in a previous step)
          }
          // If file wasn't mentioned as file to create, allow the read_file call
          // (it might be reading an existing file, or the LLM is checking if it exists)
        }
      }

      // Allow other tool calls
      filtered.push(toolCall);
    }

    return { filtered, blocked };
  }

  /**
   * Extract files mentioned in conversation that should be created
   * Looks for patterns like "create hello.py", "write file.py", etc.
   */
  private extractFilesToCreate(conversationHistory: readonly ChatMessage[]): string[] {
    const files: string[] = [];
    const createPatterns = [
      /\b(create|write|make|add|generate|build)\s+(?:a\s+)?([\w\-\.\/]+\.\w{2,4})\b/gi,
      /\b(create|write|make|add|generate|build)\s+(?:the\s+)?file\s+([\w\-\.\/]+\.\w{2,4})\b/gi,
      /\b([\w\-\.\/]+\.\w{2,4})\s+(?:file\s+)?(?:should\s+)?(?:be\s+)?(?:created|written|made|generated)\b/gi,
    ];

    for (const message of conversationHistory) {
      if (message.role === 'user') {
        const content = message.content.toLowerCase();
        for (const pattern of createPatterns) {
          const matches = content.matchAll(pattern);
          for (const match of matches) {
            // Extract filename from match (could be in different capture groups)
            const fileName = match[2] || match[1];
            if (fileName && fileName.includes('.')) {
              files.push(fileName);
            }
          }
        }
      }
    }

    // Remove duplicates
    return [...new Set(files)];
  }

  /**
   * Check if a file exists
   */
  private async checkFileExists(filePath: string, nativeToolsManager?: NativeToolsManager): Promise<boolean> {
    try {
      // Resolve path relative to workspace root
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let resolvedPath: string;
      
      if (path.isAbsolute(filePath)) {
        resolvedPath = filePath;
      } else if (workspaceFolders && workspaceFolders.length > 0) {
        resolvedPath = path.resolve(workspaceFolders[0].uri.fsPath, filePath);
      } else {
        resolvedPath = path.resolve(filePath);
      }

      // Check if file exists
      await fs.promises.access(resolvedPath, fs.constants.F_OK);
      return true;
    } catch {
      // File doesn't exist or is inaccessible
      return false;
    }
  }

  /**
   * Check if two file paths match (handles relative/absolute, different separators)
   */
  private pathMatches(path1: string, path2: string): boolean {
    const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    return normalize(path1) === normalize(path2) || 
           normalize(path.basename(path1)) === normalize(path.basename(path2));
  }

  /**
   * Handle post-processing for chat stage
   * Tracks queries and extracts problem summaries
   */
  async handlePostProcessing(
    context: ConversationContext | null,
    content: string,
    parsed: HarmonyParseResult,
    toolCalls: MCPToolCall[],
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: any }> | undefined,
    contextManager: ConversationContextManager,
    progressPlanManager: ProgressPlanManager,
    autoTransitionManager: AutoTransitionManager,
    nativeToolsManager?: NativeToolsManager,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!context) return;

    // Track user queries in chat stage
    // Note: Query is already added in extension.ts with proper file extraction via addQueryWithFiles()
    // This post-processing processes the response to update problems (add unsolved, remove solved)

    // Get the last user query from conversation history
    if (content && conversationHistory) {
      // Find the last user message (before the current assistant response)
      const userMessages = conversationHistory.filter(m => m.role === 'user');
      const lastUserQuery = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : undefined;
      
      if (lastUserQuery) {
        // Process response to add/remove problems
        this.chatManager.processResponse(content, lastUserQuery);
      }
    }
  }
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

  constructor(implementationManager?: ImplementationManager, chatManager?: ChatManager) {
    // Register handlers
    this.handlers.set('init', new InitStageHandler());
    this.handlers.set('chat', new ChatStageHandler(chatManager || new ChatManager()));
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