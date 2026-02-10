/**
 * Interface for parsing tool call attributes
 */
export interface AttributeParser {
  /**
   * Check if this parser can handle the given attributes string
   */
  canParse(attributes: string): boolean;

  /**
   * Parse the attributes to extract name and args
   * @param attributes The attributes string (everything between <tool_call and />)
   * @param allowIncomplete Whether to allow incomplete/truncated parsing
   * @returns Parsed result with name and args, or null if parsing fails
   */
  parse(
    attributes: string,
    allowIncomplete?: boolean
  ): { name: string; args: any } | null;
}

/**
 * Result of parsing operation
 */
export interface ParseResult {
  name: string;
  args: any;
}
