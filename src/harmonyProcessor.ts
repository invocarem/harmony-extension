// HarmonyProcessor.ts
// Handles parsing of Harmony protocol tokens (<|start|>, <|channel|>, etc.)

import { MCPToolCall } from "./mcpClient";
import { ToolCallExtractor } from "./utils/toolCallExtractor";

export interface HarmonyParseResult {
  content: string;
  reasoning?: string;
  rawToolCalls?: string[];
  remaining?: string;
}

export class HarmonyProcessor {
  /**
   * Parse Harmony response using token-based approach
   */
  parseResponse(response: string): HarmonyParseResult {
    console.log(`[HarmonyProcessor] Parsing ${response.length} chars`);
    
    let content = '';
    let reasoning: string | undefined;
    const rawToolCalls: string[] = [];
    
    let i = 0;
    let currentChannel: 'analysis' | 'final' | 'commentary' | 'none' = 'none';
    let inMessage = false;
    let currentBuffer = '';
    // Track tool name from variant tokens like <|analysis tool_call=name
    let pendingToolName: string | undefined = undefined;
    
    while (i < response.length) {
      // Check for token start
      if (response.substring(i, i + 2) === '<|') {
        const tokenEnd = response.indexOf('|>', i);
        
        if (tokenEnd !== -1) {
          const fullToken = response.substring(i, tokenEnd + 2);
          const tokenContent = response.substring(i + 2, tokenEnd);
          
          console.log(`[HarmonyProcessor] Found token: "${fullToken}"`);
          
          // Handle based on token type
          switch (tokenContent) {
            case 'channel':
              // Handle channel token
              i = this.handleChannelToken(response, tokenEnd, currentChannel);
              currentChannel = this.detectChannelType(response, i);
              console.log(`[HarmonyProcessor] Detected channel: ${currentChannel}`);
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
                rawToolCalls: (t) => rawToolCalls.push(t)
              }, pendingToolName);
              // Reset pending tool name after saving buffer
              pendingToolName = undefined;
              
              currentChannel = 'none';
              inMessage = false;
              currentBuffer = '';
              i = tokenEnd + 2;
              continue;
              
            case 'start':
              // Start token - reset state
              currentChannel = 'none';
              inMessage = false;
              currentBuffer = '';
              i = tokenEnd + 2;
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
        rawToolCalls: (t) => rawToolCalls.push(t)
      }, pendingToolName);
    }
    
    // Special handling: If content contains tool calls, extract them
    if (content && content.includes('<tool_call')) {
      const extracted = ToolCallExtractor.extractFromText(content);
      if (extracted.length > 0) {
        rawToolCalls.push(...extracted.map(e => e.raw));
        // Clear content since it's just a tool call
        content = '';
      }
    }
    
