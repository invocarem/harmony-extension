// fileManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileReference {
  type: 'file' | 'directory' | 'ambiguous';
  path: string;              // Absolute path
  relativePath: string;      // Relative to workspace root
  content?: string;          // File contents (if file)
  metadata?: {
    size?: number;
    extension?: string;
    lastModified?: Date;
  };
  confidence: 'high' | 'medium' | 'low';  // Confidence in match
  matchType: 'exact' | 'pattern' | 'similar';  // How it was matched
}

export interface WorkspaceFileIndex {
  files: Array<{
    relativePath: string;
    extension: string;
    size: number;
    directory: string;
  }>;
  directories: string[];
  projectStructure: {
    rootFiles: string[];
    commonDirectories: string[];
    fileTypes: Array<[string, number]>;  // extension -> count (stored as array of tuples)
  };
  lastUpdated: Date;
}

export interface FileDetectionResult {
  detectedFiles: FileReference[];
  ambiguousMatches: FileReference[];  // Files that might match but aren't certain
  diagnostics: {
    queryTokens: string[];
    searchPatterns: string[];
    searchResults: Array<{
      pattern: string;
      matches: number;
      files: string[];
    }>;
    processingTime: number;
  };
}

export class FileManager {
  private workspaceRoot: string | undefined;
  private fileCache: Map<string, { content: string; timestamp: number }>;
  private searchCache: Map<string, FileReference[]>;
  private workspaceIndex: WorkspaceFileIndex | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Initialize workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
    
