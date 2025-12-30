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
        
        // Handle incomplete/truncated tool calls (e.g., when streaming is cut off)
        // Look for <tool_call that appears at the end of text or doesn't have a closing /> or </tool_call>
        // We'll check for patterns that start with <tool_call but don't have proper closing
        
        // Find all positions where <tool_call or <MCP_CALL appears
        const toolCallStartPattern = /<(?:tool_call|MCP_CALL)(?=\s)/g;
        let startMatch: RegExpExecArray | null;
        
        while ((startMatch = toolCallStartPattern.exec(text)) !== null) {
            const startPos = startMatch.index;
            
            // Check if this is already part of a complete match we found
            const isAlreadyMatched = results.some(result => {
                const resultStart = text.indexOf(result.raw);
                return resultStart !== -1 && startPos >= resultStart && startPos < resultStart + result.raw.length;
            });
            
            if (isAlreadyMatched) {
                continue;
            }
            
            // Look for closing /> or </tool_call> or </MCP_CALL> after this position
            // Check up to a reasonable distance (e.g., 10000 chars) to avoid scanning entire text
            const searchEnd = Math.min(startPos + 10000, text.length);
            const remainingText = text.substring(startPos, searchEnd);
            
            // Check if there's a proper closing tag
            const hasSelfClosing = /\s*\/>/.test(remainingText);
            const hasClosingTag = /<\/tool_call>/.test(remainingText) || /<\/MCP_CALL>/.test(remainingText);
            
            if (hasSelfClosing || hasClosingTag) {
                // This appears to be a complete tool call that our earlier patterns missed
                // Try to extract it using a more lenient pattern
                const lenientMatch = remainingText.match(/<(?:tool_call|MCP_CALL)\s+([^>]*?)(?:\s*\/>|>)/);
                if (lenientMatch) {
                    const attributes = lenientMatch[1];
                    const raw = lenientMatch[0];
                    const parsed = this.parseAttributes(attributes, raw);
                    if (parsed) {
                        results.push(parsed);
                        continue;
                    }
                }
                // If extraction failed, skip it (might be malformed)
                continue;
            }
            
            // No closing tag found - this appears to be an incomplete tool call
            // Extract what we can from the remaining text
            const incompleteMatch = remainingText.match(/<(?:tool_call|MCP_CALL)\s+(.*)/);
            if (incompleteMatch) {
                // Get everything from startPos to end of text as the "raw" incomplete tool call
                const raw = text.substring(startPos);
                // Try to extract attributes (might be incomplete)
                const attributesMatch = raw.match(/<(?:tool_call|MCP_CALL)\s+([^>]*?)(?:\s*$|(?=\s|>))/);
                const attributes = attributesMatch ? attributesMatch[1] : incompleteMatch[1];
                
                console.log(`[XmlProcessor] Found incomplete tool call, attempting to extract: "${raw.substring(0, 200)}"`);
                
                // For incomplete tool calls, try to extract from the full raw string
                // since the JSON might extend beyond what was captured in attributes
                let parsed: XmlToolCall | null = null;
                
                // First try with just attributes
                parsed = this.parseAttributes(attributes, raw, true);
                
                // If that failed and we have args=' or args=" in the raw string, try extracting from raw
                if (!parsed && (raw.includes("args='") || raw.includes('args="'))) {
                    // Extract the part after args=' or args="
                    const argsStartMatch = raw.match(/args\s*=\s*(["'])/);
                    if (argsStartMatch) {
                        const quoteChar = argsStartMatch[1];
                        const argsStartPos = argsStartMatch.index! + argsStartMatch[0].length;
                        // Try to find complete JSON using brace matching from this position
                        let jsonMatch = this.extractJsonFromPosition(raw, argsStartPos);
                        
                        // If brace matching failed (JSON is incomplete), try to extract partial JSON
                        if (!jsonMatch) {
                            // Find where the JSON starts (after the opening quote)
                            const jsonStart = argsStartPos;
                            // Try to find the last complete property before truncation
                            // Look for patterns like "key":"value" or "key":value
                            const partialJsonMatch = raw.substring(jsonStart).match(/^(\{[^}]*"file_path"\s*:\s*"[^"]*"[^}]*)/);
                            if (partialJsonMatch) {
                                // Try to close the JSON object
                                let partialJson = partialJsonMatch[1];
                                // If it doesn't end with }, try to add it
                                if (!partialJson.trim().endsWith('}')) {
                                    // Try to extract what we have and make it valid JSON
                                    // Remove any incomplete property at the end
                                    const lastComma = partialJson.lastIndexOf(',');
                                    if (lastComma > 0) {
                                        partialJson = partialJson.substring(0, lastComma) + '}';
                                    } else {
                                        partialJson = partialJson + '}';
                                    }
                                }
                                jsonMatch = partialJson;
                                console.log(`[XmlProcessor] Extracted partial JSON from incomplete tool call: ${jsonMatch.substring(0, 100)}`);
                            }
                        }
                        
                        if (jsonMatch) {
                            // Try to construct a minimal attributes string for parsing
                            const nameMatch = raw.match(/name\s*=\s*(["'])([^"']+)\1/);
                            if (nameMatch) {
                                const name = nameMatch[2];
                                try {
                                    const args = JSON.parse(jsonMatch);
                                    console.log(`[XmlProcessor] Successfully extracted from incomplete tool call using raw string: ${name}`);
                                    parsed = {
                                        raw,
                                        name,
                                        args
                                    };
                                } catch (error) {
                                    // If JSON parsing still fails, try to extract partial information using regex
                                    // This handles cases where JSON is truncated mid-string
                                    console.log(`[XmlProcessor] JSON parse failed, attempting partial extraction from incomplete tool call...`);
                                    
                                    // Extract file_path if present (for file operations)
                                    const filePathMatch = jsonMatch.match(/"file_path"\s*:\s*"([^"]+)"/);
                                    const filePath = filePathMatch ? filePathMatch[1] : null;
                                    
                                    // Extract content - handle incomplete strings
                                    // Look for "content":" and extract everything after until end of string or end of jsonMatch
                                    const contentStartMatch = jsonMatch.match(/"content"\s*:\s*"/);
                                    let content = '';
                                    if (contentStartMatch) {
                                        const contentStartPos = contentStartMatch.index! + contentStartMatch[0].length;
                                        // Extract everything from content start to end of jsonMatch
                                        // This will include the incomplete string
                                        const rawContent = jsonMatch.substring(contentStartPos);
                                        // Unescape any escaped characters we can see
                                        content = rawContent
                                            .replace(/\\n/g, '\n')
                                            .replace(/\\t/g, '\t')
                                            .replace(/\\r/g, '\r')
                                            .replace(/\\"/g, '"')
                                            .replace(/\\'/g, "'")
                                            .replace(/\\\\/g, '\\');
                                    }
                                    
                                    if (filePath || content) {
                                        console.log(`[XmlProcessor] Extracted partial args from incomplete tool call: file_path=${filePath || 'N/A'}, content length=${content.length}`);
                                        parsed = {
                                            raw,
                                            name,
                                            args: {
                                                ...(filePath ? { file_path: filePath } : {}),
                                                ...(content !== undefined ? { content: content } : {})
                                            }
                                        };
                                    } else {
                                        console.warn(`[XmlProcessor] Failed to parse JSON and couldn't extract any useful info from incomplete tool call: ${jsonMatch.substring(0, 100)}`, error);
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (parsed) {
                    console.log(`[XmlProcessor] Successfully extracted from incomplete tool call: ${parsed.name}`);
                    results.push(parsed);
                } else {
                    console.warn(`[XmlProcessor] Could not extract from incomplete tool call: "${raw.substring(0, 100)}"`);
                }
            }
        }
        
        return results;
    }
    
    /**
     * Parse attributes from XML tool call
     * This replicates the logic from ToolCallExtractor.parseToolCallAttributes
     * @param allowIncomplete If true, be more lenient when parsing incomplete/truncated tool calls
     */
    private static parseAttributes(attributes: string, raw: string, allowIncomplete: boolean = false): XmlToolCall | null {
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
                // If we didn't find a closing quote and allowIncomplete is true, try brace matching
                // This handles cases where the XML is truncated but the JSON might still be complete
                if (allowIncomplete) {
                    console.log(`[XmlProcessor] No closing quote found, but allowIncomplete=true, trying brace matching...`);
                    argsStr = this.extractArgsUsingBraceMatching(attributes);
                    if (argsStr) {
                        console.log(`[XmlProcessor] Successfully extracted args using brace matching for incomplete tool call`);
                    }
                } else {
                    console.warn(`[XmlProcessor] Could not find closing ${quoteChar} for args attribute`);
                }
            }
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
     * Extract JSON from a specific position in a string using brace matching
     * This is used for incomplete tool calls where the JSON might extend beyond the attributes
     */
    private static extractJsonFromPosition(text: string, startPos: number): string | null {
        // Find the first opening brace after startPos
        let braceStartPos = startPos;
        while (braceStartPos < text.length && text[braceStartPos] !== '{') {
            braceStartPos++;
        }
        
        if (braceStartPos >= text.length) {
            return null;
        }
        
        // Use brace matching to find the closing brace
        let braceCount = 1; // We've already seen the opening {
        let pos = braceStartPos + 1;
        
        while (pos < text.length && braceCount > 0) {
            const char = text[pos];
            
            // Handle string literals - skip entire string content
            if (char === '"' || char === "'") {
                const stringStartQuote = char;
                pos++; // Skip opening quote
                
                // Find the matching closing quote, handling escapes
                while (pos < text.length) {
                    if (text[pos] === '\\' && pos + 1 < text.length) {
                        // Skip escaped character
                        pos += 2;
                        continue;
                    }
                    
                    if (text[pos] === stringStartQuote) {
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
                    const jsonStr = text.substring(braceStartPos, pos + 1);
                    console.log(`[XmlProcessor] extractJsonFromPosition: Extracted JSON (${jsonStr.length} chars)`);
                    return jsonStr;
                }
            }
            
            pos++;
        }
        
        console.warn(`[XmlProcessor] extractJsonFromPosition: Could not find matching closing brace`);
        return null;
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