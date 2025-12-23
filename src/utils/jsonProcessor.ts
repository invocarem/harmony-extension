// jsonProcessor.ts
export class JsonProcessor {
  /**
   * Extract JSON tool call from text
   * Returns null if not a valid JSON tool call
   */
  static extractToolCall(
    text: string
  ): { name: string; arguments: any; raw: string } | null {
    try {
      // Try to parse as full JSON object first
      const parsed = JSON.parse(text.trim());
      if (parsed && typeof parsed.name === "string") {
        const args =
          parsed.arguments !== undefined ? parsed.arguments : parsed.args;
        if (args !== undefined) {
          return {
            name: parsed.name,
            arguments: args,
            raw: text.trim(),
          };
        }
      }
    } catch {
      // Not valid JSON, try to find JSON pattern in text
    }

    // Look for JSON tool call pattern in larger text
    const jsonPattern =
      /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args)"\s*:\s*/;
    const match = text.match(jsonPattern);
    if (!match) return null;

    const startPos = match.index!;
    const argsStartPos = startPos + match[0].length;

    // Find the matching closing brace
    let braceCount = 1;
    let i = argsStartPos;
    let argsEndPos = -1;

    while (i < text.length && braceCount > 0) {
      if (text[i] === "{") braceCount++;
      else if (text[i] === "}") braceCount--;
      if (braceCount === 0) {
        argsEndPos = i;
        break;
      }
      i++;
    }

    if (argsEndPos === -1) return null;

    try {
      const fullJsonStr = text.substring(startPos, argsEndPos + 1);
      const parsed = JSON.parse(fullJsonStr);
      const args =
        parsed.arguments !== undefined ? parsed.arguments : parsed.args;

      return {
        name: parsed.name,
        arguments: args,
        raw: fullJsonStr,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if text contains a JSON tool call pattern
   */
  static looksLikeToolCall(text: string): boolean {
    return this.extractToolCall(text) !== null;
  }

  // In JsonProcessor.ts, fix extractAllToolCalls:
  static extractAllToolCalls(
    text: string
  ): Array<{ name: string; arguments: any; raw: string }> {
    const results: Array<{ name: string; arguments: any; raw: string }> = [];
    let searchPosition = 0;

    while (searchPosition < text.length) {
      const substring = text.substring(searchPosition);
      const toolCall = this.extractToolCall(substring);

      if (!toolCall) break;

      const actualPosition = text.indexOf(toolCall.raw, searchPosition);
      if (actualPosition === -1) break;

      results.push(toolCall);
      searchPosition = actualPosition + toolCall.raw.length;
    }

    return results;
  }

  /**
   * Validate if JSON is a tool call (has name and arguments/args fields)
   */
  static isValidToolCall(json: any): boolean {
    return (
      json &&
      typeof json === "object" &&
      typeof json.name === "string" &&
      (json.arguments !== undefined || json.args !== undefined)
    );
  }
}
