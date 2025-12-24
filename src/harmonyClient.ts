import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { RulesManager, Rule } from "./rulesManager";
import { NativeToolsManager, NativeTool } from "./nativeToolManager";
import { HarmonyProcessor, HarmonyParseResult } from "./harmonyProcessor";
import { ToolCallExtractor } from "./utils/toolCallExtractor";
import { ChatMessage } from "./conversationManager";
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
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
  // Add new field to track if this is a continuation response
  isContinuation?: boolean;
}

/**
 * Main HarmonyClient with HarmonyProcessor integration and multi-step continuation
 */
export class HarmonyClient {
  private harmonyProcessor: HarmonyProcessor;
  private conversationContext: {
    originalPrompt: string;
    steps: Array<{
      toolCalls: Array<{ name: string; arguments: Record<string, any> }>;
      reasoning?: string;
      timestamp: number;
    }>;
    maxSteps: number;
    currentStep: number;
  } | null = null;

  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {
    this.harmonyProcessor = new HarmonyProcessor(config.harmonyMode);
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
        this.conversationContext = {
          originalPrompt: prompt,
          steps: [],
          maxSteps: 5, // Maximum steps to prevent infinite loops
          currentStep: 1,
        };
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
        return {
          content: `I've gathered information through multiple steps, but haven't completed the task. Here's what I found so far.`,
          reasoning: "Reached maximum allowed steps for this task.",
        };
      }

      const endpoint = `${this.config.serverUrl}/v1/completions`;
 
      logApiRequest(endpoint, prompt, 100);

      // Build tools context
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
      
      if (allTools.length > 0) {
        toolsContext = "\n\nAvailable Tools:\n";
        allTools.forEach((tool) => {
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

      // If this is a continuation, add context about previous steps
      let continuationContext = "";
      if (isContinuation && this.conversationContext) {
        const previousSteps = this.conversationContext.steps;
        if (previousSteps.length > 0) {
          continuationContext = "\n\n## CONTINUATION - Previous Steps:\n";
          previousSteps.forEach((step, index) => {
            continuationContext += `\nStep ${index + 1}:\n`;
            if (step.reasoning) {
              continuationContext += `Reasoning: ${step.reasoning.substring(0, 200)}...\n`;
            }
            step.toolCalls.forEach(toolCall => {
              continuationContext += `- Called ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}\n`;
            });
          });
          
          continuationContext += `\nOriginal task: "${this.conversationContext.originalPrompt}"\n`;
          continuationContext += `Current step: ${this.conversationContext.currentStep} of ${this.conversationContext.maxSteps}\n`;
          continuationContext += `\nNow continue with the NEXT step to complete the task:\n`;
        }
      }

      // Apply template if specified
      let finalPrompt: string;
      if (templateName && applyTemplate) {
        const mcpTools = this.mcpManager?.getAllTools() || [];
        const nativeTools = this.nativeToolsManager?.getAvailableTools() || [];
        const templateContext = { 
          prompt: prompt + toolsContext + continuationContext,
          rules: rulesContext || "",
          tools: [...mcpTools, ...nativeTools]
        };
        
        finalPrompt = await applyTemplate(templateName, templateContext);
        
        // If template doesn't include rules and we have them, prepend
        if (!finalPrompt.includes("{{rules}}") && rulesContext) {
          finalPrompt = rulesContext + finalPrompt;
        }
      } else {
        finalPrompt = rulesContext + continuationContext + prompt + toolsContext;
      }

      // Log prompt preview
      const previewLength = 500;
      console.log(`[Harmony] Final prompt (first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`);
      if (rulesContext) {
        console.log(`[Rules] Rules context length: ${rulesContext.length} characters`);
      }
      if (continuationContext) {
        console.log(`[Harmony] Continuation context length: ${continuationContext.length} characters`);
      }

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

      // Use HarmonyProcessor to parse the response
      const parsed = this.harmonyProcessor.parseResponse(rawResponse);
      
      console.log(`[Harmony] Parsed - content: ${parsed.content.length} chars, reasoning: ${parsed.reasoning?.length || 0} chars`);
      console.log(`[Harmony] Content preview: ${parsed.content.substring(0, 300)}...`);

      // Extract tool calls
      let toolCalls: MCPToolCall[] = [];
      if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
        console.log(`[HarmonyClient] Processing ${parsed.rawToolCalls.length} raw tool call(s)`);
        // Filter out items that don't look like tool calls before processing
        // This prevents unnecessary processing of regular content that was incorrectly added to rawToolCalls
        const validToolCalls = parsed.rawToolCalls.filter(raw => {
          const looksLike = ToolCallExtractor.looksLikeToolCall(raw) || raw.includes('<tool_call');
          console.log(`[HarmonyClient] Checking raw tool call: looksLike=${looksLike}, length=${raw.length}, preview="${raw.substring(0, 100)}..."`);
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
        toolCalls = this.extractToolCallsFromContent(parsed.content);
      }

      // Save this step to conversation context
      if (this.conversationContext) {
        this.conversationContext.steps.push({
          toolCalls: toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments || {} })),
          reasoning: parsed.reasoning,
          timestamp: Date.now(),
        });
      }

      if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
        console.log(`[HarmonyClient] Executing ${toolCalls.length} tool call(s)...`);
        logToolCalls(toolCalls.map(tc => ({ name: tc.name })));
        const executedToolCalls = await this.executeToolCalls(toolCalls);
        console.log(`[HarmonyClient] Completed execution of ${executedToolCalls.length} tool call(s)`);
        
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
          console.log(`[Rules] Formatting tool results according to ${applicableRules.length} rule(s)`);
          try {
            const formattedContent = await this.formatToolResultsWithRules(
              executedToolCalls,
              applicableRules,
              prompt,
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
          executedToolCalls,
          finalContent,
          isContinuation
        );
        
        if (shouldContinue && this.conversationContext) {
          // Check if we can continue (before incrementing)
          const nextStep = this.conversationContext.currentStep + 1;
          if (nextStep > this.conversationContext.maxSteps) {
            console.warn(`[Harmony] Cannot continue: next step (${nextStep}) would exceed max steps (${this.conversationContext.maxSteps})`);
            return {
              content: finalContent,
              reasoning: parsed.reasoning,
              toolCalls: executedToolCalls,
              isContinuation: isContinuation,
            };
          }
          
          console.log(`[Harmony] Task incomplete, continuing to step ${nextStep}...`);
          
          // Prepare continuation prompt
          const continuationPrompt = `Based on the tool results, continue working on the original task.`;
          
          // Increment step counter
          this.conversationContext.currentStep++;
          
          // Recursive call with continuation
          const continuationResponse = await this.callServer(
            continuationPrompt,
            templateName,
            applyTemplate,
            true // Mark as continuation
          );
          
          // Merge responses
          return {
            content: finalContent + "\n\n---\n\n" + continuationResponse.content,
            reasoning: parsed.reasoning,
            toolCalls: [...executedToolCalls, ...(continuationResponse.toolCalls || [])],
            isContinuation: true,
          };
        }
        
        return {
          content: finalContent,
          reasoning: parsed.reasoning,
          toolCalls: executedToolCalls,
          isContinuation: isContinuation,
        };
      }

      return {
        content: parsed.content,
        reasoning: parsed.reasoning,
        isContinuation: isContinuation,
      };
    } catch (error: any) {
      console.error("Error calling Harmony server:", error);
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
    isAlreadyContinuation: boolean
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
    
    // Check if the task appears complete
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
    
    // NEW: Check if the current content mentions specific tool calls that should be made
    const mentionsToolCalls = /(?:will call|should call|need to call|calling|use).*(?:tool|function|method|update_file|write_file|create_file)/i.test(currentContent.toLowerCase());
    
    // Decision logic
    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      // If we have discovery tools but no file modification AND the model mentions doing it
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Task "${originalPrompt}" - Model says it will modify file but didn't call tools. Need continuation.`);
        return true;
      }
      
