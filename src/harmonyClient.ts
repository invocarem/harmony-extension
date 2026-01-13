import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { RulesManager, Rule } from "./rulesManager";
import { NativeToolsManager } from "./nativeToolManager";
import { HarmonyProcessor, HarmonyParseResult } from "./harmonyProcessor";
import { ToolCallExtractor } from "./utils/toolCallExtractor";
import { XmlProcessor } from "./utils/xmlProcessor";
import { ChatMessage } from "./conversationManager";
import { ProgressPlanManager } from "./progressPlanManager";
import {
  ConversationContextManager,
  ConversationContext,
  CodeExtractor,
  CodeContext,
  ResponseValidator,
  PromptBuilder,
  ToolExecutor,
  ToolResultFormatter,
  ContinuationManager,
  AutoTransitionManager,
  StageDetector,
  StageStateMachine,
  StageHandlerRegistry,
  WorkflowStage,
  ChatManager,
  AssumptionsManager,
  ImplementationManager,
} from "./harmony";

// Re-export WorkflowStage for backward compatibility
export type { WorkflowStage };
import {
  logLongMessage,
  logApiRequest,
  logToolCalls,
  logRules,
  logStepInfo,
  logVerboseInfo,
} from "./utils/logger";
import { VerboseInfo, VerboseInfoBuilder, FileOperationResult, withToString, VerboseInfoFormatter } from "./utils/verboseInfo";

export interface HarmonyResponse {
  content: string;
  reasoning?: string;
  commentary?: string;
  final?: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
  isContinuation?: boolean;
  verboseInfo?: VerboseInfo;
}

export type VerboseInfoCallback = (verboseInfo: VerboseInfo) => void | Promise<void>;

/**
 * Main HarmonyClient with HarmonyProcessor integration and multi-step continuation
 * Refactored to use modular components for better maintainability
 */
export class HarmonyClient {
  private stageStateMachine: StageStateMachine;
  private harmonyProcessor: HarmonyProcessor;
  private progressPlanManager: ProgressPlanManager;
  private stageHandlerRegistry: StageHandlerRegistry;

  // Modular components
  private contextManager: ConversationContextManager;
  private chatManager: ChatManager;
  private assumptionsManager: AssumptionsManager;
  private implementationManager: ImplementationManager;
  private stageDetector: StageDetector;
  private promptBuilder: PromptBuilder;
  private toolExecutor: ToolExecutor;
  private toolResultFormatter: ToolResultFormatter;
  private responseValidator: ResponseValidator;
  private continuationManager: ContinuationManager;
  private autoTransitionManager: AutoTransitionManager;

  // Callback for pre-transition verboseInfo
  private verboseInfoCallback?: VerboseInfoCallback;

  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {
    // Set verbose logging for tool extraction based on config
    const { Logger } = require('./utils/logger');
    Logger.setVerboseToolExtraction(config.verboseToolExtraction || false);
    
    this.harmonyProcessor = new HarmonyProcessor(config.harmonyMode);
    this.stageStateMachine = new StageStateMachine();
    this.progressPlanManager = new ProgressPlanManager();

    // Initialize modular components
    this.contextManager = new ConversationContextManager();
    this.chatManager = new ChatManager();
    this.autoTransitionManager = new AutoTransitionManager(this.progressPlanManager);
    this.assumptionsManager = new AssumptionsManager(this.progressPlanManager, this.autoTransitionManager);
    this.implementationManager = new ImplementationManager(this.progressPlanManager);
    this.stageHandlerRegistry = new StageHandlerRegistry(this.implementationManager, this.chatManager);
    this.stageDetector = new StageDetector(this.stageStateMachine);
    this.promptBuilder = new PromptBuilder(
      config,
      this.stageStateMachine,
      mcpManager,
      rulesManager,
      nativeToolsManager
    );
    this.toolExecutor = new ToolExecutor(mcpManager, nativeToolsManager);
    this.toolResultFormatter = new ToolResultFormatter(
      config,
      this.harmonyProcessor,
      rulesManager
    );
    this.responseValidator = new ResponseValidator();
    this.continuationManager = new ContinuationManager();
  }

