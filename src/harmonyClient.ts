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
  StateTransitionManager,
  ResponseProcessor,
  ToolExecutionCoordinator,
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
import {
  VerboseInfo,
  VerboseInfoFormatter,
  FileOperationResult,
  withToString,
} from "./utils/verboseInfo";
import { VerboseInfoManager } from "./harmony/verboseInfoManager";

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

export type VerboseInfoCallback = (
  verboseInfo: VerboseInfo
) => void | Promise<void>;

export type IntermediateResponseCallback = (
  response: HarmonyResponse
) => void | Promise<void>;

/**
 * Main HarmonyClient with HarmonyProcessor integration and multi-step continuation
 * Refactored to use modular components for better maintainability
 */
export class HarmonyClient {
  private stageStateMachine: StageStateMachine;
  private harmonyProcessor: HarmonyProcessor;
  private progressPlanManager: ProgressPlanManager;
  private verboseInfoManager: VerboseInfoManager;
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

  // Extracted manager components (for refactored callServer)
  private stateTransitionManager: StateTransitionManager;
  private responseProcessor: ResponseProcessor;
  private toolExecutionCoordinator: ToolExecutionCoordinator;

  // Callback for pre-transition verboseInfo
  private verboseInfoCallback?: VerboseInfoCallback;
  // Callback for intermediate responses in auto mode
  private intermediateResponseCallback?: IntermediateResponseCallback;

  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {
    // Set verbose logging for tool extraction based on config
    const { Logger } = require("./utils/logger");
    Logger.setVerboseToolExtraction(config.verboseToolExtraction || false);

    this.harmonyProcessor = new HarmonyProcessor(config.harmonyMode);
    this.stageStateMachine = new StageStateMachine();
    this.progressPlanManager = new ProgressPlanManager();

    // Initialize modular components
    this.contextManager = new ConversationContextManager();
    this.chatManager = new ChatManager();
    this.autoTransitionManager = new AutoTransitionManager(
      this.progressPlanManager
    );
    this.assumptionsManager = new AssumptionsManager(
      this.progressPlanManager,
      this.autoTransitionManager
    );
    this.implementationManager = new ImplementationManager(
      this.progressPlanManager
    );
    this.stageHandlerRegistry = new StageHandlerRegistry(
      this.implementationManager,
      this.chatManager
    );
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

    // Initialize extracted manager components
    this.stateTransitionManager = new StateTransitionManager(
      this.contextManager,
      this.stageDetector,
      this.chatManager,
      this.assumptionsManager,
      this.implementationManager
    );
    this.responseProcessor = new ResponseProcessor(
      config,
      this.harmonyProcessor,
      this.responseValidator
    );
    this.toolExecutionCoordinator = new ToolExecutionCoordinator(
      this.toolExecutor,
      this.toolResultFormatter,
      this.contextManager,
      this.progressPlanManager,
      this.autoTransitionManager,
      this.implementationManager,
      rulesManager,
      nativeToolsManager
    );

    this.verboseInfoManager = new VerboseInfoManager(this.progressPlanManager);
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
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult,
    isAutoMode: boolean = false
  ): Promise<HarmonyResponse> {
    try {
      // Detect if this is auto mode trigger (first time only)
      const isAutoModeStart =
        !isAutoMode &&
        /@cmd:auto|auto\s+mode|execute\s+all/i.test(prompt.toLowerCase());
      const effectiveAutoMode = isAutoMode || isAutoModeStart;

      // Phase 1: Initialize conversation and handle state transitions
      await this.handleConversationInitialization(
        prompt,
        isContinuation,
        conversationHistory,
        fileExtractionResult
      );

      // Phase 2: Prepare for LLM call
      const currentStage = this.stateTransitionManager.getCurrentStage();
      this.stateTransitionManager.logCurrentStageInfo(isContinuation);

      if (this.stateTransitionManager.isMaxStepsExceeded()) {
        return this.buildMaxStepsExceededResponse();
      }

      // Phase 3: Get and execute the LLM call with stage-specific handling
      const response = await this.executeLLMCallAndProcess(
        prompt,
        currentStage,
        templateName,
        applyTemplate,
        isContinuation,
        conversationHistory,
        fileExtractionResult
      );

      // Phase 4: Handle auto mode continuation
      // If we're in implementation stage and auto mode is active, check if plan is complete
      if (effectiveAutoMode && currentStage === "implementation") {
        const isPlanCompleted = this.isProgressPlanCompleted();
        if (!isPlanCompleted) {
          // Plan not complete - send intermediate response and continue with next step in auto mode
          console.log(
            `[Harmony] Auto mode: Step completed, sending intermediate result to UI...`
          );

          // Send intermediate response to webview UI if callback is available
          if (this.intermediateResponseCallback) {
            try {
              await this.intermediateResponseCallback(response);
            } catch (error: any) {
              console.warn(
                `[Harmony] Error sending intermediate response:`,
                error
              );
            }
          }

          console.log(`[Harmony] Auto mode: Continuing to next step...`);

          // Recursively call with @cmd:auto to trigger next step, passing isAutoMode=true
          const continuationResponse = await this.callServer(
            "@cmd:auto",
            templateName,
            applyTemplate,
            true,
            conversationHistory,
            fileExtractionResult,
            true // isAutoMode flag
          );

          // Append continuation response to current response
          return {
            content:
              response.content + "\n\n---\n\n" + continuationResponse.content,
            reasoning: response.reasoning || continuationResponse.reasoning,
            commentary: response.commentary || continuationResponse.commentary,
            final: response.final || continuationResponse.final,
            toolCalls: [
              ...(response.toolCalls || []),
              ...(continuationResponse.toolCalls || []),
            ],
            isContinuation: true,
            verboseInfo: continuationResponse.verboseInfo,
          };
        } else {
          // All steps completed
          console.log(`[Harmony] Auto mode: All steps completed`);
          return response;
        }
      }

      return response;
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
   * Phase 1: Initialize conversation and handle state transitions
   */
  private async handleConversationInitialization(
    prompt: string,
    isContinuation: boolean,
    conversationHistory?: readonly ChatMessage[],
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult
  ): Promise<void> {
    if (!isContinuation) {
      // Initialize new conversation
      if (!this.contextManager.hasContext()) {
        await this.stateTransitionManager.initializeConversation(
          prompt,
          conversationHistory
        );
      } else {
        // Check for stage transitions in existing context
        await this.stateTransitionManager.checkAndPerformStageTransition(
          prompt,
          conversationHistory,
          this.nativeToolsManager
        );
      }
    } else {
      // Handle continuation stage check
      await this.stateTransitionManager.handleContinuation(
        prompt,
        conversationHistory
      );
    }
  }

  /**
   * Build response when max steps exceeded
   */
  private buildMaxStepsExceededResponse(): HarmonyResponse {
    const context = this.contextManager.getContext();
    const stage = context?.currentStage || "chat";

    const verboseInfo = this.verboseInfoManager.buildVerboseInfo(
      stage,
      context
    );

    return {
      content: `I've gathered information through multiple steps, but haven't completed the task. Here's what I found so far.`,
      reasoning: "Reached maximum allowed steps for this task.",
      verboseInfo,
    };
  }

  /**
   * Phase 3: Execute LLM call and process response
   */
  private async executeLLMCallAndProcess(
    prompt: string,
    currentStage: WorkflowStage,
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
    const context = this.contextManager.getContext();

    console.log(
      `[Harmony] Current stage: ${currentStage} (step ${context?.currentStep || 0}/${context?.maxSteps || 0})`
    );

    // Pre-processing via stage handler
    const preStageHandler = this.stageHandlerRegistry.getHandler(currentStage);
    const detectedTrigger = this.stageStateMachine.detectTrigger(
      prompt,
      currentStage,
      undefined
    );

    if (preStageHandler.handlePreProcessing) {
      const preProcessResult = await preStageHandler.handlePreProcessing(
        context,
        prompt,
        this.nativeToolsManager,
        this.contextManager,
        this.progressPlanManager,
        detectedTrigger,
        this
      );

      if (preProcessResult.shouldSkipLLM && preProcessResult.response) {
        console.log(
          `[Harmony] Stage handler skipped LLM call, returning early`
        );
        return {
          ...preProcessResult.response,
          isContinuation: isContinuation,
        };
      }
    }

    // Build prompt and call LLM
    const effectivePrompt = this.getEffectivePrompt(
      prompt,
      conversationHistory,
      context
    );
    const finalPrompt = await this.promptBuilder.buildPrompt(
      effectivePrompt,
      currentStage,
      context,
      isContinuation,
      conversationHistory,
      templateName,
      applyTemplate,
      this.isFirstPrinciplesMode()
    );

    const previewLength = 500;
    console.log(
      `[Harmony] Final prompt (stage: ${currentStage}, first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`
    );

    // Call LLM
    const rawResponse = await this.responseProcessor.callLLMApi(finalPrompt);

    // Parse response
    const parsed = this.responseProcessor.parseResponse(rawResponse, prompt);

    if (!parsed) {
      throw new Error(
        `[Harmony] Failed to parse response at stage ${currentStage}`
      );
    }

    let content = parsed.content ?? "";

    console.log(
      `[Harmony] Parsed response - stage: ${currentStage}, content: ${content.length} chars, reasoning: ${parsed.reasoning?.length || 0} chars`
    );

    // Enforce restatement
    this.responseProcessor.enforceRestatement(parsed, currentStage, prompt);

    // Extract and validate tool calls
    let toolCalls = this.responseProcessor.extractToolCalls(parsed, content);
    const validation = this.responseProcessor.validateAndFilterToolCalls(
      toolCalls,
      currentStage,
      prompt
    );

    if (validation.wereBlocked) {
      this.responseProcessor.handleBlockedToolCalls(
        parsed,
        validation.blockedToolCalls,
        currentStage,
        prompt
      );
      content = parsed.content ?? "";
    }

    toolCalls = validation.allowedToolCalls;

    // Stage-specific tool call filtering
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
          `[Harmony] Stage handler filtered out ${filterResult.blocked.length} tool call(s)`
        );
        if (
          currentStage === "chat" &&
          filterResult.blocked.some((tc) => tc.name === "read_file")
        ) {
          const blockedFiles = filterResult.blocked
            .filter((tc) => tc.name === "read_file")
            .map((tc) => tc.arguments?.file_path || tc.arguments?.filePath)
            .filter(Boolean);
          if (blockedFiles.length > 0) {
            content = `${content}\n\nNote: I cannot read ${blockedFiles.join(", ")} as ${blockedFiles.length === 1 ? "it doesn't exist yet" : "they don't exist yet"}. ${blockedFiles.length === 1 ? "This file" : "These files"} will be created in the implementation stage.`;
          }
        }
      }

      toolCalls = filterResult.filtered;
    }

