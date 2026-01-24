// HarmonyProcessor.ts
// Handles parsing of Harmony protocol tokens (<|start|>, <|channel|>, etc.)

import { MCPToolCall } from "./mcpClient";
import { ToolCallExtractor } from "./utils/toolCallExtractor";
import { XmlProcessor } from "./utils/xmlProcessor";
import { filterHarmonyTokens } from "./utils/harmonyTokenFilter";
import { Role } from "./harmony/role";
import { IntentionDetector } from "./harmony/intentionDetector";

export interface HarmonyParseResult {
  content: string;
  reasoning?: string;
  commentary?: string;
  final?: string;
  rawToolCalls?: string[];
  remaining?: string;
}

export class HarmonyProcessor {
  private intentionDetector: IntentionDetector;

  constructor(private harmonyMode: boolean = true) {
    this.intentionDetector = new IntentionDetector();
  }

  /**
   * Parse Harmony response using token-based approach
   * Falls back to plain text if no Harmony tokens are detected
   * When harmonyMode is false, treats response as plain jinja and filters tokens
   * @param response The response string to parse
   * @param userPrompt Optional user prompt for intent detection (used to prevent false positive file extraction)
   */
  parseResponse(response: string, userPrompt?: string): HarmonyParseResult {
    // If harmony mode is disabled, treat as plain jinja output
    if (!this.harmonyMode) {
      console.log(`[HarmonyProcessor] Harmony mode disabled, treating as plain jinja output`);
      console.log(`[HarmonyProcessor] Input response length: ${response.length} chars`);
      // Don't filter Harmony tokens when harmony mode is disabled - response shouldn't have them
      // and filtering might remove legitimate content that matches token patterns
      const trimmed = response.trim();
      console.log(`[HarmonyProcessor] After trim: ${trimmed.length} chars, last 50 chars: "${trimmed.substring(Math.max(0, trimmed.length - 50))}"`);
      
      // Extract <think> tags as reasoning (similar to harmony protocol's analysis channel)
      const { reasoning, contentWithoutThinks, hasThinkTags } = XmlProcessor.extractThinkTags(trimmed);
      if (hasThinkTags) {
        console.log(`[HarmonyProcessor] Extracted ${reasoning.length} think tag(s) as reasoning`);
      }
      
      // Extract tool calls from the response (there might be both content and tool calls)
      const rawToolCalls: string[] = [];
      
      // Try to extract XML tool calls
      const xmlToolCalls = XmlProcessor.extractToolCalls(contentWithoutThinks);
      if (xmlToolCalls.length > 0) {
        console.log(`[HarmonyProcessor] Found ${xmlToolCalls.length} XML tool call(s) in plain jinja response`);
        // Remove tool calls from content
        let contentWithoutToolCalls = contentWithoutThinks;
        xmlToolCalls.forEach(tc => {
          contentWithoutToolCalls = contentWithoutToolCalls.replace(tc.raw, '').trim();
        });
        rawToolCalls.push(...xmlToolCalls.map(tc => tc.raw));
        
        console.log(`[HarmonyProcessor] Plain jinja response: content=${contentWithoutToolCalls.length} chars, tool calls=${rawToolCalls.length}`);
        return {
          content: contentWithoutToolCalls,
          reasoning: reasoning.length > 0 ? reasoning.join('\n\n') : undefined,
          rawToolCalls: rawToolCalls,
          remaining: response
        };
      }
      
      // Try MCP/JSON format tool calls
      const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(contentWithoutThinks);
      if (contentWithoutThinks && looksLikeMcpOrJson) {
        // If entire response is a tool call (no surrounding text), treat as tool call only
        const isOnlyToolCall = /^(?:to=|mcp_|{"name"|\[{"name")/.test(contentWithoutThinks.trim());
        if (isOnlyToolCall) {
          console.log(`[HarmonyProcessor] Plain jinja response appears to be a tool call only`);
          return {
            content: '',
            reasoning: reasoning.length > 0 ? reasoning.join('\n\n') : undefined,
            rawToolCalls: [contentWithoutThinks],
            remaining: response
          };
        }
        // Otherwise, it's content with embedded tool calls - extract them
        // For now, return as content and let extractToolCalls handle it later
      }
      
      // Check if content describes a file update with code blocks
      // This handles cases where the model describes a file instead of making a tool call
      // Note: extractFileUpdateFromContent will check user intent if available
      const extractedToolCall = this.extractFileUpdateFromContent(contentWithoutThinks, userPrompt);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from plain jinja content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        // Preserve FULL content including code blocks (for user display)
        // The tool call extraction happens separately and doesn't affect the user-visible response
        return {
          content: contentWithoutThinks, // Preserve full response including code blocks for webview display
          reasoning: reasoning.length > 0 ? reasoning.join('\n\n') : undefined,
          rawToolCalls: [extractedToolCall.raw],
          remaining: response
        };
      }
      
      // Otherwise, return as content and also set as final for simple responses
      console.log(`[HarmonyProcessor] Plain jinja response treated as content (${contentWithoutThinks.length} chars)`);
      return {
        content: contentWithoutThinks,
        reasoning: reasoning.length > 0 ? reasoning.join('\n\n') : undefined,
        final: contentWithoutThinks, // For simple responses, also set as final
        rawToolCalls: [],
        remaining: response
      };
    }
    // Check if response contains Harmony tokens
    const hasHarmonyTokens = this.validateResponse(response);
    
    if (!hasHarmonyTokens) {
      // Plain text response (jinja-only model) - treat entire response as content
      console.log(`[HarmonyProcessor] No Harmony tokens detected, treating as plain text`);
      const trimmed = response.trim();
      
      // Check if it looks like a tool call even without tokens
      const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(trimmed);
      const looksLikeXml = XmlProcessor.looksLikeXmlToolCall(trimmed);
      if (trimmed && (looksLikeMcpOrJson || looksLikeXml)) {
        console.log(`[HarmonyProcessor] Plain text response appears to be a tool call`);
        return {
          content: '',
          rawToolCalls: [trimmed],
          remaining: response
        };
      }
      
      // Check if content describes a file update with code blocks
      // This handles cases where the model describes a file instead of making a tool call
      // Note: extractFileUpdateFromContent will check user intent if available
      const extractedToolCall = this.extractFileUpdateFromContent(trimmed, userPrompt);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from plain text content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        // Preserve FULL content including code blocks (for user display)
        // The tool call extraction happens separately and doesn't affect the user-visible response
        return {
          content: trimmed, // Preserve full response including code blocks for webview display
          rawToolCalls: [extractedToolCall.raw],
          remaining: response
        };
      }
      
      // Otherwise, return as content and also set as final for simple responses
      console.log(`[HarmonyProcessor] Plain text response treated as content (${trimmed.length} chars)`);
      return {
        content: trimmed,
        final: trimmed, // For simple responses, also set as final
        rawToolCalls: [],
        remaining: response
      };
    }
    
    // Harmony token-based parsing (existing logic)
    let content = '';
    let reasoning: string | undefined;
    let commentary: string | undefined;
    let final: string | undefined;
    const rawToolCalls: string[] = [];
    
    let i = 0;
    let currentChannel: 'analysis' | 'final' | 'commentary' | 'none' = 'none';
    let inMessage = false;
    let currentBuffer = '';
    // Track tool name from variant tokens like <|analysis tool_call=name
    let pendingToolName: string | undefined = undefined;
    // Track current role to avoid extracting tool calls from user messages
    let currentRole: Role | null = null;
    
    while (i < response.length) {
      // Check for token start
      if (response.substring(i, i + 2) === '<|') {
        const tokenEnd = response.indexOf('|>', i);
        
        if (tokenEnd !== -1) {
          const fullToken = response.substring(i, tokenEnd + 2);
          const tokenContent = response.substring(i + 2, tokenEnd);
          
          // Handle based on token type
          switch (tokenContent) {
            case 'channel':
              // Handle channel token
              i = this.handleChannelToken(response, tokenEnd, currentChannel);
              currentChannel = this.detectChannelType(response, i);
              // Log only valid channel types (analysis, commentary, final)
              if (currentChannel !== 'none') {
                console.log(`[HarmonyProcessor] Detected channel: ${currentChannel}`);
              }
              continue;
              
            case 'message':
              // Start of message content
              inMessage = true;
              currentBuffer = '';
              i = tokenEnd + 2;
              continue;
              
            case 'end':
              // End of current section - save buffer
              this.saveBuffer(currentChannel, currentBuffer, {
                content: (c) => content = c,
                reasoning: (r) => reasoning = r,
                commentary: (c) => commentary = c,
                final: (f) => final = f,
                rawToolCalls: (t) => rawToolCalls.push(t)
              }, pendingToolName, userPrompt);
              // Reset pending tool name after saving buffer
              pendingToolName = undefined;
              
              currentChannel = 'none';
              inMessage = false;
              currentBuffer = '';
              i = tokenEnd + 2;
              continue;
              
            case 'start':
              // Start token - reset state
              // Check if this is a role token (<|start|>user or <|start|>assistant)
              // The role comes after the |> delimiter, so we need to check the text after the token
              const textAfterToken = response.substring(tokenEnd + 2);
              // Match word characters (user or assistant) that come immediately after |>
              // Stop at whitespace or the next <| token
              const roleMatch = textAfterToken.match(/^(\w+)(?=\s|<\||$)/);
              if (roleMatch) {
                const roleToken = fullToken + roleMatch[1];
                const role = Role.fromToken(roleToken);
                if (role) {
                  currentRole = role;
                  console.log(`[HarmonyProcessor] Detected role: ${role.getType()}`);
                  // Skip past the role name
                  i = tokenEnd + 2 + roleMatch[1].length;
                } else {
                  currentRole = null;
                  i = tokenEnd + 2;
                }
              } else {
                currentRole = null;
                i = tokenEnd + 2;
              }
              currentChannel = 'none';
              inMessage = false;
              currentBuffer = '';
              continue;
              
            default:
              // Check for variant token with tool_call=name syntax (e.g., <|analysis tool_call=analyze_latin)
              const toolCallMatch = tokenContent.match(/[^\s]+\s+tool_call=([^\s<]+)/);
              if (toolCallMatch) {
                pendingToolName = toolCallMatch[1];
                console.log(`[HarmonyProcessor] Found tool name in variant token: ${pendingToolName}`);
              }
              // Other tokens (constrain, eot, eoa, etc.) - skip
              i = tokenEnd + 2;
              continue;
          }
        } else {
          // Incomplete token - if we're in a message, treat <| as regular content
          // Otherwise skip it
          if (inMessage) {
            currentBuffer += response[i]; // Add '<' to buffer
            i++; // Will add '|' on next iteration
            continue;
          } else {
            i++;
            continue;
          }
        }
      }
      
      // Accumulate message content if we're in a message
      if (inMessage) {
        currentBuffer += response[i];
      }
      
      i++;
    }
    
    // Save any remaining buffer
    if (currentBuffer.trim() && currentChannel !== 'none') {
      this.saveBuffer(currentChannel, currentBuffer, {
        content: (c) => content = c,
        reasoning: (r) => reasoning = r,
        commentary: (c) => commentary = c,
        final: (f) => final = f,
        rawToolCalls: (t) => rawToolCalls.push(t)
      }, pendingToolName, userPrompt);
    }
    
    // Special handling: If content contains tool calls, extract them
    // Only extract tool calls from assistant messages, not from user messages
    if (content && (content.includes('<tool_call') || content.includes('<MCP_CALL'))) {
      // Check if we're in an assistant role context
      // If currentRole is null or user, we should be cautious about extracting tool calls
      // Tool calls should typically come from assistant responses
      const shouldExtractToolCalls = currentRole === null || currentRole.isAssistant();
      
      if (shouldExtractToolCalls) {
        const extracted = ToolCallExtractor.extractFromText(content);
        if (extracted.length > 0) {
          console.log(`[HarmonyProcessor] Extracted ${extracted.length} tool call(s) from assistant content`);
          rawToolCalls.push(...extracted.map(e => e.raw));
          // Clear content since it's just a tool call
          content = '';
        }
      } else {
        console.log(`[HarmonyProcessor] Skipping tool call extraction from user message`);
      }
    }
    
    // Extract file updates from content if model describes files but didn't make tool calls
    if (rawToolCalls.length === 0 && content) {
      // Try to extract file update from content (handles cases where model describes file with code block)
      // Note: extractFileUpdateFromContent will check user intent if available
      const extractedToolCall = this.extractFileUpdateFromContent(content, userPrompt);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from content (with Harmony tokens): ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        rawToolCalls.push(extractedToolCall.raw);
        // Preserve FULL content including code blocks (for user display)
        // The tool call extraction happens separately and doesn't affect the user-visible response
        console.log(`[HarmonyProcessor] Preserved ${content.length} chars of content including code block`);
      } else {
        // Check for file operations that should be tool calls
        const extractedFileOps = this.extractFileOperationsFromDescription(content);
        if (extractedFileOps.length > 0) {
          console.log(`[HarmonyProcessor] Extracted ${extractedFileOps.length} file operation(s) from description (with Harmony tokens)`);
          rawToolCalls.push(...extractedFileOps.map(op => op.raw));
          // Clear content since it's been extracted as tool calls
          content = '';
        } else {
          // Warn if model claims to have created/modified files but extraction failed
          const fileCreationPhrases = [
            /(?:created|added|wrote|generated).*file/i,
            /file.*(?:has been|was).*(?:created|added|written|generated)/i,
            /(?:I've|I have).*(?:created|added|written|generated).*file/i,
            /\*\*File:\*\*\s*`[^`]+`/i,  // Matches "**File:** `filename`"
            /File:\s*`[^`]+`/i,  // Matches "File: `filename`"
            /(?:here'?s|here is).*file.*`[^`]+`/i,  // Matches "Here's a file `filename`"
            /(?:the|a) file.*`[^`]+`.*(?:has been|was|is)/i,  // Matches "the file `filename` has been..."
          ];
          
          const fileOperationPhrases = [
            /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:file|content)/i,
            /(?:open|read|view|see|check|examine|edit|modify|update|change|replace).*(?:the|this|that|a|an).*(?:file|content)/i,
          ];
          
          const hasFileCreationClaim = fileCreationPhrases.some(phrase => phrase.test(content));
          const hasFileOperation = fileOperationPhrases.some(phrase => phrase.test(content));
          
          if (hasFileCreationClaim) {
            console.warn(`[HarmonyProcessor] ⚠️ Model claims to have created/modified files but extraction failed!`);
            console.warn(`[HarmonyProcessor] Content preview: "${content.substring(0, 300)}..."`);
            console.warn(`[HarmonyProcessor] The model should use <tool_call name="create_file" ... /> instead of just describing the file.`);
          } else if (hasFileOperation) {
            console.warn(`[HarmonyProcessor] ⚠️ Model describes file operations but extraction failed!`);
            console.warn(`[HarmonyProcessor] Content preview: "${content.substring(0, 300)}..."`);
            console.warn(`[HarmonyProcessor] The model should use tool calls (e.g., <tool_call name="read_file" ... /> or <tool_call name="replace_file" ... />) instead of just describing actions.`);
          }
        }
      }
    }
    
    // If final is set but content is not, use final as content
    if (final && !content) {
      content = final;
    }
    
    // Fix tool call file_paths using analysis buffer if available
    // This handles cases where analysis buffer comes after final channel
    let fixedRawToolCalls = rawToolCalls;
    if (reasoning && rawToolCalls.length > 0) {
      const fullPath = this.extractPathFromAnalysis(reasoning);
      if (fullPath) {
        fixedRawToolCalls = rawToolCalls.map(toolCall => this.fixToolCallFilePath(toolCall, fullPath));
      }
    }
    
    console.log(`[HarmonyProcessor] Result: content=${content.length} chars, reasoning=${reasoning?.length || 0} chars, final=${final?.length || 0} chars, toolCalls=${fixedRawToolCalls.length}`);
    
    // Debug: Log what's in rawToolCalls
    if (fixedRawToolCalls.length > 0) {
      fixedRawToolCalls.forEach((raw, idx) => {
        const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(raw);
        const looksLikeXml = XmlProcessor.looksLikeXmlToolCall(raw);
        const looksLikeToolCall = looksLikeMcpOrJson || looksLikeXml;
        console.log(`[HarmonyProcessor] rawToolCalls[${idx}]: ${raw.length} chars, looksLikeToolCall=${looksLikeToolCall} (MCP/JSON=${looksLikeMcpOrJson}, XML=${looksLikeXml})`);
        console.log(`[HarmonyProcessor] rawToolCalls[${idx}] content: "${raw}"`);
        if (!looksLikeToolCall) {
          console.warn(`[HarmonyProcessor] ⚠️ rawToolCalls[${idx}] doesn't look like a tool call (${raw.length} chars): "${raw.substring(0, 100)}..."`);
        }
      });
    }
    
    return { content, reasoning, commentary, final, rawToolCalls: fixedRawToolCalls, remaining: response };
  }
  
  /**
   * Handle channel token and return new position
   */
  private handleChannelToken(response: string, tokenEnd: number, currentChannel: string): number {
    // Move past the token
    let i = tokenEnd + 2;
    return i;
  }
  
  /**
   * Detect channel type (analysis, final, commentary) at current position
   */
  private detectChannelType(response: string, startPos: number): 'analysis' | 'final' | 'commentary' | 'none' {
    let i = startPos;
    
    // Skip any whitespace
    while (i < response.length && response[i].match(/\s/)) {
      i++;
    }
    
    // Check for channel types - use substring instead of deprecated substr
    const remaining = response.substring(i);
    
    if (remaining.startsWith('analysis')) {
      return 'analysis';
    } else if (remaining.startsWith('final')) {
      return 'final';
    } else if (remaining.startsWith('commentary')) {
      return 'commentary';
    }
    
    return 'none';
  }
  
  /**
   * Extract full path from analysis buffer JSON
   * Returns the path value if found, null otherwise
   */
  private extractPathFromAnalysis(analysisBuffer: string | undefined): string | null {
    if (!analysisBuffer) return null;
    
    try {
      const parsed = JSON.parse(analysisBuffer.trim());
      if (parsed && typeof parsed === 'object' && parsed.path && typeof parsed.path === 'string') {
        return parsed.path;
      }
    } catch {
      // Not valid JSON or doesn't have path field
    }
    
    return null;
  }

  /**
   * Fix tool call file_path if it's just a filename and we have the full path from analysis buffer
   */
  private fixToolCallFilePath(toolCallText: string, fullPath: string | null): string {
    if (!fullPath) return toolCallText;
    
    try {
      // Try to parse as JSON tool call
      const parsed = JSON.parse(toolCallText.trim());
      if (parsed && typeof parsed === 'object' && parsed.name && parsed.arguments) {
        const filePath = parsed.arguments.file_path || parsed.arguments.filePath;
        if (filePath && typeof filePath === 'string') {
          // Check if it's just a filename (no path separators)
          const isJustFilename = !filePath.includes('/') && !filePath.includes('\\');
          if (isJustFilename) {
            // Extract the filename from the full path
            const fullPathFilename = fullPath.split('/').pop() || fullPath.split('\\').pop();
            // If filenames match, use the full path
            if (fullPathFilename === filePath) {
              console.log(`[HarmonyProcessor] Fixing tool call file_path from "${filePath}" to "${fullPath}" using analysis buffer`);
              const fixedCall = {
                ...parsed,
                arguments: {
                  ...parsed.arguments,
                  file_path: fullPath
                }
              };
              return JSON.stringify(fixedCall);
            }
          }
        }
      }
    } catch {
      // Not JSON format, try XML format - look for JSON in args attribute
      try {
        // Match args attribute with JSON value (handles both single and double quotes)
        const argsMatch = toolCallText.match(/args\s*=\s*(["'])(\{[^'"}]+\})\1/i);
        if (argsMatch) {
          const argsJsonStr = argsMatch[2];
          const argsParsed = JSON.parse(argsJsonStr);
          const filePath = argsParsed.file_path || argsParsed.filePath;
          if (filePath && typeof filePath === 'string') {
            const isJustFilename = !filePath.includes('/') && !filePath.includes('\\');
            if (isJustFilename) {
              const fullPathFilename = fullPath.split('/').pop() || fullPath.split('\\').pop();
              if (fullPathFilename === filePath) {
                console.log(`[HarmonyProcessor] Fixing XML tool call file_path from "${filePath}" to "${fullPath}" using analysis buffer`);
                // Replace the file_path in the JSON string
                const fixedArgs = {
                  ...argsParsed,
                  file_path: fullPath
                };
                const fixedArgsJson = JSON.stringify(fixedArgs);
                const quoteChar = argsMatch[1];
                // Replace the entire args attribute value
                return toolCallText.replace(argsMatch[0], `args=${quoteChar}${fixedArgsJson}${quoteChar}`);
              }
            }
          }
        } else {
          // Try simpler regex for JSON in XML (handles cases where JSON might span multiple lines or have escaped quotes)
          const filePathMatch = toolCallText.match(/"file_path"\s*:\s*"([^"\\]+|\\.[^"]*)*"/);
          if (filePathMatch) {
            // Extract the file path value (handle escaped quotes)
            const filePathStr = filePathMatch[0];
            const filePathMatch2 = filePathStr.match(/"file_path"\s*:\s*"([^"]+)"/);
            if (filePathMatch2) {
              const filePath = filePathMatch2[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              const isJustFilename = !filePath.includes('/') && !filePath.includes('\\');
              if (isJustFilename) {
                const fullPathFilename = fullPath.split('/').pop() || fullPath.split('\\').pop();
                if (fullPathFilename === filePath) {
                  console.log(`[HarmonyProcessor] Fixing XML tool call file_path from "${filePath}" to "${fullPath}" using analysis buffer (regex fallback)`);
                  // Escape the full path for JSON
                  const escapedFullPath = fullPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                  return toolCallText.replace(filePathMatch2[0], `"file_path": "${escapedFullPath}"`);
                }
              }
            }
          }
        }
      } catch {
        // Can't fix, return original
      }
    }
    
