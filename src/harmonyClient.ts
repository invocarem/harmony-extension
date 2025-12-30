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
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ProgressPlanManager } from "./progressPlanManager";
import {
  ConversationContextManager,
  CodeExtractor,
  CodeContext,
  ResponseValidator,
  PromptBuilder,
  ToolExecutor,
  ToolResultFormatter,
  ContinuationManager,
  AutoTransitionManager,
  StageDetector,
} from "./harmony";

// Re-export WorkflowStage for backward compatibility
export type { WorkflowStage };
import {
  logLongMessage,
  logApiRequest,
  logToolCalls,
  logRules,
  logStepInfo,
} from "./utils/logger";

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
  verboseInfo?: {
    stage?: WorkflowStage;
    stageTransition?: {
      from: WorkflowStage;
      to: WorkflowStage;
    };
    step?: number;
    maxSteps?: number;
    isComplete?: boolean;
    toolCalls?: Array<{
      name: string;
      stage: WorkflowStage;
      success: boolean;
      error?: string;
    }>;
  };
}

/**
 * Main HarmonyClient with HarmonyProcessor integration and multi-step continuation
 * Refactored to use modular components for better maintainability
 */
export class HarmonyClient {
  private stageStateMachine: StageStateMachine;
  private harmonyProcessor: HarmonyProcessor;
  private progressPlanManager: ProgressPlanManager;

