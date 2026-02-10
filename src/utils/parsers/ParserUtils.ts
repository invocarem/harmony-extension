import { HtmlEntityDecoder } from "../htmlEntityDecoder";

/**
 * Shared utilities for attribute parsing
 */
export class ParserUtils {
  /**
   * Extract the name attribute from attributes string
   */
  static extractName(attributes: string): string | null {
    const nameMatch = attributes.match(/name=["']([^"']+)["']/);
    return nameMatch ? nameMatch[1] : null;
  }

  /**
   * Find the starting position of args value after args=" or args='
   */
  static findArgsStart(
    attributes: string
  ): { startPos: number; quoteChar: string } | null {
    const argsDoubleQuoteMatch = attributes.match(/args\s*=\s*"/);
    const argsSingleQuoteMatch = attributes.match(/args\s*=\s*'/);

    if (argsDoubleQuoteMatch) {
      return {
        startPos: argsDoubleQuoteMatch.index! + argsDoubleQuoteMatch[0].length,
        quoteChar: '"',
      };
    }

    if (argsSingleQuoteMatch) {
      return {
        startPos: argsSingleQuoteMatch.index! + argsSingleQuoteMatch[0].length,
        quoteChar: "'",
      };
    }

    return null;
  }

  /**
   * Decode HTML entities and parse JSON
   */
  static decodeAndParseJson(jsonStr: string): any {
    const decoded = HtmlEntityDecoder.decode(jsonStr);
    return JSON.parse(decoded);
  }

  /**
   * Check if a string is a placeholder pattern like "{...}" or "{ ... }"
   */
  static isPlaceholder(str: string): boolean {
    const trimmed = str.trim();
    return (
      trimmed === "{...}" ||
      trimmed === "{ ... }" ||
      /^\{\s*\.{3}\s*\}$/.test(trimmed)
    );
  }

  /**
   * Skip over an HTML entity starting at the given position
   * @returns New position after the entity, or original position if no entity found
   */
  static skipHtmlEntity(text: string, pos: number): number {
    if (text[pos] !== "&") {
      return pos;
    }

    const entityMatch = text
      .substring(pos)
      .match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);

    if (entityMatch) {
      return pos + entityMatch[0].length;
    }

    return pos;
  }

  /**
   * Skip over a string literal (with proper escape handling)
   * @returns Position after the closing quote, or -1 if no closing quote found
   */
  static skipString(
    text: string,
    startPos: number,
    quoteChar: string
  ): number {
    let pos = startPos;

    while (pos < text.length) {
      // Check for escape sequence
      if (text[pos] === "\\" && pos + 1 < text.length) {
        pos += 2; // Skip escaped character
        continue;
      }

      // Check for HTML entity
      const entityEnd = this.skipHtmlEntity(text, pos);
      if (entityEnd > pos) {
        pos = entityEnd;
        continue;
      }

      // Check for closing quote
      if (text[pos] === quoteChar) {
        return pos + 1; // Return position after closing quote
      }

      pos++;
    }

    return -1; // No closing quote found
  }

  /**
   * Unescape XML-level quote escaping
   */
  static unescapeXmlQuotes(str: string, quoteChar: string): string {
    if (quoteChar === '"') {
      return str.replace(/\\"/g, '"');
    } else {
      return str.replace(/\\'/g, "'");
    }
  }
}
