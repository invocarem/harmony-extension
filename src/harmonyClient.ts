import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { RulesManager, Rule } from "./rulesManager";
import { NativeToolsManager, NativeTool } from "./nativeToolManager";
import { HarmonyProcessor, HarmonyParseResult } from "./harmonyProcessor";
import { ToolCallExtractor } from "./utils/toolCallExtractor";
import { XmlProcessor } from "./utils/xmlProcessor";
import { ChatMessage } from "./conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";

// Re-export WorkflowStage for backward compatibility
export type { WorkflowStage };
import { 
  logLongMessage, 
  logApiRequest, 
  logToolCalls, 
  logRules,
  logStepInfo,
  logContinuationDecision,
  logToolExecutionResults,
  logConversationContext
} from "./utils/logger";

export interface HarmonyResponse {
  content: string;
  reasoning?: string;
  final?: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
  // Add new field to track if this is a continuation response
  isContinuation?: boolean;
  // Verbose information for debugging and UI display
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
 */
export class HarmonyClient {
  private stageStateMachine: StageStateMachine;
  private harmonyProcessor: HarmonyProcessor;
  private conversationContext: {
    originalPrompt: string;
    currentStage: WorkflowStage;
    stageHistory: Array<{
      stage: WorkflowStage;
      enteredAt: number;
      prompt?: string;
    }>;
    steps: Array<{
      toolCalls: Array<{ name: string; arguments: Record<string, any> }>;
      reasoning?: string;
      timestamp: number;
      stage: WorkflowStage;
    }>;
    maxSteps: number;
    currentStep: number;
    lastStageTransition?: {
      from: WorkflowStage;
      to: WorkflowStage;
    };
  } | null = null;

  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {
    this.harmonyProcessor = new HarmonyProcessor(config.harmonyMode);
    this.stageStateMachine = new StageStateMachine();
  }

  /**
   * Detect the appropriate workflow stage based on the prompt using state machine
   */
  private detectStage(prompt: string, conversationHistory?: readonly ChatMessage[]): WorkflowStage {
    const promptLower = prompt.toLowerCase().trim();
    
    // Simple greetings/questions stay in chat stage
    const simpleGreetings = [
      /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|thanks?|thank\s+you)$/i,
      /^how\s+(are\s+you|do\s+you\s+do|is\s+it\s+going)$/i,
      /^what('s|s| is)\s+(your|the)\s+(name|purpose)$/i,
    ];
    
    if (simpleGreetings.some(pattern => pattern.test(promptLower))) {
      return 'chat';
    }

    // Get current stage from context or default to chat
    const currentStage = this.conversationContext?.currentStage || 'chat';
    
    // Use state machine to determine next stage
    const nextStage = this.stageStateMachine.determineNextStage(currentStage, prompt, conversationHistory);
    if (nextStage !== null) {
      return nextStage;
    }

    // For continuations, maintain current stage unless explicitly changed
    if (this.conversationContext) {
      return this.conversationContext.currentStage;
    }

    // Default: chat stage for general questions
    return 'chat';
  }

  /**
   * Filter tools based on current workflow stage
   */
  private getAllowedToolsForStage(
    allTools: Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }>,
    stage: WorkflowStage
  ): Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> {
    if (stage === 'chat') {
      // Chat stage: Only allow read-only tools for context gathering
      const readOnlyTools = ['read_file', 'list_files', 'grep_files', 'search_files', 'read_directory'];
      return allTools.filter(tool => 
        readOnlyTools.includes(tool.name) || 
        !['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file'].includes(tool.name)
      );
    }
    
    if (stage === 'assumptions') {
      // Assumptions stage: Allow read/search tools, but NO file modification tools
      const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file'];
      return allTools.filter(tool => !fileModificationTools.includes(tool.name));
    }
    
    // Implementation stage: All tools allowed
    return allTools;
  }

  /**
   * Get stage-specific instructions for prompts
   */
  private getStageInstructions(stage: WorkflowStage): string {
    switch (stage) {
      case 'chat':
        return `## Current Stage: CHAT/CLARIFICATION

You are in the **Chat/Clarification** stage. Your goal is to:
- **CRITICAL: Always restate the user's problem** - Use your own words to describe their question
- Understand and clarify the user's problem or question
- Ask clarifying questions if needed
- Provide helpful explanations and guidance
- Do NOT use file modification tools (create_file, replace_file, etc.)
- Do NOT generate code or create files yet
- You may use read-only tools (read_file, list_files, grep_files) to gather context if helpful

**Stage Flow**: Chat → Analysis (code generation) → Implementation (file creation). Never skip stages.
Focus on understanding the problem and restating it clearly before moving to code generation.`;

      case 'assumptions':
        return `## Current Stage: ASSUMPTIONS/ANALYSIS

You are in the **Assumptions/Analysis** stage. Your goal is to:
- Analyze the problem and provide code snippets/examples
- Explain your assumptions about the codebase
- Show code solutions in formatted code blocks with file paths
- Do NOT use file modification tools (create_file, replace_file, etc.) - provide code snippets only
- You may use read/search tools (read_file, grep_files, list_files) to understand the codebase

**CRITICAL**: When rules specify "provide code snippets", you MUST follow them. Only provide code snippets, never attempt to modify files.`;

      case 'implementation':
        return `## Current Stage: IMPLEMENTATION

You are in the **Implementation** stage. Your goal is to:
- Actually create or modify files using appropriate tools
- Use create_file for new files, replace_file for modifying existing files
- Use the code content/snippets that were generated in the Analysis stage
- Execute the solution that was discussed and analyzed in previous stages
- All tools are available, including file modification tools

**Note**: Code content should have been generated in the Analysis stage. Your job here is to create the actual files from that content.`;

      default:
        return '';
    }
  }

