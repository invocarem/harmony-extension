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
        
        // Self-closing tool call pattern
        const selfClosingRegex = /<tool_call\s+([^>]+)\s*\/>/gs;
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
        
        // Variant patterns
        const variantPatterns = [
            /<\|[^>]*tool_call\s+([^>]+)\s*\/>/gs,  // <|...tool_call
            /(?:^|[^<])\|[^>]*tool_call\s+([^>]+)\s*\/>/gm  // |...tool_call
        ];
        
        for (const pattern of variantPatterns) {
            while ((match = pattern.exec(text)) !== null) {
                const attributes = match[1];
                const raw = match[0];
                
                const parsed = this.parseAttributes(attributes, raw);
                if (parsed) {
                    results.push(parsed);
                }
            }
        }
        
        // Full element format
        const fullElementRegex = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/g;
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
                const attrMatch = raw.match(/<tool_call\s+([^>]+)>/);
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
        
        if (!argsStr) {
            console.warn(`[XmlProcessor] No args in tool call: ${raw.substring(0, 100)}`);
            return null;
        }
        
        console.log(`[XmlProcessor] Extracted args string (${argsStr.length} chars): "${argsStr.substring(0, 200)}${argsStr.length > 200 ? '...' : ''}"`);
        
        // Decode HTML entities (e.g., &quot; -> ", &amp; -> &, &lt; -> <, &gt; -> >)
        const decodedArgsStr = HtmlEntityDecoder.decode(argsStr);
        console.log(`[XmlProcessor] After HTML entity decoding (${decodedArgsStr.length} chars): "${decodedArgsStr.substring(0, 200)}${decodedArgsStr.length > 200 ? '...' : ''}"`);
        
        // Parse JSON arguments
        let args: any;
        try {
            args = JSON.parse(decodedArgsStr);
        } catch (error) {
            console.error(`[XmlProcessor] Failed to parse JSON args: ${decodedArgsStr.substring(0, 200)}`, error);
            return null;
        }
        
        console.log(`[XmlProcessor] Successfully parsed tool: ${nameMatch[1]}`, args);
        
        return {
            raw,
            name: nameMatch[1],
            args
        };
    }
    
    /**
     * Check if text looks like an XML tool call
     */
    static looksLikeXmlToolCall(text: string): boolean {
        return /<tool_call/.test(text) || 
               /<\|[^>]*tool_call/.test(text) ||
               /(?:^|[^<])\|[^>]*tool_call/.test(text);
    }
}