      console.log(`[Harmony] Task "${originalPrompt}" needs continuation: Only discovery tools used, no file modification yet`);
      return true;
    }
    
    if (isFileTask && !hasFileModification && !hasCompletionPhrase) {
      // If the model indicates it will modify but doesn't call tools, we need to continue
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Task "${originalPrompt}" needs continuation: Model says it will modify but didn't call tools`);
        return true;
      }
      
      console.log(`[Harmony] Task "${originalPrompt}" needs continuation: File task but no file modification or completion phrase`);
      return true;
    }
    
    // Check for explicit "continue" or "next step" in reasoning/content
    const hasContinuationHint = /(?:next|continue|then|after|now|further|additional)/i.test(currentContent.toLowerCase());
    
    if (hasContinuationHint && !hasCompletionPhrase) {
      console.log(`[Harmony] Task "${originalPrompt}" needs continuation: Has continuation hints but no completion`);
      return true;
    }
    
    // NEW: If model says "I will update" but didn't actually call update tools, continue
    if (indicatesFileModified && !hasFileModification && !mentionsToolCalls) {
      console.log(`[Harmony] Task "${originalPrompt}" needs continuation: Model indicated file modification but didn't call appropriate tools`);
      return true;
    }
    
    console.log(`[Harmony] Task "${originalPrompt}" appears complete: hasFileModification=${hasFileModification}, hasCompletionPhrase=${hasCompletionPhrase}, indicatesFileModified=${indicatesFileModified}`);
    return false;
  }


  /**
   * Fallback method to extract tool calls from content
   */
  private extractToolCallsFromContent(content: string): MCPToolCall[] {
    return this.harmonyProcessor.extractToolCalls([content]);
  }

  /**
   * Execute tool calls (MCP or Native)
   */
  private async executeToolCalls(
    toolCalls: MCPToolCall[]
  ): Promise<Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>> {
    const results = [];
    
    for (const toolCall of toolCalls) {
      try {
        // Check if it's a native tool first
        if (this.nativeToolsManager) {
          const nativeTools = this.nativeToolsManager.getAvailableTools();
          const isNativeTool = nativeTools.some(t => t.name === toolCall.name);
          
          if (isNativeTool) {
            console.log(`[Harmony] Executing native tool "${toolCall.name}"`);
            const result = await this.nativeToolsManager.callTool(
              toolCall.name,
              toolCall.arguments || {}
            );
            
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
          console.error(`[Harmony] Tool "${toolCall.name}" not found`);
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

        console.log(`[Harmony] Executing MCP tool "${toolCall.name}" on server "${serverName}"`);
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

        console.log(`[Harmony] MCP tool "${toolCall.name}" executed successfully`);
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

    // Create formatting prompt
    const formattingPrompt = `User request: "${originalPrompt}"

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
2. Then, output the formatted results as JSON that follows the rules above
3. The JSON should start with [ or { and end with ] or }
4. You may include the JSON in a code block (\`\`\`json ... \`\`\`) for clarity

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