  async callServer(
    prompt: string,
    templateName?: string,
    applyTemplate?: (templateName: string, context: any, history?: readonly ChatMessage[]) => Promise<string>,
    isContinuation: boolean = false,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<HarmonyResponse> {
    try {
      // If this is not a continuation, start a new conversation context
      if (!isContinuation) {
        const initialStage = this.detectStage(prompt, conversationHistory);
        this.conversationContext = {
          originalPrompt: prompt,
          currentStage: initialStage,
          stageHistory: [{ stage: initialStage, enteredAt: Date.now(), prompt }],
          steps: [],
          maxSteps: 5, // Maximum steps to prevent infinite loops
          currentStep: 1,
        };
        console.log(`[Harmony] Starting new conversation in stage: ${initialStage}`);
      } else {
        // For continuations, check if stage should change
        if (this.conversationContext) {
          const detectedStage = this.detectStage(prompt, conversationHistory);
          const previousStage = this.conversationContext.currentStage;
          if (detectedStage !== previousStage) {
            console.log(`[Harmony] Stage transition: ${previousStage} -> ${detectedStage}`);
            this.conversationContext.currentStage = detectedStage;
            this.conversationContext.stageHistory.push({
              stage: detectedStage,
              enteredAt: Date.now(),
              prompt,
            });
            // Store stage transition for verbose info
            this.conversationContext.lastStageTransition = {
              from: previousStage,
              to: detectedStage
            };
          }
        }
      }

      if (this.conversationContext && isContinuation) {
        logStepInfo(
          this.conversationContext.currentStep,
          this.conversationContext.maxSteps,
          this.conversationContext.originalPrompt
        );
      }

      // If we're past max steps, stop continuing
      // Use > instead of >= to allow the final step (e.g., step 5 when maxSteps is 5) to run
      if (this.conversationContext && this.conversationContext.currentStep > this.conversationContext.maxSteps) {
        console.warn(`[Harmony] Reached maximum steps (${this.conversationContext.maxSteps}) for task: "${this.conversationContext.originalPrompt}"`);
        const maxStepsVerboseInfo: HarmonyResponse['verboseInfo'] = {
          stage: this.conversationContext.currentStage,
          isComplete: true,
        };
        return {
          content: `I've gathered information through multiple steps, but haven't completed the task. Here's what I found so far.`,
          reasoning: "Reached maximum allowed steps for this task.",
          verboseInfo: maxStepsVerboseInfo,
        };
      }

      const endpoint = `${this.config.serverUrl}/v1/completions`;
 
      logApiRequest(endpoint, prompt, 100);

      // Get current stage (let instead of const to allow reassignment for error-based transitions)
      let currentStage = this.conversationContext?.currentStage || this.detectStage(prompt, conversationHistory);
      if (this.conversationContext) {
        console.log(`[Harmony] Current stage: ${currentStage} (step ${this.conversationContext.currentStep}/${this.conversationContext.maxSteps})`);
      } else {
        console.log(`[Harmony] Current stage: ${currentStage} (no active conversation context)`);
      }
      
      // Build tools context - filter tools based on stage
      let toolsContext = "";
      const allTools: Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> = [];
      
      if (this.mcpManager) {
        const mcpTools = this.mcpManager.getAllTools();
        mcpTools.forEach((tool) => {
          allTools.push({ ...tool, type: "mcp" });
        });
      }
      
      if (this.nativeToolsManager) {
        const nativeTools = this.nativeToolsManager.getAvailableTools();
        nativeTools.forEach((tool) => {
          allTools.push({ ...tool, type: "native" });
        });
      }
      
      // Filter tools based on current stage
      const allowedTools = this.getAllowedToolsForStage(allTools, currentStage);
      
      if (allowedTools.length > 0) {
        toolsContext = "\n\nAvailable Tools:\n";
        allowedTools.forEach((tool) => {
          const toolType = tool.type === "native" ? "[Built-in] " : "[MCP] ";
          toolsContext += `- ${toolType}${tool.name}: ${tool.description || "No description"}\n`;
          if (tool.inputSchema.properties) {
            const props = Object.entries(tool.inputSchema.properties)
              .map(([key, value]: [string, any]) => {
                const desc = value.description ? ` - ${value.description}` : "";
                return `  ${key}: ${value.type || "any"}${desc}`;
              })
              .join("\n");
            if (props) {
              toolsContext += `  Parameters:\n${props}\n`;
            }
          }
        });
        toolsContext += "\nTo call a tool, use the format: <tool_call name=\"tool_name\" args=\"{...}\" />\n";
        
        // Add stage-specific tool restrictions warning
        if (currentStage === 'chat' || currentStage === 'assumptions') {
          const restrictedTools = allTools.filter(t => !allowedTools.includes(t));
          if (restrictedTools.length > 0) {
            toolsContext += `\n⚠️ NOTE: File modification tools (${restrictedTools.map(t => t.name).join(', ')}) are NOT available in ${currentStage} stage. `;
            if (currentStage === 'assumptions') {
              toolsContext += "Please provide code snippets instead.\n";
            } else {
              toolsContext += "Please continue the conversation to understand the requirements.\n";
            }
          }
        }
      }

      // Get applicable rules
      // Check rules against conversation history if available, otherwise just current prompt
      // This ensures rules triggered in earlier messages continue to apply in follow-ups
      let rulesContext = "";
      if (this.rulesManager) {
        let applicableRules: Rule[] = [];
        
        if (conversationHistory && conversationHistory.length > 0) {
          // Check rules against all user messages in conversation history
          applicableRules = this.rulesManager.getApplicableRulesFromHistory(conversationHistory);
          console.log(`[Rules] Checking rules against conversation history (${conversationHistory.length} messages)`);
        }
        
        // Also check current prompt for any new rules that might match
        const currentPromptRules = this.rulesManager.getApplicableRules(prompt);
        
        // Combine and deduplicate rules
        const allRules = new Map<string, Rule>();
        applicableRules.forEach(rule => allRules.set(rule.id, rule));
        currentPromptRules.forEach(rule => allRules.set(rule.id, rule));
        
        applicableRules = Array.from(allRules.values());
        
        if (applicableRules.length > 0) {
          console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) (from history + current prompt)`);
          rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
          logRules(applicableRules);
        }
      }

      // Add stage instructions
      const stageInstructions = this.getStageInstructions(currentStage);
      
      // If this is a continuation, add context about previous steps
      let continuationContext = "";
      if (isContinuation && this.conversationContext) {
        const previousSteps = this.conversationContext.steps;
        if (previousSteps.length > 0) {
          continuationContext = "\n\n## CONTINUATION - Previous Steps:\n";
          previousSteps.forEach((step, index) => {
            continuationContext += `\nStep ${index + 1} (${step.stage} stage):\n`;
            if (step.reasoning) {
              continuationContext += `Reasoning: ${step.reasoning.substring(0, 200)}...\n`;
            }
            step.toolCalls.forEach(toolCall => {
              continuationContext += `- Called ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}\n`;
            });
          });
          
          continuationContext += `\nOriginal task: "${this.conversationContext.originalPrompt}"\n`;
          continuationContext += `Current step: ${this.conversationContext.currentStep} of ${this.conversationContext.maxSteps}\n`;
          continuationContext += `Current stage: ${currentStage}\n`;
          continuationContext += `\nNow continue with the NEXT step to complete the task:\n`;
        }
      }

      // Apply template if specified
      let finalPrompt: string;
      if (templateName && applyTemplate) {
        const mcpTools = this.mcpManager?.getAllTools() || [];
        const nativeTools = this.nativeToolsManager?.getAvailableTools() || [];
        // For templates, pass the original prompt without stage instructions prepended
        // The template can decide how to incorporate stage information
        const templateContext = { 
          prompt: prompt + toolsContext + continuationContext,
          rules: rulesContext || undefined, // Pass undefined instead of empty string so template can handle it
          tools: allowedTools, // Pass only allowed tools to template
          stage: currentStage,
          stageInstructions: stageInstructions
        };
        
        finalPrompt = await applyTemplate(templateName, templateContext);
        // Templates can decide how to incorporate stage information via stageInstructions in context
        // We don't prepend stage instructions here to allow templates full control
      } else {
        finalPrompt = stageInstructions + "\n\n" + rulesContext + continuationContext + prompt + toolsContext;
      }

      // Log prompt preview
      const previewLength = 500;
      console.log(`[Harmony] Final prompt (stage: ${currentStage}, first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`);
      if (rulesContext) {
        console.log(`[Rules] Rules context length: ${rulesContext.length} characters`);
      }
      if (continuationContext) {
        console.log(`[Harmony] Continuation context length: ${continuationContext.length} characters`);
      }
      console.log(`[Harmony] Stage instructions included: ${stageInstructions ? 'yes' : 'no'}, Available tools: ${allowedTools.length} (${allowedTools.filter(t => t.type === 'mcp').length} MCP, ${allowedTools.filter(t => t.type === 'native').length} native)`);

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

      // Check for truncation indicators in API response
      const finishReason = response.data?.choices?.[0]?.finish_reason || 
                          response.data?.finish_reason || 
                          response.data?.choices?.[0]?.finishReason;
      const isTruncated = finishReason === 'length' || finishReason === 'max_tokens';
      
      if (isTruncated) {
        console.warn(`[Harmony] ⚠️ Response was truncated due to token limit (finish_reason: ${finishReason})`);
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
          `Unexpected API response format. Response: ${JSON.stringify(
            response.data
          ).substring(0, 200)}`
        );
      }

      if (!rawResponse) {
        throw new Error("Received empty response from API");
      }

      console.log(`[Harmony] Raw response length: ${rawResponse.length}`);
      logLongMessage(`[Harmony] Raw response`, rawResponse);
      
      // Detect if response looks incomplete (even if finish_reason doesn't indicate truncation)
      const looksIncomplete = this.detectIncompleteResponse(rawResponse);
      if (looksIncomplete || isTruncated) {
        const reason = isTruncated ? 'token limit' : 'incomplete structure';
        console.warn(`[Harmony] ⚠️ Response appears truncated or incomplete (${reason})`);
        console.warn(`[Harmony] Response length: ${rawResponse.length} chars, maxTokens: ${this.config.maxTokens}`);
        if (isTruncated) {
          console.warn(`[Harmony] Consider increasing harmony.maxTokens setting if responses are frequently truncated`);
        }
      }

      // Use HarmonyProcessor to parse the response
      const parsed = this.harmonyProcessor.parseResponse(rawResponse);
      
      console.log(`[Harmony] Parsed response - stage: ${currentStage}, content: ${parsed.content.length} chars, reasoning: ${parsed.reasoning?.length || 0} chars`);
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[Harmony] Found ${parsed.rawToolCalls.length} raw tool call(s) in response`);
      }
      console.log(`[Harmony] Content preview: ${parsed.content.substring(0, 300)}...`);

      // Extract tool calls
      let toolCalls: MCPToolCall[] = [];
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[HarmonyClient] Processing ${parsed.rawToolCalls.length} raw tool call(s)`);
        // Filter out items that don't look like tool calls before processing
        // This prevents unnecessary processing of regular content that was incorrectly added to rawToolCalls
        const validToolCalls = parsed.rawToolCalls.filter(raw => {
          // Check for MCP/JSON format first
          const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(raw);
          // Check for XML format using proper structure detection (not just substring match)
          const looksLikeXml = XmlProcessor.looksLikeXmlToolCall(raw);
          const looksLike = looksLikeMcpOrJson || looksLikeXml;
          console.log(`[HarmonyClient] Checking raw tool call: looksLike=${looksLike} (MCP/JSON=${looksLikeMcpOrJson}, XML=${looksLikeXml}), length=${raw.length}, preview="${raw.substring(0, 100)}..."`);
          return looksLike;
        });
        
        console.log(`[HarmonyClient] After filtering: ${validToolCalls.length} valid tool call(s) out of ${parsed.rawToolCalls.length}`);
        
        if (validToolCalls.length > 0) {
          console.log(`[HarmonyClient] Extracting tool calls from ${validToolCalls.length} valid raw tool call(s)...`);
          try {
            toolCalls = this.harmonyProcessor.extractToolCalls(validToolCalls);
            console.log(`[HarmonyClient] Extracted ${toolCalls.length} tool call(s):`, toolCalls.map(tc => ({ name: tc.name, argsKeys: Object.keys(tc.arguments || {}) })));
            if (toolCalls.length === 0 && validToolCalls.length > 0) {
              console.error(`[HarmonyClient] ⚠️ Extraction returned 0 tool calls but we had ${validToolCalls.length} valid raw tool calls!`);
              validToolCalls.forEach((raw, idx) => {
                console.error(`[HarmonyClient] Failed to extract from rawToolCalls[${idx}]: "${raw.substring(0, 300)}..."`);
              });
            }
          } catch (error: any) {
            console.error(`[HarmonyClient] Error extracting tool calls:`, error);
            console.error(`[HarmonyClient] Raw tool calls that failed:`, validToolCalls);
          }
        } else if (parsed.rawToolCalls.length > 0) {
          // Log if we filtered out all items - this indicates a bug in the parser
          console.warn(`[HarmonyClient] Found ${parsed.rawToolCalls.length} item(s) in rawToolCalls but none looked like tool calls. This may indicate a parsing issue.`);
          parsed.rawToolCalls.forEach((raw, idx) => {
            console.warn(`[HarmonyClient] rawToolCalls[${idx}]: "${raw.substring(0, 200)}..."`);
          });
        }
      }
      
      // Also check content for tool calls as fallback
      if (toolCalls.length === 0) {
        console.log(`[Harmony] No tool calls found in rawToolCalls, checking content...`);
        toolCalls = this.extractToolCallsFromContent(parsed.content);
        if (toolCalls.length > 0) {
          console.log(`[Harmony] Extracted ${toolCalls.length} tool call(s) from content`);
        } else {
          console.log(`[Harmony] No tool calls found in content either`);
        }
      }

      // Save this step to conversation context
      if (this.conversationContext) {
        this.conversationContext.steps.push({
          toolCalls: toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments || {} })),
          reasoning: parsed.reasoning,
          timestamp: Date.now(),
          stage: currentStage,
        });
      }

      // Validate tool calls against stage restrictions
      // Block file modification tools in both 'chat' and 'assumptions' stages
      // Only 'implementation' stage allows file modification tools
      const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file'];
      const restrictedToolCalls = toolCalls.filter(tc => fileModificationTools.includes(tc.name));
      
      console.log(`[Harmony] Validating ${toolCalls.length} tool call(s) in ${currentStage} stage. Restricted calls: ${restrictedToolCalls.length}`);
      
      // Block file modification tools in chat and assumptions stages
      // State machine: Chat -> Analysis -> Implementation (never skip Analysis)
      if (restrictedToolCalls.length > 0 && (currentStage === 'assumptions' || currentStage === 'chat')) {
        console.warn(`[Harmony] Blocked ${restrictedToolCalls.length} file modification tool call(s) in ${currentStage} stage: ${restrictedToolCalls.map(tc => tc.name).join(', ')}`);
        
        // Remove restricted tool calls and add warning to response
        const allowedToolCalls = toolCalls.filter(tc => !fileModificationTools.includes(tc.name));
        toolCalls = allowedToolCalls;
        
        console.log(`[Harmony] After blocking: ${toolCalls.length} tool call(s) remaining`);
        
        // Add warning message to content with proper stage guidance
        if (parsed.content && !parsed.content.includes('⚠️')) {
          let stageWarning: string;
          if (currentStage === 'assumptions') {
            stageWarning = `\n\n⚠️ **Note**: File modification tools (${restrictedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Analysis stage. Please provide code snippets instead. To create files, say "move to implementation" after the code is ready.`;
          } else {
            // Chat stage: guide user to Analysis first, then Implementation
            stageWarning = `\n\n⚠️ **Note**: File modification tools (${restrictedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Chat stage. To create files, I'll first analyze and provide code snippets (Analysis stage), then you can move to Implementation stage to create the files.`;
          }
          parsed.content = parsed.content + stageWarning;
        }
      } else if (restrictedToolCalls.length > 0) {
        console.log(`[Harmony] Allowing ${restrictedToolCalls.length} file modification tool call(s) in ${currentStage} stage`);
      }

      // Initialize executedToolCalls - will be set if tool calls are executed
      let executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }> | undefined = undefined;
      
      if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
        console.log(`[Harmony] Executing ${toolCalls.length} tool call(s) in stage: ${currentStage}`);
        logToolCalls(toolCalls.map(tc => ({ name: tc.name })));
        executedToolCalls = await this.executeToolCalls(toolCalls, currentStage);
        console.log(`[Harmony] Completed execution of ${executedToolCalls.length} tool call(s) in stage: ${currentStage}`);
        
        // Check if we should transition back to chat due to errors (state machine)
        if (this.conversationContext && this.stageStateMachine.shouldTransitionToChatOnError(currentStage, executedToolCalls)) {
          console.log(`[Harmony] State machine: Transitioning from ${currentStage} to chat due to errors requiring clarification`);
          const previousStage = this.conversationContext.currentStage;
          this.conversationContext.currentStage = 'chat';
          this.conversationContext.stageHistory.push({
            stage: 'chat',
            enteredAt: Date.now(),
            prompt: `Error-based transition: Tool execution errors require clarification`,
          });
          this.conversationContext.lastStageTransition = {
            from: previousStage,
            to: 'chat'
          };
          // Update currentStage for the rest of this function
          currentStage = 'chat';
        }
        
        // Check for applicable rules
        let applicableRules: Rule[] = [];
        if (this.rulesManager) {
          applicableRules = this.rulesManager.getApplicableRules(prompt);
          if (applicableRules.length === 0) {
            applicableRules = this.rulesManager.getRulesForTools(executedToolCalls.map(tc => tc.name));
          }
        }
        
        // Format tool results
        let finalContent = parsed.content;
        if (applicableRules.length > 0) {
          console.log(`[Rules] Formatting tool results according to ${applicableRules.length} rule(s) in ${currentStage} stage`);
          try {
            const formattedContent = await this.formatToolResultsWithRules(
              executedToolCalls,
              applicableRules,
              prompt,
              currentStage,
              templateName,
              applyTemplate
            );
            finalContent = formattedContent;
          } catch (formatError: any) {
            console.error(`[Rules] Error formatting tool results:`, formatError);
            finalContent += this.formatToolResults(executedToolCalls);
          }
        } else {
          finalContent += this.formatToolResults(executedToolCalls);
        }
        
        // Check if we should continue
        const shouldContinue = await this.shouldContinueTask(
          isContinuation ? this.conversationContext!.originalPrompt : prompt,
          executedToolCalls || [],
          finalContent,
          isContinuation,
          currentStage
        );
        
        // Build verbose info with tool calls
        // Only include step/maxSteps if we're continuing, otherwise mark as complete
        const verboseInfo: HarmonyResponse['verboseInfo'] = this.conversationContext ? {
          stage: currentStage,
          stageTransition: this.conversationContext.lastStageTransition,
          ...(shouldContinue ? {
            step: this.conversationContext.currentStep,
            maxSteps: this.conversationContext.maxSteps,
          } : {
            isComplete: true,
          }),
          toolCalls: (executedToolCalls || []).map(tc => ({
            name: tc.name,
            stage: currentStage,
            success: !tc.result?.isError,
            error: tc.result?.isError ? (tc.result.content?.[0]?.text || 'Unknown error') : undefined,
          })),
        } : {
          stage: currentStage,
          toolCalls: (executedToolCalls || []).map(tc => ({
            name: tc.name,
            stage: currentStage,
            success: !tc.result?.isError,
            error: tc.result?.isError ? (tc.result.content?.[0]?.text || 'Unknown error') : undefined,
          })),
        };

        if (shouldContinue && this.conversationContext) {
          // Check if we can continue (before incrementing)
          const nextStep = this.conversationContext.currentStep + 1;
          if (nextStep > this.conversationContext.maxSteps) {
            console.warn(`[Harmony] Cannot continue: next step (${nextStep}) would exceed max steps (${this.conversationContext.maxSteps})`);
            // Mark as complete since we can't continue
            const completeVerboseInfo: HarmonyResponse['verboseInfo'] = verboseInfo ? {
              ...verboseInfo,
              isComplete: true,
              step: undefined,
              maxSteps: undefined,
            } : {
              stage: currentStage,
              isComplete: true,
            };
            return {
              content: finalContent,
              reasoning: parsed.reasoning,
              final: parsed.final,
              ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
              isContinuation: isContinuation,
              verboseInfo: completeVerboseInfo,
            };
          }
          
          console.log(`[Harmony] Task incomplete, continuing to step ${nextStep}...`);
          
          // Prepare continuation prompt with stage awareness
          let continuationPrompt = `Based on the tool results, continue working on the original task.`;
          if (currentStage === 'assumptions') {
            continuationPrompt = `Based on the tool results, continue analyzing and provide code snippets. Remember: you are in the assumptions stage - provide code snippets only, do NOT use file modification tools.`;
          } else if (currentStage === 'chat') {
            continuationPrompt = `Based on the conversation, continue clarifying and understanding the requirements.`;
          }
          
          // Increment step counter
          this.conversationContext.currentStep++;
          
          // Recursive call with continuation
          const continuationResponse = await this.callServer(
            continuationPrompt,
            templateName,
            applyTemplate,
            true, // Mark as continuation
            conversationHistory
          );
          
          // Merge tool calls from both responses
          const allToolCalls = [...(executedToolCalls || []), ...(continuationResponse.toolCalls || [])];
          const mergedVerboseInfo: HarmonyResponse['verboseInfo'] = continuationResponse.verboseInfo ? {
            ...continuationResponse.verboseInfo,
            toolCalls: [
              ...(verboseInfo.toolCalls || []),
              ...(continuationResponse.verboseInfo.toolCalls || []),
            ],
          } : verboseInfo;
          
          // Merge responses
          return {
            content: finalContent + "\n\n---\n\n" + continuationResponse.content,
            reasoning: parsed.reasoning,
            final: parsed.final || continuationResponse.final,
            toolCalls: allToolCalls,
            isContinuation: true,
            verboseInfo: mergedVerboseInfo,
          };
        }
        
        return {
          content: finalContent,
          reasoning: parsed.reasoning,
          final: parsed.final,
          ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
          isContinuation: isContinuation,
          verboseInfo,
        };
      }

      // If no tool calls but model describes actions, check if we should continue
      // Only check this in implementation stage or if we're moving toward implementation
      if (toolCalls.length === 0 && parsed.content && this.conversationContext && currentStage === 'implementation') {
        const describesFileOperations = /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:file|content|property|field)/i.test(parsed.content);
        const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css|swift)/i.test(prompt.toLowerCase());
        
