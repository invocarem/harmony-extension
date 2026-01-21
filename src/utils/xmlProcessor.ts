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
        
        // Track all processed positions to avoid duplicate extraction
        const processedPositions: Array<{ start: number; end: number }> = [];
        
        // Self-closing tool call patterns - support both <tool_call> and <MCP_CALL>
        // Use a more robust approach that handles > characters inside quoted strings
        const selfClosingTagNames = ['tool_call', 'MCP_CALL'];
        
        for (const tagName of selfClosingTagNames) {
            const tagStartPattern = new RegExp(`<${tagName}(?=\\s)`, 'g');
            let startMatch: RegExpExecArray | null;
            
            while ((startMatch = tagStartPattern.exec(text)) !== null) {
                const startPos = startMatch.index;
                const tagEnd = this.findSelfClosingTagEnd(text, startPos, tagName);
                
                if (tagEnd !== -1) {
                    const raw = text.substring(startPos, tagEnd);
                    // Extract attributes (everything between <tagName and />)
                    const attributesMatch = raw.match(new RegExp(`<${tagName}\\s+(.+?)\\s*/>`, 's'));
                    if (attributesMatch) {
                        const attributes = attributesMatch[1];
                        
                        const parsed = this.parseAttributes(attributes, raw);
                        if (parsed) {
                            results.push(parsed);
                            // Track this processed position
                            processedPositions.push({ start: startPos, end: tagEnd });
                        }
                    }
                }
            }
        }
        
        // Variant patterns - support both tool_call and MCP_CALL
        // These patterns look for <|...tool_call or |...tool_call variants
        // We'll use a similar approach but look for the variant prefix first
        // Process <| first, then | (but skip if already matched by <|)
        // Note: processedRanges is local to variant patterns, processedPositions tracks all processed ranges
        const processedRanges: Array<{ start: number; end: number }> = [];
        
        for (const tagName of selfClosingTagNames) {
            // First, look for <|...tool_call pattern
            const variantPattern1 = new RegExp(`<\\|[^<]*${tagName}(?=\\s)`, 'g');
            let variantMatch: RegExpExecArray | null;
            
            while ((variantMatch = variantPattern1.exec(text)) !== null) {
                const variantStart = variantMatch.index;
                const tagStartMatch = text.substring(variantStart).match(new RegExp(`${tagName}(?=\\s)`));
                if (tagStartMatch && tagStartMatch.index !== undefined) {
                    const tagStartPos = variantStart + tagStartMatch.index;
                    const tagEnd = this.findSelfClosingTagEnd(text, tagStartPos, tagName);
                    
                    if (tagEnd !== -1) {
                        const raw = text.substring(variantStart, tagEnd);
                        // Extract attributes
                        const attributesMatch = raw.match(new RegExp(`${tagName}\\s+(.+?)\\s*/>`, 's'));
                        if (attributesMatch) {
                            const attributes = attributesMatch[1];
                                const parsed = this.parseAttributes(attributes, raw);
                                if (parsed) {
                                    results.push(parsed);
                                    processedRanges.push({ start: variantStart, end: tagEnd });
                                    processedPositions.push({ start: variantStart, end: tagEnd });
                                }
                        }
                    }
                }
            }
            
            // Then, look for |...tool_call pattern (but not if it's part of <|)
            const variantPattern2 = new RegExp(`(?:^|[^<])\\|[^<]*${tagName}(?=\\s)`, 'gm');
            variantMatch = null;
            
            while ((variantMatch = variantPattern2.exec(text)) !== null) {
                const variantStart = variantMatch.index;
                // Skip if this range was already processed by <| pattern
                const isAlreadyProcessed = processedRanges.some(
                    range => variantStart >= range.start && variantStart < range.end
                );
                
                if (!isAlreadyProcessed) {
                    const tagStartMatch = text.substring(variantStart).match(new RegExp(`${tagName}(?=\\s)`));
                    if (tagStartMatch && tagStartMatch.index !== undefined) {
                        const tagStartPos = variantStart + tagStartMatch.index;
                        const tagEnd = this.findSelfClosingTagEnd(text, tagStartPos, tagName);
                        
                        if (tagEnd !== -1) {
                            const raw = text.substring(variantStart, tagEnd);
                            // Extract attributes
                            const attributesMatch = raw.match(new RegExp(`${tagName}\\s+(.+?)\\s*/>`, 's'));
                            if (attributesMatch) {
                                const attributes = attributesMatch[1];
                                const parsed = this.parseAttributes(attributes, raw);
                                if (parsed) {
                                    results.push(parsed);
                                    processedPositions.push({ start: variantStart, end: tagEnd });
                                }
                            }
                        }
                    }
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
                const matchStart = match.index!;
                const matchEnd = matchStart + raw.length;
                const content = match[1].trim();
                
                // Skip if this position was already processed
                const isAlreadyProcessed = processedPositions.some(
                    range => matchStart >= range.start && matchStart < range.end
                );
                if (isAlreadyProcessed) {
                    continue;
                }
                
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
                            processedPositions.push({ start: matchStart, end: matchEnd });
                            continue;
                        }
                    }
                    
                    // Try to extract from attributes
                    const attrMatch = raw.match(/<(?:tool_call|MCP_CALL)\s+([^>]+)>/);
                    if (attrMatch) {
                        const parsed = this.parseAttributes(attrMatch[1], raw);
                        if (parsed) {
                            results.push(parsed);
                            processedPositions.push({ start: matchStart, end: matchEnd });
                        }
                    }
                } catch (error) {
                    // Silently continue on parse error
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
            
            // Check if this position was already processed by earlier sections
            const isAlreadyProcessed = processedPositions.some(
                range => startPos >= range.start && startPos < range.end
            );
            
            if (isAlreadyProcessed) {
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
                        const rawEnd = startPos + raw.length;
                        results.push(parsed);
                        processedPositions.push({ start: startPos, end: rawEnd });
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
                        
                        // If brace matching failed (JSON is incomplete), try to extract from raw string directly
                        // This handles cases where the JSON is truncated but we can still extract key fields
                        if (!jsonMatch) {
                            // Extract fields directly from raw string instead of trying to reconstruct JSON
                            const filePathMatch = raw.match(/"file_path"\s*:\s*"([^"]+)"/);
                            const filePath = filePathMatch ? filePathMatch[1] : null;
                            
                            // Extract content - look for "content":" and extract everything until end of raw string
                            // or until we find a closing quote followed by } or end of string
                            const contentStartMatch = raw.match(/"content"\s*:\s*"/);
                            let content = '';
                            if (contentStartMatch && contentStartMatch.index !== undefined) {
                                const contentStartPos = contentStartMatch.index + contentStartMatch[0].length;
                                // Extract from content start to end of raw string (content is truncated)
                                const remainingRaw = raw.substring(contentStartPos);
                                // Try to find the end of the content string (closing quote that's not escaped)
                                let contentEndPos = remainingRaw.length;
                                let foundClosingQuote = false;
                                
                                for (let i = 0; i < remainingRaw.length; i++) {
                                    if (remainingRaw[i] === '"' && (i === 0 || remainingRaw[i - 1] !== '\\')) {
                                        // Found unescaped closing quote - this might be the end of content
                                        // But check if there's more after (like ,} or })
                                        const afterQuote = remainingRaw.substring(i + 1).trim();
                                        if (afterQuote.startsWith('}') || afterQuote.startsWith(',}') || afterQuote.startsWith(', }')) {
                                            contentEndPos = i;
                                            foundClosingQuote = true;
                                            break;
                                        }
                                    }
                                }
                                
                                // If no closing quote found (incomplete content string), look for closing }
                                // that would close the JSON object and stop before it
                                if (!foundClosingQuote) {
                                    // Look backwards from the end for a } that would close the JSON
                                    // We want to stop before any } at the end (or followed by just whitespace/quotes)
                                    const trimmedRemaining = remainingRaw.trim();
                                    const lastBraceIndex = trimmedRemaining.lastIndexOf('}');
                                    if (lastBraceIndex >= 0) {
                                        // Check if this } is at the end or followed by just whitespace/quotes
                                        const afterBrace = trimmedRemaining.substring(lastBraceIndex + 1).trim();
                                        if (afterBrace === '' || afterBrace === "'" || afterBrace === '"') {
                                            // This } closes the JSON object, stop before it
                                            const originalIndex = remainingRaw.indexOf(trimmedRemaining) + lastBraceIndex;
                                            contentEndPos = originalIndex;
                                        }
                                    }
                                }
                                
                                const rawContent = remainingRaw.substring(0, contentEndPos);
                                // Unescape JSON string escapes
                                content = rawContent
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\t/g, '\t')
                                    .replace(/\\r/g, '\r')
                                    .replace(/\\"/g, '"')
                                    .replace(/\\'/g, "'")
                                    .replace(/\\\\/g, '\\')
                                    .trim();
                            }
                            
                            if (filePath || content) {
                                // Construct minimal JSON with extracted fields
                                const extractedFields: any = {};
                                if (filePath) extractedFields.file_path = filePath;
                                if (content) extractedFields.content = content;
                                jsonMatch = JSON.stringify(extractedFields);
                            }
                        }
                        
                        if (jsonMatch) {
                            // Try to construct a minimal attributes string for parsing
                            const nameMatch = raw.match(/name\s*=\s*(["'])([^"']+)\1/);
                            if (nameMatch) {
                                const name = nameMatch[2];
                                try {
                                    const args = JSON.parse(jsonMatch);
                                    parsed = {
                                        raw,
                                        name,
                                        args
                                    };
                                } catch (error) {
                                    // If JSON parsing still fails, try to extract partial information using regex
                                    // This handles cases where JSON is truncated mid-string
                                    
                                    // Extract file_path if present (for file operations)
                                    const filePathMatch = jsonMatch.match(/"file_path"\s*:\s*"([^"]+)"/);
                                    const filePath = filePathMatch ? filePathMatch[1] : null;
                                    
                                    // Extract content - handle incomplete strings
                                    // Look for "content":" and extract everything after until end of string or end of jsonMatch
                                    const contentStartMatch = jsonMatch.match(/"content"\s*:\s*"/);
                                    let content = '';
                                    if (contentStartMatch) {
                                        const contentStartPos = contentStartMatch.index! + contentStartMatch[0].length;
                                        // Extract from content start, but stop before any closing JSON structure
                                        // Look for the end of the content string or the first } that would close the JSON
                                        let contentEndPos = jsonMatch.length;
                                        
                                        // Find the first } or ,} that appears after content starts (this closes the JSON object)
                                        // But we need to be careful - the } might be part of the content if it's escaped
                                        // So we look for } that's not preceded by a backslash
                                        for (let i = contentStartPos; i < jsonMatch.length; i++) {
                                            // Check for closing brace that's not escaped
                                            if (jsonMatch[i] === '}' && (i === 0 || jsonMatch[i - 1] !== '\\')) {
                                                // Found closing brace - content ends before this
                                                contentEndPos = i;
                                                break;
                                            }
                                            // Also check for ,} pattern (comma before closing brace)
                                            if (i > 0 && jsonMatch[i - 1] === ',' && jsonMatch[i] === '}' && 
                                                (i === 1 || jsonMatch[i - 2] !== '\\')) {
                                                contentEndPos = i - 1; // Stop before the comma
                                                break;
                                            }
                                        }
                                        
                                        const rawContent = jsonMatch.substring(contentStartPos, contentEndPos);
                                        // Unescape any escaped characters we can see
                                        content = rawContent
                                            .replace(/\\n/g, '\n')
                                            .replace(/\\t/g, '\t')
                                            .replace(/\\r/g, '\r')
                                            .replace(/\\"/g, '"')
                                            .replace(/\\'/g, "'")
                                            .replace(/\\\\/g, '\\')
                                            // Remove any trailing whitespace or JSON structure that might have leaked in
                                            .replace(/\s*[,}]\s*$/, '')
                                            .trim();
                                    }
                                    
                                    if (filePath || content) {
                                        parsed = {
                                            raw,
                                            name,
                                            args: {
                                                ...(filePath ? { file_path: filePath } : {}),
                                                ...(content !== undefined ? { content: content } : {})
                                            }
                                        };
                                    } else {
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (parsed) {
                    results.push(parsed);
                } else {
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
        
        // Extract name
        const nameMatch = attributes.match(/name=["']([^"']+)["']/);
        if (!nameMatch) {
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
            } else {
                // If we didn't find a closing quote and allowIncomplete is true, try brace matching
                // This handles cases where the XML is truncated but the JSON might still be complete
                if (allowIncomplete) {
                    argsStr = this.extractArgsUsingBraceMatching(attributes);
                    if (argsStr) {
                    }
                } else {
                }
            }
        }
        
        // If quote-based extraction failed, try brace matching as fallback
        if (!argsStr) {
            argsStr = this.extractArgsUsingBraceMatching(attributes);
        }
        
        if (!argsStr) {
            return null;
        }
        
        
        // Decode HTML entities (e.g., &quot; -> ", &amp; -> &, &lt; -> <, &gt; -> >)
        let decodedArgsStr = HtmlEntityDecoder.decode(argsStr);
        
        // Check for placeholder/example patterns (e.g., "{...}", "{ ... }", etc.)
        // These are commonly used in documentation/example tool calls and should be skipped
        const trimmedArgs = decodedArgsStr.trim();
        if (trimmedArgs === '{...}' || trimmedArgs === '{ ... }' || trimmedArgs.match(/^\{\s*\.{3}\s*\}$/)) {
            return null;
        }
        
        // Parse JSON arguments
        let args: any;
        try {
            args = JSON.parse(decodedArgsStr);
        } catch (error) {
            // If parsing fails, try brace matching as fallback (in case quote extraction got wrong boundaries)
            const braceMatchStr = this.extractArgsUsingBraceMatching(attributes);
            if (braceMatchStr && braceMatchStr !== argsStr) {
                decodedArgsStr = HtmlEntityDecoder.decode(braceMatchStr);
                // Check for placeholder patterns in brace-matched result too
                const trimmedBraceArgs = decodedArgsStr.trim();
                if (trimmedBraceArgs === '{...}' || trimmedBraceArgs === '{ ... }' || trimmedBraceArgs.match(/^\{\s*\.{3}\s*\}$/)) {
                    return null;
                }
                try {
                    args = JSON.parse(decodedArgsStr);
                } catch (braceError) {
                    // Brace matching extraction failed to parse JSON
                    return null;
                }
            } else {
                return null;
            }
        }
        
        
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
                    return jsonStr;
                }
            }
            
            pos++;
        }
        
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
                    return jsonStr;
                }
            }
            
            pos++;
        }
        
        return null;
    }
    
    /**
     * Find the end position of a self-closing tag, handling > characters inside quoted strings
     * Returns the position after the closing />, or -1 if not found
     */
    private static findSelfClosingTagEnd(text: string, startPos: number, tagName: string): number {
        // Start after the opening tag name
        let pos = startPos + tagName.length + 1; // +1 for '<'
        
        // Track if we're inside quotes (single or double)
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let escapeNext = false;
        
        // Look for the closing />
        while (pos < text.length) {
            const char = text[pos];
            
            // Handle escape sequences
            if (escapeNext) {
                escapeNext = false;
                pos++;
                continue;
            }
            
            if (char === '\\') {
                escapeNext = true;
                pos++;
                continue;
            }
            
            // Track quote state
            if (char === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
            } else if (char === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
            }
            
            // Only check for /> when we're not inside quotes
            if (!inSingleQuote && !inDoubleQuote) {
                // Check for closing />
                if (char === '/' && pos + 1 < text.length && text[pos + 1] === '>') {
                    return pos + 2; // Return position after />
                }
            }
            
            pos++;
        }
        
        return -1; // Not found
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