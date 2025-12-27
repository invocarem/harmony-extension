// xmlProcessor.ts
import { HtmlEntityDecoder } from './htmlEntityDecoder';

export interface XmlToolCall {
    name: string;
    args: any;
    raw: string;
}

export class XmlProcessor {
    /**
     * Extract XML tool calls from text
     */
    static extractToolCalls(text: string): XmlToolCall[] {
        const results: XmlToolCall[] = [];
        
        console.log(`[XmlProcessor] extractToolCalls called with text (${text.length} chars): "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`);
        
        // Self-closing tool call patterns - support both <tool_call> and <MCP_CALL>
        const selfClosingPatterns = [
            /<tool_call\s+([^>]+)\s*\/>/gs,
            /<MCP_CALL\s+([^>]+)\s*\/>/gs
        ];
        
        for (const selfClosingRegex of selfClosingPatterns) {
            let match: RegExpExecArray | null;
            while ((match = selfClosingRegex.exec(text)) !== null) {
                const attributes = match[1];
                const raw = match[0];
                
                console.log(`[XmlProcessor] Found self-closing tool call, attributes: "${attributes}", raw: "${raw}"`);
                
                const parsed = this.parseAttributes(attributes, raw);
                if (parsed) {
                    console.log(`[XmlProcessor] Successfully parsed tool call: ${parsed.name}`);
                    results.push(parsed);
                } else {
                    console.warn(`[XmlProcessor] Failed to parse attributes from: "${attributes}"`);
                }
            }
        }
        
        // Variant patterns - support both tool_call and MCP_CALL
        const variantPatterns = [
            /<\|[^>]*tool_call\s+([^>]+)\s*\/>/gs,  // <|...tool_call
            /<\|[^>]*MCP_CALL\s+([^>]+)\s*\/>/gs,  // <|...MCP_CALL
            /(?:^|[^<])\|[^>]*tool_call\s+([^>]+)\s*\/>/gm,  // |...tool_call
            /(?:^|[^<])\|[^>]*MCP_CALL\s+([^>]+)\s*\/>/gm  // |...MCP_CALL
        ];
        
        for (const pattern of variantPatterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const attributes = match[1];
                const raw = match[0];
                
                const parsed = this.parseAttributes(attributes, raw);
                if (parsed) {
                    results.push(parsed);
                }
            }
        }
        
        // Full element format - support both <tool_call> and <MCP_CALL>
        const fullElementPatterns = [
            /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/g,
            /<MCP_CALL[^>]*>([\s\S]*?)<\/MCP_CALL>/g
        ];
        