    // Warn if model claims to have created/modified files but didn't call tools
    if (rawToolCalls.length === 0 && content) {
      const fileCreationPhrases = [
        /(?:created|added|wrote|generated).*file/i,
        /file.*(?:has been|was).*(?:created|added|written|generated)/i,
        /(?:I've|I have).*(?:created|added|written|generated).*file/i,
        /\*\*File:\*\*\s*`[^`]+`/i,  // Matches "**File:** `filename`"
        /File:\s*`[^`]+`/i,  // Matches "File: `filename`"
        /(?:here'?s|here is).*file.*`[^`]+`/i,  // Matches "Here's a file `filename`"
        /(?:the|a) file.*`[^`]+`.*(?:has been|was|is)/i,  // Matches "the file `filename` has been..."
      ];
      
      const hasFileCreationClaim = fileCreationPhrases.some(phrase => phrase.test(content));
      if (hasFileCreationClaim) {
        console.warn(`[HarmonyProcessor] ⚠️ Model claims to have created/modified files but no tool calls were made!`);
        console.warn(`[HarmonyProcessor] Content preview: "${content.substring(0, 300)}..."`);
        console.warn(`[HarmonyProcessor] The model should use <tool_call name="create_file" ... /> instead of just describing the file.`);
      }
    }
    
    console.log(`[HarmonyProcessor] Result: content=${content.length} chars, reasoning=${reasoning?.length || 0} chars, toolCalls=${rawToolCalls.length}`);
    
    // Debug: Log what's in rawToolCalls
    if (rawToolCalls.length > 0) {
      rawToolCalls.forEach((raw, idx) => {
        const looksLikeToolCall = ToolCallExtractor.looksLikeToolCall(raw) || raw.includes('<tool_call');
        console.log(`[HarmonyProcessor] rawToolCalls[${idx}]: ${raw.length} chars, looksLikeToolCall=${looksLikeToolCall}`);
        console.log(`[HarmonyProcessor] rawToolCalls[${idx}] content: "${raw}"`);
        if (!looksLikeToolCall) {
          console.warn(`[HarmonyProcessor] ⚠️ rawToolCalls[${idx}] doesn't look like a tool call (${raw.length} chars): "${raw.substring(0, 100)}..."`);
        }
      });
    }
    
    return { content, reasoning, rawToolCalls, remaining: response };
  }
  
  /**
   * Handle channel token and return new position
   */
  private handleChannelToken(response: string, tokenEnd: number, currentChannel: string): number {
    // Move past the token
    let i = tokenEnd + 2;
    
    // Debug: show what's next
    const nextChars = response.substring(i, Math.min(i + 20, response.length));
    console.log(`[HarmonyProcessor] After <|channel|>, next chars: "${nextChars}"`);
    
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
      console.log(`[HarmonyProcessor] Found analysis at position ${i}`);
      return 'analysis';
    } else if (remaining.startsWith('final')) {
      console.log(`[HarmonyProcessor] Found final at position ${i}`);
      return 'final';
    } else if (remaining.startsWith('commentary')) {
      console.log(`[HarmonyProcessor] Found commentary at position ${i}`);
      return 'commentary';
    }
    
    console.log(`[HarmonyProcessor] No channel type found at position ${i}, next: "${response.substring(i, Math.min(i + 10, response.length))}"`);
    return 'none';
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
      rawToolCalls: (t: string) => void
    },
    pendingToolName?: string
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
        
        // First check for XML-style tool calls
        // Try multiple patterns to catch different formats
        const selfClosingPattern = /<tool_call\s+[^>]*\/\s*>/;
        const selfClosingPatternLoose = /<tool_call[^>]*\/>/;
        const openingTagPattern = /<tool_call\s+[^>]*>/;
        const variantMatch = trimmed.match(/<\|?[^>]*tool_call[^>]*\/?>/);
        const fullElementMatch = trimmed.match(/<tool_call[^>]*>[\s\S]*?<\/tool_call>/);
        
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
          console.log(`[HarmonyProcessor] Matched XML tool call pattern, length: ${toolCallText.length}`);
        } else if (ToolCallExtractor.looksLikeToolCall(trimmed)) {
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
          const extractedToolCall = this.extractFileUpdateFromContent(trimmed);
          if (extractedToolCall) {
            console.log(`[HarmonyProcessor] Extracted file update from content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
            setters.rawToolCalls(extractedToolCall.raw);
          } else {
            // Regular content - preserve formatting
            setters.content(this.preserveCodeBlocks(trimmed));
          }
        }
        break;
      case 'commentary':
        // Commentary channel may contain tool calls, but also regular text
        // Only treat as tool call if it actually looks like one
        if (ToolCallExtractor.looksLikeToolCall(trimmed) || trimmed.includes('<tool_call')) {
          setters.rawToolCalls(trimmed);
        } else {
          // Regular commentary text - treat as content
          setters.content(trimmed);
        }
        break;
      default:
        console.warn(`[HarmonyProcessor] Unknown channel type: ${channel}`);
    }
  }
  
  /**
   * Extract file update from content that claims to have updated/created a file
   * but doesn't make an explicit tool call
   */
  private extractFileUpdateFromContent(content: string): { raw: string; name: string; arguments: { file_path: string; content: string } } | null {
    // Check for file update claims
    const fileUpdatePhrases = [
      /(?:I've|I have|I|we've|we have).*(?:replaced|updated|created|wrote|modified|generated).*(?:file|contents?)/i,
      /(?:file|contents?).*(?:has been|was|have been).*(?:replaced|updated|created|written|modified|generated)/i,
      /(?:here'?s|here is).*(?:the|an?)?.*(?:updated|new|modified).*(?:file|code)/i,
    ];
    
    const hasFileUpdateClaim = fileUpdatePhrases.some(phrase => phrase.test(content));
    if (!hasFileUpdateClaim) {
      return null;
    }
    
    // Extract file name - look for backticked file names or file extensions
    const filePathPatterns = [
      /`([^`]+\.(?:py|js|ts|jsx|tsx|java|cpp|c|h|hpp|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1))`/i,
      /(?:file|filename|path)[:\s]+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|cpp|c|h|hpp|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1))`?/i,
      /(?:updated|created|wrote|modified)\s+`?([^\s`]+\.(?:py|js|ts|jsx|tsx|java|cpp|c|h|hpp|html|css|json|md|txt|xml|yaml|yml|sh|bat|ps1))`?/i,
    ];
    
    let filePath: string | null = null;
    for (const pattern of filePathPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        filePath = match[1];
        break;
      }
    }
    
    if (!filePath) {
      return null;
    }
    
    // Extract code block content
    const codeBlockPattern = /```(?:\w+)?\s*\n([\s\S]*?)```/;
    const codeBlockMatch = content.match(codeBlockPattern);
    if (!codeBlockMatch || !codeBlockMatch[1]) {
      return null;
    }
    
    const codeContent = codeBlockMatch[1].trim();
    
    // Determine if it's create_file or replace_file based on claim
    const isCreate = /(?:created|generated|new)/i.test(content);
    const toolName = isCreate ? 'create_file' : 'replace_file';
    
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
   * Format a prompt with Harmony tokens
   */
  formatPrompt(userMessage: string): string {
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