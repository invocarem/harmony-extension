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
import { XmlProcessor } from './xmlProcessor';

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
    
    // Track ranges of full elements that have been processed to avoid duplicate JSON extraction
    const matchedFullElementRanges: Array<{ start: number; end: number }> = [];
    
    // First, extract XML tool calls using XmlProcessor
    const xmlResults = XmlProcessor.extractToolCalls(text);
    for (const xmlResult of xmlResults) {
      results.push({
        raw: xmlResult.raw,
        name: xmlResult.name,
        args: xmlResult.args
      });
      
      // Track XML element positions to avoid duplicate JSON extraction
      const xmlStartPos = text.indexOf(xmlResult.raw);
      if (xmlStartPos !== -1) {
        matchedFullElementRanges.push({
          start: xmlStartPos,
          end: xmlStartPos + xmlResult.raw.length
        });
      }
    }
    
    // Then, extract JSON tool calls using JsonProcessor
    const jsonResults = JsonProcessor.extractAllToolCalls(text);
    for (const jsonResult of jsonResults) {
      // Skip if this JSON is inside an XML element that was already processed
      const jsonStartPos = text.indexOf(jsonResult.raw);
      const isInsideXmlElement = matchedFullElementRanges.some(
        range => jsonStartPos >= range.start && jsonStartPos < range.end
      );
      
      if (!isInsideXmlElement) {
        results.push({
          raw: jsonResult.raw,
          name: jsonResult.name,
          args: jsonResult.arguments
        });
      }
    }
    
    console.log(`[ToolCallExtractor] Found ${results.length} tool calls`);
    return results;
  }

  /**
   * Parse tool call attributes from a string
   * Note: This is now primarily used by XmlProcessor, but kept here for backward compatibility
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
    // Look for args=" or args=''
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
      
      // First try to extract as <tool_call> pattern using extractFromText
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
        
        // Use JsonProcessor for JSON tool call format
        const jsonToolCall = JsonProcessor.extractToolCall(raw);
        if (jsonToolCall) {
          toolCalls.push({
            name: jsonToolCall.name,
            arguments: jsonToolCall.arguments
          });
          console.log(`[ToolCallExtractor] Extracted from JSON format: ${jsonToolCall.name}`);
          continue;
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