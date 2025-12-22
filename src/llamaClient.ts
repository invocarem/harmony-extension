import axios from "axios";
import { LlamaConfig } from "./config";
import { MCPManager } from "./mcpManager";
import { MCPToolCall, MCPToolResult } from "./mcpClient";

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
    private mcpManager?: MCPManager
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

      // Get available MCP tools and add them to context
      let toolsContext = "";
      if (this.mcpManager) {
        const tools = this.mcpManager.getAllTools();
        if (tools.length > 0) {
          toolsContext = "\n\nAvailable MCP Tools:\n";
          tools.forEach((tool) => {
            toolsContext += `- ${tool.name}: ${tool.description || "No description"}\n`;
            if (tool.inputSchema.properties) {
              const props = Object.entries(tool.inputSchema.properties)
                .map(([key, value]: [string, any]) => `  ${key}: ${value.type || "any"}`)
                .join("\n");
              if (props) {
                toolsContext += `  Parameters:\n${props}\n`;
              }
            }
          });
          toolsContext += "\nTo call a tool, use the format: <tool_call name=\"tool_name\" args=\"{...}\" />\n";
        }
      }

      // Apply Jinja template if specified
      let finalPrompt = prompt + toolsContext;
      if (templateName && applyTemplate) {
        finalPrompt = await applyTemplate(templateName, { 
          prompt: prompt + toolsContext,
          tools: this.mcpManager?.getAllTools() || []
        });
      }

      console.log(`[Harmony] Final prompt: ${finalPrompt.substring(0, 100)}...`);

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
        
        // Format tool results into the response
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
        const serverName = this.mcpManager!.findToolServer(toolCall.name);
        if (!serverName) {
          console.error(`[Harmony] Tool "${toolCall.name}" not found in any MCP server`);
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

        console.log(`[Harmony] Executing tool "${toolCall.name}" on server "${serverName}"`);
        const result = await this.mcpManager!.callTool(
          serverName,
          toolCall.name,
          toolCall.arguments || {}
        );
        
        results.push({
          name: toolCall.name,
          arguments: toolCall.arguments || {},
          result,
        });

        console.log(`[Harmony] Tool "${toolCall.name}" executed successfully`);
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
}

