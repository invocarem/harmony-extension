import { MCPManager } from "../mcpManager";
import { MCPToolCall, MCPToolResult } from "../mcpClient";
import { NativeToolsManager } from "../nativeToolManager";
import { WorkflowStage } from "./stageStateMachine";

/**
 * Executes tool calls (MCP and native tools)
 */
export class ToolExecutor {
  constructor(
    private mcpManager?: MCPManager,
    private nativeToolsManager?: NativeToolsManager
  ) { }

  /**
   * Execute tool calls
   */
  async executeToolCalls(
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
            const rawResult = await this.nativeToolsManager.callTool(
              toolCall.name,
              toolCall.arguments || {}
            );

            const attemptedResult: MCPToolResult = {
              content: rawResult?.content || [],
              isError: rawResult ? (rawResult.isError || false) : true,
            };

            // Always record the initial native tool attempt
            results.push({
              name: toolCall.name,
              arguments: toolCall.arguments || {},
              result: attemptedResult,
            });

            // Auto-fallback: If create_file fails because file exists, automatically use replace_file
            if (toolCall.name === "create_file" && attemptedResult?.isError) {
              const errorText = attemptedResult?.content?.[0]?.text || "";
              if (errorText.includes("already exists") || errorText.includes("Use replace_file")) {
                console.log(`[Harmony] File already exists, automatically retrying with replace_file`);
                const replaceRaw = await this.nativeToolsManager.callTool(
                  "replace_file",
                  toolCall.arguments || {}
                );

                const replaceResult: MCPToolResult = {
                  content: replaceRaw?.content || [],
                  isError: replaceRaw?.isError || false,
                };

                results.push({
                  name: "replace_file",
                  arguments: toolCall.arguments || {},
                  result: replaceResult,
                });
              }
            }

            // Auto-fallback: If edit_file fails because file doesn't exist, automatically use create_file
            if (toolCall.name === "edit_file" && attemptedResult?.isError) {
              const errorText = attemptedResult?.content?.[0]?.text || "";
              const errorMessage = errorText.toLowerCase();
              // Check for common "file not found" error patterns
              if (
                errorMessage.includes("enoent") ||
                errorMessage.includes("no such file") ||
                errorMessage.includes("cannot find") ||
                errorMessage.includes("file not found") ||
                errorMessage.match(/error editing file.*:.*enoent/i)
              ) {
                console.log(`[Harmony] File doesn't exist for edit_file, automatically creating with create_file`);
                // Use new_text as the content for create_file
                const createArguments = {
                  file_path: toolCall.arguments?.file_path,
                  content: toolCall.arguments?.new_text || "",
                };

                const createRaw = await this.nativeToolsManager.callTool(
                  "create_file",
                  createArguments
                );

                const createResult: MCPToolResult = {
                  content: createRaw?.content || [],
                  isError: createRaw?.isError || false,
                };

                results.push({
                  name: "create_file",
                  arguments: createArguments,
                  result: createResult,
                });
              }
            }

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
}

