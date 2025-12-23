/**
 * Tool Call Extractor
 * Handles extraction and parsing of tool calls from various formats:
 * - XML format: <tool_call name="..." args='...' />
 * - MCP format: to=function_name {...}
 * - JSON format: {"name": "...", "arguments": {...}}
 */

import { MCPToolCall } from "../mcpClient";
import { HtmlEntityDecoder } from "./htmlEntityDecoder";
import { JsonProcessor } from './jsonProcessor';

export interface ExtractedToolCall {
  raw: string;
  name: string;
  args: any;
}

export class ToolCallExtractor {
  /**
   * Check if text looks like a tool call (MCP format or other patterns)
   */

  static looksLikeToolCall(text: string): boolean {
    const trimmed = text.trim();
    
    // Check for MCP-style tool calls: to=function_name {...}
    if (/^to=\w+\s*\{/.test(trimmed)) {
      return true;
    }
    
    // Check for JSON format using JsonProcessor
    if (JsonProcessor.looksLikeToolCall(trimmed)) {
      return true;
    }
    
    // Note: XML patterns are checked separately in extraction logic
    return false;
  }


  /**
   * Extract tool calls from text
   * Supports multiple formats:
   * 1. <tool_call name="..." args='...' />
   * 2. <tool_call name="..." args="...">...</tool_call>
   * 3. <|...tool_call name="..." args='...' /> (variant but recoverable)
   * 4. JSON format: {"name": "...", "arguments": {...}} or {"name": "...", "args": {...}}
   */
  static extractFromText(text: string): ExtractedToolCall[] {
    const results: ExtractedToolCall[] = [];
    
    console.log(`[ToolCallExtractor] extractFromText called with text (${text.length} chars): "${text.substring(0, 300)}${text.length > 300 ? '...' : ''}"`);
    
    // Pattern 1: Self-closing <tool_call name="..." args='...' />
    const selfClosingRegex = /<tool_call\s+([^>]+)\s*\/>/gs;
    
    // Pattern 1b: Variant pattern like <|analysis tool_call name="..." args='...' />
    const variantPrefixRegex = /<\|[^>]*tool_call\s+([^>]+)\s*\/>/gs;
    
    // Pattern 1c: Variant pattern starting with | (missing <)
    const variantPipeRegex = /(?:^|[^<])\|[^>]*tool_call\s+([^>]+)\s*\/>/gm;
    
    // Pattern 2: Full element <tool_call>...</tool_call>
    const fullElementRegex = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/g;
    
    // Track which patterns we've already matched to avoid duplicates
    const matchedPositions = new Set<number>();
    // Track ranges of full elements that have been processed to avoid duplicate JSON extraction
    const matchedFullElementRanges: Array<{ start: number; end: number }> = [];
    
    let match: RegExpExecArray | null;
    
    // Try variant patterns first (they're more specific)
    // Pattern 1b: <|...tool_call
    while ((match = variantPrefixRegex.exec(text)) !== null) {
      const startPos = match.index;
      if (matchedPositions.has(startPos)) continue;
      
      const attributes = match[1];
      const raw = match[0];
      
      console.log(`[ToolCallExtractor] Found tool call (variant prefix): ${raw.substring(0, 100)}...`);
      
      try {
        const parsed = this.parseToolCallAttributes(attributes, raw);
        if (parsed) {
          results.push(parsed);
          matchedPositions.add(startPos);
        }
      } catch (error) {
        console.error(`[ToolCallExtractor] Failed to parse variant tool call: ${raw.substring(0, 100)}`, error);
      }
    }
    
    // Pattern 1c: |...tool_call (at start of string or line)
    while ((match = variantPipeRegex.exec(text)) !== null) {
      const startPos = match.index;
      if (matchedPositions.has(startPos)) continue;
      
      const attributes = match[1];
      const raw = match[0];
      
      console.log(`[ToolCallExtractor] Found tool call (variant pipe): ${raw.substring(0, 100)}...`);
      
      try {
        const parsed = this.parseToolCallAttributes(attributes, raw);
        if (parsed) {
          results.push(parsed);
          matchedPositions.add(startPos);
        }
      } catch (error) {
        console.error(`[ToolCallExtractor] Failed to parse variant tool call: ${raw.substring(0, 100)}`, error);
      }
    }
    
    // Try clean self-closing format (only if not already matched as variant)
    while ((match = selfClosingRegex.exec(text)) !== null) {
      const startPos = match.index;
      // Skip if this position was already matched as a variant pattern
      if (matchedPositions.has(startPos)) continue;
      
      // Also skip if it's actually a variant pattern (starts with <|)
      if (text.substring(Math.max(0, startPos - 2), startPos) === '<|') {
        continue;
      }
      
      const attributes = match[1];
      const raw = match[0];
      
      console.log(`[ToolCallExtractor] Found tool call (self-closing): ${raw.substring(0, 100)}...`);
      
      try {
        const parsed = this.parseToolCallAttributes(attributes, raw);
        if (parsed) {
          results.push(parsed);
          matchedPositions.add(startPos);
        }
      } catch (error) {
        console.error(`[ToolCallExtractor] Failed to parse tool call: ${raw.substring(0, 100)}`, error);
      }
    }
    
    // Try full element format
    while ((match = fullElementRegex.exec(text)) !== null) {
      const raw = match[0];
      const content = match[1].trim();
      const elementStart = match.index;
      const elementEnd = match.index + raw.length;
      
      console.log(`[ToolCallExtractor] Found tool call (full element): ${raw.substring(0, 100)}...`);
      
      try {
        // Try to parse as JSON first
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const toolData = JSON.parse(jsonMatch[0]);
          // Support both "args" and "arguments" fields
          const args = toolData.arguments !== undefined ? toolData.arguments : toolData.args;
          if (toolData.name && args !== undefined) {
            results.push({
              raw,
              name: toolData.name,
              args
            });
            // Track this full element range to avoid duplicate JSON extraction
            matchedFullElementRanges.push({ start: elementStart, end: elementEnd });
            continue;
          }
        }
        
        // Otherwise try to extract from attributes
        const attrMatch = raw.match(/<tool_call\s+([^>]+)>/);
        if (attrMatch) {
          const parsed = this.parseToolCallAttributes(attrMatch[1], raw);
          if (parsed) {
            results.push(parsed);
            // Track this full element range to avoid duplicate JSON extraction
            matchedFullElementRanges.push({ start: elementStart, end: elementEnd });
          }
        }
      } catch (error) {
        console.error(`[ToolCallExtractor] Failed to parse tool call: ${raw.substring(0, 100)}`, error);
      }
    }
    
    // Try JSON format - use a more robust extraction method
    // Handle both "arguments" and "args" formats
    // Allow optional whitespace after opening brace for multiline JSON
    const jsonPattern = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args)"\s*:\s*/g;
    while ((match = jsonPattern.exec(text)) !== null) {
      const startPos = match.index;
      const name = match[1];
      const argsStartPos = match.index + match[0].length;
      
      // Skip if this JSON is inside a full element that was already processed
      const isInsideMatchedElement = matchedFullElementRanges.some(
        range => startPos >= range.start && startPos < range.end
      );
      if (isInsideMatchedElement) {
        continue;
      }
      
      // Find the matching closing brace for the arguments/args object
      let braceCount = 1;
      let i = argsStartPos;
      let argsEndPos = -1;
      
      while (i < text.length && braceCount > 0) {
        if (text[i] === '{') braceCount++;
        else if (text[i] === '}') braceCount--;
        if (braceCount === 0) {
          argsEndPos = i;
          break;
        }
        i++;
      }
      
      if (argsEndPos !== -1) {
        // Parse the full JSON object to extract both name and args/arguments
        const fullJsonStr = text.substring(startPos, argsEndPos + 1);
        const raw = fullJsonStr;
        
        console.log(`[ToolCallExtractor] Found tool call (JSON): ${name}`);
        
        try {
          const parsed = JSON.parse(fullJsonStr);
          // Support both "args" and "arguments" fields
          const args = parsed.arguments !== undefined ? parsed.arguments : parsed.args;
          if (args !== undefined) {
            results.push({
              raw,
              name,
              args
            });
          }
        } catch (error) {
          console.error(`[ToolCallExtractor] Failed to parse JSON tool call: ${fullJsonStr.substring(0, 100)}`, error);
        }
      }
    }
    
