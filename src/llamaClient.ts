import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { RulesManager, Rule } from "./rulesManager";
import { NativeToolsManager, NativeTool } from "./nativeTools";
import { HarmonyProcessor, HarmonyParseResult } from "./harmonyProcessor";
import { 
  logLongMessage, 
  logApiRequest, 
  logToolCalls, 
  logRules 
} from "./utils/logger";

export interface LlamaResponse {
  content: string;
  reasoning?: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
}

/**
 * Main LlamaClient with HarmonyProcessor integration
 */
export class LlamaClient {
  private harmonyProcessor = new HarmonyProcessor();

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
      let rulesContext = "";
      if (this.rulesManager) {
        const applicableRules = this.rulesManager.getApplicableRules(prompt);
        if (applicableRules.length > 0) {
          console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) for query`);
          rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
          logRules(applicableRules);
        }
      }

      // Apply template if specified
      let finalPrompt: string;
      if (templateName && applyTemplate) {
        const mcpTools = this.mcpManager?.getAllTools() || [];
        const nativeTools = this.nativeToolsManager?.getAvailableTools() || [];
        const basePrompt = await applyTemplate(templateName, { 
          prompt: prompt + toolsContext,
          rules: rulesContext || "",
          tools: [...mcpTools, ...nativeTools]
        });
        
        if (!basePrompt.includes("{{rules}}") && rulesContext) {
          finalPrompt = rulesContext + basePrompt;
        } else {
          finalPrompt = basePrompt;
        }
      } else {
        finalPrompt = rulesContext + prompt + toolsContext;
      }

      // Log prompt preview
      const previewLength = 500;
      console.log(`[Harmony] Final prompt (first ${previewLength} chars): ${finalPrompt.substring(0, previewLength)}...`);
      if (rulesContext) {
        console.log(`[Rules] Rules context length: ${rulesContext.length} characters`);
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
        toolCalls = this.harmonyProcessor.extractToolCalls(parsed.rawToolCalls);
      }
      
      // Also check content for tool calls as fallback
      if (toolCalls.length === 0) {
        toolCalls = this.extractToolCallsFromContent(parsed.content);
      }

      if (toolCalls.length > 0 && (this.mcpManager || this.nativeToolsManager)) {
        logToolCalls(toolCalls.map(tc => ({ name: tc.name })));
        const executedToolCalls = await this.executeToolCalls(toolCalls);
        
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
        
        return {
          content: finalContent,
          reasoning: parsed.reasoning,
          toolCalls: executedToolCalls,
        };
      }

      return {
        content: parsed.content,
        reasoning: parsed.reasoning,
      };
    } catch (error: any) {
      console.error("Error calling Harmony server:", error);
      throw new Error(`Failed to call Harmony server: ${error.message}`);
    }
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

    // Get rules context
    let rulesContext = "";
    if (this.rulesManager) {
      rulesContext = this.rulesManager.formatRulesForPrompt(applicableRules);
    }

    // Create formatting prompt
    const formattingPrompt = `User request: "${originalPrompt}"

Tool results have been obtained. Format these results as JSON according to the rules below.

${rulesContext}

Tool Results:
${toolResultsText}

CRITICAL: You MUST output ONLY valid JSON that follows the rules above. Do not include any explanation, commentary, or text outside the JSON. Start with [ or { and end with ] or }.

JSON Output:`;

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
        // Try to extract JSON
        const jsonMatch = parsed.content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (jsonMatch) {
          return jsonMatch[1];
        }
        
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
   * Legacy method for backward compatibility
   */
  cleanHarmonyResponse(response: string): LlamaResponse {
    const parsed = this.harmonyProcessor.parseResponse(response);
    return {
      content: parsed.content,
      reasoning: parsed.reasoning,
    };
  }
}