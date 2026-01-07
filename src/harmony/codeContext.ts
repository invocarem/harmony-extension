/**
 * Represents a code snippet that's ready for file creation
 */
export class CodeContext {
  private _contentString?: string;  // Cached string representation of content

  constructor(
    public name: string,  // File name or identifier
    public content: string[],  // The code content itself (array of lines/strings)
    public waitForCreate: boolean = true,  // Flag indicating waiting for file creation
    public version: string = 'v1',  // Version tag (e.g., "v1", "v2")
    public timestamp: number = Date.now(),  // Creation timestamp
    public description?: string,  // Description of change/reason (e.g., "generate json based on whitaker and the rule", "add field xxx")
    public previousVersion?: string,  // Reference to previous version
    public isActive: boolean = true  // Whether this is the active version
  ) {}

  /**
   * Create a CodeContext from a code block with file path
   * Optionally parses version tags from code block header (e.g., ```typescript file.ts v2)
   */
  static fromCodeBlock(codeBlock: string, filePath?: string): CodeContext | null {
    // Extract code content from markdown code block
    // Pattern: ```language optional_file_path optional_version\ncode``` or ```language\ncode```
    // Version can be: v1, v2, v1.0, etc. or @v1, @v2
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
      // Check if first line looks like a file path (possibly with version)
      const firstLine = altContent.split('\n')[0];
      let fileName = filePath;
      let version: string | undefined;
      
      // Helper function to validate if a string looks like a valid filename
      const isValidFileName = (name: string): boolean => {
        if (!name || name.trim().length === 0) return false;
        const trimmed = name.trim();
        // Must have a file extension (at least 2 chars after dot)
        if (!/\.\w{2,4}$/.test(trimmed)) return false;
      // Must not be just common words like "File", "file", "Code", etc.
      const baseName = trimmed.split(/[\/\.]/)[0]; // Get first part before any path separators or dots
      const commonWords = /^(file|File|code|Code|script|Script|text|Text|data|Data)$/i;
      if (commonWords.test(baseName)) return false;
        // Must look like a valid file path (alphanumeric, dots, slashes, hyphens, underscores)
        return /^[\w\/\.\-]+\.\w{2,4}$/.test(trimmed);
      };
      
      // Check for version tag in first line: file.ts v2 or file.ts@v2
      const versionMatch = firstLine.match(/\s+(v\d+(?:\.\d+)?|@v\d+(?:\.\d+)?)$/i) ||
                          firstLine.match(/@(v\d+(?:\.\d+)?)$/i);
      if (versionMatch) {
        version = versionMatch[1].replace('@', '');
        const firstLineWithoutVersion = firstLine.replace(/\s+(v\d+(?:\.\d+)?|@v\d+(?:\.\d+)?)$/i, '').trim();
        if (isValidFileName(firstLineWithoutVersion) && altContent.split('\n').length > 1) {
          // First line is file path with version, rest is code
          const lines = altContent.split('\n');
          const contentLines = lines.slice(1);
          fileName = fileName || firstLineWithoutVersion;
          return new CodeContext(fileName, contentLines, true, version || 'v1');
        }
      } else if (isValidFileName(firstLine.trim()) && altContent.split('\n').length > 1) {
        // First line is file path without version, rest is code
        const lines = altContent.split('\n');
        const contentLines = lines.slice(1);
        fileName = fileName || firstLine.trim();
        return new CodeContext(fileName, contentLines, true);
      } else {
        // All content is code
        const contentLines = altContent.split('\n');
        // Default to 'file.txt' instead of 'file' to ensure it has an extension
        fileName = fileName || 'file.txt';
        return new CodeContext(fileName, contentLines, true);
      }
    }