  async callServer(
    prompt: string,
    templateName?: string,
    applyTemplate?: (
      templateName: string,
      context: any,
      history?: readonly ChatMessage[]
    ) => Promise<string>,
    isContinuation: boolean = false,
    conversationHistory?: readonly ChatMessage[],
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult
  ): Promise<HarmonyResponse> {
    try {
      // Initialize or update conversation context
      if (!isContinuation) {
        // Only initialize if no context exists, otherwise preserve existing context
        if (!this.contextManager.hasContext()) {
          // Always start new conversations in 'init' stage, then transition to 'chat'
          // This ensures proper initialization and transition recording
          this.contextManager.initialize(prompt, 'init');
          const context = this.contextManager.getContext();
          if (context) {
            // Init stage always transitions to chat on first prompt
            if (context.currentStage === 'init') {
              console.log(`[Harmony] Initializing conversation: init -> chat`);
              this.contextManager.updateStage('chat', prompt);
            }
            
            // Now detect if we should transition further from chat
            const updatedContext = this.contextManager.getContext();
            if (updatedContext) {
              const detectedStage = this.stageDetector.detectStage(
                prompt,
                conversationHistory,
                updatedContext
              );
              if (detectedStage !== 'chat' && detectedStage !== 'init') {
                console.log(`[Harmony] Stage transition detected at start: chat -> ${detectedStage}`);
                // Perform the transition first
                this.contextManager.updateStage(detectedStage, prompt);
                // VerboseInfo will be included in the final response, no need to send it separately
              }
            }
          }
          const finalContext = this.contextManager.getContext();
          console.log(`[Harmony] Starting new conversation in stage: ${finalContext?.currentStage || 'chat'}`);
          
          // Initialize chat manager when entering chat stage (only if not already initialized)
          // Note: Query might have already been added in extension.ts before callServer() is called
          if (finalContext?.currentStage === 'chat' && !this.chatManager.hasContent()) {
            this.chatManager.initialize();
          }
        } else {
          // Context exists, just update stage if needed
          const context = this.contextManager.getContext();
          if (context) {
            const previousStage = context.currentStage;
            console.log(`[Harmony] Checking stage transition. Current stage: ${previousStage}, Prompt: "${prompt.substring(0, 50)}..."`);
            
            // Check what stage the state machine detects for this prompt
            // The state machine will IMMEDIATELY return the new stage if "move to implementation" is detected
            const detectedStage = this.stageDetector.detectStage(
              prompt,
              conversationHistory,
              context
            );
            
            console.log(`[Harmony] State machine detected stage: ${detectedStage} (was: ${previousStage})`);
            
            if (detectedStage !== previousStage) {
              console.log(`[Harmony] ✅ STAGE TRANSITION APPROVED: ${previousStage} -> ${detectedStage}`);
              
              // When transitioning from chat to assumptions, use aggregated prompt
              if (previousStage === 'chat' && detectedStage === 'assumptions') {
                // Initialize assumptions manager when entering assumptions stage
                this.assumptionsManager.initialize();
                
                // Get aggregated prompt from ChatManager if available
                let aggregatedPrompt: string | undefined;
                let queries: string[] = [];
                
                if (this.chatManager.hasContent()) {
                  const chatExport = this.chatManager.exportForTransition();
                  aggregatedPrompt = chatExport.aggregatedPrompt;
                  queries = chatExport.queries;
                  console.log(`[Harmony] Using aggregated prompt from ChatManager (${queries.length} queries)`);
                }
                
                // Also check conversation history to ensure we capture ALL user queries from chat stage
                // This is a fallback to catch queries that might have been missed in ChatManager
                if (conversationHistory && conversationHistory.length > 0) {
                  const chatStageUserQueries: string[] = [];
                  let inChatStage = true; // Track if we're still in chat stage messages
                  
                  for (const message of conversationHistory) {
                    if (message.role === 'user') {
                      const content = message.content.trim();
                      // Skip empty messages and command-only messages
                      if (content && !content.match(/^@cmd:/i)) {
                        // Check if this message contains a stage transition command
                        const hasStageTransition = /\b(move\s+to|go\s+to|goto)\s+(assumptions|implementation|chat)\b/i.test(content);
                        if (hasStageTransition && content.toLowerCase().includes('assumptions')) {
                          // This is the transition message, stop collecting
                          break;
                        }
                        // Only collect queries that appear to be from chat stage (before any transitions)
                        if (inChatStage) {
                          chatStageUserQueries.push(content);
                        }
                      }
                    } else if (message.role === 'assistant') {
                      // Check if assistant response indicates stage transition
                      const content = message.content.toLowerCase();
                      if (content.includes('moving to assumptions') || 
                          content.includes('transitioning to assumptions') ||
                          content.includes('now in assumptions stage')) {
                        inChatStage = false;
                      }
                    }
                  }
                  
                  // Always use conversation history if it has queries, as it's the source of truth
                  // ChatManager might miss queries if they were processed before stage was 'chat'
                  if (chatStageUserQueries.length > 0) {
                    // Check if history has different/more queries than ChatManager
                    const historyHasMore = chatStageUserQueries.length > queries.length;
                    const historyHasDifferent = chatStageUserQueries.some(q => !queries.includes(q));
                    
                    // CRITICAL FIX: Check for DIFFERENT queries, not just MORE queries
                    // This fixes the bug where:
                    // - ChatManager has ["write unit test", "create README"] (2 queries, missing first)
                    // - History has ["create hello.py", "write unit test", "create README"] (3 queries)
                    // - Old code: 3 > 2 = true, works
                    // - But if ChatManager had 3 queries (including "move to assumptions"),
                    //   then 3 > 3 = false, bug! First query is lost!
                    // - New code: Checks historyHasDifferent, catches the missing first query
                    if (historyHasMore || historyHasDifferent || (!aggregatedPrompt && chatStageUserQueries.length > 0)) {
                      if (historyHasMore || historyHasDifferent) {
                        console.log(`[Harmony] Found ${chatStageUserQueries.length} queries in conversation history vs ${queries.length} in ChatManager. History has ${historyHasMore ? 'more' : 'different'} queries. Using history to ensure all queries are captured.`);
                      } else {
                        console.log(`[Harmony] ChatManager had no content, but found ${chatStageUserQueries.length} queries in conversation history. Using history.`);
                      }
                      
                      queries = chatStageUserQueries;
                      
                      // Rebuild aggregated prompt from all queries
                      if (queries.length === 1) {
                        aggregatedPrompt = queries[0];
                      } else if (queries.length > 1) {
                        aggregatedPrompt = `Please address the following requests:\n\n${queries.join('\n\n')}`;
                      }
                    }
                  }
                }
                
                if (aggregatedPrompt) {
                  prompt = aggregatedPrompt;
                  
                  // Collect assistant responses from chat stage
                  const assistantResponses: Array<{content: string; reasoning?: string}> = [];
                  if (conversationHistory && conversationHistory.length > 0) {
                    let inChatStage = true;
                    for (const message of conversationHistory) {
                      if (message.role === 'user') {
                        const content = message.content.trim();
                        const hasStageTransition = /\b(move\s+to|go\s+to|goto)\s+(assumptions|implementation|chat)\b/i.test(content);
                        if (hasStageTransition && content.toLowerCase().includes('assumptions')) {
                          break;
                        }
                      } else if (message.role === 'assistant') {
                        const assistantContent = message.content.trim();
                        if (inChatStage) {
                          if (assistantContent && assistantContent.length > 0) {
                            assistantResponses.push({
                              content: assistantContent,
                              reasoning: message.reasoning
                            });
                          }
                        }
                        // Check if assistant response indicates stage transition
                        const contentLower = assistantContent.toLowerCase();
                        if (contentLower.includes('moving to assumptions') || 
                            contentLower.includes('transitioning to assumptions') ||
                            contentLower.includes('now in assumptions stage')) {
                          inChatStage = false;
                        }
                      }
                    }
                  }
                  
                  // Get referred files from ChatManager
                  const referredFiles = this.chatManager.getReferredFiles();
                  
                  // Generate aggregated_prompt.json using AssumptionsManager
                  await this.assumptionsManager.generateAggregatedPromptFile(
                    {
                      queries: queries,
                      assistantResponses: assistantResponses,
                      referredFiles: referredFiles
                    },
                    conversationHistory,
                    this.nativeToolsManager,
                    this.contextManager
                  );
                }
                
                // Clear chat manager after transition
                this.chatManager.clear();
              }
              
              // When transitioning from assumptions to implementation, save assumptions data and initialize implementation manager
              if (previousStage === 'assumptions' && detectedStage === 'implementation') {
                // Also check for code contexts that were created in assumptions stage
                const context = this.contextManager.getContext();
                
                // Initialize implementation manager when entering implementation stage
                const taskId = context?.progressPlan?.taskId;
                if (taskId) {
                  this.implementationManager.initialize(taskId);
                  console.log(`[Harmony] Initialized ImplementationManager for task: ${taskId}`);
                }
                if (context?.codeContexts) {
                  for (const [fileName, versions] of context.codeContexts.entries()) {
                    const activeVersion = versions.find(v => v.isActive);
                    if (activeVersion && fileName !== 'aggregated_prompt.json' && fileName !== 'assumption_data.json') {
                      this.assumptionsManager.addCodeSnippet(
                        fileName,
                        activeVersion.description || `Code context for ${fileName}`
                      );
                    }
                  }
                }
                
                // If plan was created, ensure taskId is set in AssumptionsManager
                if (context?.progressPlan) {
                  // Ensure AssumptionsManager is initialized
                  if (!this.assumptionsManager.getState()) {
                    this.assumptionsManager.initialize();
                  }
                  this.assumptionsManager.setTaskId(context.progressPlan.taskId);
                  console.log(`[Harmony] Transition: Set taskId in AssumptionsManager: ${context.progressPlan.taskId}`);
                } else {
                  console.log(`[Harmony] Transition: No progressPlan found in context`);
                }
                
                // Export assumptions data using AssumptionsManager
                const assumptionsExport = this.assumptionsManager.exportForTransition(context?.originalPrompt);
                console.log(`[Harmony] Transition: Exported assumptions data - has progressPlan: ${!!assumptionsExport.progressPlan}, steps: ${assumptionsExport.progressPlan?.totalSteps || 0}`);
                
                // If a plan was created in exportForTransition, set it in context
                if (assumptionsExport.progressPlan && !context?.progressPlan) {
                  this.contextManager.setProgressPlan(assumptionsExport.progressPlan);
                }
                
                // Generate assumption_data.json using ImplementationManager
                await this.implementationManager.generateAssumptionDataFile(
                  assumptionsExport,
                  this.nativeToolsManager,
                  this.contextManager
                );
                
                // Clear assumptions manager after transition
                this.assumptionsManager.clear();
              }
              
              // Before transitioning to implementation, ensure we have a plan
              if (detectedStage === 'implementation') {
                const currentContext = this.contextManager.getContext();
                if (!currentContext?.progressPlan) {
                  console.warn(`[Harmony] ⚠️ Attempting to transition to implementation stage without a ProgressPlan. This should not happen - plan should be created in assumptions stage.`);
                  // Try to get plan from assumptions manager as fallback
                  const assumptionsExport = this.assumptionsManager.exportForTransition();
                  if (assumptionsExport.progressPlan) {
                    console.log(`[Harmony] Found plan in assumptions manager, setting it before transition`);
                    this.contextManager.setProgressPlan(assumptionsExport.progressPlan);
                  } else {
                    console.error(`[Harmony] ❌ Cannot transition to implementation stage: No ProgressPlan found. Please ensure you've completed the assumptions stage first.`);
                    // Don't transition - stay in current stage
                    return {
                      content: '⚠️ Cannot transition to implementation stage: No plan found. Please complete the assumptions/analysis stage first to create a plan.',
                      verboseInfo: VerboseInfoBuilder.forAssumptionStage(currentContext || null, undefined, conversationHistory),
                    };
                  }
                } else {
                  console.log(`[Harmony] ✅ ProgressPlan found - proceeding with transition to implementation stage`);
                }
              }
              
              // Perform the transition first
              this.contextManager.updateStage(detectedStage, prompt);
              // VerboseInfo will be included in the final response, no need to send it separately
              
              // Immediately refresh context to verify the update
              const updatedContext = this.contextManager.getContext();
              if (updatedContext) {
                if (updatedContext.currentStage === detectedStage) {
                  console.log(`[Harmony] ✅ Stage successfully updated in context: ${updatedContext.currentStage}`);
                  
                  // If transitioning to implementation via "move to implementation" command
                  // The stage handler will determine the action based on ProgressPlan/PlanStep
                  if (detectedStage === 'implementation' && /\b(move\s+to|go\s+to|goto|start|begin)\s+(implementation|implement)\b/i.test(prompt.toLowerCase())) {
                    console.log(`[Harmony] "move to implementation" detected - switching to implementation stage immediately`);
                    // Continue to stage handler pre-processing which will check ProgressPlan/PlanStep
                  }
                } else {
                  console.error(`[Harmony] ❌ ERROR: Stage update failed! Expected: ${detectedStage}, Got: ${updatedContext.currentStage}`);
                }
              }
            } else {
              console.log(`[Harmony] Stage remains: ${previousStage} (no transition needed)`);
            }
          }
        }
      } else {
        // For continuations, check if stage should change
        const context = this.contextManager.getContext();
        if (context) {
          const detectedStage = this.stageDetector.detectStage(
            prompt,
            conversationHistory,
            context
          );
          const previousStage = context.currentStage;
          if (detectedStage !== previousStage) {
            console.log(`[Harmony] Stage transition: ${previousStage} -> ${detectedStage}`);
            // Perform the transition first
            this.contextManager.updateStage(detectedStage, prompt);
            // VerboseInfo will be included in the final response, no need to send it separately
          }
        }
      }

      // Refresh context to get the latest stage after potential updates
      // IMPORTANT: Get fresh context to ensure we have the most up-to-date stage
      const context = this.contextManager.getContext();
      if (context && isContinuation) {
        logStepInfo(context.currentStep, context.maxSteps, context.originalPrompt);
      }

      // Check if we've exceeded max steps
      if (context && context.currentStep > context.maxSteps) {
        console.warn(
          `[Harmony] Reached maximum steps (${context.maxSteps}) for task: "${context.originalPrompt}"`
        );
        const verboseInfo = context.currentStage === 'chat'
          ? VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory)
          : context.currentStage === 'assumptions'
          ? VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory)
          : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager);
        verboseInfo.isComplete = true;
        delete verboseInfo.step;
        delete verboseInfo.maxSteps;
        
        // Log using toString() (doesn't affect returned object)
        try {
          withToString(verboseInfo).toString();
        } catch (e) {
          // Ignore logging errors
        }
        
