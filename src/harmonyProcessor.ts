// HarmonyProcessor.ts (complete and coherent)

import { MCPToolCall } from "./mcpClient";

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
    
    while (i < response.length) {
      // Check for token start
      if (response.substr(i, 2) === '<|') {
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
              });
              
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
              // Other tokens (constrain, eot, eoa, etc.) - skip
              i = tokenEnd + 2;
              continue;
          }
        } else {
          // Incomplete token, skip
          i++;
          continue;
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
      });
    }
    
    // Special handling: If content contains tool calls, extract them
    if (content && content.includes('<tool_call')) {
      const extracted = this.extractToolCallsFromText(content);
      if (extracted.length > 0) {
        rawToolCalls.push(...extracted.map(e => e.raw));
        // Clear content since it's just a tool call
        content = '';
      }
    }
    
    console.log(`[HarmonyProcessor] Result: content=${content.length} chars, reasoning=${reasoning?.length || 0} chars, toolCalls=${rawToolCalls.length}`);
    
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
    
    // Check for channel types
    if (response.substr(i, 7) === 'analysis') {
      console.log(`[HarmonyProcessor] Found analysis at position ${i}`);
      return 'analysis';
    } else if (response.substr(i, 5) === 'final') {
      console.log(`[HarmonyProcessor] Found final at position ${i}`);
      return 'final';
    } else if (response.substr(i, 10) === 'commentary') {
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
    }
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
        if (trimmed.includes('<tool_call')) {
          setters.rawToolCalls(trimmed);
        } else {
          setters.content(trimmed);
        }
        break;
      case 'commentary':
        setters.rawToolCalls(trimmed);
        break;
      default:
        console.warn(`[HarmonyProcessor] Unknown channel type: ${channel}`);
    }
  }
  
  /**
   * Extract tool calls from text
   */
  private extractToolCallsFromText(text: string): Array<{raw: string, name: string, args: any}> {
    const results: Array<{raw: string, name: string, args: any}> = [];
    
    // Pattern: <tool_call name="..." args='...' />
    const toolCallRegex = /<tool_call\s+([^>]+)\s*\/>/g;
    
    let match;
    while ((match = toolCallRegex.exec(text)) !== null) {
      const attributes = match[1];
      const raw = match[0];
      
      console.log(`[HarmonyProcessor] Found tool call: ${raw.substring(0, 100)}...`);
      
      try {
        // Extract name
        const nameMatch = attributes.match(/name=["']([^"']+)["']/);
        if (!nameMatch) {
          console.warn(`[HarmonyProcessor] No name in tool call: ${raw.substring(0, 100)}`);
          continue;
        }
        
        // Extract args - handle both single and double quotes
        let argsStr: string | null = null;
        const argsDoubleMatch = attributes.match(/args="([^"]*)"/);
        const argsSingleMatch = attributes.match(/args='([^']*)'/);
        
        if (argsDoubleMatch) {
          argsStr = argsDoubleMatch[1];
        } else if (argsSingleMatch) {
          argsStr = argsSingleMatch[1];
        }
        
        if (!argsStr) {
          console.warn(`[HarmonyProcessor] No args in tool call: ${raw.substring(0, 100)}`);
          continue;
        }
        
        // Parse JSON arguments
        const args = JSON.parse(argsStr);
        
        results.push({
          raw,
          name: nameMatch[1],
          args
        });
        
        console.log(`[HarmonyProcessor] Successfully parsed tool: ${nameMatch[1]}`, args);
        
      } catch (error) {
        console.error(`[HarmonyProcessor] Failed to parse tool call: ${raw.substring(0, 100)}`, error);
      }
    }
    
    return results;
  }
  
  /**
   * Extract MCPToolCalls from raw strings
   */
  extractToolCalls(rawToolCalls: string[]): MCPToolCall[] {
    const toolCalls: MCPToolCall[] = [];
    
    console.log(`[HarmonyProcessor] extractToolCalls called with ${rawToolCalls.length} raw calls`);
    
    for (const raw of rawToolCalls) {
      // First try to extract as <tool_call> pattern
      const extracted = this.extractToolCallsFromText(raw);
      extracted.forEach(item => {
        toolCalls.push({
          name: item.name,
          arguments: item.args
        });
      });
      
      // If no <tool_call> found, check for commentary format: to=analyze_latin {...}
      if (extracted.length === 0 && raw.includes('to=')) {
        const toMatch = raw.match(/to=([^\s]+)/);
        const jsonMatch = raw.match(/(\{[\s\S]*\})/);
        
        if (toMatch && jsonMatch) {
          try {
            const args = JSON.parse(jsonMatch[0]);
            toolCalls.push({
              name: toMatch[1],
              arguments: args
            });
            console.log(`[HarmonyProcessor] Extracted from commentary: ${toMatch[1]}`);
          } catch (error) {
            console.error(`[HarmonyProcessor] Failed to parse JSON in commentary: ${jsonMatch[0].substring(0, 100)}`, error);
          }
        }
      }
    }
    
    console.log(`[HarmonyProcessor] Returning ${toolCalls.length} tool calls`);
    return toolCalls;
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