    return results;
  }

  /**
   * Parse tool call attributes from a string
   */
  private static parseToolCallAttributes(attributes: string, raw: string): ExtractedToolCall | null {
    // Extract name
    const nameMatch = attributes.match(/name=["']([^"']+)["']/);
    if (!nameMatch) {
      console.warn(`[ToolCallExtractor] No name in tool call: ${raw.substring(0, 100)}`);
      return null;
    }
    
    // Extract args - handle both single and double quotes, escaped quotes, and HTML entities
    let argsStr: string | null = null;
    
    // Manually parse the args attribute value to handle HTML entities correctly
    // Look for args=" or args='
    const argsDoubleQuoteMatch = attributes.match(/args\s*=\s*"/);
    const argsSingleQuoteMatch = attributes.match(/args\s*=\s*'/);
    
    if (argsDoubleQuoteMatch || argsSingleQuoteMatch) {
      const quoteChar = argsDoubleQuoteMatch ? '"' : "'";
      const startPos = (argsDoubleQuoteMatch?.index ?? argsSingleQuoteMatch!.index)! + (argsDoubleQuoteMatch?.[0].length ?? argsSingleQuoteMatch![0].length);
      let endPos = startPos;
      
      // Find the matching closing quote, accounting for HTML entities and escaped quotes
      while (endPos < attributes.length) {
        // Check if we're at the start of an HTML entity
        if (attributes[endPos] === '&') {
          // Skip the entire HTML entity (e.g., &quot; or &#34;)
          const entityMatch = attributes.substring(endPos).match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);
          if (entityMatch) {
            endPos += entityMatch[0].length;
            continue;
          }
        }
        
        // Check for escaped quote
        if (attributes[endPos] === '\\' && endPos + 1 < attributes.length && attributes[endPos + 1] === quoteChar) {
          endPos += 2;
          continue;
        }
        
        // Check for closing quote
        if (attributes[endPos] === quoteChar) {
          break;
        }
        
        endPos++;
      }
      
      if (endPos < attributes.length) {
        argsStr = attributes.substring(startPos, endPos);
        // Handle escaped quotes
        if (quoteChar === '"') {
          argsStr = argsStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        } else {
          argsStr = argsStr.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        }
      }
    }
    
    if (!argsStr) {
      console.warn(`[ToolCallExtractor] No args in tool call: ${raw.substring(0, 100)}`);
      return null;
    }
    
    console.log(`[ToolCallExtractor] Extracted args string (${argsStr.length} chars): "${argsStr.substring(0, 200)}${argsStr.length > 200 ? '...' : ''}"`);
    
    // Decode HTML entities (e.g., &quot; -> ", &amp; -> &, &lt; -> <, &gt; -> >)
    const decodedArgsStr = HtmlEntityDecoder.decode(argsStr);
    console.log(`[ToolCallExtractor] After HTML entity decoding (${decodedArgsStr.length} chars): "${decodedArgsStr.substring(0, 200)}${decodedArgsStr.length > 200 ? '...' : ''}"`);
    
    // Parse JSON arguments
    let args: any;
    try {
      args = JSON.parse(decodedArgsStr);
    } catch (error) {
      console.error(`[ToolCallExtractor] Failed to parse JSON args: ${decodedArgsStr.substring(0, 200)}`, error);
      return null;
    }
    
    console.log(`[ToolCallExtractor] Successfully parsed tool: ${nameMatch[1]}`, args);
    
    return {
      raw,
      name: nameMatch[1],
      args
    };
  }

  /**
   * Extract MCPToolCalls from raw strings
   * Supports multiple formats:
   * 1. <tool_call> XML format
   * 2. MCP commentary format: to=function_name {...}
   * 3. JSON format: {"name": "...", "arguments": {...}} or {"name": "...", "args": {...}}
   */
  static extractToolCalls(rawToolCalls: string[]): MCPToolCall[] {
    const toolCalls: MCPToolCall[] = [];
    
    console.log(`[ToolCallExtractor] extractToolCalls called with ${rawToolCalls.length} raw calls`);
    
    for (const raw of rawToolCalls) {
      // Log the raw tool call string for debugging
      console.log(`[ToolCallExtractor] Processing raw tool call (${raw.length} chars): "${raw.substring(0, 200)}${raw.length > 200 ? '...' : ''}"`);
      
      // First try to extract as <tool_call> pattern
      const extracted = this.extractFromText(raw);
      console.log(`[ToolCallExtractor] extractFromText found ${extracted.length} tool call(s)`);
      extracted.forEach(item => {
        toolCalls.push({
          name: item.name,
          arguments: item.args || {}
        });
      });
      
      // If no <tool_call> found, check for MCP commentary format: to=analyze_latin {...}
      if (extracted.length === 0) {
        // Try MCP format: to=function_name {...}
        const mcpMatch = raw.match(/to=([^\s=]+)\s*(\{[\s\S]*\})/);
        if (mcpMatch) {
          try {
            const args = JSON.parse(mcpMatch[2]);
            toolCalls.push({
              name: mcpMatch[1],
              arguments: args
            });
            console.log(`[ToolCallExtractor] Extracted from MCP format: ${mcpMatch[1]}`);
            continue;
          } catch (error) {
            console.error(`[ToolCallExtractor] Failed to parse JSON in MCP format: ${mcpMatch[2].substring(0, 100)}`, error);
          }
        }
        
        // Try simpler format: to=function_name with args on next line
        const simpleMcpMatch = raw.match(/to=([^\s\n]+)/);
        if (simpleMcpMatch) {
          const jsonMatch = raw.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            try {
              const args = JSON.parse(jsonMatch[0]);
              toolCalls.push({
                name: simpleMcpMatch[1],
                arguments: args
              });
              console.log(`[ToolCallExtractor] Extracted from simple MCP format: ${simpleMcpMatch[1]}`);
            } catch (error) {
              console.error(`[ToolCallExtractor] Failed to parse JSON in simple MCP format: ${jsonMatch[0].substring(0, 100)}`, error);
            }
          }
        }
        
        // Try to find JSON tool call format directly in the raw string
        // Pattern: {"name": "...", "arguments": {...}} or {"name": "...", "args": {...}}
        // Use the same brace-counting approach as extractFromText to handle multiline JSON
        // Allow optional whitespace after opening brace for multiline JSON
        const jsonPattern = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args)"\s*:\s*/;
        const jsonMatch = raw.match(jsonPattern);
        if (jsonMatch) {
          try {
            const startPos = jsonMatch.index!;
            const argsStartPos = startPos + jsonMatch[0].length;
            
            // Find the matching closing brace for the arguments/args object
            let braceCount = 1;
            let i = argsStartPos;
            let argsEndPos = -1;
            
            while (i < raw.length && braceCount > 0) {
              if (raw[i] === '{') braceCount++;
              else if (raw[i] === '}') braceCount--;
              if (braceCount === 0) {
                argsEndPos = i;
                break;
              }
              i++;
            }
            
            if (argsEndPos !== -1) {
              // Parse the full JSON object to handle both "args" and "arguments"
              const fullJsonStr = raw.substring(startPos, argsEndPos + 1);
              const parsed = JSON.parse(fullJsonStr);
              // Support both "args" and "arguments" fields, normalize to "arguments"
              const args = parsed.arguments !== undefined ? parsed.arguments : parsed.args;
              toolCalls.push({
                name: parsed.name,
                arguments: args
              });
              console.log(`[ToolCallExtractor] Extracted from JSON format: ${parsed.name}`);
              continue;
            }
          } catch (error) {
            console.error(`[ToolCallExtractor] Failed to parse JSON tool call: ${raw.substring(0, 100)}`, error);
          }
        }
        
        // If still nothing found, only warn if it looked like it should be a tool call
        if (toolCalls.length === 0 && this.looksLikeToolCall(raw)) {
          console.warn(`[ToolCallExtractor] Could not extract tool call from raw string that looked like a tool call. Raw content: "${raw.substring(0, 500)}"`);
        }
      }
    }
    
    console.log(`[ToolCallExtractor] Returning ${toolCalls.length} tool calls`);
    return toolCalls;
  }
}