        if (describesFileOperations && isFileTask) {
          console.log(`[HarmonyClient] Model describes file operations but didn't make tool calls. Triggering continuation...`);
          
          // Check if we can continue (before incrementing)
          const nextStep = this.conversationContext.currentStep + 1;
          if (nextStep > this.conversationContext.maxSteps) {
            console.warn(`[Harmony] Cannot continue: next step (${nextStep}) would exceed max steps (${this.conversationContext.maxSteps})`);
            const cannotContinueVerboseInfo: HarmonyResponse['verboseInfo'] = {
              stage: currentStage,
              isComplete: true,
            };
            return {
              content: parsed.content,
              reasoning: parsed.reasoning,
              final: parsed.final,
              isContinuation: isContinuation,
              verboseInfo: cannotContinueVerboseInfo,
            };
          }
          
          console.log(`[Harmony] Continuing to step ${nextStep} to get model to make tool calls...`);
          
          // Prepare continuation prompt that encourages tool calls (only in implementation stage)
          const continuationPrompt = `Please use the appropriate tool calls to perform the file operations you described. For example, use read_file to read a file, and replace_file to modify a file.`;
          
          // Increment step counter
          this.conversationContext.currentStep++;
          
          // Recursive call with continuation
          const continuationResponse = await this.callServer(
            continuationPrompt,
            templateName,
            applyTemplate,
            true, // Mark as continuation
            conversationHistory
          );
          
          // Build verbose info for this step (no tool calls yet)
          const noToolCallsVerboseInfo: HarmonyResponse['verboseInfo'] = this.conversationContext ? {
            stage: currentStage,
            stageTransition: this.conversationContext.lastStageTransition,
            step: this.conversationContext.currentStep,
            maxSteps: this.conversationContext.maxSteps,
          } : {
            stage: currentStage,
          };

          // Merge verbose info from continuation
          const mergedVerboseInfo: HarmonyResponse['verboseInfo'] = continuationResponse.verboseInfo ? {
            ...continuationResponse.verboseInfo,
            // Preserve stage from continuation if available
            stage: continuationResponse.verboseInfo.stage || currentStage,
          } : noToolCallsVerboseInfo;

          // Merge responses
          return {
            content: parsed.content + "\n\n---\n\n" + continuationResponse.content,
            reasoning: parsed.reasoning,
            final: parsed.final || continuationResponse.final,
            toolCalls: continuationResponse.toolCalls || [],
            isContinuation: true,
            verboseInfo: mergedVerboseInfo,
          };
        }
      }

      // Log final response summary
      if (this.conversationContext) {
        console.log(`[Harmony] Response complete - stage: ${currentStage}, step: ${this.conversationContext.currentStep}/${this.conversationContext.maxSteps}, isContinuation: ${isContinuation}`);
      }

      // Build verbose info - always include stage information
      // No tool calls executed, so this is a complete response (no continuation)
      const verboseInfo: HarmonyResponse['verboseInfo'] = this.conversationContext ? {
        stage: currentStage,
        stageTransition: this.conversationContext.lastStageTransition,
        isComplete: true,
      } : {
        stage: currentStage,
      };

      // Clear lastStageTransition after using it
      if (this.conversationContext?.lastStageTransition) {
        this.conversationContext.lastStageTransition = undefined;
      }

      return {
        content: parsed.content,
        reasoning: parsed.reasoning,
        final: parsed.final,
        ...(executedToolCalls !== undefined ? { toolCalls: executedToolCalls } : {}),
        isContinuation: isContinuation,
        verboseInfo,
      };
    } catch (error: any) {
      console.error(`[Harmony] Error calling Harmony server (stage: ${this.conversationContext?.currentStage || 'unknown'}):`, error);
      throw new Error(`Failed to call Harmony server: ${error.message}`);
    }
  }

  /**
   * Determine if the task should continue after tool execution
   */
  private async shouldContinueTask(
    originalPrompt: string,
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    currentContent: string,
    isAlreadyContinuation: boolean,
    currentStage: WorkflowStage
  ): Promise<boolean> {
    // Check if we've reached the maximum steps
    // Use > instead of >= to allow the final step (e.g., step 5 when maxSteps is 5) to run
    if (this.conversationContext && this.conversationContext.currentStep > this.conversationContext.maxSteps) {
      return false;
    }
    
    // Also check if the NEXT step would exceed maxSteps
    if (this.conversationContext && this.conversationContext.currentStep + 1 > this.conversationContext.maxSteps) {
      return false;
    }
    
    // Stage-specific completion logic
    if (currentStage === 'chat') {
      // Check if this is a file task with only discovery tools - allow continuation
      const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
      const onlyDiscoveryTools = executedToolCalls.every(tc => 
        ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
      );
      const hasFileModification = executedToolCalls.some(tc => 
        ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
      );
      
      if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
        console.log(`[Harmony] Chat stage: File task with only discovery tools, continuing`);
        return true;
      }
      
      // Otherwise, only continue if there are explicit continuation hints
      const hasContinuationHint = /(?:next|continue|then|after|now|further|additional|let'?s|proceed)/i.test(currentContent.toLowerCase());
      if (hasContinuationHint) {
        console.log(`[Harmony] Chat stage: Has continuation hints, may need to continue`);
        return true;
      }
      return false;
    }
    
    if (currentStage === 'assumptions') {
      // Check if this is a file task with only discovery tools - allow continuation to implementation
      // Per STATE_MACHINE.md: File tasks with extensions should transition to implementation
      const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
      const onlyDiscoveryTools = executedToolCalls.every(tc => 
        ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
      );
      const hasFileModification = executedToolCalls.some(tc => 
        ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
      );
      
      // If it's a file task with extensions and only discovery tools, continue to implementation
      if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
        console.log(`[Harmony] Assumptions stage: File task with only discovery tools, continuing to implementation`);
        // Transition to implementation stage for continuation
        if (this.conversationContext) {
          this.conversationContext.currentStage = 'implementation';
          this.conversationContext.stageHistory.push({
            stage: 'implementation',
            enteredAt: Date.now(),
            prompt: 'Auto-transition: File task ready for implementation'
          });
          this.conversationContext.lastStageTransition = {
            from: 'assumptions',
            to: 'implementation'
          };
        }
        return true;
      }
      
      // In assumptions stage, completion is when code snippets are provided
      // Don't look for file modifications as completion criteria
      const hasCodeSnippets = /```[\s\S]*?```/.test(currentContent);
      const hasCompletionPhrase = /(?:here'?s|here is|below|above).*(?:code|snippet|solution|example)/i.test(currentContent.toLowerCase());
      
      // Check for explicit continuation hints
      const hasContinuationHint = /(?:next|continue|then|after|now|further|additional|implement|create|write)/i.test(currentContent.toLowerCase());
      
      // In assumptions stage, we don't continue if code snippets are provided
      if (hasCodeSnippets || hasCompletionPhrase) {
        console.log(`[Harmony] Assumptions stage: Code snippets provided, task appears complete`);
        return false;
      }
      
      if (hasContinuationHint) {
        console.log(`[Harmony] Assumptions stage: Has continuation hints`);
        return true;
      }
      
      return false;
    }
    
    // Implementation stage: Use existing file modification logic
    const taskCompletionPhrases = [
      /(?:updated|created|wrote|modified).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i,
      /file.*has been.*(?:created|updated|written|modified)/i,
      /task.*(?:complete|done|finished|accomplished)/i,
      /(?:here'?s|here is).*the.*(?:readme|file|code)/i,
      /I have.*(?:created|updated|written)/i,
      /\*\*File:\*\*\s*`[^`]+`/i,
      /```[\s\S]*?```/i, // Code blocks in response
    ];
    
    const hasCompletionPhrase = taskCompletionPhrases.some(phrase => phrase.test(currentContent.toLowerCase()));
    
    // Check if we've performed file modification OR if the model says it will/has done it
    const hasFileModification = executedToolCalls.some(tc => 
      ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
    );
    
    // Check if the response indicates file modification was done (even without tool calls)
    const indicatesFileModified = /(?:I will|I'll|going to|will|should|need to).*(?:update|modify|change|edit|replace).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(currentContent.toLowerCase());
    
    // Check if original prompt requested file creation/modification
    const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
    
    // Check if we've only done discovery/read tools
    const onlyDiscoveryTools = executedToolCalls.every(tc => 
      ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
    );
    
    // Check if the current content mentions specific tool calls that should be made
    const mentionsToolCalls = /(?:will call|should call|need to call|calling|use).*(?:tool|function|method|update_file|write_file|create_file)/i.test(currentContent.toLowerCase());
    
    // Decision logic for implementation stage
    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      // If we have discovery tools but no file modification AND the model mentions doing it
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Implementation stage: Model says it will modify file but didn't call tools. Need continuation.`);
        return true;
      }
      
      console.log(`[Harmony] Implementation stage: Only discovery tools used, no file modification yet`);
      return true;
    }
    
    if (isFileTask && !hasFileModification && !hasCompletionPhrase) {
      // If the model indicates it will modify but doesn't call tools, we need to continue
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Implementation stage: Model says it will modify but didn't call tools`);
        return true;
      }
      
      console.log(`[Harmony] Implementation stage: File task but no file modification or completion phrase`);
      return true;
    }
    
    // Check for explicit "continue" or "next step" in reasoning/content
    const hasContinuationHint = /(?:next|continue|then|after|now|further|additional)/i.test(currentContent.toLowerCase());
    
    if (hasContinuationHint && !hasCompletionPhrase) {
      console.log(`[Harmony] Implementation stage: Has continuation hints but no completion`);
      return true;
    }
    
    // If model says "I will update" but didn't actually call update tools, continue
    if (indicatesFileModified && !hasFileModification && !mentionsToolCalls) {
      console.log(`[Harmony] Implementation stage: Model indicated file modification but didn't call appropriate tools`);
      return true;
    }
    
    console.log(`[Harmony] Implementation stage: Task appears complete: hasFileModification=${hasFileModification}, hasCompletionPhrase=${hasCompletionPhrase}, indicatesFileModified=${indicatesFileModified}`);
    return false;
  }


  /**
   * Fallback method to extract tool calls from content
   */
  private extractToolCallsFromContent(content: string): MCPToolCall[] {
    return this.harmonyProcessor.extractToolCalls([content]);
  }

  /**
   * Detect if a response looks incomplete (truncated code blocks, incomplete file content, etc.)
   */
  private detectIncompleteResponse(response: string): boolean {
    // Check for unclosed code blocks
    const codeBlockMatches = response.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      const markerCount = codeBlockMatches.length;
      console.log(`[Harmony] Detected unclosed code block (${markerCount} code block markers)`);
      return true;
    }

    // Check for file descriptions with code blocks that might be incomplete
    // Pattern: **File:** `filename` followed by code block
    const filePattern = /\*\*File:\*\*\s*`[^`]+`/gi;
    const codeBlockPattern = /```[\s\S]*?```/g;
    
    if (filePattern.test(response)) {
      // Reset regex lastIndex for matchAll
      filePattern.lastIndex = 0;
      
      // Count code blocks after file mentions
      const fileMatches = Array.from(response.matchAll(filePattern));
      const allCodeBlocks = Array.from(response.matchAll(codeBlockPattern));
      
      // If we have file mentions but code blocks seem incomplete
      // (e.g., file mentioned but code block doesn't close properly)
      const lastFileMatch = fileMatches[fileMatches.length - 1];
      if (lastFileMatch) {
        const afterFileMatch = response.substring(lastFileMatch.index! + lastFileMatch[0].length);
        const codeBlocksAfter = Array.from(afterFileMatch.matchAll(codeBlockPattern));
        
        // If there's a file mention but no complete code block after it, it might be incomplete
        if (codeBlocksAfter.length === 0 && afterFileMatch.includes('```')) {
          console.log(`[Harmony] Detected file mention with potentially incomplete code block`);
          return true;
        }
      }
    }

    // Check for incomplete Harmony tokens (if harmonyMode is true)
    // Unclosed tokens like <|channel|> without <|end|>
    if (response.includes('<|')) {
      const channelTokens = (response.match(/<\|channel\|>/g) || []).length;
      const endTokens = (response.match(/<\|end\|>/g) || []).length;
      
      // If we have channel tokens but fewer end tokens, it might be incomplete
      if (channelTokens > endTokens) {
        console.log(`[Harmony] Detected unclosed Harmony tokens (${channelTokens} channels, ${endTokens} ends)`);
        return true;
      }
    }

    // Check if response ends abruptly (ends in middle of word, unclosed quotes, etc.)
    const trimmed = response.trim();
    if (trimmed.length > 0) {
      const lastChar = trimmed[trimmed.length - 1];
      // If ends with certain characters, might be incomplete
      // But be careful - some valid responses might end with these
      // Only flag if we also have other indicators
    }

    return false;
  }

  /**
   * Execute tool calls (MCP or Native)
   */
  private async executeToolCalls(
    toolCalls: MCPToolCall[],
    currentStage?: WorkflowStage
  ): Promise<Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>> {
    if (currentStage) {
      console.log(`[Harmony] Executing tools in ${currentStage} stage`);
    }
    const results = [];
    
    for (const toolCall of toolCalls) {
      try {
        // Check if it's a native tool first
        if (this.nativeToolsManager) {
          const nativeTools = this.nativeToolsManager.getAvailableTools();
          const isNativeTool = nativeTools.some(t => t.name === toolCall.name);
          
          if (isNativeTool) {
            console.log(`[Harmony] Executing native tool "${toolCall.name}"`);
            let result = await this.nativeToolsManager.callTool(
              toolCall.name,
              toolCall.arguments || {}
            );
            
            // Auto-fallback: If create_file fails because file exists, automatically use replace_file
            if (toolCall.name === "create_file" && result.isError) {
              const errorText = result.content[0]?.text || "";
              if (errorText.includes("already exists") || errorText.includes("Use replace_file")) {
                console.log(`[Harmony] File already exists, automatically retrying with replace_file`);
                result = await this.nativeToolsManager.callTool(
                  "replace_file",
                  toolCall.arguments || {}
                );
                // Update the tool call name in the result to reflect what actually happened
                results.push({
                  name: "replace_file", // Record as replace_file since that's what we did
                  arguments: toolCall.arguments || {},
                  result: {
                    content: result.content,
                    isError: result.isError,
                  },
                });
                continue;
              }
            }
            
            const mcpResult: MCPToolResult = {
              content: result.content,
              isError: result.isError,
            };
            
            results.push({
              name: toolCall.name,
              arguments: toolCall.arguments || {},
              result: mcpResult,
            });
            continue;
          }
        }
        
        // Try MCP tools
        if (!this.mcpManager) {
          throw new Error("MCP Manager not available");
        }
        
        const serverName = this.mcpManager.findToolServer(toolCall.name);
        if (!serverName) {
          console.error(`[Harmony] [MCP] Tool "${toolCall.name}" not found in any MCP server`);
          results.push({
            name: toolCall.name,
            arguments: toolCall.arguments || {},
            result: {
              content: [
                {
                  type: "text",
                  text: `Error: Tool "${toolCall.name}" not found`,
                },
              ],
              isError: true,
            },
          });
          continue;
        }

        console.log(`[Harmony] [MCP] Executing tool "${toolCall.name}" on server "${serverName}" with args:`, JSON.stringify(toolCall.arguments || {}).substring(0, 200));
        const result = await this.mcpManager.callTool(
          serverName,
          toolCall.name,
          toolCall.arguments || {}
        );
        
        results.push({
          name: toolCall.name,
          arguments: toolCall.arguments || {},
          result,
        });

        const resultPreview = result.content?.[0]?.text?.substring(0, 100) || 'no content';
        const status = result.isError ? 'failed' : 'succeeded';
        console.log(`[Harmony] [MCP] Tool "${toolCall.name}" on server "${serverName}" ${status}: ${resultPreview}...`);
      } catch (error: any) {
        console.error(`[Harmony] Error executing tool "${toolCall.name}":`, error);
        results.push({
          name: toolCall.name,
          arguments: toolCall.arguments || {},
          result: {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          },
        });
      }
    }

    return results;
  }

  /**
   * Format tool results as plain text
   */
  private formatToolResults(
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>
  ): string {
    if (executedToolCalls.length === 0) {
      return '';
    }

    let toolResultsText = "\n\n**Tool Results:**\n";
    executedToolCalls.forEach((toolCall) => {
      toolResultsText += `\n**${toolCall.name}**:\n`;
      if (toolCall.result?.isError) {
        toolResultsText += `❌ Error: ${toolCall.result.content[0]?.text || "Unknown error"}\n`;
      } else {
        toolCall.result?.content.forEach((content) => {
          if (content.type === "text" && content.text) {
            toolResultsText += `${content.text}\n`;
          }
        });
      }
    });
    
    return toolResultsText;
  }

  /**
   * Format tool results according to applicable rules
   */
  private async formatToolResultsWithRules(
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    applicableRules: Rule[],
    originalPrompt: string,
    currentStage: WorkflowStage,
    templateName?: string,
    applyTemplate?: (templateName: string, context: any, history?: readonly ChatMessage[]) => Promise<string>
  ): Promise<string> {
    // Extract tool results text
    let toolResultsText = "";
    executedToolCalls.forEach((toolCall) => {
      if (toolCall.result?.isError) {
        toolResultsText += `\n**${toolCall.name}** Error: ${toolCall.result.content[0]?.text || "Unknown error"}\n`;
      } else {
        toolCall.result?.content.forEach((content) => {
          if (content.type === "text" && content.text) {
            toolResultsText += `${content.text}\n`;
          }
        });
      }
    });

    // Get rules context
    let rulesContext = "";
    if (this.rulesManager) {
      rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
    }

    // Create formatting prompt with stage-aware instructions
    const stageNote = currentStage === 'assumptions' 
      ? `\n\n⚠️ CRITICAL: You are in the ASSUMPTIONS stage. You MUST provide code snippets only. Do NOT use file modification tools. If rules specify "provide code snippets", you MUST follow them strictly.`
      : currentStage === 'chat'
      ? `\n\n⚠️ CRITICAL: You are in the CHAT stage. Focus on clarifying and understanding the problem. Do NOT provide file modifications yet.`
      : `\n\nYou are in the IMPLEMENTATION stage. You may use file modification tools to implement the solution.`;
    
    const formattingPrompt = `User request: "${originalPrompt}"

Current Stage: ${currentStage.toUpperCase()}
${stageNote}

Tool results have been obtained. Format these results according to the rules below.

## Always Clarify the problem

Before providing the formatted results, you **MUST**:

- **Restate my problem** - Paraphrase my request in your own words to show understanding
- **Brief my code** - Briefly mention any assumptions you are making about my code context (if applicable)
- **Proceed to solution** - provide the formatted results after clarification

${rulesContext}

Tool Results:
${toolResultsText}

IMPORTANT: 
1. First, restate the problem and provide any brief context
2. Then, output the formatted results following the rules above
3. In ${currentStage === 'assumptions' ? 'ASSUMPTIONS' : currentStage === 'chat' ? 'CHAT' : 'IMPLEMENTATION'} stage: ${currentStage === 'assumptions' ? 'Provide code snippets only, do NOT use file modification tools' : currentStage === 'chat' ? 'Focus on clarification, no file operations' : 'You may implement using file modification tools'}
4. If rules specify code snippets format, follow them exactly

Response:`;

    try {
      // Make follow-up API call
      const endpoint = `${this.config.serverUrl}/v1/completions`;
      
      // Use HarmonyProcessor to format the prompt
      const finalPrompt = this.harmonyProcessor.formatPrompt(formattingPrompt);

      const response = await axios.post(
        endpoint,
        {
          model: this.config.model,
          prompt: finalPrompt,
          temperature: 0.3,
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

      // Extract response
      let rawResponse: string | undefined;
      if (response.data?.choices?.[0]?.text) {
        rawResponse = response.data.choices[0].text;
      } else if (response.data?.choices?.[0]?.message?.content) {
        rawResponse = response.data.choices[0].message.content;
      } else if (response.data?.text) {
        rawResponse = response.data.text;
      } else if (response.data?.content) {
        rawResponse = response.data.content;
      }

      if (rawResponse) {
        const parsed = this.harmonyProcessor.parseResponse(rawResponse);
        // Return the full content (including restatement and JSON)
        // The content may include a restatement followed by JSON
        if (parsed.content.trim()) {
          return parsed.content.trim();
        }
      }

      // Fallback to raw tool results
      return toolResultsText;
    } catch (error: any) {
      console.error(`[Rules] Error formatting tool results:`, error);
      return toolResultsText;
    }
  }

  /**
   * Reset conversation context
   */
  resetConversationContext(): void {
    this.conversationContext = null;
    console.log(`[Harmony] Conversation context reset`);
  }
}