        for (const fullElementRegex of fullElementPatterns) {
            let match: RegExpExecArray | null;
            while ((match = fullElementRegex.exec(text)) !== null) {
                const raw = match[0];
                const content = match[1].trim();
                
                try {
                    // Try to parse JSON content inside element
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const toolData = JSON.parse(jsonMatch[0]);
                        const args = toolData.arguments !== undefined ? toolData.arguments : toolData.args;
                        if (toolData.name && args !== undefined) {
                            results.push({
                                raw,
                                name: toolData.name,
                                args
                            });
                            continue;
                        }
                    }
                    
                    // Try to extract from attributes
                    const attrMatch = raw.match(/<(?:tool_call|MCP_CALL)\s+([^>]+)>/);
                    if (attrMatch) {
                        const parsed = this.parseAttributes(attrMatch[1], raw);
                        if (parsed) {
                            results.push(parsed);
                        }
                    }
                } catch (error) {
                    console.error(`[XmlProcessor] Failed to parse tool call: ${raw.substring(0, 100)}`, error);
                }
            }
        }
        
        return results;
    }
    
    /**
     * Parse attributes from XML tool call
     * This replicates the logic from ToolCallExtractor.parseToolCallAttributes
     */
    private static parseAttributes(attributes: string, raw: string): XmlToolCall | null {
        console.log(`[XmlProcessor] parseAttributes called with attributes: "${attributes}"`);
        
        // Extract name
        const nameMatch = attributes.match(/name=["']([^"']+)["']/);
        if (!nameMatch) {
            console.warn(`[XmlProcessor] No name in tool call: ${raw.substring(0, 100)}`);
            return null;
        }
        
        console.log(`[XmlProcessor] Extracted name: "${nameMatch[1]}"`);
        
        // Extract args - handle both single and double quotes, escaped quotes, and HTML entities
        let argsStr: string | null = null;
        
        // Manually parse the args attribute value to handle HTML entities correctly
        // Look for args=" or args=''
        const argsDoubleQuoteMatch = attributes.match(/args\s*=\s*"/);
        const argsSingleQuoteMatch = attributes.match(/args\s*=\s*'/);
        
        console.log(`[XmlProcessor] argsDoubleQuoteMatch: ${argsDoubleQuoteMatch ? 'found' : 'not found'}, argsSingleQuoteMatch: ${argsSingleQuoteMatch ? 'found' : 'not found'}`);
        
        if (argsDoubleQuoteMatch || argsSingleQuoteMatch) {
            const quoteChar = argsDoubleQuoteMatch ? '"' : "'";
            const startPos = (argsDoubleQuoteMatch?.index ?? argsSingleQuoteMatch!.index)! + (argsDoubleQuoteMatch?.[0].length ?? argsSingleQuoteMatch![0].length);
            let endPos = startPos;
            
            console.log(`[XmlProcessor] Looking for closing ${quoteChar} starting at position ${startPos}`);
            
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
                    console.log(`[XmlProcessor] Found closing ${quoteChar} at position ${endPos}`);
                    break;
                }
                
                endPos++;
            }
            
            if (endPos < attributes.length) {
                argsStr = attributes.substring(startPos, endPos);
                console.log(`[XmlProcessor] Extracted args string (${argsStr.length} chars): "${argsStr}"`);
                // Handle escaped quotes
                if (quoteChar === '"') {
                    argsStr = argsStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                } else {
                    argsStr = argsStr.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
                }
            } else {
                console.warn(`[XmlProcessor] Could not find closing ${quoteChar} for args attribute`);
            }
        }
        
        // If quote-based extraction failed, try brace matching as fallback
        if (!argsStr) {
            console.log(`[XmlProcessor] Quote-based extraction failed, trying brace matching fallback...`);
            argsStr = this.extractArgsUsingBraceMatching(attributes);
        }
        
        // If quote-based extraction failed, try brace matching as fallback
        if (!argsStr) {
            console.log(`[XmlProcessor] Quote-based extraction failed, trying brace matching fallback...`);
            argsStr = this.extractArgsUsingBraceMatching(attributes);
        }
        
        if (!argsStr) {
            console.warn(`[XmlProcessor] No args in tool call: ${raw.substring(0, 100)}`);
            return null;
        }
        
        console.log(`[XmlProcessor] Extracted args string (${argsStr.length} chars): "${argsStr.substring(0, 200)}${argsStr.length > 200 ? '...' : ''}"`);
        
        // Decode HTML entities (e.g., &quot; -> ", &amp; -> &, &lt; -> <, &gt; -> >)
        let decodedArgsStr = HtmlEntityDecoder.decode(argsStr);
        console.log(`[XmlProcessor] After HTML entity decoding (${decodedArgsStr.length} chars): "${decodedArgsStr.substring(0, 200)}${decodedArgsStr.length > 200 ? '...' : ''}"`);
        
        // Check for placeholder/example patterns (e.g., "{...}", "{ ... }", etc.)
        // These are commonly used in documentation/example tool calls and should be skipped
        const trimmedArgs = decodedArgsStr.trim();
        if (trimmedArgs === '{...}' || trimmedArgs === '{ ... }' || trimmedArgs.match(/^\{\s*\.{3}\s*\}$/)) {
            console.warn(`[XmlProcessor] Detected placeholder/example pattern in args: "${decodedArgsStr}", skipping tool call`);
            return null;
        }
        
        // Parse JSON arguments
        let args: any;
        try {
            args = JSON.parse(decodedArgsStr);
        } catch (error) {
            // If parsing fails, try brace matching as fallback (in case quote extraction got wrong boundaries)
            console.log(`[XmlProcessor] JSON parse failed with quote-based extraction, trying brace matching fallback...`);
            const braceMatchStr = this.extractArgsUsingBraceMatching(attributes);
            if (braceMatchStr && braceMatchStr !== argsStr) {
                decodedArgsStr = HtmlEntityDecoder.decode(braceMatchStr);
                // Check for placeholder patterns in brace-matched result too
                const trimmedBraceArgs = decodedArgsStr.trim();
                if (trimmedBraceArgs === '{...}' || trimmedBraceArgs === '{ ... }' || trimmedBraceArgs.match(/^\{\s*\.{3}\s*\}$/)) {
                    console.warn(`[XmlProcessor] Detected placeholder/example pattern in brace-matched args: "${decodedArgsStr}", skipping tool call`);
                    return null;
                }
                try {
                    args = JSON.parse(decodedArgsStr);
                    console.log(`[XmlProcessor] Successfully parsed JSON using brace matching fallback`);
                } catch (braceError) {
                    console.error(`[XmlProcessor] Failed to parse JSON args even with brace matching: ${decodedArgsStr.substring(0, 200)}`, braceError);
                    return null;
                }
            } else {
                console.error(`[XmlProcessor] Failed to parse JSON args: ${decodedArgsStr.substring(0, 200)}`, error);
                return null;
            }
        }
        
        console.log(`[XmlProcessor] Successfully parsed tool: ${nameMatch[1]}`, args);
        
        return {
            raw,
            name: nameMatch[1],
            args
        };
    }
    
    /**
     * Extract args attribute value using JSON brace matching (fallback method)
     * This is used when quote-based extraction fails, especially for complex JSON
     * with lots of escaped quotes or special characters.
     */
    private static extractArgsUsingBraceMatching(attributes: string): string | null {
        // Look for args=" or args=' followed by {
        const argsPattern = /args\s*=\s*(["'])\s*\{/;
        const match = attributes.match(argsPattern);
        
        if (!match) {
            return null;
        }
        
        const quoteChar = match[1];
        const jsonStartPos = match.index! + match[0].length - 1; // Position of the {
        
        console.log(`[XmlProcessor] Brace matching: Found JSON start at position ${jsonStartPos} (quote: ${quoteChar})`);
        
        // Use brace matching to find the closing brace
        // We need to properly handle strings, escaped characters, and HTML entities
        let braceCount = 1; // We've already seen the opening {
        let pos = jsonStartPos + 1;
        
        while (pos < attributes.length && braceCount > 0) {
            const char = attributes[pos];
            
            // Check for HTML entities first (they don't affect JSON structure)
            if (char === '&') {
                const entityMatch = attributes.substring(pos).match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);
                if (entityMatch) {
                    pos += entityMatch[0].length;
                    continue;
                }
            }
            
            // Handle string literals - skip entire string content
            if (char === '"' || char === "'") {
                const stringStartQuote = char;
                pos++; // Skip opening quote
                
                // Find the matching closing quote, handling escapes and HTML entities
                while (pos < attributes.length) {
                    if (attributes[pos] === '\\' && pos + 1 < attributes.length) {
                        // Skip escaped character (could be \" or \' or other escapes)
                        pos += 2;
                        continue;
                    }
                    
                    if (attributes[pos] === '&') {
                        // Skip HTML entities
                        const entityMatch = attributes.substring(pos).match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);
                        if (entityMatch) {
                            pos += entityMatch[0].length;
                            continue;
                        }
                    }
                    
                    if (attributes[pos] === stringStartQuote) {
                        // Found closing quote - skip it and break
                        pos++;
                        break;
                    }
                    
                    pos++;
                }
                continue;
            }
            
            // Handle braces (we're outside any string at this point)
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                    // Found the matching closing brace
                    const jsonStr = attributes.substring(jsonStartPos, pos + 1);
                    console.log(`[XmlProcessor] Brace matching: Extracted JSON (${jsonStr.length} chars)`);
                    return jsonStr;
                }
            }
            
            pos++;
        }
        
        console.warn(`[XmlProcessor] Brace matching: Could not find matching closing brace for JSON in args attribute`);
        return null;
    }
    
    /**
     * Check if text looks like an XML tool call
     */
    static looksLikeXmlToolCall(text: string): boolean {
        return /<tool_call/.test(text) || 
               /<MCP_CALL/.test(text) ||
               /<\|[^>]*tool_call/.test(text) ||
               /<\|[^>]*MCP_CALL/.test(text) ||
               /(?:^|[^<])\|[^>]*tool_call/.test(text) ||
               /(?:^|[^<])\|[^>]*MCP_CALL/.test(text);
    }
}