    // At this point, codeBlockMatch is guaranteed to be non-null (checked above)
    if (!codeBlockMatch) {
      return null;
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

    // Extract file path and version from code block header
    let fileName = filePath;
    let version: string | undefined;
    
    // Helper function to validate if a string looks like a valid filename
    const isValidFileName = (name: string): boolean => {
      if (!name || name.trim().length === 0) return false;
      const trimmed = name.trim();
      // Must have a file extension (at least 2 chars after the last dot)
      if (!/\.\w{2,4}$/.test(trimmed)) return false;
      // Must not be just common words like "File", "file", "Code", etc.
      const baseName = trimmed.split(/[\/\.]/)[0]; // Get first part before any path separators or dots
      const commonWords = /^(file|File|code|Code|script|Script|text|Text|data|Data)$/i;
      if (commonWords.test(baseName)) return false;
      // Must look like a valid file path (alphanumeric, dots, slashes, hyphens, underscores)
      // Allow multiple dots (e.g., hello.test.py, config.json.backup)
      return /^[\w\/\.\-]+\.\w{2,4}$/.test(trimmed);
    };
    
    // Try to extract from code block header: ```language file_path v2 or ```language file_path@v2
    const headerMatch = codeBlock.match(/```(?:\w+)?\s+([^\n]+)/);
    if (headerMatch) {
      const headerContent = headerMatch[1].trim();
      // Check for version tag: v1, v2, v1.0, @v1, @v2, etc.
      const versionMatch = headerContent.match(/\s+(v\d+(?:\.\d+)?|@v\d+(?:\.\d+)?)$/i) ||
                          headerContent.match(/@(v\d+(?:\.\d+)?)$/i);
      if (versionMatch) {
        version = versionMatch[1].replace('@', ''); // Remove @ if present
        // Remove version from header to get file path
        const headerWithoutVersion = headerContent.replace(/\s+(v\d+(?:\.\d+)?|@v\d+(?:\.\d+)?)$/i, '').trim();
        if (headerWithoutVersion && isValidFileName(headerWithoutVersion) && !fileName) {
          fileName = headerWithoutVersion;
        }
      } else if (!fileName) {
        // No version tag, use entire header as file path if it looks like a valid filename
        if (isValidFileName(headerContent)) {
          fileName = headerContent;
        }
      }
    }
    
    if (!fileName) {
      // Try to extract from surrounding context
      const matchIndex = codeBlockMatch.index ?? 0;
      const beforeMatch = codeBlock.substring(0, matchIndex);
      const filePathMatch = 
        beforeMatch.match(/(?:file|filename|path)[:\s]+`?([^\s`]+\.\w{2,4})`?/i) ||
        beforeMatch.match(/\*\*(?:file|filename|path)\*\*[:\s]+`([^`]+\.\w{2,4})`/i) ||
        beforeMatch.match(/\*\*([^*]+\.\w{2,4})\*\*/i) ||
        beforeMatch.match(/`([^`]+\.\w{2,4})`/i);
      
      // Also check if file path is mentioned in the code block itself
      // Support formats like: "# File path: hello.py", "# file path: hello.py", "# File: hello.py", "# hello.py", "// file path: hello.py"
      // Try matching at the start of any line (not just the first line), in case there's leading whitespace
      const codeBlockWithPath = codeContent.match(/^#\s*(?:file\s+path|file|path)[:\s]+([^\n]+\.\w{2,4})/im) ||
                                codeContent.match(/^\/\/\s*(?:file\s+path|file|path)[:\s]+([^\n]+\.\w{2,4})/im) ||
                                // Match simple "# filename.ext" pattern (must be first or second line, to avoid false matches)
                                codeContent.match(/^(?:[^\n]*\n)?#\s+([a-zA-Z][\w\.-]*\.\w{2,4})\s*(?:\n|$)/im);
      
      const extractedName = filePathMatch?.[1] || codeBlockWithPath?.[1];
      // Only use extracted name if it's valid (trim whitespace first)
      if (extractedName) {
        const trimmedName = extractedName.trim();
        if (isValidFileName(trimmedName)) {
          fileName = trimmedName;
        }
      }
    }

    // If still no file name, use a default with extension
    // This ensures the file has a valid extension and won't be just "file"
    if (!fileName) {
      fileName = 'file.txt';
    }

    // Create CodeContext with optional version (defaults to v1 if not specified)
    return new CodeContext(fileName, contentLines, true, version || 'v1');
  }

  /**
   * Check if this code context is ready for creation
   */
  isReady(): boolean {
    return this.waitForCreate && this.content.length > 0 && this.content.some(line => line.trim().length > 0);
  }

  /**
   * Get the content as a single string (joined with newlines)
   * Uses cached string if available, otherwise computes and caches it
   */
  getContentAsString(): string {
    if (!this.content || this.content.length === 0) {
      this._contentString = '';
      return '';
    }
    
    // Return cached string if available
    if (this._contentString !== undefined) {
      return this._contentString;
    }
    
    // Filter out any undefined or null lines and join
    const validLines = this.content.filter(line => line != null);
    this._contentString = validLines.join('\n');
    return this._contentString;
  }

  /**
   * Invalidate the cached string representation
   * Call this when content array is modified directly
   */
  invalidateCache(): void {
    this._contentString = undefined;
  }
}

