import axios from "axios";
import { LlamaConfig } from "../config";
import { HarmonyProcessor, HarmonyParseResult } from "../harmonyProcessor";
import { ToolCallExtractor } from "../utils/toolCallExtractor";
import { XmlProcessor } from "../utils/xmlProcessor";
import { ResponseValidator } from "./responseValidator";
import { MCPToolCall } from "../mcpClient";
import { WorkflowStage } from "./index";
import { logLongMessage, logApiRequest } from "../utils/logger";

/**
 * ResponseProcessor
 * Handles API calls, response parsing, and tool call extraction
 * Extracts response-related logic from HarmonyClient.callServer
 */
export class ResponseProcessor {
  constructor(
    private config: LlamaConfig,
    private harmonyProcessor: HarmonyProcessor,
    private responseValidator: ResponseValidator
  ) {}

  /**
   * Make API call to get LLM response
   */
  async callLLMApi(finalPrompt: string): Promise<string> {
    const endpoint = `${this.config.serverUrl}/v1/completions`;
    logApiRequest(endpoint, finalPrompt, 100);

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

    // Check for truncation
    const isTruncated = finishReason === "length" || finishReason === "max_tokens";

    if (isTruncated) {
      console.warn(
        `[Harmony] ⚠️ Response was truncated due to token limit (finish_reason: ${finishReason})`
      );
    }

    // Extract response text
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

    return rawResponse;
  }

  /**
   * Parse response into structured format
   */
  parseResponse(rawResponse: string, prompt: string): HarmonyParseResult | null {
    const parsed = this.harmonyProcessor.parseResponse(rawResponse, prompt);

    if (!parsed) {
      throw new Error("HarmonyProcessor.parseResponse returned undefined");
    }

    return parsed;
  }

  /**
   * Extract tool calls from response
   */
  extractToolCalls(parsed: HarmonyParseResult, content: string): MCPToolCall[] {
    let toolCalls: MCPToolCall[] = [];

    if (parsed.rawToolCalls && parsed.rawToolCalls.length > 0) {
      console.log(
        `[HarmonyClient] Processing ${parsed.rawToolCalls.length} raw tool call(s)`
      );

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
            toolCalls.map((tc) => ({
              name: tc.name,
              argsKeys: Object.keys(tc.arguments || {}),
            }))
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
          console.warn(
            `[HarmonyClient] rawToolCalls[${idx}]: "${raw.substring(0, 200)}..."`
          );
        });
      }
    }

    // Check content for tool calls as fallback
    if (toolCalls.length === 0 && content) {
      console.log(`[Harmony] No tool calls found in rawToolCalls, checking content...`);
      toolCalls = this.harmonyProcessor.extractToolCalls([content]);
      if (toolCalls.length > 0) {
        console.log(`[Harmony] Extracted ${toolCalls.length} tool call(s) from content`);
      } else {
        console.log(`[Harmony] No tool calls found in content either`);
      }
    }

    return toolCalls;
  }

  /**
   * Validate and filter tool calls
   */
  validateAndFilterToolCalls(
    toolCalls: MCPToolCall[],
    currentStage: WorkflowStage,
    prompt: string
  ): {
    allowedToolCalls: MCPToolCall[];
    blockedToolCalls: MCPToolCall[];
    wereBlocked: boolean;
  } {
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
    }

    return {
      allowedToolCalls: validation.allowedToolCalls,
      blockedToolCalls: validation.blockedToolCalls,
      wereBlocked: toolCallsWereBlocked,
    };
  }

  /**
   * Enforce restatement in response for certain stages
   */
  enforceRestatement(
    parsed: HarmonyParseResult,
    currentStage: WorkflowStage,
    prompt: string
  ): void {
    this.responseValidator.enforceRestatement(parsed, currentStage, prompt);
  }

  /**
   * Handle blocked tool calls
   */
  handleBlockedToolCalls(
    parsed: HarmonyParseResult,
    blockedToolCalls: MCPToolCall[],
    currentStage: WorkflowStage,
    prompt: string
  ): void {
    this.responseValidator.handleBlockedToolCalls(
      parsed,
      blockedToolCalls,
      currentStage,
      prompt
    );
  }
}
