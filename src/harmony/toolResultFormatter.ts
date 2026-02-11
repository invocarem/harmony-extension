import axios from "axios";
import { LlamaConfig } from "../config";
import { MCPToolResult } from "../mcpClient";
import { RulesManager, Rule } from "../rulesManager";
import { WorkflowStage } from "./stageStateMachine";
import { HarmonyProcessor } from "../harmonyProcessor";

/**
 * Formats tool results for display
 */
export class ToolResultFormatter {
  constructor(
    private config: LlamaConfig,
    private harmonyProcessor: HarmonyProcessor,
    private rulesManager?: RulesManager
  ) {}

  /**
   * Format tool results as plain text
   */
  formatToolResults(
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>
  ): string {
    if (executedToolCalls.length === 0) {
      return "";
    }

    // Debug: Log what tool calls are being formatted
    console.log(
      `[ToolResultFormatter] Formatting ${executedToolCalls.length} tool result(s): ${executedToolCalls.map((tc) => tc.name).join(", ")}`
    );

    let toolResultsText = "\n\n**Tool Results:**\n";
    executedToolCalls.forEach((toolCall, index) => {
      console.log(
        `[ToolResultFormatter] Formatting tool #${index + 1}: ${toolCall.name}, hasResult: ${!!toolCall.result}, isError: ${toolCall.result?.isError}`
      );
      toolResultsText += `\n**${toolCall.name}**:\n`;
      if (toolCall.result?.isError) {
        toolResultsText += `❌ Error: ${toolCall.result.content?.[0]?.text || "Unknown error"}\n`;
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
  async formatToolResultsWithRules(
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    applicableRules: Rule[],
    originalPrompt: string,
    currentStage: WorkflowStage
  ): Promise<string> {
    // Extract tool results text
    let toolResultsText = "";
    executedToolCalls.forEach((toolCall) => {
      if (toolCall.result?.isError) {
        toolResultsText += `\n**${toolCall.name}** Error: ${toolCall.result.content?.[0]?.text || "Unknown error"}\n`;
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
    const stageNote =
      currentStage === "assumptions"
        ? `\n\n⚠️ CRITICAL: You are in the ASSUMPTIONS stage. You MUST provide code snippets only. Do NOT use file modification tools. If rules specify "provide code snippets", you MUST follow them strictly.`
        : currentStage === "chat"
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
3. In ${currentStage === "assumptions" ? "ASSUMPTIONS" : currentStage === "chat" ? "CHAT" : "IMPLEMENTATION"} stage: ${currentStage === "assumptions" ? "Provide code snippets only, do NOT use file modification tools" : currentStage === "chat" ? "Focus on clarification, no file operations" : "You may implement using file modification tools"}
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
          stream: true,
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey && {
              Authorization: `Bearer ${this.config.apiKey}`,
            }),
          },
          responseType: "stream",
        }
      );

      // Handle streaming response - collect all chunks
      let rawResponse: string = "";

      if (
        response.data &&
        typeof response.data === "object" &&
        response.data.pipe
      ) {
        // Stream response
        rawResponse = await new Promise<string>((resolve, reject) => {
          let buffer = "";
          const lines: string[] = [];

          response.data.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const parts = buffer.split("\n");

            // Process all complete lines
            for (let i = 0; i < parts.length - 1; i++) {
              const line = parts[i];
              lines.push(line);

              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.text) {
                    process.stdout.write(data.choices[0].text); // Show streaming progress
                  }
                } catch (e) {
                  // Ignore parse errors for non-JSON lines
                }
              }
            }

            // Keep the last incomplete line in buffer
            buffer = parts[parts.length - 1];
          });

          response.data.on("end", () => {
            // Reconstruct full response from all data lines
            let fullText = "";

            lines.forEach((line) => {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.text) {
                    fullText += data.choices[0].text;
                  }
                } catch (e) {
                  // Ignore
                }
              }
            });

            resolve(fullText);
          });

          response.data.on("error", reject);
        });
      } else {
        // Non-streaming response (fallback)
        if (response.data?.choices?.[0]?.text) {
          rawResponse = response.data.choices[0].text;
        } else if (response.data?.choices?.[0]?.message?.content) {
          rawResponse = response.data.choices[0].message.content;
        } else if (response.data?.text) {
          rawResponse = response.data.text;
        } else if (response.data?.content) {
          rawResponse = response.data.content;
        }
      }

      if (rawResponse) {
        const parsed = this.harmonyProcessor.parseResponse(rawResponse);
        const trimmedContent = parsed.content.trim();
        if (trimmedContent) {
          const hasToolResultsHeader =
            trimmedContent.includes("**Tool Results:**") ||
            trimmedContent.includes("Tool Results:");
          const hasExecTerminal = executedToolCalls.some(
            (tc) => tc.name === "exec_terminal"
          );
          if (
            currentStage === "snippet" &&
            hasExecTerminal &&
            !hasToolResultsHeader
          ) {
            return (
              trimmedContent + this.formatToolResults(executedToolCalls)
            ).trim();
          }
          return trimmedContent;
        }
      }

      // Fallback to raw tool results
      return toolResultsText;
    } catch (error: any) {
      console.error(`[Rules] Error formatting tool results:`, error);
      return toolResultsText;
    }
  }
}
