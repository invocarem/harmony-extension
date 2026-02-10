import { AttributeParser, ParseResult } from "./AttributeParser";
import { ParserUtils } from "./ParserUtils";

/**
 * Simple quote-based parser for well-formed attributes.
 * Finds matching quotes for args attribute value.
 */
export class SimpleQuoteParser implements AttributeParser {
  canParse(attributes: string): boolean {
    // Can parse if we can find args=" or args='
    return /args\s*=\s*["']/.test(attributes);
  }

  parse(
    attributes: string,
    allowIncomplete: boolean = false
  ): ParseResult | null {
    const name = ParserUtils.extractName(attributes);
    if (!name) {
      return null;
    }

    const argsInfo = ParserUtils.findArgsStart(attributes);
    if (!argsInfo) {
      return null;
    }

    const { startPos, quoteChar } = argsInfo;
    const argsStr = this.extractQuotedValue(
      attributes,
      startPos,
      quoteChar,
      allowIncomplete
    );

    if (!argsStr) {
      return null;
    }

    // Unescape and parse
    const unescaped = ParserUtils.unescapeXmlQuotes(argsStr, quoteChar);

    // Check for placeholder
    if (ParserUtils.isPlaceholder(unescaped)) {
      return null;
    }

    try {
      const args = ParserUtils.decodeAndParseJson(unescaped);
      return { name, args };
    } catch (error) {
      console.warn(
        `[SimpleQuoteParser] JSON parse failed: ${error}`
      );
      return null;
    }
  }

  /**
   * Extract the quoted value, handling escapes and nested quotes intelligently
   */
  private extractQuotedValue(
    text: string,
    startPos: number,
    quoteChar: string,
    allowIncomplete: boolean
  ): string | null {
    let pos = startPos;
    let escapeNext = false;

    // Track JSON string state to handle nested quotes
    let inJsonString = false;
    let jsonStringChar = "";

    while (pos < text.length) {
      const char = text[pos];

      // Handle backslash escapes
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

      // Skip HTML entities
      const entityEnd = ParserUtils.skipHtmlEntity(text, pos);
      if (entityEnd > pos) {
        pos = entityEnd;
        continue;
      }

      // Track quote state
      if (char === '"' || char === "'") {
        if (inJsonString) {
          // Check if this closes the JSON string
          if (char === jsonStringChar) {
            inJsonString = false;
            jsonStringChar = "";
          }
        } else if (char === quoteChar) {
          // This is the XML quote character - check if it closes the attribute
          // or starts a JSON string
          if (this.isJsonContext(text, startPos, pos)) {
            // We're in a JSON context, so this starts a JSON string
            inJsonString = true;
            jsonStringChar = char;
          } else {
            // This closes the XML attribute
            return text.substring(startPos, pos);
          }
        } else {
          // Different quote type - starts a JSON string
          inJsonString = true;
          jsonStringChar = char;
        }
      }

      pos++;
    }

    // Reached end without finding closing quote
    if (allowIncomplete && pos > startPos) {
      return text.substring(startPos, pos);
    }

    return null;
  }

  /**
   * Check if we're in a JSON context (after :, [, ,, or {)
   */
  private isJsonContext(text: string, startPos: number, pos: number): boolean {
    // Look backward for JSON structural characters
    for (let i = pos - 1; i >= startPos; i--) {
      const char = text[i];

      // Skip whitespace
      if (/\s/.test(char)) {
        continue;
      }

      // Check for JSON delimiters
      if (char === ":" || char === "[" || char === "," || char === "{") {
        return true;
      }

      // Hit non-whitespace, non-delimiter - not in JSON context
      return false;
    }

    return false;
  }
}
