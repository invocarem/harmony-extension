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
    // Pattern: ```language optional_file_path\ncode``` or ```language\ncode```
    const codeBlockMatch = codeBlock.match(/```(?:\w+)?(?:\s+[^\n]+)?\n([\s\S]*?)```/);
    if (!codeBlockMatch) {
      // Try alternative pattern without newline after language
      const altMatch = codeBlock.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      if (!altMatch) {
        return null;
      }
      // If no newline after ```, the first line might be file path or code
      const altContent = altMatch[1].trim();
      if (!altContent || altContent.length < 10) {
        return null;
      }
      // Check if first line looks like a file path
      const firstLine = altContent.split('\n')[0];
      const looksLikeFilePath = /^[\w\/\.\-]+\.\w{2,4}$/.test(firstLine.trim());
      if (looksLikeFilePath && altContent.split('\n').length > 1) {
        // First line is file path, rest is code
        const lines = altContent.split('\n');
        const contentLines = lines.slice(1);
        const fileName = filePath || firstLine.trim();
        return new CodeContext(fileName, contentLines, true);
      } else {
        // All content is code
        const contentLines = altContent.split('\n');
        const fileName = filePath || 'file';
        return new CodeContext(fileName, contentLines, true);
      }
    }

    const codeContent = codeBlockMatch[1].trim();
    if (!codeContent || codeContent.length < 10) {
      return null;
    }

    // Split code content into lines (array of strings)
    const contentLines = codeContent.split('\n');
    
    // Ensure contentLines is not empty and contains actual content
    if (contentLines.length === 0 || !contentLines.some(line => line.trim().length > 0)) {
      return null;
    }

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
    if (!this.content || this.content.length === 0) {
      return '';
    }
    // Filter out any undefined or null lines
    const validLines = this.content.filter(line => line != null);
    return validLines.join('\n');
  }
}