    // Process code contexts and plans (assumptions stage specific)
    await this.processAssumptionsStageLogic(
      currentStage,
      context,
      content,
      parsed,
      toolCalls
    );

    // Save step to context
    if (context) {
      this.contextManager.addStep(
        toolCalls.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments || {},
        })),
        parsed.reasoning,
        currentStage
      );
    }

    // Execute tool calls
    return await this.processToolExecutionAndContinuation(
      toolCalls,
      currentStage,
      parsed,
      content,
      prompt,
      isContinuation,
      conversationHistory,
      fileExtractionResult,
      templateName,
      applyTemplate
    );
  }

  /**
   * Get effective prompt (handle stage transition commands)
   */
  private getEffectivePrompt(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    context?: ConversationContext | null
  ): string {
    if (!this.isStageTransitionCommand(prompt)) {
      return prompt;
    }

    const originalQuery = this.extractOriginalQueryFromHistory(
      conversationHistory,
      context
    );

    if (originalQuery) {
      console.log(
        `[Harmony] Stage transition command detected. Using original query instead.`
      );
      return originalQuery;
    }

    return "Please proceed with the task from the conversation history above.";
  }

  /**
   * Process assumptions stage specific logic
   */
  private async processAssumptionsStageLogic(
    currentStage: WorkflowStage,
    context: ConversationContext | null,
    content: string,
    parsed: HarmonyParseResult,
    toolCalls: MCPToolCall[]
  ): Promise<void> {
    if (currentStage !== "assumptions" || !context || !content) {
      return;
    }

    try {
      // Extract code snippets
      const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
      const matches = content.matchAll(codeBlockPattern);
      let codeBlockCount = 0;

      for (const match of matches) {
        try {
          const codeBlock = match[0];
          const codeContext = CodeContext.fromCodeBlock(codeBlock);

          if (codeContext) {
            const currentPrompt = context.originalPrompt || "";
            this.contextManager.addCodeContext(
              codeContext,
              currentPrompt,
              content
            );
            this.assumptionsManager.addCodeSnippet(
              codeContext.name,
              codeContext.description || "Code snippet from assumptions stage"
            );
            codeBlockCount++;
            console.log(
              `[Harmony] Assumptions stage: Extracted code context for ${codeContext.name}`
            );
          }
        } catch (error) {
          console.warn(
            `[Harmony] Failed to extract code context from block:`,
            error
          );
        }
      }

      if (codeBlockCount > 0) {
        console.log(
          `[Harmony] Assumptions stage: Added ${codeBlockCount} code context(s)`
        );
      }

      // Create or update plan
      const originalPrompt = context.originalPrompt || "";
      if (originalPrompt) {
        if (!this.assumptionsManager.getState()) {
          this.assumptionsManager.initialize();
        }

        const existingContext = this.contextManager.getContext();
        const existingTaskId = existingContext?.progressPlan?.taskId;
        if (existingTaskId) {
          this.assumptionsManager.setTaskId(existingTaskId);
        }

        const plan = this.assumptionsManager.createOrUpdatePlan(
          content,
          originalPrompt,
          parsed.reasoning,
          toolCalls,
          existingTaskId
        );

        if (plan) {
          this.contextManager.setProgressPlan(plan);
          console.log(
            `[Harmony] Assumptions stage: ${existingContext?.progressPlan ? "Updated" : "Created"} ProgressPlan`
          );
        }
      }

      // Track assumptions
      this.assumptionsManager.addAssumption(content);
    } catch (error) {
      console.warn(
        `[Harmony] Error during assumptions stage processing:`,
        error
      );
    }
  }

  /**
   * Process tool execution and handle continuation
   */
  private async processToolExecutionAndContinuation(
    toolCalls: MCPToolCall[],
    currentStage: WorkflowStage,
    parsed: HarmonyParseResult,
    content: string,
    prompt: string,
    isContinuation: boolean,
    conversationHistory?: readonly ChatMessage[],
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult,
    templateName?: string,
    applyTemplate?: (
      templateName: string,
      context: any,
      history?: readonly ChatMessage[]
    ) => Promise<string>
  ): Promise<HarmonyResponse> {
    let executedToolCalls:
      | Array<{
          name: string;
          arguments: Record<string, any>;
          result?: MCPToolResult;
        }>
      | undefined;

    if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
      // Execute tools
      executedToolCalls = await this.toolExecutionCoordinator.executeToolCalls(
        toolCalls,
        currentStage
      );

      // Post-processing via stage handler
      const postStageHandler =
        this.stageHandlerRegistry.getHandler(currentStage);
      if (postStageHandler.handlePostProcessing) {
        await postStageHandler.handlePostProcessing(
          this.contextManager.getContext(),
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

      // Handle implementation stage file creation from code blocks
      if (currentStage === "implementation" && executedToolCalls.length === 0) {
        const codeBlockResult =
          await this.toolExecutionCoordinator.createFilesFromCodeBlocks(
            content
          );
        if (codeBlockResult.createdFiles.length > 0) {
          executedToolCalls = codeBlockResult.createdFiles.map((path) => ({
            name: "create_file",
            arguments: { file_path: path },
          }));
        }
      }

      // Update progress plan
      if (executedToolCalls && executedToolCalls.length > 0) {
        this.toolExecutionCoordinator.updateProgressPlan(
          executedToolCalls,
          currentStage
        );
      }

      // Format tool results
      let finalContent = content;
      if (executedToolCalls.length > 0) {
        const formattedResults =
          await this.toolExecutionCoordinator.formatToolResults(
            executedToolCalls,
            prompt,
            currentStage
          );
        finalContent += formattedResults;
      }

      // Check for continuation
      const updatedContext = this.contextManager.getContext();
      const shouldContinue = this.continuationManager.shouldContinueTask(
        isContinuation ? updatedContext?.originalPrompt || prompt : prompt,
        executedToolCalls || [],
        finalContent,
        isContinuation,
        currentStage,
        updatedContext
      );

      if (shouldContinue && updatedContext) {
        if (updatedContext.currentStep + 1 > updatedContext.maxSteps) {
          return {
            content: finalContent,
            reasoning: parsed.reasoning,
            commentary: parsed.commentary,
            final: parsed.final,
            toolCalls: executedToolCalls,
            isContinuation: isContinuation,
            verboseInfo: this.buildVerboseInfo(currentStage, updatedContext, {
              executedToolCalls,
            }),
          };
        }

        console.log(
          `[Harmony] Task incomplete, continuing to step ${updatedContext.currentStep + 1}...`
        );

        this.contextManager.incrementStep();

        const continuationResponse = await this.callServer(
          this.getContinuationPrompt(currentStage),
          templateName,
          applyTemplate,
          true,
          conversationHistory
        );

        return {
          content: finalContent + "\n\n---\n\n" + continuationResponse.content,
          reasoning: parsed.reasoning,
          commentary: parsed.commentary || continuationResponse.commentary,
          final: parsed.final || continuationResponse.final,
          toolCalls: [
            ...(executedToolCalls || []),
            ...(continuationResponse.toolCalls || []),
          ],
          isContinuation: true,
          verboseInfo: continuationResponse.verboseInfo,
        };
      }

      return {
        content: finalContent,
        reasoning: parsed.reasoning,
        commentary: parsed.commentary,
        final: parsed.final,
        toolCalls: executedToolCalls,
        isContinuation: isContinuation,
        verboseInfo: this.buildVerboseInfo(currentStage, updatedContext, {
          fileExtractionResult,
          executedToolCalls,
        }),
      };
    }

    // No tool calls - handle empty content and possible continuation
    return await this.handleNoToolCalls(
      currentStage,
      content,
      parsed,
      prompt,
      isContinuation,
      conversationHistory,
      fileExtractionResult,
      templateName,
      applyTemplate
    );
  }

  /**
   * Get continuation prompt based on stage
   */
  private getContinuationPrompt(currentStage: WorkflowStage): string {
    if (currentStage === "assumptions") {
      return `Based on the tool results, continue analyzing and provide code snippets. Remember: you are in the assumptions stage - provide code snippets only, do NOT use file modification tools.`;
    } else if (currentStage === "chat") {
      return `Based on the conversation, continue clarifying and understanding the requirements.`;
    }
    return `Based on the tool results, continue working on the original task.`;
  }

  /**
   * Handle case with no tool calls
   */
  private async handleNoToolCalls(
    currentStage: WorkflowStage,
    content: string,
    parsed: HarmonyParseResult,
    prompt: string,
    isContinuation: boolean,
    conversationHistory?: readonly ChatMessage[],
    fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult,
    templateName?: string,
    applyTemplate?: (
      templateName: string,
      context: any,
      history?: readonly ChatMessage[]
    ) => Promise<string>
  ): Promise<HarmonyResponse> {
    const context = this.contextManager.getContext();
    let finalContent = content;

    // Check if in implementation stage and should trigger continuation
    if (currentStage === "implementation" && context) {
      const describesFileOperations =
        /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:file|content)/i.test(
          content
        );
      const isFileTask =
        /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py)/i.test(
          prompt.toLowerCase()
        );

      if (
        describesFileOperations &&
        isFileTask &&
        context.currentStep + 1 <= context.maxSteps
      ) {
        console.log(
          `[Harmony] Model describes file operations but didn't make tool calls. Triggering continuation...`
        );

        this.contextManager.incrementStep();

        const continuationResponse = await this.callServer(
          `Call the tools now. Use code from conversation history if available, otherwise generate it.`,
          templateName,
          applyTemplate,
          true,
          conversationHistory
        );

        return {
          content: content + "\n\n---\n\n" + continuationResponse.content,
          reasoning: parsed.reasoning,
          commentary: parsed.commentary || continuationResponse.commentary,
          final: parsed.final || continuationResponse.final,
          toolCalls: continuationResponse.toolCalls || [],
          isContinuation: true,
          verboseInfo: continuationResponse.verboseInfo,
        };
      }
    }

    return {
      content: finalContent,
      reasoning: parsed.reasoning,
      commentary: parsed.commentary,
      final: parsed.final,
      isContinuation: isContinuation,
      verboseInfo: this.buildVerboseInfo(currentStage, context, {
        fileExtractionResult,
      }),
    };
  }

  /**
   * Build verbose info for response
   */
  private buildVerboseInfo(
    currentStage: WorkflowStage,
    context: ConversationContext | null,
    options: {
      fileExtractionResult?: import("./utils/verboseInfo").FileExtractionResult;
      toolCallsForVerbose?: VerboseInfo["toolCalls"];
      executedToolCalls?: Array<{
        name: string;
        arguments: Record<string, any>;
        result?: MCPToolResult;
      }>;
      fileOperations?: FileOperationResult;
      content?: string;
      reasoning?: string;
      conversationHistory?: readonly ChatMessage[];
    } = {}
  ): VerboseInfo {
    return this.verboseInfoManager.buildVerboseInfo(
      currentStage,
      context,
      options
    );
  }

  /**
   * Call LLM server with prompt
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
                      verboseInfo: this.verboseInfoManager.buildVerboseInfo(
                        "assumptions",
                        currentContext || null,
                        { conversationHistory }
                      ),
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

      // Check if we've exceeded max steps (strictly greater). Allow the current
      // call when currentStep === maxSteps so the final step can still run.
      if (context && context.currentStep > context.maxSteps) {
        console.warn(
          `[Harmony] Reached maximum steps (${context.maxSteps}) for task: "${context.originalPrompt}"`
        );
        const verboseInfo = this.verboseInfoManager.buildVerboseInfo(
          context.currentStage,
          context,
          { conversationHistory }
        );
        // VerboseInfoBuilder determines `isComplete` from the progress plan.
        // Do NOT force isComplete=true here - let it reflect actual step completion status
        // This ensures "Complete" only shows when steps are actually completed

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

      // Detect trigger from state machine (for event handling like next_step, auto, verbose_info)
      const detectedTrigger = this.stageStateMachine.detectTrigger(
        prompt,
        currentStage,
        undefined // confirmationManager not available here
      );

      // Use stage handler for pre-processing (table-based, no if-else)
      const preStageHandler = this.stageHandlerRegistry.getHandler(currentStage);
      if (preStageHandler.handlePreProcessing) {
        const preProcessResult = await preStageHandler.handlePreProcessing(
          context,
          prompt,
          this.nativeToolsManager,
          this.contextManager,
          this.progressPlanManager,
          detectedTrigger,
          this // Pass harmonyClient instance for verboseInfo generation
        );
        
        if (preProcessResult.shouldSkipLLM && preProcessResult.response) {
          console.log(`[Harmony] Stage handler skipped LLM call, returning early`);
          return {
            ...preProcessResult.response,
            isContinuation: isContinuation,
          };
        }
      }

      // All CodeContext and state handling delegated to stage handlers
      // Stage handlers will use ImplementationManager to manage step state
            
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

      // Make API call with streaming enabled for better responsiveness
      const response = await axios.post(
        endpoint,
        {
          model: this.config.model,
          prompt: finalPrompt,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: true,
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey && {
              Authorization: `Bearer ${this.config.apiKey}`,
            }),
          },
          responseType: 'stream',
        }
      );

      console.log(`[Harmony] API response status: ${response.status}`);

      // Handle streaming response - collect all chunks
      let rawResponse: string = '';
      let finishReason: string | undefined = undefined;
      
      if (response.data && typeof response.data === 'object' && response.data.pipe) {
        // Stream response
        console.log(`[Harmony] Handling streamed response...`);
        
        rawResponse = await new Promise<string>((resolve, reject) => {
          let buffer = '';
          const lines: string[] = [];
          
          response.data.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const parts = buffer.split('\n');
            
            // Process all complete lines
            for (let i = 0; i < parts.length - 1; i++) {
              const line = parts[i];
              lines.push(line);
              
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.text) {
                    process.stdout.write(data.choices[0].text); // Show streaming progress
                  }
                  if (data.choices?.[0]?.finish_reason) {
                    finishReason = data.choices[0].finish_reason;
                  }
                } catch (e) {
                  // Ignore parse errors for non-JSON lines
                }
              }
            }
            
            // Keep the last incomplete line in buffer
            buffer = parts[parts.length - 1];
          });
          
          response.data.on('end', () => {
            // Reconstruct full response from all data lines
            let fullText = '';
            let lastFinishReason: string | undefined;
            
            lines.forEach(line => {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.text) {
                    fullText += data.choices[0].text;
                  }
                  if (data.choices?.[0]?.finish_reason) {
                    lastFinishReason = data.choices[0].finish_reason;
                  }
                } catch (e) {
                  // Ignore
                }
              }
            });
            
            if (lastFinishReason) {
              finishReason = lastFinishReason;
            }
            
            console.log(`\n[Harmony] Stream completed`);
            resolve(fullText);
          });
          
          response.data.on('error', reject);
        });
      } else {
        // Non-streaming response (fallback)
        console.log(`[Harmony] Handling non-streamed response...`);
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
        
        // Capture finish_reason from response
        if (response.data?.choices?.[0]?.finish_reason) {
          finishReason = response.data.choices[0].finish_reason;
        } else if (response.data?.finish_reason) {
          finishReason = response.data.finish_reason;
        } else if (response.data?.choices?.[0]?.finishReason) {
          finishReason = response.data.choices[0].finishReason;
        }
      }

      // Check for truncation indicators
      const isTruncated = finishReason === "length" || finishReason === "max_tokens";

      if (isTruncated) {
        console.warn(
          `[Harmony] ⚠️ Response was truncated due to token limit (finish_reason: ${finishReason})`
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

      // Initialize executedToolCalls
      let executedToolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
        result?: MCPToolResult;
      }> | undefined = undefined;

      // Execute tool calls if any exist
      if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
        console.log(`[Harmony] Executing ${toolCalls.length} tool call(s) in stage: ${currentStage}`);
        logToolCalls(toolCalls.map((tc) => ({ name: tc.name })));
        executedToolCalls = await this.toolExecutor.executeToolCalls(toolCalls, currentStage);
        console.log(
          `[Harmony] Completed execution of ${executedToolCalls.length} tool call(s) in stage: ${currentStage}`
        );
      } else if (currentStage === 'implementation') {
        // Initialize empty executedToolCalls array for implementation stage even when no tools were called
        // This allows stage handlers to process non-tool responses (e.g., clarification steps)
        executedToolCalls = [];
      }

      // Use stage handler for post-processing (always call for all stages)
      // This handles both tool execution results and non-tool responses
      // State machine and plan updates are delegated to stage handlers
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

      // Check if we should transition back to chat due to errors (only if tools were executed)
      if (executedToolCalls && executedToolCalls.length > 0) {
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
      }

      // Check for applicable rules (only if tools were executed)
      let applicableRules: Rule[] = [];
      if (executedToolCalls && executedToolCalls.length > 0 && this.rulesManager) {
        applicableRules = this.rulesManager.getApplicableRules(prompt);
        if (applicableRules.length === 0) {
          applicableRules = this.rulesManager.getRulesForTools(executedToolCalls.map((tc) => tc.name));
        }
      }

      if (executedToolCalls && executedToolCalls.length > 0) {

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
        let fileOperations: FileOperationResult | undefined;
        if (currentStage === "implementation") {
          fileOperations = {
            created: [],
            updated: [],
            failed: [],
          };

          (executedToolCalls || []).forEach((tc) => {
            if (["create_file", "write_file"].includes(tc.name) && !tc.result?.isError) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations?.created?.push({
                  path: filePath,
                  source: "toolCall",
                  createdAt: Date.now(),
                });
              }
            } else if (["replace_file", "update_file"].includes(tc.name) && !tc.result?.isError) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations?.updated?.push({
                  path: filePath,
                  source: "toolCall",
                  updatedAt: Date.now(),
                });
              }
            } else if (
              tc.result?.isError &&
              ["create_file", "replace_file", "write_file", "update_file"].includes(tc.name)
            ) {
              const filePath = tc.arguments?.file_path || tc.arguments?.path;
              if (filePath) {
                fileOperations?.failed?.push({
                  path: filePath,
                  error: tc.result.content?.[0]?.text || "Unknown error",
                  attemptedAt: Date.now(),
                });
              }
            }
          });
        }

        const verboseInfo = this.buildVerboseInfo(currentStage, finalContext, {
          fileExtractionResult,
          content,
          reasoning: parsed.reasoning,
          toolCallsForVerbose,
          fileOperations,
          conversationHistory,
        });
        
        if (shouldContinue && finalContext) {
          // Check if we can continue
          if (finalContext.currentStep + 1 > finalContext.maxSteps) {
            console.warn(
              `[Harmony] Cannot continue: next step (${finalContext.currentStep + 1}) would exceed max steps (${finalContext.maxSteps})`
            );
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
          const mergedVerboseInfo = this.verboseInfoManager.mergeContinuationVerboseInfo(
            continuationResponse.verboseInfo,
            verboseInfo,
            { mergeToolCalls: true }
          );

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
              verboseInfo: this.buildVerboseInfo(currentStage, context, {
                conversationHistory,
              }),
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

          const mergedVerboseInfo = this.verboseInfoManager.buildForContinuation(
            continuationResponse.verboseInfo,
            currentStage,
            context || null,
            { conversationHistory }
          );

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

      // Build verbose info for no-tool-calls case
      const finalContextForVerbose = this.contextManager.getContext();
      const verboseInfo = this.buildVerboseInfo(currentStage, finalContextForVerbose, {
        fileExtractionResult,
        content,
        reasoning: parsed.reasoning,
        conversationHistory,
      });

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
                  verboseInfo: this.buildVerboseInfo(
                    "implementation",
                    context,
                    { conversationHistory }
                  ),
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

              const mergedVerboseInfo = this.verboseInfoManager.buildForContinuation(
                continuationResponse.verboseInfo,
                (context?.currentStage || currentStage) as WorkflowStage,
                context || null,
                { conversationHistory }
              );

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

            const mergedVerboseInfo = this.verboseInfoManager.buildForContinuation(
              continuationResponse.verboseInfo,
              (context?.currentStage || currentStage) as WorkflowStage,
              context || null,
              { conversationHistory }
            );

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
    return context?.currentStage || "chat";
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
  getCurrentVerboseInfo(
    conversationHistory?: readonly ChatMessage[]
  ): VerboseInfo {
    const context = this.contextManager.getContext();
    return this.verboseInfoManager.getCurrentVerboseInfo(
      context,
      conversationHistory
    );
  }

  /**
   * Check if the current progress plan is completed
   * Returns true if plan exists and all steps are completed, false otherwise
   */
  isProgressPlanCompleted(): boolean {
    const context = this.contextManager.getContext();
    if (!context?.progressPlan) {
      return false;
    }

    const plan = this.progressPlanManager.getPlan(context.progressPlan.taskId);
    if (!plan) {
      return false;
    }

    // Plan is completed if completedAt is set OR all steps are completed
    return (
      !!plan.completedAt || plan.steps.every((s) => s.status === "completed")
    );
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

    return transitionPatterns.some((pattern) => pattern.test(promptLower));
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
        if (
          message.role === "user" &&
          !this.isStageTransitionCommand(message.content)
        ) {
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

  setIntermediateResponseCallback(
    callback: IntermediateResponseCallback
  ): void {
    this.intermediateResponseCallback = callback;
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
    if (
      (fromStage === "chat" && toStage === "assumptions") ||
      (fromStage === "assumptions" && toStage === "implementation")
    ) {
      const verboseInfo = this.buildVerboseInfo(fromStage, context, {
        fileExtractionResult,
      });

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
              console.warn(
                `[Harmony] Error calling toString() on verboseInfo:`,
                toStringError
              );
            }
          }

          // Send a plain, serializable copy of verboseInfo to callback
          // This ensures we don't pass any object with getter-only properties that can't be serialized
          // Use structuredClone if available (Node 17+), otherwise fall back to JSON serialization
          let plainVerboseInfo: VerboseInfo;
          if (typeof structuredClone !== "undefined") {
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
      const verboseInfo = this.buildVerboseInfo(
        context.currentStage,
        context,
        { fileExtractionResult }
      );

      console.log(
        `[Harmony] 📋 Sending ${context.currentStage} verbose info to webview (after transition)`
      );

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
          console.warn(
            `[Harmony] Error calling toString() on verboseInfo:`,
            toStringError
          );
        }
      }

      // Send a plain, serializable copy of verboseInfo to callback
      // This ensures we don't pass any object with getter-only properties that can't be serialized
      // Use structuredClone if available (Node 17+), otherwise fall back to JSON serialization
      let plainVerboseInfo: VerboseInfo;
      if (typeof structuredClone !== "undefined") {
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
      console.log(
        `[Harmony] Invalid stage transition: ${currentStage} -> ${to}`
      );
      return false;
    }

    // Perform the transition first
    this.contextManager.updateStage(
      to,
      prompt || `Manual transition from ${currentStage} to ${to}`
    );
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