        return {
          content: `I've gathered information through multiple steps, but haven't completed the task. Here's what I found so far.`,
          reasoning: "Reached maximum allowed steps for this task.",
          verboseInfo,
        };
      }

      const endpoint = `${this.config.serverUrl}/v1/completions`;
      
      // Get the current stage from context - this is the IMMEDIATE stage after any transitions
      // Stage detection and updates already happened earlier: lines 136-144 (new context) or 152-160 (existing context) or 170-179 (continuations)
      // Use the context we just refreshed to ensure we have the latest stage
      let currentStage = context?.currentStage || 'chat';
      
      // Log stage transition if it occurred
      if (context?.lastStageTransition) {
        const transition = context.lastStageTransition;
        console.log(`[Harmony] Stage transition applied: ${transition.from} -> ${transition.to}`);
        // Ensure we're using the new stage immediately
        if (context.currentStage === transition.to) {
          currentStage = transition.to;
          console.log(`[Harmony] Immediately using new stage: ${currentStage}`);
        }
      }
      
      // Verify we're using the correct stage
      if (context && context.currentStage !== currentStage) {
        console.warn(`[Harmony] Stage mismatch detected! Context stage: ${context.currentStage}, currentStage variable: ${currentStage}. Using context stage.`);
        currentStage = context.currentStage;
      }

      if (context) {
        console.log(
          `[Harmony] Current stage: ${currentStage} (step ${context.currentStep}/${context.maxSteps})`
        );
      } else {
        console.log(`[Harmony] Current stage: ${currentStage} (no active conversation context)`);
      }

      logApiRequest(endpoint, prompt, 100);

      // Use stage handler for pre-processing (table-based, no if-else)
      const preStageHandler = this.stageHandlerRegistry.getHandler(currentStage);
      if (preStageHandler.handlePreProcessing) {
        const preProcessResult = await preStageHandler.handlePreProcessing(
          context,
          prompt,
          this.nativeToolsManager,
          this.contextManager,
          this.progressPlanManager
        );
        
        if (preProcessResult.shouldSkipLLM && preProcessResult.response) {
          console.log(`[Harmony] Stage handler skipped LLM call, returning early`);
          return {
            ...preProcessResult.response,
            isContinuation: isContinuation,
          };
        }
      }

      // Legacy implementation stage check (to be removed after handler is fully tested)
      if (currentStage === 'implementation' && context && this.nativeToolsManager) {
        const codeContexts = this.contextManager.getCodeContexts();
        console.log(`[Harmony] Implementation stage: Checking for CodeContext... context exists: ${!!context}, nativeToolsManager exists: ${!!this.nativeToolsManager}, codeContexts found: ${codeContexts.length}`);
        if (codeContexts.length > 0) {
          console.log(`[Harmony] Implementation stage: Found ${codeContexts.length} code context(s), creating files from CodeContext...`);
          codeContexts.forEach((cc, idx) => {
            console.log(`[Harmony] Implementation stage: CodeContext[${idx}]: name="${cc.name}", waitForCreate=${cc.waitForCreate}, contentLines=${cc.content.length}`);
          });
          
          const createdFiles: string[] = [];
          const updatedFiles: string[] = [];
          const failedFiles: Array<{ path: string; error: string }> = [];
          const toolCalls: Array<{
            name: string;
            arguments: Record<string, any>;
            result?: any;
          }> = [];
          
          for (const codeContext of codeContexts) {
            if (codeContext.waitForCreate && codeContext.content && codeContext.content.length > 0) {
              try {
                const filePath = codeContext.name;
                
                // Validate CodeContext has valid content array
                if (!codeContext.content || !Array.isArray(codeContext.content) || codeContext.content.length === 0) {
                  console.warn(`[Harmony] Implementation stage: CodeContext for ${filePath} has invalid content array, skipping...`);
                  console.warn(`[Harmony] Implementation stage: Content array: ${JSON.stringify(codeContext.content)}`);
                  continue;
                }
                
                // Get content as string
                let content: string;
                try {
                  content = codeContext.getContentAsString();
                } catch (error) {
                  console.warn(`[Harmony] Implementation stage: Error calling getContentAsString() for ${filePath}:`, error);
                  // Fallback: manually join the content array
                  content = codeContext.content.filter(line => line != null).join('\n');
                }
                
                // Validate content is not empty or undefined
                if (!content || typeof content !== 'string' || content.trim().length === 0) {
                  console.warn(`[Harmony] Implementation stage: CodeContext for ${filePath} has empty or invalid content, skipping...`);
                  console.warn(`[Harmony] Implementation stage: Content type: ${typeof content}, length: ${content?.length}, contentLines: ${codeContext.content.length}`);
                  console.warn(`[Harmony] Implementation stage: First few content lines: ${JSON.stringify(codeContext.content.slice(0, 3))}`);
                  continue;
                }
                
                console.log(`[Harmony] Implementation stage: Creating file ${filePath} from CodeContext (${content.length} chars, ${codeContext.content.length} lines)...`);
                
                // Ensure content is a string (double-check)
                const fileContent = String(content);
                
                if (!fileContent || fileContent.length === 0) {
                  console.warn(`[Harmony] Implementation stage: File content is empty after conversion, skipping ${filePath}...`);
                  continue;
                }
                
                // Try to create the file directly (don't check if it exists first - let create_file handle it)
                const createResult = await this.nativeToolsManager.callTool('create_file', {
                  file_path: filePath,
                  content: fileContent
                });
                
                if (!createResult.isError) {
                  createdFiles.push(filePath);
                  this.contextManager.markCodeContextCreated(filePath);
                  toolCalls.push({
                    name: 'create_file',
                    arguments: { file_path: filePath, content: fileContent },
                    result: createResult
                  });
                  console.log(`[Harmony] Implementation stage: Successfully created file ${filePath} from CodeContext`);
                } else if (createResult.content?.[0]?.text?.includes('already exists')) {
                  // File exists, use replace_file
                  console.log(`[Harmony] Implementation stage: File ${filePath} exists, using replace_file...`);
                  const replaceResult = await this.nativeToolsManager.callTool('replace_file', {
                    file_path: filePath,
                    content: fileContent
                  });
                  if (!replaceResult.isError) {
                    updatedFiles.push(filePath);
                    this.contextManager.markCodeContextCreated(filePath);
                    toolCalls.push({
                      name: 'replace_file',
                      arguments: { file_path: filePath, content: fileContent },
                      result: replaceResult
                    });
                    console.log(`[Harmony] Implementation stage: Successfully updated file ${filePath} from CodeContext`);
                  } else {
                    const errorMsg = replaceResult.content?.[0]?.text || 'Unknown error';
                    failedFiles.push({ path: filePath, error: errorMsg });
                    console.warn(`[Harmony] Implementation stage: Failed to update file ${filePath}: ${errorMsg}`);
                  }
                } else {
                  const errorMsg = createResult.content?.[0]?.text || 'Unknown error';
                  failedFiles.push({ path: filePath, error: errorMsg });
                  console.warn(`[Harmony] Implementation stage: Failed to create file ${filePath}: ${errorMsg}`);
                }
              } catch (error: any) {
                console.warn(`[Harmony] Implementation stage: Error creating file ${codeContext.name}:`, error);
              }
            }
          }
          
          // If we created any files, update progressPlan before returning early
          // Note: If files were created from CodeContext in stageHandlers, step completion is already handled there
          // This block is for files created from code blocks in the response
          if (createdFiles.length > 0) {
            // Update progressPlan if it exists
            if (context?.progressPlan) {
              const plan = context.progressPlan;
              
              // Ensure ImplementationManager is initialized
              if (!this.implementationManager.getTaskId()) {
                this.implementationManager.initialize(plan.taskId);
              }
              
              // Get current step and mark it as completed using ImplementationManager
              const currentStep = this.implementationManager.getCurrentStep();
              if (currentStep) {
                const updated = this.implementationManager.completeStep(currentStep.stepNumber);
                if (updated) {
                  console.log(
                    `[Harmony] ProgressPlan: Marked step ${currentStep.stepNumber} (${currentStep.goal}) as completed after creating files from CodeContext`
                  );

                  // Check if plan is now complete
                  const updatedPlan = this.implementationManager.getProgressPlan();
                  if (updatedPlan?.completedAt) {
                    console.log(
                      `[Harmony] ProgressPlan: All steps completed! Plan "${plan.taskId}" is now complete.`
                    );
                  }
                }
              }
            }

            console.log(`[Harmony] Implementation stage: Created ${createdFiles.length} file(s) from CodeContext, returning early (skipping LLM call)`);
            
            // Track file operations for verbose info
            const fileOperations: FileOperationResult = {
              created: createdFiles.map(path => ({
                path,
                source: 'codeContext' as const,
                version: codeContexts.find(cc => cc.name === path)?.version,
                createdAt: Date.now()
              })),
              updated: updatedFiles.map(path => ({
                path,
                source: 'codeContext' as const,
                version: codeContexts.find(cc => cc.name === path)?.version,
                updatedAt: Date.now()
              })),
              failed: failedFiles.map(f => ({
                path: f.path,
                error: f.error,
                attemptedAt: Date.now()
              }))
            };
            
            const verboseInfo = VerboseInfoBuilder.forImplementationStage(
              context,
              this.progressPlanManager,
              fileOperations,
              toolCalls.map(tc => ({
                name: tc.name,
                stage: currentStage,
                success: !tc.result?.isError,
                error: tc.result?.isError ? (tc.result?.content?.[0]?.text || 'Unknown error') : undefined
              }))
            );
            verboseInfo.isComplete = true;
            delete verboseInfo.step;
            delete verboseInfo.maxSteps;
            
            // Log using toString() (doesn't affect returned object)
            try {
              withToString(verboseInfo).toString();
            } catch (e) {
              // Ignore logging errors
            }
            
            return {
              content: `Successfully created ${createdFiles.length} file(s) from code snippets: ${createdFiles.join(', ')}`,
              reasoning: undefined,
              commentary: undefined,
              final: undefined,
              toolCalls: toolCalls,
              isContinuation: isContinuation,
              verboseInfo
            };
          }
        }
      }

      // NOTE: Files should NOT be created in assumptions stage per state machine rules
      // Files are only created in implementation stage (see code at line 233)
      // This ensures proper stage flow: Chat -> Assumptions (code snippets) -> Implementation (file creation)

      // If the prompt is a stage transition command, replace it with the original user query from history
      // This ensures the LLM sees the actual task, not just "move to assumptions"
      // The conversation history already contains the transition command, so we extract the original query
      let effectivePrompt = prompt;
      if (this.isStageTransitionCommand(prompt)) {
        const originalQuery = this.extractOriginalQueryFromHistory(conversationHistory, context);
        if (originalQuery) {
          console.log(`[Harmony] Stage transition command detected: "${prompt}". Replacing with original query: "${originalQuery.substring(0, 100)}..."`);
          effectivePrompt = originalQuery;
        } else {
          // If no original query found (shouldn't happen in normal flow), use a transition message
          // that tells the LLM to reference the conversation history
          effectivePrompt = "Please proceed with the task from the conversation history above.";
          console.log(`[Harmony] Stage transition command detected but no original query found in history. Using transition message.`);
        }
      }

      // Build prompt using PromptBuilder
      const finalPrompt = await this.promptBuilder.buildPrompt(
        effectivePrompt,
        currentStage,
        context,
        isContinuation,
        conversationHistory,
        templateName,
        applyTemplate
      );

      // Log prompt preview
      const previewLength = 500;
      console.log(
        `[Harmony] Final prompt (stage: ${currentStage}, first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`
      );

      // Make API call
      const response = await axios.post(
        endpoint,
        {
          model: this.config.model,
          prompt: finalPrompt,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: false,
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey && {
              Authorization: `Bearer ${this.config.apiKey}`,
            }),
          },
        }
      );

      console.log(`[Harmony] API response status: ${response.status}`);

      // Check for truncation indicators
      const finishReason =
        response.data?.choices?.[0]?.finish_reason ||
        response.data?.finish_reason ||
        response.data?.choices?.[0]?.finishReason;
      const isTruncated = finishReason === "length" || finishReason === "max_tokens";

      if (isTruncated) {
        console.warn(
          `[Harmony] ⚠️ Response was truncated due to token limit (finish_reason: ${finishReason})`
        );
      }

      // Extract response text
      let rawResponse: string | undefined;
      if (response.data?.choices?.[0]?.text) {
        rawResponse = response.data.choices[0].text;
      } else if (response.data?.choices?.[0]?.message?.content) {
        rawResponse = response.data.choices[0].message.content;
      } else if (response.data?.text) {
        rawResponse = response.data.text;
      } else if (response.data?.content) {
        rawResponse = response.data.content;
      } else {
        console.error(
          `[Harmony] Unexpected response format:`,
          JSON.stringify(response.data).substring(0, 500)
        );
        throw new Error(
          `Unexpected API response format. Response: ${JSON.stringify(response.data).substring(0, 200)}`
        );
      }

      if (!rawResponse) {
        throw new Error("Received empty response from API");
      }

      console.log(`[Harmony] Raw response length: ${rawResponse.length}`);
      logLongMessage(`[Harmony] Raw response`, rawResponse);

      // Detect if response looks incomplete
      const looksIncomplete = this.responseValidator.detectIncompleteResponse(rawResponse);
      if (looksIncomplete || isTruncated) {
        const reason = isTruncated ? "token limit" : "incomplete structure";
        console.warn(`[Harmony] ⚠️ Response appears truncated or incomplete (${reason})`);
        console.warn(
          `[Harmony] Response length: ${rawResponse.length} chars, maxTokens: ${this.config.maxTokens}`
        );
        if (isTruncated) {
          console.warn(
            `[Harmony] Consider increasing harmony.maxTokens setting if responses are frequently truncated`
          );
        }
      }

      // Parse response
      // Pass user prompt for intent detection (prevents false positive file extraction)
      const parsed = this.harmonyProcessor.parseResponse(rawResponse, prompt);

      if (!parsed) {
        throw new Error("HarmonyProcessor.parseResponse returned undefined");
      }

      // Ensure content is defined (default to empty string if undefined)
      let content = parsed.content ?? '';
      
      console.log(
        `[Harmony] Parsed response - stage: ${currentStage}, content: ${content.length} chars, reasoning: ${parsed.reasoning?.length || 0} chars`
      );
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[Harmony] Found ${parsed.rawToolCalls.length} raw tool call(s) in response`);
      }
      console.log(`[Harmony] Content preview: ${content.substring(0, 300)}...`);

      // Enforce restatement in Chat stage
      this.responseValidator.enforceRestatement(parsed, currentStage, prompt);

      // Extract tool calls
      let toolCalls: MCPToolCall[] = [];
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[HarmonyClient] Processing ${parsed.rawToolCalls.length} raw tool call(s)`);
        const validToolCalls = parsed.rawToolCalls.filter((raw) => {
          const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(raw);
          const looksLikeXml = XmlProcessor.looksLikeXmlToolCall(raw);
          const looksLike = looksLikeMcpOrJson || looksLikeXml;
          console.log(
            `[HarmonyClient] Checking raw tool call: looksLike=${looksLike} (MCP/JSON=${looksLikeMcpOrJson}, XML=${looksLikeXml}), length=${raw.length}, preview="${raw.substring(0, 100)}..."`
          );
          return looksLike;
        });

        console.log(
          `[HarmonyClient] After filtering: ${validToolCalls.length} valid tool call(s) out of ${parsed.rawToolCalls.length}`
        );

        if (validToolCalls.length > 0) {
          console.log(
            `[HarmonyClient] Extracting tool calls from ${validToolCalls.length} valid raw tool call(s)...`
          );
          try {
            toolCalls = this.harmonyProcessor.extractToolCalls(validToolCalls);
            console.log(
              `[HarmonyClient] Extracted ${toolCalls.length} tool call(s):`,
              toolCalls.map((tc) => ({ name: tc.name, argsKeys: Object.keys(tc.arguments || {}) }))
            );
            if (toolCalls.length === 0 && validToolCalls.length > 0) {
              console.error(
                `[HarmonyClient] ⚠️ Extraction returned 0 tool calls but we had ${validToolCalls.length} valid raw tool calls!`
              );
              validToolCalls.forEach((raw, idx) => {
                console.error(
                  `[HarmonyClient] Failed to extract from rawToolCalls[${idx}]: "${raw.substring(0, 300)}..."`
                );
              });
            }
          } catch (error: any) {
            console.error(`[HarmonyClient] Error extracting tool calls:`, error);
            console.error(`[HarmonyClient] Raw tool calls that failed:`, validToolCalls);
          }
        } else if (parsed.rawToolCalls.length > 0) {
          console.warn(
            `[HarmonyClient] Found ${parsed.rawToolCalls.length} item(s) in rawToolCalls but none looked like tool calls. This may indicate a parsing issue.`
          );
          parsed.rawToolCalls.forEach((raw, idx) => {
            console.warn(`[HarmonyClient] rawToolCalls[${idx}]: "${raw.substring(0, 200)}..."`);
          });
        }
      }

      // Also check content for tool calls as fallback
      if (toolCalls.length === 0 && content) {
        console.log(`[Harmony] No tool calls found in rawToolCalls, checking content...`);
        toolCalls = this.harmonyProcessor.extractToolCalls([content]);
        if (toolCalls.length > 0) {
          console.log(`[Harmony] Extracted ${toolCalls.length} tool call(s) from content`);
        } else {
          console.log(`[Harmony] No tool calls found in content either`);
        }
      }

      // Save this step to conversation context
      if (context) {
        this.contextManager.addStep(
          toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments || {} })),
          parsed.reasoning,
          currentStage
        );
      }

      // Validate tool calls against stage restrictions
      const validation = this.responseValidator.validateToolCalls(toolCalls, currentStage);
      let toolCallsWereBlocked = validation.wereBlocked;

      console.log(
        `[Harmony] Validating ${toolCalls.length} tool call(s) in ${currentStage} stage. Restricted calls: ${validation.blockedToolCalls.length}`
      );

      if (validation.wereBlocked) {
        console.warn(
          `[Harmony] Blocked ${validation.blockedToolCalls.length} file modification tool call(s) in ${currentStage} stage: ${validation.blockedToolCalls.map((tc) => tc.name).join(", ")}`
        );
        console.log(
          `[Harmony] After blocking: ${validation.allowedToolCalls.length} tool call(s) remaining`
        );
        this.responseValidator.handleBlockedToolCalls(
          parsed,
          validation.blockedToolCalls,
          currentStage,
          prompt
        );
        // Update content variable after handleBlockedToolCalls modifies parsed.content
        content = parsed.content ?? '';
      }

      toolCalls = validation.allowedToolCalls;

      // Use stage handler to filter tool calls (e.g., chat stage prevents reading non-existent files)
      const stageHandler = this.stageHandlerRegistry.getHandler(currentStage);
      if (stageHandler.filterToolCalls) {
        const filterResult = await stageHandler.filterToolCalls(
          toolCalls,
          context,
          conversationHistory,
          this.nativeToolsManager
        );
        
        if (filterResult.blocked.length > 0) {
          console.log(
            `[Harmony] Stage handler filtered out ${filterResult.blocked.length} tool call(s) in ${currentStage} stage: ${filterResult.blocked.map((tc) => tc.name).join(", ")}`
          );
          // Update content to explain why tool calls were blocked
          if (currentStage === 'chat' && filterResult.blocked.some(tc => tc.name === 'read_file')) {
            const blockedFiles = filterResult.blocked
              .filter(tc => tc.name === 'read_file')
              .map(tc => tc.arguments?.file_path || tc.arguments?.filePath)
              .filter(Boolean);
            if (blockedFiles.length > 0) {
              content = `${content}\n\nNote: I cannot read ${blockedFiles.join(', ')} as ${blockedFiles.length === 1 ? 'it doesn\'t exist yet' : 'they don\'t exist yet'}. ${blockedFiles.length === 1 ? 'This file' : 'These files'} will be created in the implementation stage.`;
            }
          }
        }
        
        toolCalls = filterResult.filtered;
      }

      // Legacy assumptions stage code (to be removed after handler is fully tested)
      try {
        const hasToolCalls = parsed.rawToolCalls && parsed.rawToolCalls.length > 0;
        if (currentStage === 'assumptions' && context && content && !hasToolCalls && toolCalls.length === 0) {
          console.log(`[Harmony] Assumptions stage: Extracting code snippets from content (${content.length} chars)...`);
          const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
          const matches = content.matchAll(codeBlockPattern);
          let codeBlockCount = 0;
          
          for (const match of matches) {
            try {
              const codeBlock = match[0];
              const codeContext = CodeContext.fromCodeBlock(codeBlock);
              
              if (codeContext) {
                // Get the current user prompt from context for description extraction
                const currentPrompt = context.originalPrompt || prompt;
                this.contextManager.addCodeContext(codeContext, currentPrompt, content);
                
                // Track code snippet in AssumptionsManager
                this.assumptionsManager.addCodeSnippet(
                  codeContext.name,
                  codeContext.description || `Code snippet from assumptions stage`
                );
                
                codeBlockCount++;
                console.log(`[Harmony] Assumptions stage: Extracted code context for file: ${codeContext.name} (${codeContext.content.length} lines, version: ${codeContext.version})`);
              }
            } catch (error) {
              // Silently skip if code context extraction fails for a single block
              console.warn(`[Harmony] Failed to extract code context from block:`, error);
            }
          }
          
          if (codeBlockCount > 0) {
            console.log(`[Harmony] Assumptions stage: Added ${codeBlockCount} code context(s) ready for implementation`);
            const allContexts = this.contextManager.getCodeContexts();
            console.log(`[Harmony] Assumptions stage: Total CodeContext objects: ${allContexts.length}`);
          } else {
            console.log(`[Harmony] Assumptions stage: No code blocks found in content - CodeContext extraction returned 0 blocks`);
          }
          
          // Create or update plan in assumptions stage
          // Delegated to AssumptionsManager for centralized handling
          if (currentStage === 'assumptions' && context && content && !context.progressPlan) {
            try {
              const originalPrompt = context.originalPrompt || prompt;
              if (originalPrompt) {
                // Ensure AssumptionsManager is initialized
                if (!this.assumptionsManager.getState()) {
                  this.assumptionsManager.initialize();
                }
                
                // Use AssumptionsManager to create/update plan (centralized logic)
                const plan = this.assumptionsManager.createOrUpdatePlan(
                  content,
                  originalPrompt,
                  parsed.reasoning,
                  toolCalls
                );
                
                if (plan) {
                  this.contextManager.setProgressPlan(plan);
                  console.log(`[Harmony] Assumptions stage: Created ProgressPlan with ${plan.totalSteps} step(s) (complexity: ${plan.complexity}), taskId: ${plan.taskId}`);
                }
              }
            } catch (error) {
              // Don't let plan creation break the main flow
              console.warn(`[Harmony] Error during plan creation:`, error);
            }
          }
          
          // Track assumptions responses during assumptions stage
          if (currentStage === 'assumptions' && content) {
            this.assumptionsManager.addAssumption(content);
          }
        }
      } catch (error) {
        // Don't let code context extraction break the main flow
        console.warn(`[Harmony] Error during code context extraction:`, error);
      }

      // Initialize executedToolCalls
      let executedToolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
        result?: MCPToolResult;
      }> | undefined = undefined;

      if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
        console.log(`[Harmony] Executing ${toolCalls.length} tool call(s) in stage: ${currentStage}`);
        logToolCalls(toolCalls.map((tc) => ({ name: tc.name })));
        executedToolCalls = await this.toolExecutor.executeToolCalls(toolCalls, currentStage);
        console.log(
          `[Harmony] Completed execution of ${executedToolCalls.length} tool call(s) in stage: ${currentStage}`
        );

        // Use stage handler for post-processing (table-based, no if-else)
        const postStageHandler = this.stageHandlerRegistry.getHandler(currentStage);
        if (postStageHandler.handlePostProcessing) {
          await postStageHandler.handlePostProcessing(
            context,
            content,
            parsed,
            toolCalls,
            executedToolCalls,
            this.contextManager,
            this.progressPlanManager,
            this.autoTransitionManager,
            this.nativeToolsManager,
            conversationHistory
          );
        }

        // In implementation stage, if no tool calls were executed but content has code blocks, extract and create files
        if (currentStage === 'implementation' && executedToolCalls.length === 0 && content && this.nativeToolsManager) {
          const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
          const matches = content.matchAll(codeBlockPattern);
          const codeBlocks: Array<{ codeContext: CodeContext; match: RegExpMatchArray }> = [];
          
          for (const match of matches) {
            try {
              const codeBlock = match[0];
              const codeContext = CodeContext.fromCodeBlock(codeBlock);
              
              if (codeContext && codeContext.content.length > 0) {
                codeBlocks.push({ codeContext, match });
                console.log(`[Harmony] Implementation stage: Extracted code block for file: ${codeContext.name}`);
              }
            } catch (error) {
              console.warn(`[Harmony] Implementation stage: Failed to extract code context from block:`, error);
            }
          }

          // Create files from extracted code blocks
          if (codeBlocks.length > 0) {
            console.log(`[Harmony] Implementation stage: Found ${codeBlocks.length} code block(s) in response, creating files...`);
            const createdFiles: string[] = [];
            const fileCreationToolCalls: Array<{
              name: string;
              arguments: Record<string, any>;
              result?: any;
            }> = [];

            for (const { codeContext } of codeBlocks) {
              try {
                const filePath = codeContext.name;
                const fileContent = codeContext.getContentAsString();
                
                if (!fileContent || fileContent.trim().length === 0) {
                  console.warn(`[Harmony] Implementation stage: Skipping empty code block for ${filePath}`);
                  continue;
                }

                console.log(`[Harmony] Implementation stage: Creating file ${filePath} from code block (${fileContent.length} chars)...`);
                
                const createResult = await this.nativeToolsManager.callTool('create_file', {
                  file_path: filePath,
                  content: fileContent
                });

                if (!createResult.isError) {
                  createdFiles.push(filePath);
                  fileCreationToolCalls.push({
                    name: 'create_file',
                    arguments: { file_path: filePath, content: fileContent },
                    result: createResult
                  });
                  console.log(`[Harmony] Implementation stage: Successfully created file ${filePath} from code block`);
                } else if (createResult.content?.[0]?.text?.includes('already exists')) {
                  // File exists, use replace_file
                  console.log(`[Harmony] Implementation stage: File ${filePath} exists, using replace_file...`);
                  const replaceResult = await this.nativeToolsManager.callTool('replace_file', {
                    file_path: filePath,
                    content: fileContent
                  });
                  
                  if (!replaceResult.isError) {
                    createdFiles.push(filePath);
                    fileCreationToolCalls.push({
                      name: 'replace_file',
                      arguments: { file_path: filePath, content: fileContent },
                      result: replaceResult
                    });
                    console.log(`[Harmony] Implementation stage: Successfully updated file ${filePath} from code block`);
                  } else {
                    console.warn(`[Harmony] Implementation stage: Failed to update file ${filePath}: ${replaceResult.content?.[0]?.text || 'Unknown error'}`);
                  }
                } else {
                  console.warn(`[Harmony] Implementation stage: Failed to create file ${filePath}: ${createResult.content?.[0]?.text || 'Unknown error'}`);
                }
              } catch (error: any) {
                console.warn(`[Harmony] Implementation stage: Error creating file ${codeContext.name}:`, error);
              }
            }

            // Update executedToolCalls to include file creations for progressPlan update
            if (fileCreationToolCalls.length > 0) {
              executedToolCalls = fileCreationToolCalls.map(tc => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result
              }));
            }
          }
        }

        // Update progressPlan if it exists and we're in implementation stage
        // Use ImplementationManager to ensure consistent step tracking
        const contextForPlan = this.contextManager.getContext();
        if (contextForPlan?.progressPlan && currentStage === 'implementation' && executedToolCalls?.length > 0) {
          const plan = contextForPlan.progressPlan;
          const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
          
          // Ensure ImplementationManager is initialized
          if (!this.implementationManager.getTaskId()) {
            this.implementationManager.initialize(plan.taskId);
          }
          
          // Check for file modification tool executions (both successful and failed)
          const fileModToolCalls = executedToolCalls.filter(tc => 
            fileModificationTools.includes(tc.name)
          );

          if (fileModToolCalls.length > 0) {
            // Delegate to ImplementationManager to process file creations and complete steps
            // This will also handle reverting steps to pending if all tool calls failed
            const completedStepNumber = this.implementationManager.processFileCreations(executedToolCalls);
            
            if (completedStepNumber) {
              // Check if plan is now complete
              const updatedPlan = this.implementationManager.getProgressPlan();
              if (updatedPlan?.completedAt) {
                console.log(
                  `[Harmony] ProgressPlan: All steps completed! Plan "${plan.taskId}" is now complete.`
                );
              }
            }
          }
        }

        // Check if we should transition back to chat due to errors
        const updatedContext = this.contextManager.getContext();
        if (
          updatedContext &&
          this.stageStateMachine.shouldTransitionToChatOnError(currentStage, executedToolCalls)
        ) {
          console.log(
            `[Harmony] State machine: Transitioning from ${currentStage} to chat due to errors requiring clarification`
          );
          // Note: We don't dump verboseInfo for error-based transitions back to chat
          this.contextManager.updateStage("chat", `Error-based transition: Tool execution errors require clarification`);
          currentStage = "chat";
        }

        // Check for applicable rules
        let applicableRules: Rule[] = [];
        if (this.rulesManager) {
          applicableRules = this.rulesManager.getApplicableRules(prompt);
          if (applicableRules.length === 0) {
            applicableRules = this.rulesManager.getRulesForTools(executedToolCalls.map((tc) => tc.name));
          }
        }

        // Format tool results
        let finalContent = content;
        if (applicableRules.length > 0) {
          console.log(
            `[Rules] Formatting tool results according to ${applicableRules.length} rule(s) in ${currentStage} stage`
          );
          try {
            const formattedContent = await this.toolResultFormatter.formatToolResultsWithRules(
              executedToolCalls,
              applicableRules,
              prompt,
              currentStage
            );
            finalContent = formattedContent;
          } catch (formatError: any) {
            console.error(`[Rules] Error formatting tool results:`, formatError);
            finalContent += this.toolResultFormatter.formatToolResults(executedToolCalls);
          }
        } else {
          finalContent += this.toolResultFormatter.formatToolResults(executedToolCalls);
        }

        // Check if we should continue
        const updatedContextForContinuation = this.contextManager.getContext();
        const shouldContinue = this.continuationManager.shouldContinueTask(
          isContinuation ? (updatedContextForContinuation?.originalPrompt || prompt) : prompt,
          executedToolCalls || [],
          finalContent,
          isContinuation,
          currentStage,
          updatedContextForContinuation
        );

        // Build verbose info with tool calls
        const finalContext = this.contextManager.getContext();
        const toolCallsForVerbose = (executedToolCalls || []).map((tc) => {
          const toolCallInfo: any = {
            name: tc.name,
            stage: currentStage,
            success: !tc.result?.isError,
            error: tc.result?.isError
              ? tc.result.content?.[0]?.text || "Unknown error"
              : undefined,
          };
          
          // Add file path for file-related tool calls
          if (['create_file', 'write_file', 'replace_file', 'update_file'].includes(tc.name)) {
            const filePath = tc.arguments?.file_path || tc.arguments?.path;
            if (filePath) {
              toolCallInfo.file = filePath;
            }
          }
          
          return toolCallInfo;
        });
        
        let verboseInfo: VerboseInfo;
        if (currentStage === 'chat') {
          verboseInfo = VerboseInfoBuilder.forChatStage(
            finalContext,
            fileExtractionResult, // file extraction from extension.ts
            content, // response content for problem restatement
            parsed.reasoning, // response reasoning for problem restatement
            toolCallsForVerbose,
            conversationHistory
          );
        } else if (currentStage === 'assumptions') {
          verboseInfo = VerboseInfoBuilder.forAssumptionStage(
            finalContext,
            toolCallsForVerbose,
            conversationHistory
          );
        } else {
          // Implementation stage - track file operations from tool calls
          const fileOperations: FileOperationResult = {
            created: [],
            updated: [],
            failed: []
          };
          
          (executedToolCalls || []).forEach(tc => {
            if (['create_file', 'write_file'].includes(tc.name) && !tc.result?.isError) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations.created?.push({
                  path: filePath,
                  source: 'toolCall',
                  createdAt: Date.now()
                });
              }
            } else if (['replace_file', 'update_file'].includes(tc.name) && !tc.result?.isError) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations.updated?.push({
                  path: filePath,
                  source: 'toolCall',
                  updatedAt: Date.now()
                });
              }
            } else if (tc.result?.isError && ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations.failed?.push({
                  path: filePath,
                  error: tc.result.content?.[0]?.text || 'Unknown error',
                  attemptedAt: Date.now()
                });
              }
            }
          });
          
          verboseInfo = VerboseInfoBuilder.forImplementationStage(
            finalContext,
            this.progressPlanManager,
            fileOperations,
            toolCallsForVerbose
          );
        }
        
        // Log using toString() (doesn't affect returned object)
        try {
          withToString(verboseInfo).toString();
        } catch (e) {
          // Ignore logging errors
        }
        
        if (shouldContinue && finalContext) {
          // Check if we can continue
          if (finalContext.currentStep + 1 > finalContext.maxSteps) {
            console.warn(
              `[Harmony] Cannot continue: next step (${finalContext.currentStep + 1}) would exceed max steps (${finalContext.maxSteps})`
            );
            verboseInfo.isComplete = true;
            delete verboseInfo.step;
            delete verboseInfo.maxSteps;
            return {
              content: finalContent,
              reasoning: parsed.reasoning,
              commentary: parsed.commentary,
              final: parsed.final,
              ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
              isContinuation: isContinuation,
              verboseInfo,
            };
          }

          console.log(`[Harmony] Task incomplete, continuing to step ${finalContext.currentStep + 1}...`);

          // Prepare continuation prompt with stage awareness
          let continuationPrompt = `Based on the tool results, continue working on the original task.`;
          if (currentStage === "assumptions") {
            continuationPrompt = `Based on the tool results, continue analyzing and provide code snippets. Remember: you are in the assumptions stage - provide code snippets only, do NOT use file modification tools.`;
          } else if (currentStage === "chat") {
            continuationPrompt = `Based on the conversation, continue clarifying and understanding the requirements.`;
          }

          // Increment step counter
          this.contextManager.incrementStep();

          // Recursive call with continuation
          const continuationResponse = await this.callServer(
            continuationPrompt,
            templateName,
            applyTemplate,
            true,
            conversationHistory
          );

          // Merge tool calls from both responses
          const allToolCalls = [
            ...(executedToolCalls || []),
            ...(continuationResponse.toolCalls || []),
          ];
          // Merge verbose info from continuation
          const mergedVerboseInfo: VerboseInfo = continuationResponse.verboseInfo
            ? {
                ...continuationResponse.verboseInfo,
                toolCalls: [
                  ...(verboseInfo.toolCalls || []),
                  ...(continuationResponse.verboseInfo.toolCalls || []),
                ],
              } as VerboseInfo
            : verboseInfo;

          // Merge responses
          return {
            content: finalContent + "\n\n---\n\n" + continuationResponse.content,
            reasoning: parsed.reasoning,
            commentary: parsed.commentary || continuationResponse.commentary,
            final: parsed.final || continuationResponse.final,
            toolCalls: allToolCalls,
            isContinuation: true,
            verboseInfo: mergedVerboseInfo,
          };
        }

        return {
          content: finalContent,
          reasoning: parsed.reasoning,
          commentary: parsed.commentary,
          final: parsed.final,
          ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
          isContinuation: isContinuation,
          verboseInfo,
        };
      }

      // If no tool calls but model describes actions, check if we should continue
      const isImplementationStage = currentStage === "implementation";
      if (
        toolCalls.length === 0 &&
        content &&
        context &&
        isImplementationStage
      ) {
        const describesFileOperations = /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:file|content|property|field)/i.test(
          content
        );
        const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css|swift)/i.test(
          prompt.toLowerCase()
        );

        if (describesFileOperations && isFileTask) {
          console.log(
            `[HarmonyClient] Model describes file operations but didn't make tool calls. Triggering continuation...`
          );

          if (context.currentStep + 1 > context.maxSteps) {
            console.warn(
              `[Harmony] Cannot continue: next step (${context.currentStep + 1}) would exceed max steps (${context.maxSteps})`
            );
            return {
              content: content,
              reasoning: parsed.reasoning,
              commentary: parsed.commentary,
              final: parsed.final,
              isContinuation: isContinuation,
              verboseInfo: (() => {
                const stage = currentStage;
                const info = stage === 'chat'
                  ? VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory)
                  : stage === 'assumptions'
                  ? VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory)
                  : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager);
                info.isComplete = true;
                return info;
              })(),
            };
          }

          console.log(
            `[Harmony] Continuing to step ${context.currentStep + 1} to get model to make tool calls...`
          );

          const continuationPrompt = `Call the tools now. Use code from conversation history if available, otherwise generate it. Use create_file or replace_file to create the files.`;

          this.contextManager.incrementStep();

          const continuationResponse = await this.callServer(
            continuationPrompt,
            templateName,
            applyTemplate,
            true,
            conversationHistory
          );

          const stageForVerbose = currentStage;
          const noToolCallsVerboseInfo: VerboseInfo = context
            ? (stageForVerbose === 'chat'
                ? VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory)
                : stageForVerbose === 'assumptions'
                ? VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory)
                : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager))
            : (stageForVerbose === 'chat'
                ? VerboseInfoBuilder.forChatStage(null, undefined, undefined, undefined, undefined, conversationHistory)
                : stageForVerbose === 'assumptions'
                ? VerboseInfoBuilder.forAssumptionStage(null, undefined, conversationHistory)
                : VerboseInfoBuilder.forImplementationStage(null, this.progressPlanManager));

          const mergedVerboseInfo: VerboseInfo = continuationResponse.verboseInfo
            ? {
                ...continuationResponse.verboseInfo,
                stage: continuationResponse.verboseInfo.stage || stageForVerbose,
              } as VerboseInfo
            : noToolCallsVerboseInfo;

          return {
            content: content + "\n\n---\n\n" + continuationResponse.content,
            reasoning: parsed.reasoning,
            commentary: parsed.commentary || continuationResponse.commentary,
            final: parsed.final || continuationResponse.final,
            toolCalls: continuationResponse.toolCalls || [],
            isContinuation: true,
            verboseInfo: mergedVerboseInfo,
          };
        }
      }

      // Auto-transition from Assumptions to Implementation is DISABLED
      // Users must explicitly type "move to implementation" to transition
      // This ensures users have control over when to proceed to implementation stage
      // The state machine will handle explicit transition commands via stageDetector
      // 
      // Note: The auto-transition logic is commented out to require explicit user commands:
      // if (currentStage === "assumptions" && context && !toolCallsWereBlocked) {
      //   ... auto-transition code ...
      // }

      // Log final response summary
      if (context) {
        // Only show step info when there's a ProgressPlan (real multi-step task)
        const stepInfo = context.progressPlan 
          ? `, step: ${context.currentStep}/${context.maxSteps}` 
          : '';
        console.log(
          `[Harmony] Response complete - stage: ${currentStage}${stepInfo}, isContinuation: ${isContinuation}`
        );
      }

      // Build verbose info
      const finalContextForVerbose = this.contextManager.getContext();
      let verboseInfo: VerboseInfo = currentStage === 'chat'
        ? VerboseInfoBuilder.forChatStage(finalContextForVerbose, fileExtractionResult, content, parsed.reasoning, undefined, conversationHistory)
        : currentStage === 'assumptions'
        ? VerboseInfoBuilder.forAssumptionStage(finalContextForVerbose, undefined, conversationHistory)
        : VerboseInfoBuilder.forImplementationStage(finalContextForVerbose, this.progressPlanManager);
      verboseInfo.isComplete = true;
      delete verboseInfo.step;
      delete verboseInfo.maxSteps;

      // Log using toString() (doesn't affect returned object)
      try {
        withToString(verboseInfo).toString();
      } catch (e) {
        // Ignore logging errors
      }

      // Clear lastStageTransition after using it
      if (finalContextForVerbose?.lastStageTransition) {
        // Note: We can't directly mutate, but the context manager will handle this in next update
        // For now, we'll leave it as it will be cleared on next stage update
      }

      // Ensure Implementation stage has content
      let finalContent = content;
      if (!finalContent || !finalContent.trim()) {
        if (currentStage === "implementation" && toolCalls.length === 0 && !toolCallsWereBlocked) {
          // First, check if we have CodeContext objects ready to create
          const codeContexts = this.contextManager.getCodeContexts();
          const codeSnippets = CodeExtractor.extractCodeSnippetsFromHistory(conversationHistory);

          // If we have CodeContext, use that (it's more reliable than extracting from history)
          if (codeContexts.length > 0 && context) {
            if (context.currentStep + 1 <= context.maxSteps) {
              console.log(
                `[Harmony] Implementation stage: Empty content but found ${codeContexts.length} code context(s). Creating files...`
              );

              // Create files from CodeContext
              const createdFiles: string[] = [];
              for (const codeContext of codeContexts) {
                if (codeContext.waitForCreate && codeContext.content.length > 0 && this.nativeToolsManager) {
                  try {
                    const filePath = codeContext.name;
                    const content = codeContext.getContentAsString();
                    
                    // Try to create the file
                    const createResult = await this.nativeToolsManager.callTool('create_file', {
                      file_path: filePath,
                      content: content
                    });
                    
                    if (!createResult.isError) {
                      createdFiles.push(filePath);
                      this.contextManager.markCodeContextCreated(filePath);
                      console.log(`[Harmony] Implementation stage: Created file ${filePath} from CodeContext`);
                    } else if (createResult.content?.[0]?.text?.includes('already exists')) {
                      // File exists, use replace_file
                      const replaceResult = await this.nativeToolsManager.callTool('replace_file', {
                        file_path: filePath,
                        content: content
                      });
                      if (!replaceResult.isError) {
                        createdFiles.push(filePath);
                        this.contextManager.markCodeContextCreated(filePath);
                        console.log(`[Harmony] Implementation stage: Updated file ${filePath} from CodeContext`);
                      }
                    }
                  } catch (error: any) {
                    console.warn(`[Harmony] Implementation stage: Error creating file ${codeContext.name}:`, error);
                  }
                }
              }
              
              if (createdFiles.length > 0) {
                return {
                  content: `Successfully created ${createdFiles.length} file(s): ${createdFiles.join(', ')}`,
                  reasoning: parsed.reasoning,
                  commentary: parsed.commentary,
                  final: parsed.final,
                  toolCalls: createdFiles.map(filePath => {
                    const codeContext = codeContexts.find(cc => cc.name === filePath);
                    return {
                      name: 'create_file',
                      arguments: {
                        file_path: filePath,
                        content: codeContext?.getContentAsString() || ''
                      },
                      result: {
                        content: [{ type: 'text', text: `Successfully created file: ${filePath}` }],
                        isError: false
                      }
                    };
                  }),
                  isContinuation: isContinuation,
                  verboseInfo: (() => {
                    const vi = VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager, undefined, []);
                    // Log using toString() (doesn't affect returned object)
                    try {
                      withToString(vi).toString();
                    } catch (e) {
                      // Ignore logging errors
                    }
                    return vi;
                  })(),
                };
              }
            }
          }

          if (codeSnippets.length > 0 && context) {
            if (context.currentStep + 1 <= context.maxSteps) {
              console.log(
                `[Harmony] Implementation stage: Empty content but found ${codeSnippets.length} code snippet(s) in history. Triggering continuation...`
              );

              let continuationPrompt = `Create the files now using these code snippets from the Analysis stage. Call create_file or replace_file tools with the code below:\n\n`;
              codeSnippets.forEach((snippet, idx) => {
                continuationPrompt += `\n**Code Snippet ${idx + 1}:**\n${snippet}\n`;
              });
              continuationPrompt += `\nCall the tools now with the code above.`;

              this.contextManager.incrementStep();

              const continuationResponse = await this.callServer(
                continuationPrompt,
                templateName,
                applyTemplate,
                true,
                conversationHistory
              );

              const stageForVerbose3 = (context?.currentStage || currentStage) as 'chat' | 'assumptions' | 'implementation';
              const noToolCallsVerboseInfo: VerboseInfo = context
                ? (stageForVerbose3 === 'chat'
                    ? VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory)
                    : stageForVerbose3 === 'assumptions'
                    ? VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory)
                    : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager))
                : (stageForVerbose3 === 'chat'
                    ? VerboseInfoBuilder.forChatStage(null, undefined, undefined, undefined, undefined, conversationHistory)
                    : stageForVerbose3 === 'assumptions'
                    ? VerboseInfoBuilder.forAssumptionStage(null, undefined, conversationHistory)
                    : VerboseInfoBuilder.forImplementationStage(null, this.progressPlanManager));

              const mergedVerboseInfo: VerboseInfo = continuationResponse.verboseInfo
                ? {
                    ...continuationResponse.verboseInfo,
                    stage: continuationResponse.verboseInfo.stage || stageForVerbose3,
                  } as VerboseInfo
                : noToolCallsVerboseInfo;

              return {
                content: continuationResponse.content ?? '',
                reasoning: parsed.reasoning || continuationResponse.reasoning,
                commentary: parsed.commentary || continuationResponse.commentary,
                final: parsed.final || continuationResponse.final,
                toolCalls: continuationResponse.toolCalls || [],
                isContinuation: true,
                verboseInfo: mergedVerboseInfo,
              };
            } else {
              console.warn(
                `[Harmony] Cannot continue: next step (${context.currentStep + 1}) would exceed max steps (${context.maxSteps})`
              );
            }
          }

          // If no code snippets found but we're in implementation stage, trigger continuation to generate code
          // Only do this if we have conversation history (might have code snippets) or if explicitly continuing
          if (context && context.currentStep + 1 <= context.maxSteps && (conversationHistory && conversationHistory.length > 0 || isContinuation)) {
            console.log(
              `[Harmony] Implementation stage: Empty content and no code snippets in history. Triggering continuation to generate code...`
            );

            const continuationPrompt = `Create the file now. Check the conversation history for any code snippets from the Analysis stage. If code exists in history, use it. Otherwise, generate the code content needed for the file and call create_file or replace_file tool.`;

            this.contextManager.incrementStep();

            const continuationResponse = await this.callServer(
              continuationPrompt,
              templateName,
              applyTemplate,
              true,
              conversationHistory
            );

            // Use context.currentStage to avoid type narrowing issues with currentStage variable
            const stageForVerbose2 = (context?.currentStage || currentStage) as 'chat' | 'assumptions' | 'implementation';
            const noToolCallsVerboseInfo: VerboseInfo = context
              ? (stageForVerbose2 === 'chat'
                  ? VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory)
                  : stageForVerbose2 === 'assumptions'
                  ? VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory)
                  : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager))
              : (stageForVerbose2 === 'chat'
                  ? VerboseInfoBuilder.forChatStage(null, undefined, undefined, undefined, undefined, conversationHistory)
                  : stageForVerbose2 === 'assumptions'
                  ? VerboseInfoBuilder.forAssumptionStage(null, undefined, conversationHistory)
                  : VerboseInfoBuilder.forImplementationStage(null, this.progressPlanManager));

            const mergedVerboseInfo: VerboseInfo = continuationResponse.verboseInfo
              ? {
                  ...continuationResponse.verboseInfo,
                  stage: continuationResponse.verboseInfo.stage || currentStage,
                } as VerboseInfo
              : noToolCallsVerboseInfo;

            return {
              content: continuationResponse.content ?? '',
              reasoning: parsed.reasoning || continuationResponse.reasoning,
              commentary: parsed.commentary || continuationResponse.commentary,
              final: parsed.final || continuationResponse.final,
              toolCalls: continuationResponse.toolCalls || [],
              isContinuation: true,
              verboseInfo: mergedVerboseInfo,
            };
          }

          // Fallback: only show message if we can't continue and there were code snippets to work with
          // If no code snippets at all, just return empty content
          // Reuse codeContexts from earlier in the function scope
          if (codeSnippets.length > 0 || codeContexts.length > 0) {
            finalContent =
              "I understand you want me to create the file. Please check the conversation history for the code snippets from the Analysis stage, then use create_file tool to create the file.";
          }
        }
      }

      return {
        content: finalContent,
        reasoning: parsed.reasoning,
        commentary: parsed.commentary,
        final: parsed.final,
        ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
        isContinuation: isContinuation,
        verboseInfo,
      };
    } catch (error: any) {
      const context = this.contextManager.getContext();
      console.error(
        `[Harmony] Error calling Harmony server (stage: ${context?.currentStage || "unknown"}):`,
        error
      );
      throw new Error(`Failed to call Harmony server: ${error.message}`);
    }
  }

  /**
   * Reset conversation context
   */
  resetConversationContext(): void {
    this.contextManager.clear();
    this.progressPlanManager.clearAll();
    console.log(`[Harmony] Conversation context reset`);
  }

  /**
   * Get the current stage from the conversation context
   */
  getCurrentStage(): WorkflowStage {
    const context = this.contextManager.getContext();
    return context?.currentStage || 'chat';
  }

  /**
   * Get the ChatManager instance
   */
  getChatManager(): ChatManager {
    return this.chatManager;
  }

  /**
   * Get the AssumptionsManager instance
   */
  getAssumptionsManager(): AssumptionsManager {
    return this.assumptionsManager;
  }

  /**
   * Get current verboseInfo for display
   * Returns minimal verboseInfo for chat stage if no context exists
   */
  getCurrentVerboseInfo(conversationHistory?: readonly ChatMessage[]): VerboseInfo {
    const context = this.contextManager.getContext();
    
    // If no context exists, return minimal chat stage verboseInfo
    if (!context) {
      return VerboseInfoBuilder.forChatStage(null, undefined, undefined, undefined, undefined, conversationHistory);
    }

    const currentStage = context.currentStage;
    if (currentStage === 'chat') {
      return VerboseInfoBuilder.forChatStage(context, undefined, undefined, undefined, undefined, conversationHistory);
    } else if (currentStage === 'assumptions') {
      return VerboseInfoBuilder.forAssumptionStage(context, undefined, conversationHistory);
    } else {
      return VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager);
    }
  }

  /**
   * Check if a prompt is a stage transition command
   */
  private isStageTransitionCommand(prompt: string): boolean {
    const promptLower = prompt.toLowerCase().trim();
    const transitionPatterns = [
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i,
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(implementation|implement)\b/i,
      /\b(move\s+to|go\s+to|goto|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i,
    ];
    
    return transitionPatterns.some(pattern => pattern.test(promptLower));
  }

  /**
   * Extract the original user query from conversation history
   * This finds the first non-transition-command user message
   */
  private extractOriginalQueryFromHistory(
    conversationHistory?: readonly ChatMessage[],
    context?: ConversationContext | null
  ): string | null {
    // First, try to get the original prompt from context
    if (context?.originalPrompt) {
      // Check if original prompt is not a transition command
      if (!this.isStageTransitionCommand(context.originalPrompt)) {
        return context.originalPrompt;
      }
    }

    // If not found in context, search conversation history
    // Look for the most recent (last) user message that's not a transition command
    // This ensures we get the actual task the user wants to work on
    if (conversationHistory && conversationHistory.length > 0) {
      // Iterate backwards to find the most recent non-transition user message
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const message = conversationHistory[i];
        if (message.role === 'user' && !this.isStageTransitionCommand(message.content)) {
          return message.content;
        }
      }
    }

    return null;
  }

  /**
   * Set callback for pre-transition verboseInfo
   * This callback will be called before stage transitions to send verboseInfo to the webview
   */
  setVerboseInfoCallback(callback: VerboseInfoCallback): void {
    this.verboseInfoCallback = callback;
  }

  /**
   * Send verboseInfo before a stage transition
   * This captures the state of the current stage before transitioning to the next
   */
  private async sendVerboseInfoBeforeTransition(
    fromStage: WorkflowStage,
    toStage: WorkflowStage,
    context: ConversationContext | null,
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult
  ): Promise<void> {
    // Only send for specific transitions
    if ((fromStage === 'chat' && toStage === 'assumptions') ||
        (fromStage === 'assumptions' && toStage === 'implementation')) {
      
      let verboseInfo: VerboseInfo | undefined;
      
      if (fromStage === 'chat') {
        // Send chatVerboseInfo before transitioning to assumptions
        // Note: conversationHistory not available in this context, pass undefined
        verboseInfo = VerboseInfoBuilder.forChatStage(
          context,
          fileExtractionResult,
          undefined,
          undefined,
          undefined,
          undefined
        );
        console.log(`[Harmony] 📋 Sending chat verbose info to webview (before transition: chat -> assumptions)`);
      } else if (fromStage === 'assumptions') {
        // Send assumptionsVerboseInfo before transitioning to implementation
        // Note: conversationHistory not available in this context, pass undefined
        verboseInfo = VerboseInfoBuilder.forAssumptionStage(context, undefined, undefined);
        console.log(`[Harmony] 📋 Sending assumptions verbose info to webview (before transition: assumptions -> implementation)`);
      }
      
      if (verboseInfo && this.verboseInfoCallback) {
        try {
          // Log verboseInfo directly using logVerboseInfo
          // This ensures logging happens even if toString() has issues
          try {
            const formatted = VerboseInfoFormatter.format(verboseInfo);
            logVerboseInfo(verboseInfo, formatted);
          } catch (logError: any) {
            console.warn(`[Harmony] Error logging verboseInfo:`, logError);
            // Fallback: try using toString() wrapper
            try {
              const verboseInfoWithToString = withToString(verboseInfo);
              verboseInfoWithToString.toString(); // This also logs via logVerboseInfo() inside toString()
            } catch (toStringError: any) {
              console.warn(`[Harmony] Error calling toString() on verboseInfo:`, toStringError);
            }
          }
          
          // Send a plain, serializable copy of verboseInfo to callback
          // This ensures we don't pass any object with getter-only properties that can't be serialized
          // Use structuredClone if available (Node 17+), otherwise fall back to JSON serialization
          let plainVerboseInfo: VerboseInfo;
          if (typeof structuredClone !== 'undefined') {
            plainVerboseInfo = structuredClone(verboseInfo);
          } else {
            // Fallback for older Node versions
            plainVerboseInfo = JSON.parse(JSON.stringify(verboseInfo));
          }
          await this.verboseInfoCallback(plainVerboseInfo);
        } catch (error: any) {
          console.warn(`[Harmony] Error in verboseInfo callback:`, error);
        }
      }
    }
  }

  /**
   * Send verboseInfo to webview after a stage transition
   * This displays the verboseInfo for the current stage (after transition)
   */
  private async sendVerboseInfo(
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context || !this.verboseInfoCallback) {
      return;
    }

    try {
      // Build verboseInfo for the current stage (after transition)
      // Note: conversationHistory not available in this context, pass undefined
      const verboseInfo: VerboseInfo = context.currentStage === 'chat'
        ? VerboseInfoBuilder.forChatStage(context, fileExtractionResult, undefined, undefined, undefined, undefined)
        : context.currentStage === 'assumptions'
        ? VerboseInfoBuilder.forAssumptionStage(context, undefined, undefined)
        : VerboseInfoBuilder.forImplementationStage(context, this.progressPlanManager);

      console.log(`[Harmony] 📋 Sending ${context.currentStage} verbose info to webview (after transition)`);

      // Log verboseInfo directly using logVerboseInfo
      try {
        const formatted = VerboseInfoFormatter.format(verboseInfo);
        logVerboseInfo(verboseInfo, formatted);
      } catch (logError: any) {
        console.warn(`[Harmony] Error logging verboseInfo:`, logError);
        // Fallback: try using toString() wrapper
        try {
          const verboseInfoWithToString = withToString(verboseInfo);
          verboseInfoWithToString.toString(); // This also logs via logVerboseInfo() inside toString()
        } catch (toStringError: any) {
          console.warn(`[Harmony] Error calling toString() on verboseInfo:`, toStringError);
        }
      }

      // Send a plain, serializable copy of verboseInfo to callback
      // This ensures we don't pass any object with getter-only properties that can't be serialized
      // Use structuredClone if available (Node 17+), otherwise fall back to JSON serialization
      let plainVerboseInfo: VerboseInfo;
      if (typeof structuredClone !== 'undefined') {
        plainVerboseInfo = structuredClone(verboseInfo);
      } else {
        // Fallback for older Node versions
        plainVerboseInfo = JSON.parse(JSON.stringify(verboseInfo));
      }
      await this.verboseInfoCallback(plainVerboseInfo);
    } catch (error: any) {
      console.warn(`[Harmony] Error in verboseInfo callback:`, error);
    }
  }

  /**
   * Manually transition to a different stage
   * Validates the transition using the stage state machine
   */
  async transitionStage(to: WorkflowStage, prompt?: string): Promise<boolean> {
    const currentStage = this.getCurrentStage();
    
    // Check if transition is valid
    if (!this.stageStateMachine.canTransition(currentStage, to)) {
      console.log(`[Harmony] Invalid stage transition: ${currentStage} -> ${to}`);
      return false;
    }
    
    // Perform the transition first
    this.contextManager.updateStage(to, prompt || `Manual transition from ${currentStage} to ${to}`);
    console.log(`[Harmony] Stage transitioned: ${currentStage} -> ${to}`);
    
    // Send verboseInfo after transition
    await this.sendVerboseInfo();
    
    return true;
  }

  /**
   * Get the progress plan manager (for testing purposes)
   */
  getProgressPlanManager(): ProgressPlanManager {
    return this.progressPlanManager;
  }

  /**
   * Get the current conversation context
   */
  getContext(): ConversationContext | null {
    return this.contextManager.getContext();
  }

  /**
   * Check if first-principles mode should be activated based on prompt
   */
  shouldActivateFirstPrinciples(prompt: string): boolean {
    return this.stageDetector.detectFirstPrinciplesMode(prompt);
  }

  /**
   * Activate or deactivate first-principles mode
   */
  setFirstPrinciplesMode(enabled: boolean): void {
    this.contextManager.setFirstPrinciplesMode(enabled);
  }

  /**
   * Check if first-principles mode is active
   */
  isFirstPrinciplesMode(): boolean {
    return this.contextManager.isFirstPrinciplesMode();
  }
}


