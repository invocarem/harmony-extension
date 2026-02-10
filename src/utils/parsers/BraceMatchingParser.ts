import { AttributeParser, ParseResult } from "./AttributeParser";
import { ParserUtils } from "./ParserUtils";

/**
 * Brace-matching parser for complex JSON.
 * Uses brace counting to find JSON boundaries instead of quote matching.
 * More robust for JSON with complex quote patterns.
 */
export class BraceMatchingParser implements AttributeParser {
  canParse(attributes: string): boolean {
    // Can parse if we can find args= followed by {
    return /args\s*=\s*["']/.test(attributes) && attributes.includes("{");
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

    const { startPos } = argsInfo;

    // Find opening brace
    let braceStart = startPos;
    while (braceStart < attributes.length && attributes[braceStart] !== "{") {
      // Only skip whitespace
      if (!/\s/.test(attributes[braceStart])) {
        return null; // Non-whitespace before brace
      }
      braceStart++;
    }

    if (braceStart >= attributes.length) {
      return null;
    }

    // Match braces
    const jsonStr = this.matchBraces(attributes, braceStart);
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
      console.warn(
        `[BraceMatchingParser] JSON parse failed: ${error}`
      );
      return null;
    }
  }

  /**
   * Match braces to extract JSON object
   */
  private matchBraces(text: string, startPos: number): string | null {
    let braceCount = 1; // We've seen the opening brace
    let pos = startPos + 1;

    while (pos < text.length && braceCount > 0) {
      const char = text[pos];

      // Skip HTML entities
      const entityEnd = ParserUtils.skipHtmlEntity(text, pos);
      if (entityEnd > pos) {
        pos = entityEnd;
        continue;
      }

      // Skip string literals
      if (char === '"' || char === "'") {
        const stringEnd = ParserUtils.skipString(text, pos + 1, char);
        if (stringEnd === -1) {
          // Unclosed string
          return null;
        }
        pos = stringEnd;
        continue;
      }

      // Track braces
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          // Found matching closing brace
          return text.substring(startPos, pos + 1);
        }
      }

      pos++;
    }

    return null; // Unmatched braces
  }
}
