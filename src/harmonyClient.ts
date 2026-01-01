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
  private stageHandlerRegistry: StageHandlerRegistry;

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
    this.stageHandlerRegistry = new StageHandlerRegistry();

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
                this.contextManager.updateStage(detectedStage, prompt);
              }
            }
          }
          const finalContext = this.contextManager.getContext();
          console.log(`[Harmony] Starting new conversation in stage: ${finalContext?.currentStage || 'chat'}`);
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
              this.contextManager.updateStage(detectedStage, prompt);
              
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
            this.contextManager.updateStage(detectedStage, prompt);
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
                    createdFiles.push(filePath);
                    this.contextManager.markCodeContextCreated(filePath);
                    toolCalls.push({
                      name: 'replace_file',
                      arguments: { file_path: filePath, content: fileContent },
                      result: replaceResult
                    });
                    console.log(`[Harmony] Implementation stage: Successfully updated file ${filePath} from CodeContext`);
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
          }
          
          // If we created any files, update progressPlan before returning early
          if (createdFiles.length > 0) {
            // Update progressPlan if it exists
            if (context?.progressPlan) {
              const plan = context.progressPlan;
              const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
              
              // Count successful file modification tool executions
              const successfulFileMods = toolCalls.filter(tc => 
                fileModificationTools.includes(tc.name) && !tc.result?.isError
              );

              if (successfulFileMods.length > 0) {
                // Find the first pending or in_progress step to mark as completed
                const stepToComplete = plan.steps.find(step => 
                  step.status === 'pending' || step.status === 'in_progress'
                );

                if (stepToComplete) {
                  // Mark step as completed
                  const updated = this.progressPlanManager.updateStepStatus(
                    plan.taskId,
                    stepToComplete.stepNumber,
                    'completed'
                  );

                  if (updated) {
                    console.log(
                      `[Harmony] ProgressPlan: Marked step ${stepToComplete.stepNumber} (${stepToComplete.goal}) as completed after creating files from CodeContext`
                    );

                    // Check if plan is now complete
                    const updatedPlan = this.progressPlanManager.getPlan(plan.taskId);
                    if (updatedPlan?.completedAt) {
                      console.log(
                        `[Harmony] ProgressPlan: All steps completed! Plan "${plan.taskId}" is now complete.`
                      );
                    }
                  }
                }
              }
            }

            console.log(`[Harmony] Implementation stage: Created ${createdFiles.length} file(s) from CodeContext, returning early (skipping LLM call)`);
            return {
              content: `Successfully created ${createdFiles.length} file(s) from code snippets: ${createdFiles.join(', ')}`,
              reasoning: undefined,
              commentary: undefined,
              final: undefined,
              toolCalls: toolCalls,
              isContinuation: isContinuation,
              verboseInfo: {
                stage: currentStage,
                isComplete: true,
                toolCalls: toolCalls.map(tc => ({
                  name: tc.name,
                  stage: currentStage,
                  success: !tc.result?.isError,
                  error: tc.result?.isError ? (tc.result?.content?.[0]?.text || 'Unknown error') : undefined
                }))
              }
            };
          }
        }
      }

      // NOTE: Files should NOT be created in assumptions stage per state machine rules
      // Files are only created in implementation stage (see code at line 233)
      // This ensures proper stage flow: Chat -> Assumptions (code snippets) -> Implementation (file creation)

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
          
          // Check if we should create a ProgressPlan for complex tasks
          // This happens when entering assumptions stage and the response indicates a multi-step task
          if (currentStage === 'assumptions' && context && content && !context.progressPlan) {
            try {
              const complexity = this.autoTransitionManager.detectTaskComplexity(
                content,
                parsed.reasoning,
                toolCalls
              );
              
              if (complexity === 'hard') {
                // Task is complex (3+ steps), create a ProgressPlan
                const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const originalPrompt = context.originalPrompt || prompt;
                
                // Extract steps from content
                const steps: Array<{ goal: string; description?: string; tools?: string[] }> = [];
                
                // Try to extract steps from numbered list or step indicators
                const stepMatches = content.match(/(?:^|\n)(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)(.+?)(?=\n(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?|$))/gi);
                if (stepMatches && stepMatches.length >= 3) {
                  stepMatches.forEach((match) => {
                    const goal = match.replace(/^(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)/i, '').trim();
                    if (goal) {
                      steps.push({ goal, description: goal });
                    }
                  });
                } else {
                  // Fallback: create generic steps based on detected complexity
                  // Count how many steps were detected
                  const stepPatterns = [
                    /\b(step\s+1|first|second|third|fourth|fifth|then|next|after that|subsequently)\b/gi,
                    /\b(1\.|2\.|3\.|4\.|5\.)/g,
                  ];
                  let stepCount = 0;
                  for (const pattern of stepPatterns) {
                    const matches = content.match(pattern);
                    if (matches) {
                      stepCount = Math.max(stepCount, matches.length);
                    }
                  }
                  
                  // Look for explicit step numbers
                  const numberedSteps = content.match(/\b(?:step|stage)\s*(\d+)\b/gi);
                  if (numberedSteps) {
                    const maxStepNumber = Math.max(...numberedSteps.map(s => {
                      const match = s.match(/\d+/);
                      return match ? parseInt(match[0]) : 0;
                    }));
                    stepCount = Math.max(stepCount, maxStepNumber);
                  }
                  
                  // Create steps (minimum 3 for 'hard' complexity)
                  const numSteps = Math.max(3, stepCount || 3);
                  for (let i = 1; i <= numSteps; i++) {
                    steps.push({ 
                      goal: `Step ${i}: Complete part ${i} of the task`, 
                      description: `Execute step ${i} of the implementation plan` 
                    });
                  }
                }
                
                const plan = this.progressPlanManager.createPlan(
                  taskId,
                  originalPrompt,
                  'hard',
                  steps.length > 0 ? steps : [
                    { goal: 'Step 1: Analyze requirements', description: 'Understand the task requirements' },
                    { goal: 'Step 2: Design solution', description: 'Plan the implementation approach' },
                    { goal: 'Step 3: Implement solution', description: 'Execute the implementation' }
                  ]
                );
                
                this.contextManager.setProgressPlan(plan);
                console.log(`[Harmony] Assumptions stage: Created ProgressPlan with ${plan.totalSteps} steps for complex task`);
              }
            } catch (error) {
              // Don't let plan creation break the main flow
              console.warn(`[Harmony] Error during plan creation:`, error);
            }
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
            this.nativeToolsManager
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
        const contextForPlan = this.contextManager.getContext();
        if (contextForPlan?.progressPlan && currentStage === 'implementation' && executedToolCalls?.length > 0) {
          const plan = contextForPlan.progressPlan;
          const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
          
          // Count successful file modification tool executions
          const successfulFileMods = executedToolCalls.filter(tc => 
            fileModificationTools.includes(tc.name) && !tc.result?.isError
          );

          if (successfulFileMods.length > 0) {
            // Find the first pending or in_progress step to mark as completed
            // This assumes steps are completed sequentially
            const stepToComplete = plan.steps.find(step => 
              step.status === 'pending' || step.status === 'in_progress'
            );

            if (stepToComplete) {
              // Mark step as completed
              const updated = this.progressPlanManager.updateStepStatus(
                plan.taskId,
                stepToComplete.stepNumber,
                'completed'
              );

              if (updated) {
                console.log(
                  `[Harmony] ProgressPlan: Marked step ${stepToComplete.stepNumber} (${stepToComplete.goal}) as completed after successful file modifications`
                );

                // Check if plan is now complete (updateStepStatus already checks internally)
                const updatedPlan = this.progressPlanManager.getPlan(plan.taskId);
                if (updatedPlan?.completedAt) {
                  console.log(
                    `[Harmony] ProgressPlan: All steps completed! Plan "${plan.taskId}" is now complete.`
                  );
                }
              }
            } else {
              console.log(
                `[Harmony] ProgressPlan: File modifications executed but all steps are already completed or in unknown state`
              );
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
        content &&
        context &&
        currentStage === "implementation"
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
                  verboseInfo: {
                    stage: currentStage,
                    isComplete: true,
                  },
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
   * Manually transition to a different stage
   * Validates the transition using the stage state machine
   */
  transitionStage(to: WorkflowStage, prompt?: string): boolean {
    const currentStage = this.getCurrentStage();
    
    // Check if transition is valid
    if (!this.stageStateMachine.canTransition(currentStage, to)) {
      console.log(`[Harmony] Invalid stage transition: ${currentStage} -> ${to}`);
      return false;
    }
    
    // Perform the transition
    this.contextManager.updateStage(to, prompt || `Manual transition from ${currentStage} to ${to}`);
    console.log(`[Harmony] Stage transitioned: ${currentStage} -> ${to}`);
    return true;
  }

  /**
   * Get the progress plan manager (for testing purposes)
   */
  getProgressPlanManager(): ProgressPlanManager {
    return this.progressPlanManager;
  }
}

