// HarmonyProcessor.ts
// Handles parsing of Harmony protocol tokens (<|start|>, <|channel|>, etc.)

import { MCPToolCall } from "./mcpClient";
import { ToolCallExtractor } from "./utils/toolCallExtractor";
import { XmlProcessor } from "./utils/xmlProcessor";
import { filterHarmonyTokens } from "./utils/harmonyTokenFilter";

export interface HarmonyParseResult {
  content: string;
  reasoning?: string;
  rawToolCalls?: string[];
  remaining?: string;
}

export class HarmonyProcessor {
  constructor(private harmonyMode: boolean = true) {}

  /**
   * Parse Harmony response using token-based approach
   * Falls back to plain text if no Harmony tokens are detected
   * When harmonyMode is false, treats response as plain jinja and filters tokens
   */
  parseResponse(response: string): HarmonyParseResult {
    // If harmony mode is disabled, treat as plain jinja output
    if (!this.harmonyMode) {
      console.log(`[HarmonyProcessor] Harmony mode disabled, treating as plain jinja output`);
      const filtered = filterHarmonyTokens(response);
      const trimmed = filtered.trim();
      
      // Extract tool calls from the response (there might be both content and tool calls)
      const rawToolCalls: string[] = [];
      
      // Try to extract XML tool calls
      const xmlToolCalls = XmlProcessor.extractToolCalls(trimmed);
      if (xmlToolCalls.length > 0) {
        console.log(`[HarmonyProcessor] Found ${xmlToolCalls.length} XML tool call(s) in plain jinja response`);
        // Remove tool calls from content
        let contentWithoutToolCalls = trimmed;
        xmlToolCalls.forEach(tc => {
          contentWithoutToolCalls = contentWithoutToolCalls.replace(tc.raw, '').trim();
        });
        rawToolCalls.push(...xmlToolCalls.map(tc => tc.raw));
        
        console.log(`[HarmonyProcessor] Plain jinja response: content=${contentWithoutToolCalls.length} chars, tool calls=${rawToolCalls.length}`);
        return {
          content: contentWithoutToolCalls,
          rawToolCalls: rawToolCalls,
          remaining: response
        };
      }
      
      // Try MCP/JSON format tool calls
      const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(trimmed);
      if (trimmed && looksLikeMcpOrJson) {
        // If entire response is a tool call (no surrounding text), treat as tool call only
        const isOnlyToolCall = /^(?:to=|mcp_|{"name"|\[{"name")/.test(trimmed.trim());
        if (isOnlyToolCall) {
          console.log(`[HarmonyProcessor] Plain jinja response appears to be a tool call only`);
          return {
            content: '',
            rawToolCalls: [trimmed],
            remaining: response
          };
        }
        // Otherwise, it's content with embedded tool calls - extract them
        // For now, return as content and let extractToolCalls handle it later
      }
      
      // Check if content describes a file update with code blocks
      // This handles cases where the model describes a file instead of making a tool call
      const extractedToolCall = this.extractFileUpdateFromContent(trimmed);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from plain jinja content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        return {
          content: '',
          rawToolCalls: [extractedToolCall.raw],
          remaining: response
        };
      }
      
      // Otherwise, return as content
      console.log(`[HarmonyProcessor] Plain jinja response treated as content (${trimmed.length} chars)`);
      return {
        content: trimmed,
        rawToolCalls: [],
        remaining: response
      };
    }
    console.log(`[HarmonyProcessor] Parsing ${response.length} chars`);
    
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
      const extractedToolCall = this.extractFileUpdateFromContent(trimmed);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from plain text content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        return {
          content: '',
          rawToolCalls: [extractedToolCall.raw],
          remaining: response
        };
      }
      
      // Otherwise, return as content
      console.log(`[HarmonyProcessor] Plain text response treated as content (${trimmed.length} chars)`);
      return {
        content: trimmed,
        rawToolCalls: [],
        remaining: response
      };
    }
    
    // Harmony token-based parsing (existing logic)
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
    if (content && (content.includes('<tool_call') || content.includes('<MCP_CALL'))) {
      const extracted = ToolCallExtractor.extractFromText(content);
      if (extracted.length > 0) {
        rawToolCalls.push(...extracted.map(e => e.raw));
        // Clear content since it's just a tool call
        content = '';
      }
    }
    
    // Extract file updates from content if model describes files but didn't make tool calls
    if (rawToolCalls.length === 0 && content) {
      // Try to extract file update from content (handles cases where model describes file with code block)
      const extractedToolCall = this.extractFileUpdateFromContent(content);
      if (extractedToolCall) {
        console.log(`[HarmonyProcessor] Extracted file update from content (with Harmony tokens): ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
        rawToolCalls.push(extractedToolCall.raw);
        // Clear content since it's been extracted as a tool call
        content = '';
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
    
    console.log(`[HarmonyProcessor] Result: content=${content.length} chars, reasoning=${reasoning?.length || 0} chars, toolCalls=${rawToolCalls.length}`);
    
    // Debug: Log what's in rawToolCalls
    if (rawToolCalls.length > 0) {
      rawToolCalls.forEach((raw, idx) => {
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
          const extractedToolCall = this.extractFileUpdateFromContent(trimmed);
          if (extractedToolCall) {
            console.log(`[HarmonyProcessor] Extracted file update from content: ${extractedToolCall.name} for ${extractedToolCall.arguments.file_path}`);
            setters.rawToolCalls(extractedToolCall.raw);
          } else {
            // Check if content describes file operations that should be tool calls
            const extractedFileOps = this.extractFileOperationsFromDescription(trimmed);
            if (extractedFileOps.length > 0) {
              console.log(`[HarmonyProcessor] Extracted ${extractedFileOps.length} file operation(s) from description`);
              // Use the first extracted operation (most common case)
              setters.rawToolCalls(extractedFileOps[0].raw);
            } else {
              // Regular content - preserve formatting
              setters.content(this.preserveCodeBlocks(trimmed));
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
   * Also extracts when code block with file name is present (even without explicit claims)
   */
  private extractFileUpdateFromContent(content: string): { raw: string; name: string; arguments: { file_path: string; content: string } } | null {
    // First, try to extract code block content
    // Handle both formats: with newline after language (```swift\n) and without (```swift ) due to whitespace normalization
    const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/;
    const codeBlockMatch = content.match(codeBlockPattern);
    if (!codeBlockMatch || !codeBlockMatch[1]) {
      return null; // No code block found
    }
    
    const codeContent = codeBlockMatch[1].trim();
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
    // Default to create_file if unclear (new files are more common)
    const isCreate = /(?:created|generated|new|write|save)/i.test(content) || 
                     !/(?:updated|replaced|modified|edit)/i.test(content);
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