    return toolCallText;
  }

  /**
   * Save buffer based on channel type
   */
  private saveBuffer(
    channel: string,
    buffer: string,
    setters: {
      content: (c: string) => void,
      reasoning: (r: string) => void,
      commentary?: (c: string) => void,
      final?: (f: string) => void,
      rawToolCalls: (t: string) => void
    },
    pendingToolName?: string,
    userPrompt?: string
  ) {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    
    console.log(`[HarmonyProcessor] Saving ${channel} buffer (${trimmed.length} chars): "${trimmed.substring(0, 100)}..."`);
    
    switch (channel) {
      case 'analysis':
        setters.reasoning(trimmed);
        break;

      case 'final':
        // Check if this is a tool call
        let toolCallText: string | null = null;
        
        // Use XmlProcessor to extract tool calls (more robust than regex)
        // This handles complex JSON in args attributes correctly
        const xmlToolCalls = XmlProcessor.extractToolCalls(trimmed);
        if (xmlToolCalls.length > 0) {
          // Use the raw XML string from the first extracted tool call
          toolCallText = xmlToolCalls[0].raw;
          console.log(`[HarmonyProcessor] Matched XML tool call pattern via XmlProcessor, length: ${toolCallText.length}`);
        } else {
          // Fallback to pattern matching for non-XML formats
          // First check for XML-style tool calls with regex (for backwards compatibility)
          // Support both <tool_call> and <MCP_CALL>
          const selfClosingPattern = /<(?:tool_call|MCP_CALL)\s+[^>]*\/\s*>/;
          const selfClosingPatternLoose = /<(?:tool_call|MCP_CALL)[^>]*\/>/;
          const openingTagPattern = /<(?:tool_call|MCP_CALL)\s+[^>]*>/;
          const variantMatch = trimmed.match(/<\|?[^>]*(?:tool_call|MCP_CALL)[^>]*\/?>/);
          const fullElementMatch = trimmed.match(/<(?:tool_call|MCP_CALL)[^>]*>[\s\S]*?<\/(?:tool_call|MCP_CALL)>/);
          
          // Try self-closing first (most common)
          let match = trimmed.match(selfClosingPattern);
          if (!match) {
            match = trimmed.match(selfClosingPatternLoose);
          }
          if (!match) {
            match = trimmed.match(openingTagPattern);
          }
          if (!match && variantMatch) {
            match = variantMatch;
          }
          if (!match && fullElementMatch) {
            match = fullElementMatch;
          }
          
          if (match) {
            // It's an XML-style tool call
            toolCallText = match[0];
            console.log(`[HarmonyProcessor] Matched XML tool call pattern via regex, length: ${toolCallText.length}`);
          }
        }
        
        if (!toolCallText && ToolCallExtractor.looksLikeToolCall(trimmed)) {
          // It's a non-XML tool call (MCP or JSON format)
          toolCallText = trimmed;
          console.log(`[HarmonyProcessor] Matched non-XML tool call pattern`);
        } else {
          // Check if this is JSON arguments without a name field, and we have a pending tool name
          try {
            const parsed = JSON.parse(trimmed);
            // Check if it's just arguments (no "name" field, but has object properties)
            if (parsed && typeof parsed === 'object' && !parsed.name && !parsed.arguments && !parsed.args && Object.keys(parsed).length > 0) {
              // This looks like just arguments, try to combine with pending tool name
              if (pendingToolName) {
                const combinedToolCall = JSON.stringify({
                  name: pendingToolName,
                  arguments: parsed
                });
                console.log(`[HarmonyProcessor] Combining variant token tool name "${pendingToolName}" with JSON arguments`);
                setters.rawToolCalls(combinedToolCall);
                return; // Exit early after setting tool call
              }
            }
          } catch {
            // Not valid JSON, continue with regular content handling
          }
        }
        
        if (toolCallText) {
          console.log(`[HarmonyProcessor] Detected tool call in final channel: ${toolCallText.substring(0, 100)}...`);
          console.log(`[HarmonyProcessor] Full tool call text (${toolCallText.length} chars): "${toolCallText}"`);
          setters.rawToolCalls(toolCallText);
        } else {
          // Check if content contains file update claims with code blocks
          // Note: extractFileUpdateFromContent will check user intent if available
          const extractedToolCall = this.extractFileUpdateFromContent(trimmed, userPrompt);
          if (extractedToolCall) {
            console.log(`[HarmonyProcessor] Extracted file update from content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
            setters.rawToolCalls(extractedToolCall.raw);
            // Preserve FULL content including code blocks (for user display)
            // The tool call extraction happens separately and doesn't affect the user-visible response
            console.log(`[HarmonyProcessor] Preserved ${trimmed.length} chars of content including code block in saveBuffer`);
            // Save full content to final or content field
            if (setters.final) {
              setters.final(this.preserveCodeBlocks(trimmed));
            } else {
              setters.content(this.preserveCodeBlocks(trimmed));
            }
            // Return early since we've extracted the tool call
            return;
          } else {
            // Check if content describes file operations that should be tool calls
            const extractedFileOps = this.extractFileOperationsFromDescription(trimmed);
            if (extractedFileOps.length > 0) {
              console.log(`[HarmonyProcessor] Extracted ${extractedFileOps.length} file operation(s) from description`);
              // Use the first extracted operation (most common case)
              setters.rawToolCalls(extractedFileOps[0].raw);
            } else {
              // Regular content in final channel - save to final field
              if (setters.final) {
                setters.final(this.preserveCodeBlocks(trimmed));
              } else {
                // Fallback to content if final setter not available
                setters.content(this.preserveCodeBlocks(trimmed));
              }
            }
          }
        }
        break;
      case 'commentary':
        // Commentary channel may contain tool calls, but also regular text
        // Only treat as tool call if it actually looks like one
        const looksLikeMcpOrJsonCommentary = ToolCallExtractor.looksLikeToolCall(trimmed);
        const looksLikeXmlCommentary = XmlProcessor.looksLikeXmlToolCall(trimmed);
        if (looksLikeMcpOrJsonCommentary || looksLikeXmlCommentary) {
          setters.rawToolCalls(trimmed);
        } else {
          // Regular commentary text - save to commentary field
          if (setters.commentary) {
            setters.commentary(trimmed);
          } else {
            // Fallback to content if commentary setter not available
            setters.content(trimmed);
          }
        }
        break;
      default:
        console.warn(`[HarmonyProcessor] Unknown channel type: ${channel}`);
    }
  }
  
  /**
   * Extract file update from content that claims to have updated/created a file
   * but doesn't make an explicit tool call
   * Also extracts when code block with file name is present (even without explicit claims)
   * Note: Stage-level validation (in responseValidator) will block file modification tools at CHAT stage
   */
  private extractFileUpdateFromContent(content: string, userPrompt?: string): { raw: string; name: string; arguments: { file_path: string; content: string } } | null {
    // Exclude tool results sections from file extraction to prevent false positives
    // Tool results are formatted output and should not be parsed as file operations
    // This prevents exec_terminal results from triggering unwanted file operations
    if (content.includes('**Tool Results:**') || content.includes('Tool Results:')) {
      // Find the tool results section and exclude it from extraction
      const toolResultsPattern = /(?:\*\*)?Tool Results(?::)?(?:\*\*)?/i;
      const toolResultsMatch = content.match(toolResultsPattern);
      if (toolResultsMatch && toolResultsMatch.index !== undefined) {
        // Only process content before the tool results section
        const contentBeforeToolResults = content.substring(0, toolResultsMatch.index);
        if (!contentBeforeToolResults.trim()) {
          // If all content is in tool results, don't extract anything
          console.log(`[HarmonyProcessor] Content is only in Tool Results section, skipping file extraction`);
          return null;
        }
        // Process only the content before tool results
        content = contentBeforeToolResults;
        console.log(`[HarmonyProcessor] Excluding Tool Results section from file extraction`);
      }
    }
    
    // NOTE: Intention detection removed - stage validator will block file modifications at CHAT stage
    // This allows AI to suggest file operations at chat stage that will be blocked appropriately
    // No need to check user intent here; the stage machine handles access control
    
    // First, try to extract code block content
    // Handle both formats: with newline after language (```swift\n) and without (```swift ) due to whitespace normalization
    const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/;
    const codeBlockMatch = content.match(codeBlockPattern);
    const hasCodeBlock = codeBlockMatch && codeBlockMatch[1];
    const codeContent = hasCodeBlock ? codeBlockMatch[1].trim() : null;
    
    // If there's no code block and file is referenced, default to read_file
    // This allows reviewing existing files at CHAT stage
    if (!hasCodeBlock) {
      // Extract file name for reading
      const filePathPatterns = [
        /`([^`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`/i,
        /\*\*([^*]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\*\*/i,
        /\*\*(?:file|filename|path)\*\*[:\s]+`([^`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`/i,
        /(?:file|filename|path)[:\s]+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`?/i,
        /\b([a-zA-Z0-9_\-/]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\b/i,
      ];
      
      let filePath: string | null = null;
      for (const pattern of filePathPatterns) {
        const globalPattern = new RegExp(pattern.source, pattern.flags + (pattern.global ? '' : 'g'));
        const matches = Array.from(content.matchAll(globalPattern));
        for (const match of matches) {
          if (match[1] && match[1].length > 0) {
            const candidate = match[1];
            if (!/(?:^import|^from|require\(|\.includes\()/i.test(candidate) && 
                !/(?:package\.json|tsconfig\.json|webpack\.config)/i.test(candidate)) {
              filePath = candidate;
              break;
            }
          }
        }
        if (filePath) break;
      }
      
      if (filePath) {
        // Normalize file path (remove leading slashes)
        filePath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        
        // Determine if path looks complete (has directory separators) or incomplete (just filename)
        const isFullPath = filePath.includes('/') || filePath.includes('\\');
        const toolName = isFullPath ? 'read_file' : 'find_files';
        
        // Create tool call - use find_files for incomplete paths, read_file for full paths
        const toolCall = {
          name: toolName,
          arguments: {
            file_path: filePath,
            // find_files uses 'name_pattern' instead of 'file_path'
            ...(toolName === 'find_files' && { name_pattern: filePath })
          }
        };
        
        // Remove file_path from find_files arguments if needed
        if (toolName === 'find_files') {
          delete (toolCall.arguments as any).file_path;
        }
        
        const raw = JSON.stringify(toolCall);
        console.log(`[HarmonyProcessor] Extracted ${toolName} for file: ${filePath} (isFullPath=${isFullPath})`);
        
        return {
          raw,
          name: toolName,
          arguments: {
            file_path: filePath,
            content: '' // Neither read_file nor find_files need content in arguments
          } as any
        };
      }
      
      return null; // No file referenced and no code block
    }
    
    // Has code block - determine if it's create_file or replace_file
    if (!codeContent || codeContent.length < 10) {
      return null; // Code block too short or empty
    }
    
    // Extract file name - look for backticked file names or file extensions
    // Try multiple patterns to find file paths
    const filePathPatterns = [
      /`([^`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`/i,
      /\*\*([^*]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\*\*/i,
      // Handle "**File:** `filename`" format (markdown bold with backticked filename)
      /\*\*(?:file|filename|path)\*\*[:\s]+`([^`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`/i,
      /(?:file|filename|path)[:\s]+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`?/i,
      /(?:updated|created|wrote|modified|save|save as|named)\s+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`?/i,
      // Also look for file names in the content text itself (like "animation.py" or "Tests/LatinService/Psalm101Tests.swift")
      /\b([a-zA-Z0-9_\-/]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\b/i,
    ];
    
    let filePath: string | null = null;
    for (const pattern of filePathPatterns) {
      // Make sure pattern is global for matchAll
      const globalPattern = new RegExp(pattern.source, pattern.flags + (pattern.global ? '' : 'g'));
      const matches = Array.from(content.matchAll(globalPattern));
      // Prefer backticked filenames or explicit mentions over generic matches
      for (const match of matches) {
        if (match[1] && match[1].length > 0) {
          // Skip common false positives (like "import json" matching "json")
          const candidate = match[1];
          if (!/(?:^import|^from|require\(|\.includes\()/i.test(candidate) && 
              !/(?:package\.json|tsconfig\.json|webpack\.config)/i.test(candidate)) {
            filePath = candidate;
            break;
          }
        }
      }
      if (filePath) break;
    }
    
    if (!filePath) {
      return null; // No file path found
    }
    
    // Normalize file path: remove leading '/' if present to make it relative to workspace
    // Paths like "/Tests/LatinService/..." should be "Tests/LatinService/..." (relative)
    if (filePath.startsWith('/')) {
      filePath = filePath.substring(1);
    }
    
    // Check for file update claims (for determining create vs replace)
    const fileUpdatePhrases = [
      /(?:I've|I have|I|we've|we have).*(?:replaced|updated|created|wrote|modified|generated).*(?:file|contents?)/i,
      /(?:file|contents?).*(?:has been|was|have been).*(?:replaced|updated|created|written|modified|generated)/i,
      /(?:here'?s|here is).*(?:the|an?)?.*(?:updated|new|modified).*(?:file|code)/i,
    ];
    
    const hasFileUpdateClaim = fileUpdatePhrases.some(phrase => phrase.test(content));
    
    // Check if file name is mentioned anywhere in content (even without explicit claims)
    // If we have a code block and a file name, that's a strong signal to extract it
    const fileMentioned = new RegExp(filePath.replace(/\./g, '\\.'), 'i').test(content);
    
    // Extract if:
    // 1. There's an explicit file update claim, OR
    // 2. There's a file name mentioned in the content (even without explicit claim)
    // This handles cases where model provides code as explanation/description
    if (!hasFileUpdateClaim && !fileMentioned) {
      return null; // No file mentioned and no explicit claim
    }
    
    // Determine if it's create_file or replace_file
    // If content explicitly mentions modification, use replace_file
    // Otherwise default to create_file (new files are more common)
    const hasModificationKeywords = /(?:updated|replaced|modified|modify|change|update)/i.test(content);
    const toolName = hasModificationKeywords ? 'replace_file' : 'create_file';

    
    // Create tool call JSON
    const toolCall = {
      name: toolName,
      arguments: {
        file_path: filePath,
        content: codeContent
      }
    };
    
    const raw = JSON.stringify(toolCall);
    
    console.log(`[HarmonyProcessor] Extracted file update: ${toolName} ${filePath} (${codeContent.length} chars)`);
    
    return {
      raw,
      name: toolName,
      arguments: toolCall.arguments
    };
  }
  
  /**
   * Extract file operations (read_file, replace_file) from descriptive text
   * This is a fallback when the model describes actions instead of making tool calls
   */
  private extractFileOperationsFromDescription(content: string): Array<{ raw: string; name: string; arguments: any }> {
    const operations: Array<{ raw: string; name: string; arguments: any }> = [];
    
    // Patterns for file paths (similar to extractFileUpdateFromContent)
    const filePathPatterns = [
      /`([^`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`/i,
      /\*\*([^*]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\*\*/i,
      /(?:file|filename|path)[:\s]+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))`?/i,
      /\b([a-zA-Z0-9_\-/]+\.(?:py|js|ts|jsx|tsx|java|swift|go|rs|cpp|c|cc|cxx|h|hpp|hxx|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1|rb|php|kt|kts|r|R|scala|clj|cljs|ex|exs|erl|hrl|lua|pl|pm|sql|vue|svelte|elm|dart|zig|nim|fs|fsx|f90|f95|f03|f08))\b/i,
    ];
    
    // Extract file path
    let filePath: string | null = null;
    for (const pattern of filePathPatterns) {
      const globalPattern = new RegExp(pattern.source, pattern.flags + (pattern.global ? '' : 'g'));
      const matches = Array.from(content.matchAll(globalPattern));
      for (const match of matches) {
        if (match[1] && match[1].length > 0) {
          const candidate = match[1];
          // Skip common false positives
          if (!/(?:^import|^from|require\(|\.includes\()/i.test(candidate) && 
              !/(?:package\.json|tsconfig\.json|webpack\.config)/i.test(candidate)) {
            filePath = candidate;
            break;
          }
        }
      }
      if (filePath) break;
    }
    
    if (!filePath) {
      return operations; // No file path found
    }
    
    // Normalize file path: remove leading '/' if present to make it relative to workspace
    // Paths like "/Tests/LatinService/..." should be "Tests/LatinService/..." (relative)
    if (filePath.startsWith('/')) {
      filePath = filePath.substring(1);
    }
    
    // Check for file read operations
    const readPhrases = [
      /(?:I'll|I will|going to|need to|should|will).*(?:open|read|view|see|check|examine|look at).*(?:file|content|contents)/i,
      /(?:open|read|view|see|check|examine|look at).*(?:the|this|that|a|an).*(?:file|content|contents)/i,
      /(?:file|content|contents).*(?:from previous|already|earlier)/i,
    ];
    
    const hasReadOperation = readPhrases.some(phrase => phrase.test(content));
    
    if (hasReadOperation) {
      const toolCall = {
        name: 'read_file',
        arguments: {
          file_path: filePath
        }
      };
      operations.push({
        raw: JSON.stringify(toolCall),
        name: 'read_file',
        arguments: toolCall.arguments
      });
      console.log(`[HarmonyProcessor] Extracted read_file operation for: ${filePath}`);
    }
    
    // Check for file edit/update operations (but only if we have enough context)
    // This is more conservative - we only extract if there's a clear indication
    // of what needs to be changed
    const editPhrases = [
      /(?:I'll|I will|going to|need to|should|will).*(?:edit|modify|update|change|replace|insert|add).*(?:property|field|value|text|content)/i,
      /(?:edit|modify|update|change|replace|insert|add).*(?:the|this|that).*(?:property|field|value|text|content|englishText)/i,
    ];
    
    const hasEditOperation = editPhrases.some(phrase => phrase.test(content));
    
    // Note: We don't extract edit operations without code blocks because we don't know
    // what the new content should be. The model should make a proper tool call for edits.
    // However, we can log a warning to help debug.
    if (hasEditOperation && !content.includes('```')) {
      console.warn(`[HarmonyProcessor] Model describes editing ${filePath} but no code block provided. Model should use replace_file tool call.`);
    }
    
    return operations;
  }
  
  /**
   * Preserve code blocks in content (markdown code blocks)
   */
  private preserveCodeBlocks(content: string): string {
    // Code blocks are already preserved in the content, but we can ensure
    // they're properly formatted. This is mainly for future enhancements.
    // For now, just return as-is since Harmony tokens shouldn't interfere
    // with markdown code blocks.
    return content;
  }
  
  /**
   * Extract MCPToolCalls from raw strings
   * Delegates to ToolCallExtractor for the actual extraction logic
   */
  extractToolCalls(rawToolCalls: string[]): MCPToolCall[] {
    return ToolCallExtractor.extractToolCalls(rawToolCalls);
  }
  
  /**
   * Simple text cleaner
   */
  cleanText(text: string): string {
    return text
      .replace(/<\|[^>]*\|?>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  /**
   * Format a prompt with Harmony tokens (or plain text if harmonyMode is false)
   */
  formatPrompt(userMessage: string): string {
    if (!this.harmonyMode) {
      // Return plain text without harmony tokens
      return userMessage;
    }
    return `<|start|>user<|channel|>final<|message|>
${userMessage}
<|end|>
<|start|>assistant<|channel|>final<|message|>`;
  }
  
  /**
   * Validate if response looks like Harmony format
   */
  validateResponse(response: string): boolean {
    return response.includes('<|') && response.includes('|>');
  }
}