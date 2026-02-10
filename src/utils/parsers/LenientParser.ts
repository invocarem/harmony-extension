import { AttributeParser, ParseResult } from "./AttributeParser";
import { ParserUtils } from "./ParserUtils";

/**
 * Lenient parser for malformed or incomplete attributes.
 * Tries to extract whatever it can, even if the structure is broken.
 * Used as a last resort fallback.
 */
export class LenientParser implements AttributeParser {
  canParse(attributes: string): boolean {
    // Always returns true - this is the fallback
    return true;
  }

  parse(
    attributes: string,
    allowIncomplete: boolean = false
  ): ParseResult | null {
    const name = ParserUtils.extractName(attributes);
    if (!name) {
      return null;
    }

    // Try to find any JSON-like structure
    const jsonStr = this.extractAnyJson(attributes);
    if (!jsonStr) {
      return null;
    }

    // Check for placeholder
    if (ParserUtils.isPlaceholder(jsonStr)) {
      return null;
    }

    try {
      const args = ParserUtils.decodeAndParseJson(jsonStr);
      return { name, args };
    } catch (error) {
      // If JSON parse fails and content is large (likely truncated response),
      // always try to salvage what we can
      const shouldSalvage = allowIncomplete || jsonStr.length > 3000;
      
      if (shouldSalvage) {
        console.warn(
          `[LenientParser] JSON parse failed${allowIncomplete ? ' (incomplete mode)' : ' (large content)'}, attempting salvage: ${error}`
        );
        const salvaged = this.salvageIncompleteJson(jsonStr);
        if (salvaged) {
          console.log(`[LenientParser] ✓ Successfully salvaged partial data`);
          return { name, args: salvaged };
        }
      }
      
      console.warn(
        `[LenientParser] JSON parse failed: ${error}`
      );
      return null;
    }
  }

  /**
   * Try to salvage data from incomplete/malformed JSON
   * Used when response is truncated mid-stream
   */
  private salvageIncompleteJson(jsonStr: string): any | null {
    try {
      // Try to extract individual key-value pairs even if structure is broken
      const result: any = {};
      
      // Helper to extract value for a key, handling escaped quotes
      const extractValue = (key: string): string | null => {
        const keyPattern = `"${key}"\\s*:\\s*"`;
        const keyIndex = jsonStr.indexOf(keyPattern);
        if (keyIndex === -1) return null;
        
        let pos = keyIndex + keyPattern.length;
        let value = "";
        let escapeNext = false;
        
        // Read until unescaped closing quote or end of string
        while (pos < jsonStr.length) {
          const char = jsonStr[pos];
          
          if (escapeNext) {
            // Handle escape sequences like \n, \", \\, etc.
            if (char === 'n') value += '\n';
            else if (char === 't') value += '\t';
            else if (char === 'r') value += '\r';
            else if (char === '\\') value += '\\';
            else if (char === '"') value += '"';
            else value += char; // Keep other escaped chars as-is
            escapeNext = false;
          } else if (char === '\\') {
            escapeNext = true;
          } else if (char === '"') {
            // Found closing quote
            return value;
          } else {
            value += char;
          }
          
          pos++;
        }
        
        // String was truncated, return what we got
        return value.length > 0 ? value : null;
      };
      
      // Extract each known field
      const file_path = extractValue('file_path');
      if (file_path) result.file_path = file_path;
      
      const old_text = extractValue('old_text');
      if (old_text) result.old_text = old_text;
      
      const new_text = extractValue('new_text');
      if (new_text) result.new_text = new_text;
      
      const content = extractValue('content');
      if (content) result.content = content;
      
      // Only return if we got at least one field
      if (Object.keys(result).length > 0) {
        console.log(`[LenientParser] Salvaged ${Object.keys(result).length} field(s) from incomplete JSON`);
        return result;
      }
    } catch (error) {
      console.warn(`[LenientParser] Could not salvage incomplete JSON: ${error}`);
    }
    
    return null;
  }

  /**
   * Try to extract any valid JSON from the attributes
   * Very lenient - just looks for {...} structure
   */
  private extractAnyJson(attributes: string): string | null {
    // Find first opening brace
    const startPos = attributes.indexOf("{");
    if (startPos === -1) {
      return null;
    }

    // Try to match braces
    let braceCount = 1;
    let pos = startPos + 1;
    let inString = false;
    let stringChar = "";
    let escapeNext = false;

    while (pos < attributes.length && braceCount > 0) {
      const char = attributes[pos];

      if (escapeNext) {
        escapeNext = false;
        pos++;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        pos++;
        continue;
      }

      if (char === '"' || char === "'") {
        if (inString && char === stringChar) {
          inString = false;
          stringChar = "";
        } else if (!inString) {
          inString = true;
          stringChar = char;
        }
      }

      if (!inString) {
        if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            return attributes.substring(startPos, pos + 1);
          }
        }
      }

      pos++;
    }

    // Even if braces don't match, return what we have if it looks like JSON
    if (startPos < attributes.length) {
      const partial = attributes.substring(startPos);
      // Only return if it starts with { and has some content
      if (partial.length > 2 && partial.startsWith("{")) {
        return partial;
      }
    }

    return null;
  }
}
