import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { RulesManager, Rule } from "./rulesManager";
import { NativeToolsManager, NativeTool } from "./nativeTools";

export interface LlamaResponse {
  content: string;
  reasoning?: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
}

export class LlamaClient {
  constructor(
    private config: LlamaConfig,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {}

  async callServer(
    prompt: string,
    templateName?: string,
    applyTemplate?: (templateName: string, context: any) => Promise<string>
  ): Promise<LlamaResponse> {
    try {
      const endpoint = `${this.config.serverUrl}/v1/completions`;
      console.log(`[Harmony] Calling endpoint: ${endpoint}`);
      console.log(`[Harmony] Prompt: ${prompt.substring(0, 100)}...`);

      // Get available tools (MCP + Native) and add them to context
      let toolsContext = "";
      const allTools: Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> = [];
      
      // Get MCP tools
      if (this.mcpManager) {
        const mcpTools = this.mcpManager.getAllTools();
        mcpTools.forEach((tool) => {
          allTools.push({ ...tool, type: "mcp" });
        });
      }
      
      // Get Native tools
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

      // Get applicable rules based on the query
      let rulesContext = "";
      if (this.rulesManager) {
        const applicableRules = this.rulesManager.getApplicableRules(prompt);
        if (applicableRules.length > 0) {
          console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) for query`);
          rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
          
          // Log which rules were matched for debugging
          applicableRules.forEach(rule => {
            console.log(`[Rules] Matched rule: ${rule.id}${rule.description ? ` (${rule.description})` : ""}`);
          });
        }
      }

      // Apply Jinja template if specified
      // Rules should be injected BEFORE the template so they appear prominently
      let finalPrompt: string;
      if (templateName && applyTemplate) {
        // Pass rules and tools separately so template can structure them properly
        const mcpTools = this.mcpManager?.getAllTools() || [];
        const nativeTools = this.nativeToolsManager?.getAvailableTools() || [];
        const basePrompt = await applyTemplate(templateName, { 
          prompt: prompt + toolsContext,
          rules: rulesContext || "",
          tools: [...mcpTools, ...nativeTools]
        });
        // If template doesn't use {{rules}}, prepend them
        if (!basePrompt.includes("{{rules}}") && rulesContext) {
          finalPrompt = rulesContext + basePrompt;
        } else {
          finalPrompt = basePrompt;
        }
      } else {
        // No template - just combine everything, with rules first
        finalPrompt = rulesContext + prompt + toolsContext;
      }

      // Log more of the prompt for debugging (especially rules)
      const previewLength = 500;
      console.log(`[Harmony] Final prompt (first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`);
      if (rulesContext) {
        console.log(`[Rules] Rules context length: ${rulesContext.length} characters`);
      }

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
      console.log(
        `[Harmony] API response data structure:`,
        JSON.stringify(Object.keys(response.data || {})).substring(0, 200)
      );

      // Check for different response formats
      let rawResponse: string | undefined;

      if (response.data?.choices?.[0]?.text) {
        rawResponse = response.data.choices[0].text;
      } else if (response.data?.choices?.[0]?.message?.content) {
        // OpenAI-compatible format
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

      console.log(`[Harmony] Raw response length: ${rawResponse?.length || 0}`);
      if (rawResponse && rawResponse.length > 0) {
        console.log(
          `[Harmony] Raw response: ${rawResponse.substring(0, 200)}...`
        );
      } else {
        console.warn(`[Harmony] Raw response is empty or undefined!`);
        throw new Error("Received empty response from API");
      }

      // Clean up Harmony format tokens and extract reasoning
      const cleaned = this.cleanHarmonyResponse(rawResponse);
      console.log(
        `[Harmony] Cleaned response - content length: ${cleaned.content?.length || 0}, has reasoning: ${!!cleaned.reasoning}`
      );
      if (cleaned.content && cleaned.content.length > 0) {
        console.log(
          `[Harmony] Cleaned content preview: ${cleaned.content.substring(0, 100)}...`
        );
      }

      // Check for tool calls in the response (check both raw and cleaned)
      const toolCalls = this.extractToolCalls(rawResponse);
      const cleanedToolCalls = this.extractToolCalls(cleaned.content);
      const allToolCalls = [...toolCalls, ...cleanedToolCalls];
      
      // Remove duplicates based on tool name and args
      const uniqueToolCalls = allToolCalls.filter((call, index, self) =>
        index === self.findIndex((c) => 
          c.name === call.name && JSON.stringify(c.arguments) === JSON.stringify(call.arguments)
        )
      );

      if (uniqueToolCalls.length > 0 && this.mcpManager) {
        console.log(`[Harmony] Found ${uniqueToolCalls.length} tool call(s)`);
        const executedToolCalls = await this.executeToolCalls(uniqueToolCalls);
        
        // Check if we have applicable rules that require JSON formatting
        let applicableRules: Rule[] = [];
        if (this.rulesManager) {
          // First, check rules based on the original prompt
          applicableRules = this.rulesManager.getApplicableRules(prompt);
          console.log(`[Rules] After tool execution, checking rules for prompt: "${prompt}"`);
          console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) from prompt`);
          
          // If no rules found, check if any executed tools match rule tool requirements
          if (applicableRules.length === 0) {
            applicableRules = this.rulesManager.getRulesForTools(executedToolCalls.map(tc => tc.name));
            if (applicableRules.length > 0) {
              console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) based on tool calls`);
            }
          }
          
          console.log(`[Rules] Total applicable rules for formatting: ${applicableRules.length}`);
        }
        
        // If rules require JSON formatting, format the tool results accordingly
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
            
            console.log(`[Rules] Formatted content length: ${formattedContent.length} chars`);
            console.log(`[Rules] Formatted content preview: ${formattedContent.substring(0, 200)}...`);
            
            return {
              content: formattedContent,
              reasoning: cleaned.reasoning,
              toolCalls: executedToolCalls,
            };
          } catch (formatError: any) {
            console.error(`[Rules] Error in formatToolResultsWithRules:`, formatError);
            // Fall through to default formatting
          }
        } else {
          console.log(`[Rules] No applicable rules found, using default tool result formatting`);
        }
        
        // No rules - just format tool results normally
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
        
        return {
          content: cleaned.content + toolResultsText,
          reasoning: cleaned.reasoning,
          toolCalls: executedToolCalls,
        };
      }

      return cleaned;
    } catch (error: any) {
      console.error("Error calling Harmony server:", error);
      throw new Error(`Failed to call Harmony server: ${error.message}`);
    }
  }

  cleanHarmonyResponse(response: string): LlamaResponse {
    if (!response) return { content: response || "" };

    console.log(`[Harmony] Before cleaning: ${response.substring(0, 200)}...`);

    // Extract reasoning/thinking/analysis sections first (before cleaning)
    let reasoning: string | undefined;
    const reasoningPatterns = [
      /<\|thinking\|>(.*?)(?:<\|end\|>|<\|eoa\|>|<\|assistant\|>)/s,
      /<\|reasoning\|>(.*?)(?:<\|end\|>|<\|eoa\|>|<\|assistant\|>)/s,
      /<\|channel\|>thinking<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>|<\|assistant\|>)/s,
      /<\|channel\|>analysis<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>|<\|assistant\|>)/s,
      /<\|analysis<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>|<\|assistant\|>)/s,  // More flexible pattern
      /<\|channel\|>thinking<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>)/s,
      /<\|channel\|>analysis<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>)/s,
    ];

    for (const pattern of reasoningPatterns) {
      const match = response.match(pattern);
      if (match && match[1]) {
        reasoning = match[1]
          .trim()
          .replace(/<\|[^>]+\|>/g, "") // Remove any remaining tokens
          .replace(/\n{3,}/g, "\n\n"); // Clean up multiple newlines
        console.log(
          `[Harmony] Extracted reasoning: ${reasoning.substring(0, 200)}...`
        );
        break;
      }
    }

    // First, try to extract content between <|message|> and <|end|> or <|eoa|>
    let cleaned = response;
    let extracted = false;

    // Pattern 1: Extract content from final message channel
    const finalMessagePattern =
      /<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|<\|eoa\|>|$)/s;
    const finalMatch = cleaned.match(finalMessagePattern);

    if (finalMatch && finalMatch[1]) {
      cleaned = finalMatch[1].trim();
      extracted = true;
      console.log(
        `[Harmony] Extracted final message: ${cleaned.substring(0, 200)}...`
      );
    }

    // Pattern 2: Extract content from assistant message
    if (!extracted) {
      const assistantPattern =
        /<\|assistant\|>(?:<\|channel\|>final<\|message\|>)?(.*?)(?:<\|end\|>|<\|eoa\|>|$)/s;
      const assistantMatch = cleaned.match(assistantPattern);

      if (assistantMatch && assistantMatch[1]) {
        cleaned = assistantMatch[1].trim();
        extracted = true;
        console.log(
          `[Harmony] Extracted assistant message: ${cleaned.substring(0, 200)}...`
        );
      }
    }

    // Remove ALL remaining Harmony tokens (comprehensive)
    cleaned = cleaned
      .replace(/<\|[^>]+\|>/g, "") // Remove all <|token|> patterns
      .replace(/^\s+|\s+$/g, "") // Trim whitespace
      .replace(/\n{3,}/g, "\n\n"); // Clean up multiple newlines

    // Ensure we always return valid content
    if (!cleaned || cleaned.trim().length === 0) {
      console.warn(
        `[Harmony] Warning: Cleaned response is empty. Original response: ${response.substring(0, 200)}...`
      );
      // Fallback: return original response with tokens removed as last resort
      cleaned = response.replace(/<\|[^>]+\|>/g, "").trim();
      if (!cleaned) {
        cleaned = response.trim(); // Last resort: return original
      }
    }

    console.log(`[Harmony] After cleaning: ${cleaned.substring(0, 200)}...`);

    return { content: cleaned || "", reasoning };
  }

  private extractToolCalls(response: string): MCPToolCall[] {
    const toolCalls: MCPToolCall[] = [];
    
    // Pattern 1: <tool_call name="tool_name" args="{...}" />
    // Use a more flexible approach: match the tag, then extract name and args separately
    const toolCallTagPattern = /<tool_call\s+([^>]+)\s*\/>/g;
    let match;
    while ((match = toolCallTagPattern.exec(response)) !== null) {
      try {
        const attributes = match[1];
        console.log(`[Harmony] Found tool call tag with attributes: ${attributes}`);
        
        // Extract name attribute
        const nameMatch = attributes.match(/name=["']([^"']+)["']/);
        if (!nameMatch) {
          console.warn(`[Harmony] Tool call missing name attribute: ${attributes}`);
          continue;
        }
        const toolName = nameMatch[1];
        
        // Extract args attribute - handle both single and double quotes
        // First, find which quote type is used for the args attribute
        const argsDoubleQuoteMatch = attributes.match(/args="((?:[^"\\]|\\.)*)"/);
        const argsSingleQuoteMatch = attributes.match(/args='((?:[^'\\]|\\.)*)'/);
        
        let argsStr: string | null = null;
        if (argsDoubleQuoteMatch) {
          argsStr = argsDoubleQuoteMatch[1];
        } else if (argsSingleQuoteMatch) {
          argsStr = argsSingleQuoteMatch[1];
        }
        
        if (!argsStr) {
          console.warn(`[Harmony] Tool call missing args attribute: ${attributes}`);
          continue;
        }
        
        // Unescape the JSON string
        argsStr = argsStr
          .replace(/\\"/g, '"')  // Unescape quotes
          .replace(/\\'/g, "'")  // Unescape single quotes
          .replace(/&quot;/g, '"')  // Handle HTML entities
          .replace(/&apos;/g, "'")  // Handle HTML entities for single quotes
          .replace(/\\n/g, '\n')  // Unescape newlines
          .replace(/\\t/g, '\t')  // Unescape tabs
          .replace(/\\\\/g, '\\'); // Unescape backslashes
        
        console.log(`[Harmony] Extracted tool call: name="${toolName}", args="${argsStr}"`);
        const args = JSON.parse(argsStr);
        toolCalls.push({
          name: toolName,
          arguments: args,
        });
        console.log(`[Harmony] Parsed tool call: ${toolName} with args:`, args);
      } catch (error) {
        console.error(`[Harmony] Failed to parse tool call: ${match[0]}`, error);
      }
    }

    // Pattern 2: JSON tool call format
    const jsonToolCallPattern = /```json\s*\{\s*"tool":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]+\})\s*\}\s*```/g;
    while ((match = jsonToolCallPattern.exec(response)) !== null) {
      try {
        const args = JSON.parse(match[2]);
        toolCalls.push({
          name: match[1],
          arguments: args,
        });
      } catch (error) {
        console.error(`[Harmony] Failed to parse JSON tool call: ${match[0]}`, error);
      }
    }

    return toolCalls;
  }

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
            
            // Convert NativeToolResult to MCPToolResult format
            const mcpResult: MCPToolResult = {
              content: result.content,
              isError: result.isError,
            };
            
            results.push({
              name: toolCall.name,
              arguments: toolCall.arguments || {},
              result: mcpResult,
            });

            console.log(`[Harmony] Native tool "${toolCall.name}" executed successfully`);
            continue;
          }
        }
        
        // Otherwise, try MCP tools
        if (!this.mcpManager) {
          throw new Error("MCP Manager not available");
        }
        
        const serverName = this.mcpManager.findToolServer(toolCall.name);
        if (!serverName) {
          console.error(`[Harmony] Tool "${toolCall.name}" not found in any MCP server or native tools`);
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
   * Format tool results according to applicable rules
   * Makes a follow-up API call to format results as JSON per rules
   */
  private async formatToolResultsWithRules(
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    applicableRules: Rule[],
    originalPrompt: string,
    templateName?: string,
    applyTemplate?: (templateName: string, context: any) => Promise<string>
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

    console.log(`[Rules] Tool results extracted (${toolResultsText.length} chars): ${toolResultsText.substring(0, 300)}...`);

    // Get rules context
    let rulesContext = "";
    if (this.rulesManager) {
      rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
    }

    // Create formatting prompt - simpler, without template wrapper for formatting
    const formattingPrompt = `User request: "${originalPrompt}"

Tool results have been obtained. Format these results as JSON according to the rules below.

${rulesContext}

Tool Results:
${toolResultsText}

CRITICAL: You MUST output ONLY valid JSON that follows the rules above. Do not include any explanation, commentary, or text outside the JSON. Start with [ or { and end with ] or }.

JSON Output:`;

    try {
      // Make follow-up API call to format results
      const endpoint = `${this.config.serverUrl}/v1/completions`;
      console.log(`[Rules] Making follow-up call to format tool results as JSON`);

      // For JSON formatting, don't use the chat template - use a simpler prompt structure
      // This ensures the model focuses on generating JSON, not conversational text
      const finalPrompt = `<|start|>user<|channel|>final<|message|>
${formattingPrompt}
<|end|>
<|start|>assistant<|channel|>final<|message|>`;

      const response = await axios.post(
        endpoint,
        {
          model: this.config.model,
          prompt: finalPrompt,
          temperature: 0.3, // Lower temperature for more consistent JSON
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
        console.log(`[Rules] Raw formatting response: ${rawResponse.substring(0, 300)}...`);
        const cleaned = this.cleanHarmonyResponse(rawResponse);
        console.log(`[Rules] Cleaned formatting response: ${cleaned.content.substring(0, 300)}...`);
        
        // Extract JSON from response (in case there's extra text)
        // Try to find JSON objects or arrays
        const jsonMatch = cleaned.content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (jsonMatch) {
          console.log(`[Rules] Successfully extracted JSON from formatted response`);
          return jsonMatch[1];
        }
        
        // If no JSON found but content exists, return it (might be valid JSON already)
        if (cleaned.content.trim()) {
          console.log(`[Rules] No JSON pattern match, returning cleaned content as-is`);
          return cleaned.content.trim();
        }
        
        console.warn(`[Rules] Formatted response is empty`);
      }

      // Fallback to raw tool results if formatting fails
      console.warn(`[Rules] Failed to format tool results, returning raw results`);
      return toolResultsText;
    } catch (error: any) {
      console.error(`[Rules] Error formatting tool results:`, error);
      // Fallback to raw tool results
      return toolResultsText;
    }
  }
}