  // Modular components
  private contextManager: ConversationContextManager;
  private stageDetector: StageDetector;
  private promptBuilder: PromptBuilder;
  private toolExecutor: ToolExecutor;
  private toolResultFormatter: ToolResultFormatter;
  private responseValidator: ResponseValidator;
  private continuationManager: ContinuationManager;
  private autoTransitionManager: AutoTransitionManager;

  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {
    this.harmonyProcessor = new HarmonyProcessor(config.harmonyMode);
    this.stageStateMachine = new StageStateMachine();
    this.progressPlanManager = new ProgressPlanManager();

    // Initialize modular components
    this.contextManager = new ConversationContextManager();
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
    this.autoTransitionManager = new AutoTransitionManager(this.progressPlanManager);
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
    conversationHistory?: readonly ChatMessage[]
  ): Promise<HarmonyResponse> {
    try {
      // Initialize or update conversation context
      if (!isContinuation) {
        // Only initialize if no context exists, otherwise preserve existing context
        if (!this.contextManager.hasContext()) {
          // Always start new conversations in 'chat' stage, then detect if we should transition
          // This ensures transitions are properly recorded
          this.contextManager.initialize(prompt, 'chat');
          const context = this.contextManager.getContext();
          if (context) {
            const detectedStage = this.stageDetector.detectStage(
              prompt,
              conversationHistory,
              context
            );
            if (detectedStage !== 'chat') {
              console.log(`[Harmony] Stage transition detected at start: chat -> ${detectedStage}`);
              this.contextManager.updateStage(detectedStage, prompt);
            }
          }
          const finalContext = this.contextManager.getContext();
          console.log(`[Harmony] Starting new conversation in stage: ${finalContext?.currentStage || 'chat'}`);
        } else {
          // Context exists, just update stage if needed
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
              this.contextManager.updateStage(detectedStage, prompt);
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
            this.contextManager.updateStage(detectedStage, prompt);
          }
        }
      }

      const context = this.contextManager.getContext();
      if (context && isContinuation) {
        logStepInfo(context.currentStep, context.maxSteps, context.originalPrompt);
      }

      // Check if we've exceeded max steps
      if (context && context.currentStep > context.maxSteps) {
        console.warn(
          `[Harmony] Reached maximum steps (${context.maxSteps}) for task: "${context.originalPrompt}"`
        );
        return {
          content: `I've gathered information through multiple steps, but haven't completed the task. Here's what I found so far.`,
          reasoning: "Reached maximum allowed steps for this task.",
          verboseInfo: {
            stage: context.currentStage,
            isComplete: true,
          },
        };
      }

      const endpoint = `${this.config.serverUrl}/v1/completions`;
      
      // Always detect the stage first to handle explicit transition commands (e.g., "moveto implementation")
      // If context exists, use it as a hint, but let the detector determine if a transition is needed
      const detectedStage = this.stageDetector.detectStage(
        prompt,
        conversationHistory,
        context
      );
      
      // Update context if stage changed
      if (context && detectedStage !== context.currentStage) {
        console.log(`[Harmony] Stage transition detected: ${context.currentStage} → ${detectedStage}`);
        this.contextManager.updateStage(detectedStage, prompt);
      }
      
      let currentStage = detectedStage;

      if (context) {
        console.log(
          `[Harmony] Current stage: ${currentStage} (step ${context.currentStep}/${context.maxSteps})`
        );
      } else {
        console.log(`[Harmony] Current stage: ${currentStage} (no active conversation context)`);
      }

      logApiRequest(endpoint, prompt, 100);

      // Build prompt using PromptBuilder
      const finalPrompt = await this.promptBuilder.buildPrompt(
        prompt,
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
      const parsed = this.harmonyProcessor.parseResponse(rawResponse);

      if (!parsed) {
        throw new Error("HarmonyProcessor.parseResponse returned undefined");
      }

      console.log(
        `[Harmony] Parsed response - stage: ${currentStage}, content: ${parsed.content.length} chars, reasoning: ${parsed.reasoning?.length || 0} chars`
      );
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[Harmony] Found ${parsed.rawToolCalls.length} raw tool call(s) in response`);
      }
      console.log(`[Harmony] Content preview: ${parsed.content.substring(0, 300)}...`);

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
      if (toolCalls.length === 0) {
        console.log(`[Harmony] No tool calls found in rawToolCalls, checking content...`);
        toolCalls = this.harmonyProcessor.extractToolCalls([parsed.content]);
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
      }

      toolCalls = validation.allowedToolCalls;

      // In assumptions stage, extract code snippets and create CodeContext objects
      // Only do this if we have content and no tool calls were extracted (code snippets, not tool calls)
      // This is a non-blocking operation that just tracks code for later use in implementation stage
      try {
        const hasToolCalls = parsed.rawToolCalls && parsed.rawToolCalls.length > 0;
        if (currentStage === 'assumptions' && context && parsed.content && !hasToolCalls && toolCalls.length === 0) {
          const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
          const matches = parsed.content.matchAll(codeBlockPattern);
          let codeBlockCount = 0;
          
          for (const match of matches) {
            try {
              const codeBlock = match[0];
              const codeContext = CodeContext.fromCodeBlock(codeBlock);
              
              if (codeContext) {
                this.contextManager.addCodeContext(codeContext);
                codeBlockCount++;
                console.log(`[Harmony] Assumptions stage: Extracted code context for file: ${codeContext.name}`);
              }
            } catch (error) {
              // Silently skip if code context extraction fails for a single block
              console.warn(`[Harmony] Failed to extract code context from block:`, error);
            }
          }
          
          if (codeBlockCount > 0) {
            console.log(`[Harmony] Assumptions stage: Added ${codeBlockCount} code context(s) ready for implementation`);
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

        // Check if we should transition back to chat due to errors
        const updatedContext = this.contextManager.getContext();
        if (
          updatedContext &&
          this.stageStateMachine.shouldTransitionToChatOnError(currentStage, executedToolCalls)
        ) {
          console.log(
            `[Harmony] State machine: Transitioning from ${currentStage} to chat due to errors requiring clarification`
          );
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
        let finalContent = parsed.content;
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
        const verboseInfo: HarmonyResponse["verboseInfo"] = finalContext
          ? {
              stage: currentStage,
              stageTransition: finalContext.lastStageTransition,
              ...(shouldContinue
                ? {
                    step: finalContext.currentStep,
                    maxSteps: finalContext.maxSteps,
                  }
                : {
                    isComplete: true,
                  }),
              toolCalls: (executedToolCalls || []).map((tc) => ({
                name: tc.name,
                stage: currentStage,
                success: !tc.result?.isError,
                error: tc.result?.isError
                  ? tc.result.content?.[0]?.text || "Unknown error"
                  : undefined,
              })),
            }
          : {
              stage: currentStage,
              toolCalls: (executedToolCalls || []).map((tc) => ({
                name: tc.name,
                stage: currentStage,
                success: !tc.result?.isError,
                error: tc.result?.isError
                  ? tc.result.content?.[0]?.text || "Unknown error"
                  : undefined,
              })),
            };

        if (shouldContinue && finalContext) {
          // Check if we can continue
          if (finalContext.currentStep + 1 > finalContext.maxSteps) {
            console.warn(
              `[Harmony] Cannot continue: next step (${finalContext.currentStep + 1}) would exceed max steps (${finalContext.maxSteps})`
            );
            const completeVerboseInfo: HarmonyResponse["verboseInfo"] = verboseInfo
              ? {
                  ...verboseInfo,
                  isComplete: true,
                  step: undefined,
                  maxSteps: undefined,
                }
              : {
                  stage: currentStage,
                  isComplete: true,
                };
            return {
              content: finalContent,
              reasoning: parsed.reasoning,
              commentary: parsed.commentary,
              final: parsed.final,
              ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
              isContinuation: isContinuation,
              verboseInfo: completeVerboseInfo,
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
          const mergedVerboseInfo: HarmonyResponse["verboseInfo"] = continuationResponse.verboseInfo
            ? {
                ...continuationResponse.verboseInfo,
                toolCalls: [
                  ...(verboseInfo.toolCalls || []),
                  ...(continuationResponse.verboseInfo.toolCalls || []),
                ],
              }
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
      if (
        toolCalls.length === 0 &&
        parsed.content &&
        context &&
        currentStage === "implementation"
      ) {
        const describesFileOperations = /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:file|content|property|field)/i.test(
          parsed.content
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
              content: parsed.content,
              reasoning: parsed.reasoning,
              commentary: parsed.commentary,
              final: parsed.final,
              isContinuation: isContinuation,
              verboseInfo: {
                stage: currentStage,
                isComplete: true,
              },
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

          const noToolCallsVerboseInfo: HarmonyResponse["verboseInfo"] = context
            ? {
                stage: currentStage,
                stageTransition: context.lastStageTransition,
                step: context.currentStep,
                maxSteps: context.maxSteps,
              }
            : {
                stage: currentStage,
              };

          const mergedVerboseInfo: HarmonyResponse["verboseInfo"] = continuationResponse.verboseInfo
            ? {
                ...continuationResponse.verboseInfo,
                stage: continuationResponse.verboseInfo.stage || currentStage,
              }
            : noToolCallsVerboseInfo;

          return {
            content: parsed.content + "\n\n---\n\n" + continuationResponse.content,
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
      // Users must explicitly type "move to implementation" or "moveto implementation" to transition
      // This ensures users have control over when to proceed to implementation stage
      // The state machine will handle explicit transition commands via stageDetector
      // 
      // Note: The auto-transition logic is commented out to require explicit user commands:
      // if (currentStage === "assumptions" && context && !toolCallsWereBlocked) {
      //   ... auto-transition code ...
      // }

      // Log final response summary
      if (context) {
        console.log(
          `[Harmony] Response complete - stage: ${currentStage}, step: ${context.currentStep}/${context.maxSteps}, isContinuation: ${isContinuation}`
        );
      }

      // Build verbose info
      const finalContextForVerbose = this.contextManager.getContext();
      let verboseInfo: HarmonyResponse["verboseInfo"] = finalContextForVerbose
        ? {
            stage: currentStage,
            stageTransition: finalContextForVerbose.lastStageTransition,
            isComplete: true,
          }
        : {
            stage: currentStage,
          };

      // Clear lastStageTransition after using it
      if (finalContextForVerbose?.lastStageTransition) {
        // Note: We can't directly mutate, but the context manager will handle this in next update
        // For now, we'll leave it as it will be cleared on next stage update
      }

      // Ensure Implementation stage has content
      let finalContent = parsed.content;
      if (!finalContent || !finalContent.trim()) {
        if (currentStage === "implementation" && toolCalls.length === 0 && !toolCallsWereBlocked) {
          const codeSnippets = CodeExtractor.extractCodeSnippetsFromHistory(conversationHistory);

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

              const noToolCallsVerboseInfo: HarmonyResponse["verboseInfo"] = context
                ? {
                    stage: currentStage,
                    stageTransition: context.lastStageTransition,
                    step: context.currentStep,
                    maxSteps: context.maxSteps,
                  }
                : {
                    stage: currentStage,
                  };

              const mergedVerboseInfo: HarmonyResponse["verboseInfo"] = continuationResponse.verboseInfo
                ? {
                    ...continuationResponse.verboseInfo,
                    stage: continuationResponse.verboseInfo.stage || currentStage,
                  }
                : noToolCallsVerboseInfo;

              return {
                content: continuationResponse.content,
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
          if (context && context.currentStep + 1 <= context.maxSteps) {
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

            const noToolCallsVerboseInfo: HarmonyResponse["verboseInfo"] = context
              ? {
                  stage: currentStage,
                  stageTransition: context.lastStageTransition,
                  step: context.currentStep,
                  maxSteps: context.maxSteps,
                }
              : {
                  stage: currentStage,
                };

            const mergedVerboseInfo: HarmonyResponse["verboseInfo"] = continuationResponse.verboseInfo
              ? {
                  ...continuationResponse.verboseInfo,
                  stage: continuationResponse.verboseInfo.stage || currentStage,
                }
              : noToolCallsVerboseInfo;

            return {
              content: continuationResponse.content,
              reasoning: parsed.reasoning || continuationResponse.reasoning,
              commentary: parsed.commentary || continuationResponse.commentary,
              final: parsed.final || continuationResponse.final,
              toolCalls: continuationResponse.toolCalls || [],
              isContinuation: true,
              verboseInfo: mergedVerboseInfo,
            };
          }

          // Fallback: only show message if we can't continue
          finalContent =
            "I understand you want me to create the file. Please check the conversation history for the code snippets from the Analysis stage, then use create_file tool to create the file.";
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
}