    // Initialize caches
    this.fileCache = new Map();
    this.searchCache = new Map();
  }

  /**
   * Build or refresh workspace file index
   * Creates a catalog of files in the workspace for AI awareness
   */
  async buildWorkspaceIndex(options?: {
    includeHidden?: boolean;
    excludePatterns?: string[];
    maxDepth?: number;
  }): Promise<WorkspaceFileIndex> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace root available');
    }

    const includeHidden = options?.includeHidden ?? false;
    const excludePatterns = options?.excludePatterns ?? [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.build',
      'out',
      'output',
      '.next',
      'target',
      '.cache',
      'coverage',
      '.vscode-test'
    ];

    const files: Array<{
      relativePath: string;
      extension: string;
      size: number;
      directory: string;
    }> = [];
    
    const directories: string[] = [];
    const fileTypes = new Map<string, number>();
    const rootFiles: string[] = [];
    const commonDirectories = new Set<string>();

    const shouldExclude = (relativePath: string): boolean => {
      const normalizedPath = relativePath.replace(/\\/g, '/');
      return excludePatterns.some(pattern => normalizedPath.includes(pattern));
    };

    const collectFiles = async (dirPath: string, relativeDir: string = ''): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (!includeHidden && entry.name.startsWith('.')) {
            continue;
          }

          const fullPath = path.join(dirPath, entry.name);
          const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
          
          if (shouldExclude(relativePath)) {
            continue;
          }

          if (entry.isDirectory()) {
            directories.push(relativePath);
            commonDirectories.add(relativeDir || entry.name);
            await collectFiles(fullPath, relativePath);
          } else if (entry.isFile()) {
            try {
              const stats = await fs.promises.stat(fullPath);
              const ext = path.extname(entry.name) || '(no extension)';
              
              files.push({
                relativePath,
                extension: ext,
                size: stats.size,
                directory: relativeDir || '.'
              });

              fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);

              if (!relativeDir) {
                rootFiles.push(entry.name);
              }
            } catch (error) {
              // Skip files that can't be stat'd
              console.warn(`[FileManager] Failed to stat file: ${fullPath}`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`[FileManager] Failed to read directory: ${dirPath}`, error);
      }
    };

    await collectFiles(this.workspaceRoot);

    // Convert fileTypes Map to array for storage
    const fileTypesArray = Array.from(fileTypes.entries());

    this.workspaceIndex = {
      files,
      directories: Array.from(new Set(directories)),
      projectStructure: {
        rootFiles,
        commonDirectories: Array.from(commonDirectories),
        fileTypes: fileTypesArray
      },
      lastUpdated: new Date()
    };

    return this.workspaceIndex;
  }

  /**
   * Get workspace file index (cached or fresh)
   * Provides overview of files in workspace
   */
  async getWorkspaceIndex(): Promise<WorkspaceFileIndex> {
    // Return cached index if it exists and is recent (less than 5 minutes old)
    if (this.workspaceIndex) {
      const age = Date.now() - this.workspaceIndex.lastUpdated.getTime();
      if (age < this.CACHE_TTL) {
        return this.workspaceIndex;
      }
    }

    // Build fresh index
    return await this.buildWorkspaceIndex();
  }

  /**
   * Get workspace structure summary for AI context
   * Returns formatted string describing project structure
   */
  getWorkspaceStructureSummary(index?: WorkspaceFileIndex): string {
    const idx = index || this.workspaceIndex;
    if (!idx) {
      return 'Workspace structure not available';
    }

    const fileTypesMap = new Map<string, number>(idx.projectStructure.fileTypes);

    const fileTypeSummary = Array.from(fileTypesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ext, count]) => `  - ${ext}: ${count} file(s)`)
      .join('\n');

    const dirSummary = idx.projectStructure.commonDirectories
      .slice(0, 10)
      .map(dir => `  - ${dir || 'root'}`)
      .join('\n');

    const rootFilesSummary = idx.projectStructure.rootFiles
      .slice(0, 10)
      .map(file => `  - ${file}`)
      .join('\n');

    return `Project Structure:
- Total files: ${idx.files.length}
- Total directories: ${idx.directories.length}

File types (top 10):
${fileTypeSummary}

Common directories:
${dirSummary}

Root files:
${rootFilesSummary}`;
  }

  /**
   * Main entry point: Detect and collect files from user query
   * Used at chat stage to proactively gather file information
   */
  async detectAndCollectFiles(
    userQuery: string,
    options?: {
      includeContent?: boolean;
      maxFiles?: number;
      confidenceThreshold?: 'high' | 'medium' | 'low';
      includeWorkspaceContext?: boolean;
    }
  ): Promise<FileDetectionResult> {
    const startTime = Date.now();
    const includeContent = options?.includeContent ?? true;
    const maxFiles = options?.maxFiles ?? 10;
    const confidenceThreshold = options?.confidenceThreshold ?? 'medium';

    // Detect file references in query
    const patterns = this.detectFileReferences(userQuery);
    const queryTokens = userQuery.split(/\s+/).filter(token => token.length > 0);

    // Locate files
    const locatedFiles = await this.locateFiles(patterns, { maxResults: maxFiles * 2 });
    
    // Filter by confidence threshold
    const confidenceLevels = { low: 0, medium: 1, high: 2 };
    const thresholdLevel = confidenceLevels[confidenceThreshold];
    const filteredFiles = locatedFiles.filter(file => {
      const fileLevel = confidenceLevels[file.confidence];
      return fileLevel >= thresholdLevel;
    });

    // Separate high-confidence from ambiguous matches
    const detectedFiles: FileReference[] = [];
    const ambiguousMatches: FileReference[] = [];
    
    for (const file of filteredFiles.slice(0, maxFiles)) {
      if (file.confidence === 'high') {
        detectedFiles.push(file);
      } else {
        ambiguousMatches.push(file);
      }
    }

    // Read file contents if requested
    if (includeContent && detectedFiles.length > 0) {
      await this.readFileContents(detectedFiles);
    }

    // Build search results for diagnostics
    const searchResults = patterns.map(pattern => {
      const matches = locatedFiles.filter(f => 
        f.relativePath.includes(pattern) || f.path.includes(pattern)
      );
      return {
        pattern,
        matches: matches.length,
        files: matches.slice(0, 5).map(f => f.relativePath)
      };
    });

    const processingTime = Date.now() - startTime;

    return {
      detectedFiles,
      ambiguousMatches,
      diagnostics: {
        queryTokens,
        searchPatterns: patterns,
        searchResults,
        processingTime
      }
    };
  }

  /**
   * Detect potential file references in natural language query
   * Returns candidate file names/patterns
   */
  private detectFileReferences(query: string): string[] {
    const patterns: string[] = [];
    
    // Pattern 1: Quoted strings (high confidence)
    const quotedPattern = /["']([^"']+\.[\w.]+)["']/g;
    let match;
    while ((match = quotedPattern.exec(query)) !== null) {
      patterns.push(match[1]);
    }

    // Pattern 2: Tokens with file extensions
    const tokens = query.split(/\s+/);
    const extensionPattern = /\.(?:js|ts|jsx|tsx|py|java|rb|go|rs|cpp|c|h|json|yaml|yml|xml|html|css|md|txt|sh|bash|zsh|ps1|sql|php|swift|kt|scala|dart|r|m|mm|pl|pm|rkt|clj|hs|lua|vim|yaml|toml|ini|cfg|conf|log|csv|tsv|svg|png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|bz2|7z|exe|dll|so|dylib|a|lib|bin|out|class|jar|war|ear|rpm|deb|pkg|dmg|apk|ipa|app|appx|msi|exe)$/i;
    
    for (const token of tokens) {
      // Remove punctuation at start/end
      const cleaned = token.replace(/^[.,;:!?()\[\]{}]+|[.,;:!?()\[\]{}]+$/g, '');
      
      if (extensionPattern.test(cleaned)) {
        patterns.push(cleaned);
      }
    }

    // Pattern 3: Common phrases like "the [filename] file", "[filename] file"
    const phrasePatterns = [
      /(?:the|a|an)\s+([a-zA-Z0-9_.-]+\.[\w.]+)\s+file/gi,
      /([a-zA-Z0-9_.-]+\.[\w.]+)\s+file/gi,
      /file\s+(?:called|named)?\s+([a-zA-Z0-9_.-]+\.[\w.]+)/gi,
      /show\s+me\s+(?:the\s+)?([a-zA-Z0-9_.-]+\.[\w.]+)/gi,
      /read\s+(?:the\s+)?([a-zA-Z0-9_.-]+\.[\w.]+)/gi,
      /look\s+at\s+(?:the\s+)?([a-zA-Z0-9_.-]+\.[\w.]+)/gi
    ];

    for (const pattern of phrasePatterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        patterns.push(match[1]);
      }
    }

    // Pattern 4: Simple filename patterns (medium confidence)
    const simpleFilenamePattern = /\b([a-zA-Z0-9_.-]{2,}\.[\w]{1,10})\b/g;
    while ((match = simpleFilenamePattern.exec(query)) !== null) {
      // Skip if already captured
      if (!patterns.includes(match[1])) {
        patterns.push(match[1]);
      }
    }

    // Remove duplicates and empty patterns
    return Array.from(new Set(patterns.filter(p => p.length > 0)));
  }

  /**
   * Locate files in workspace matching the detected references
   */
  private async locateFiles(
    patterns: string[],
    options?: { maxResults?: number }
  ): Promise<FileReference[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    const maxResults = options?.maxResults ?? 20;
    const results: FileReference[] = [];

    // Get or build workspace index
    const index = await this.getWorkspaceIndex();

    for (const pattern of patterns) {
      // Check cache first
      const cacheKey = `pattern:${pattern}`;
      if (this.searchCache.has(cacheKey)) {
        results.push(...this.searchCache.get(cacheKey)!);
        continue;
      }

      const matches: FileReference[] = [];
      const patternLower = pattern.toLowerCase();
      const exactMatch = pattern;

      // Search in index
      for (const file of index.files) {
        const filename = path.basename(file.relativePath).toLowerCase();
        const relativePathLower = file.relativePath.toLowerCase();

        let confidence: 'high' | 'medium' | 'low' = 'low';
        let matchType: 'exact' | 'pattern' | 'similar' = 'pattern';

        // Exact filename match (high confidence)
        if (filename === patternLower || filename === exactMatch) {
          confidence = 'high';
          matchType = 'exact';
        }
        // Exact relative path match (high confidence)
        else if (relativePathLower === patternLower || relativePathLower === exactMatch) {
          confidence = 'high';
          matchType = 'exact';
        }
        // Filename contains pattern (medium confidence)
        else if (filename.includes(patternLower)) {
          confidence = 'medium';
          matchType = 'pattern';
        }
        // Path contains pattern (low confidence)
        else if (relativePathLower.includes(patternLower)) {
          confidence = 'low';
          matchType = 'pattern';
        } else {
          continue;
        }

        try {
          const absolutePath = path.resolve(this.workspaceRoot, file.relativePath);
          const stats = await fs.promises.stat(absolutePath);
          
          matches.push({
            type: 'file',
            path: absolutePath,
            relativePath: file.relativePath,
            metadata: {
              size: file.size,
              extension: file.extension,
              lastModified: stats.mtime
            },
            confidence,
            matchType
          });
        } catch (error) {
          // Skip files that can't be accessed
          console.warn(`[FileManager] Failed to access file: ${file.relativePath}`, error);
        }
      }

      // Sort by confidence (high first), then by match type (exact first)
      matches.sort((a, b) => {
        const confidenceOrder = { high: 0, medium: 1, low: 2 };
        const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        if (confDiff !== 0) return confDiff;
        
        const matchOrder = { exact: 0, pattern: 1, similar: 2 };
        return matchOrder[a.matchType] - matchOrder[b.matchType];
      });

      // Cache results
      this.searchCache.set(cacheKey, matches);

      results.push(...matches);
    }

    // Remove duplicates and limit results
    const uniqueResults = Array.from(
      new Map(results.map(r => [r.path, r])).values()
    ).slice(0, maxResults);

    return uniqueResults;
  }

  /**
   * Read file contents if requested
   */
  private async readFileContents(files: FileReference[]): Promise<FileReference[]> {
    for (const file of files) {
      if (file.type !== 'file' || file.content !== undefined) {
        continue;
      }

      // Check cache
      const cacheKey = file.path;
      const cached = this.fileCache.get(cacheKey);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < this.CACHE_TTL) {
          file.content = cached.content;
          continue;
        }
      }

      try {
        // Limit file size to 1MB to avoid memory issues
        const stats = await fs.promises.stat(file.path);
        if (stats.size > 1024 * 1024) {
          console.warn(`[FileManager] File too large to read: ${file.relativePath} (${stats.size} bytes)`);
          continue;
        }

        const content = await fs.promises.readFile(file.path, 'utf-8');
        file.content = content;

        // Cache content
        this.fileCache.set(cacheKey, {
          content,
          timestamp: Date.now()
        });
      } catch (error) {
        console.warn(`[FileManager] Failed to read file: ${file.relativePath}`, error);
      }
    }

    return files;
  }

  /**
   * Format file references for prompt inclusion
   * Similar to FileContextExtractor.formatFileContexts but tailored for chat stage
   */
  formatForChatPrompt(
    result: FileDetectionResult,
    includeDiagnostics?: boolean
  ): string {
    if (result.detectedFiles.length === 0 && result.ambiguousMatches.length === 0) {
      return '';
    }

    let formatted = '\n\n' + '='.repeat(80) + '\n';
    formatted += '📁 FILE CONTEXT DETECTED\n';
    formatted += '='.repeat(80) + '\n\n';

    // Add detected files
    if (result.detectedFiles.length > 0) {
      result.detectedFiles.forEach((file, index) => {
        formatted += `## File ${index + 1}: ${file.relativePath}\n`;
        formatted += `Type: ${file.type} | Confidence: ${file.confidence} | Match: ${file.matchType}\n`;
        
        if (file.metadata) {
          if (file.metadata.size !== undefined) {
            formatted += `Size: ${this.formatSize(file.metadata.size)}\n`;
          }
          if (file.metadata.extension) {
            formatted += `Extension: ${file.metadata.extension}\n`;
          }
        }

        if (file.content) {
          formatted += '\n```\n';
          
          // Truncate very large files
          const maxLength = 20000;
          if (file.content.length > maxLength) {
            formatted += file.content.substring(0, maxLength);
            formatted += `\n\n... [Content truncated. Full file is ${file.content.length} characters.] ...`;
          } else {
            formatted += file.content;
          }
          
          formatted += '\n```\n';
        }
        
        formatted += '\n' + '-'.repeat(60) + '\n\n';
      });
    }

    // Add ambiguous matches if any
    if (result.ambiguousMatches.length > 0) {
      formatted += '## Ambiguous Matches (multiple files found):\n\n';
      result.ambiguousMatches.forEach(file => {
        formatted += `- ${file.relativePath} (confidence: ${file.confidence})\n`;
      });
      formatted += '\nPlease clarify which file you\'re referring to.\n\n';
      formatted += '-'.repeat(60) + '\n\n';
    }

    formatted += '='.repeat(80) + '\n';
    formatted += 'END OF FILE CONTEXT\n';
    formatted += '='.repeat(80) + '\n';

    // Add diagnostics if requested
    if (includeDiagnostics) {
      formatted += '\n\n## Diagnostics\n';
      formatted += `Processing time: ${result.diagnostics.processingTime}ms\n`;
      formatted += `Query tokens: ${result.diagnostics.queryTokens.join(', ')}\n`;
      formatted += `Search patterns: ${result.diagnostics.searchPatterns.join(', ')}\n`;
      formatted += `Search results:\n`;
      result.diagnostics.searchResults.forEach(result => {
        formatted += `  - Pattern "${result.pattern}": ${result.matches} match(es)\n`;
      });
    }

    return formatted;
  }

  /**
   * Generate problem restatement with file context
   * Helps AI re-state the problem mentioning relevant files
   */
  generateProblemRestatement(
    originalQuery: string,
    detectedFiles: FileReference[]
  ): string {
    if (detectedFiles.length === 0) {
      return `You're asking: ${originalQuery}`;
    }

    const fileNames = detectedFiles.map(f => f.relativePath).join(', ');
    
    if (detectedFiles.length === 1) {
      return `You're asking about the file "${fileNames}". ${originalQuery}`;
    } else {
      return `You're asking about the following files: ${fileNames}. ${originalQuery}`;
    }
  }

  /**
   * Get files relevant to query for cross-stage context
   * Returns file references that should be available in next stages
   */
  getFilesForNextStage(
    detectedFiles: FileReference[],
    workspaceIndex?: WorkspaceFileIndex
  ): FileReference[] {
    // Return high-confidence detected files
    return detectedFiles.filter(file => file.confidence === 'high');
  }

  /**
   * Format file size in human-readable format
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

