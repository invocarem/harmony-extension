/**
 * Represents a code snippet that's ready for file creation
 */
export class CodeContext {
  constructor(
    public name: string,  // File name or identifier
    public content: string[],  // The code content itself (array of lines/strings)
    public waitForCreate: boolean = true  // Flag indicating waiting for file creation
  ) {}

  /**
   * Create a CodeContext from a code block with file path
   */
  static fromCodeBlock(codeBlock: string, filePath?: string): CodeContext | null {
    // Extract code content from markdown code block
    const codeBlockMatch = codeBlock.match(/```(?:\w+)?\s*[\n ]([\s\S]*?)```/);
    if (!codeBlockMatch) {
      return null;
    }

    const codeContent = codeBlockMatch[1].trim();
    if (!codeContent || codeContent.length < 10) {
      return null;
    }

    // Split code content into lines (array of strings)
    const contentLines = codeContent.split('\n');

    // Extract file path if not provided
    let fileName = filePath;
    if (!fileName) {
      // Try to extract from surrounding context
      const beforeMatch = codeBlock.substring(0, codeBlockMatch.index || 0);
      const filePathMatch = 
        beforeMatch.match(/(?:file|filename|path)[:\s]+`?([^\s`]+\.\w{2,4})`?/i) ||
        beforeMatch.match(/\*\*(?:file|filename|path)\*\*[:\s]+`([^`]+\.\w{2,4})`/i) ||
        beforeMatch.match(/\*\*([^*]+\.\w{2,4})\*\*/i) ||
        beforeMatch.match(/`([^`]+\.\w{2,4})`/i);
      
      // Also check if file path is mentioned in the code block itself
      const codeBlockWithPath = codeContent.match(/^#\s*(?:file|path)[:\s]+([^\n]+\.\w{2,4})/i) ||
                                codeContent.match(/\/\/\s*(?:file|path)[:\s]+([^\n]+\.\w{2,4})/i);
      
      fileName = filePathMatch?.[1] || codeBlockWithPath?.[1];
    }

    // If still no file name, use a default
    if (!fileName) {
      fileName = 'file';
    }

    return new CodeContext(fileName, contentLines, true);
  }

  /**
   * Check if this code context is ready for creation
   */
  isReady(): boolean {
    return this.waitForCreate && this.content.length > 0 && this.content.some(line => line.trim().length > 0);
  }

  /**
   * Get the content as a single string (joined with newlines)
   */
  getContentAsString(): string {
    return this.content.join('\n');
  }
}

