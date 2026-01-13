/**
 * Chat stage state management
 * Tracks queries, files, and provides aggregation for stage transitions
 */

import * as vscode from 'vscode';
import { FileReference } from '../utils/fileContextExtractor';
import { FileExtractionResult } from '../utils/verboseInfo';

/**
 * Represents a user query in the chat stage
 */
export interface ChatQuery {
  query: string;
  timestamp: number;
  relatedFiles: string[];  // File paths detected/mentioned for this query
}

/**
 * Chat stage state
 */
export interface ChatState {
  problemSummary?: string;           // Restated problem summary (from assistant)
  queries: ChatQuery[];              // All user queries in chat stage
  referredFiles: Array<{ file: string; description?: string }>;  // Files referred to/mentioned across all queries
  lastUpdated: number;
}

/**
 * Manages chat stage state and operations
 * 
 * Responsibilities:
 * - Track all user queries in chat stage
 * - Store problem summaries/restatements
 * - Track files related to queries
 * - Aggregate queries for stage transitions
 */
export class ChatManager {
  private state: ChatState | null = null;

  /**
   * Initialize chat state (called when entering chat stage)
   */
  initialize(): void {
    this.state = {
      queries: [],
      referredFiles: [],
      lastUpdated: Date.now(),
    };
    console.log(`[ChatManager] Initialized chat state`);
  }

  /**
   * Extract and normalize file paths from file contexts and extraction results
   * Converts absolute paths to relative paths and deduplicates
   */
  extractRelatedFiles(
    fileContexts: FileReference[],
    fileExtractionResult?: FileExtractionResult
  ): string[] {
    const allFiles: string[] = [];
    
    // Add explicit file contexts (normalize to relative paths)
    fileContexts.forEach(fc => {
      try {
        const relativePath = vscode.workspace.asRelativePath(fc.path, false);
        if (!allFiles.includes(relativePath)) {
          allFiles.push(relativePath);
        }
      } catch {
        // If asRelativePath fails, use the original path
        if (!allFiles.includes(fc.path)) {
          allFiles.push(fc.path);
        }
      }
    });
    
    // Add detected files (normalize to relative paths)
    if (fileExtractionResult) {
      if (fileExtractionResult.explicitFiles) {
        fileExtractionResult.explicitFiles.forEach(f => {
          try {
            const relativePath = vscode.workspace.asRelativePath(f.path, false);
            if (!allFiles.includes(relativePath)) {
              allFiles.push(relativePath);
            }
          } catch {
            // If asRelativePath fails, use the original path
            if (!allFiles.includes(f.path)) {
              allFiles.push(f.path);
            }
          }
        });
      }
      if (fileExtractionResult.detectedFiles) {
        fileExtractionResult.detectedFiles.forEach(f => {
          try {
            const relativePath = vscode.workspace.asRelativePath(f.path, false);
            if (!allFiles.includes(relativePath)) {
              allFiles.push(relativePath);
            }
          } catch {
            // If asRelativePath fails, use the original path
            if (!allFiles.includes(f.path)) {
              allFiles.push(f.path);
            }
          }
        });
      }
    }
    
    return allFiles;
  }

  /**
   * Add a user query to chat state with file extraction
   */
  addQueryWithFiles(
    query: string,
    fileContexts: FileReference[],
    fileExtractionResult?: FileExtractionResult
  ): void {
    const relatedFiles = this.extractRelatedFiles(fileContexts, fileExtractionResult);
    this.addQuery(query, relatedFiles);
  }

  /**
   * Add a user query to chat state
   */
  addQuery(query: string, relatedFiles: string[] = []): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    const chatQuery: ChatQuery = {
      query: query.trim(),
      timestamp: Date.now(),
      relatedFiles: [...relatedFiles],
    };

    this.state.queries.push(chatQuery);
    
    // Update referred files array (deduplicate by file path)
    relatedFiles.forEach(file => {
      if (!this.state!.referredFiles.some(rf => rf.file === file)) {
        this.state!.referredFiles.push({ file });
      }
    });
    
    this.state.lastUpdated = Date.now();
    console.log(`[ChatManager] Added query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}" with ${relatedFiles.length} file(s)`);
  }

  /**
   * Update the problem summary (restatement from assistant)
   */
  updateProblemSummary(summary: string): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    this.state.problemSummary = summary.trim();
    this.state.lastUpdated = Date.now();
    console.log(`[ChatManager] Updated problem summary: "${summary.substring(0, 100)}${summary.length > 100 ? '...' : ''}"`);
  }

  /**
   * Update problem summary from response content, intelligently handling system warnings
   * If response is a system warning message, extracts intent from user query instead
   */
  updateProblemSummaryFromResponse(responseContent: string, userQuery: string): void {
    if (!responseContent || !responseContent.trim()) {
      return;
    }

    // Check if response is a system warning message
    const isSystemWarning = this.isSystemWarningMessage(responseContent);
    
    if (isSystemWarning) {
      // Extract problem summary from user query instead of using the warning
      const intent = this.extractIntentFromUserQuery(userQuery);
      if (intent) {
        this.updateProblemSummary(intent);
        console.log(`[ChatManager] Updated problem summary from user query (warning response detected)`);
      }
      return;
    }

    // Extract first paragraph from response (potential restatement)
    const summaryMatch = responseContent.match(/^(.*?)(?:\n\n|$)/);
    if (summaryMatch) {
      const potentialSummary = summaryMatch[1].trim();
      
      // Check if it's a valid restatement (not a generic system message)
      if (this.isValidRestatement(potentialSummary, userQuery)) {
        this.updateProblemSummary(potentialSummary);
        console.log(`[ChatManager] Updated problem summary from response`);
      } else {
        // Fallback to extracting from user query if response doesn't contain valid restatement
        const intent = this.extractIntentFromUserQuery(userQuery);
        if (intent) {
          this.updateProblemSummary(intent);
          console.log(`[ChatManager] Updated problem summary from user query (no valid restatement in response)`);
        }
      }
    }
  }

  /**
   * Check if content is a system warning message
   */
  private isSystemWarningMessage(content: string): boolean {
    const lowerContent = content.toLowerCase().trim();
    
    // Check for system warning patterns
    return lowerContent.startsWith('i understand you want to create files') ||
           lowerContent.includes('⚠️ **note**: file modification tools') ||
           (lowerContent.includes('file modification tools') && 
            (lowerContent.includes('not available') || lowerContent.includes('are not available')));
  }

  /**
   * Check if a potential summary is a valid restatement
   */
  private isValidRestatement(potentialSummary: string, userQuery: string): boolean {
    if (!potentialSummary || potentialSummary.length < 20) {
      return false;
    }

    const lowerSummary = potentialSummary.toLowerCase();
    
    // Exclude generic system messages
    if (lowerSummary === 'i understand you want to create files' ||
        lowerSummary.startsWith('⚠️')) {
      return false;
    }

    // Check if it looks like a restatement (contains user's words or common restatement patterns)
    const hasRestatementPattern = lowerSummary.includes('you want') ||
                                  lowerSummary.includes("you're asking") ||
                                  lowerSummary.includes('you need') ||
                                  lowerSummary.includes('i can see') ||
                                  lowerSummary.includes('i understand') ||
                                  lowerSummary.includes('the issue is') ||
                                  lowerSummary.includes('the problem is');

    // Check if it contains words from user query (meaningful words only)
    const userWords = userQuery.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3 && !/^(the|and|or|but|with|from|that|this)$/i.test(word));
    
    const containsUserWords = userWords.some(word => 
      lowerSummary.includes(word)
    );

    return hasRestatementPattern || containsUserWords;
  }

  /**
   * Extract problem intent from user query
   */
  private extractIntentFromUserQuery(userQuery: string): string | null {
    if (!userQuery || userQuery.trim().length < 10) {
      return null;
    }

    const message = userQuery.trim();
    const lowerMessage = message.toLowerCase();

    // Extract meaningful intent patterns
    const intentPatterns = [
      // Bug fixes
      /(?:fix|fixing|fixed|resolve|resolving|correct|correcting)\s+(?:a\s+)?(?:bug|error|issue|problem|indentation\s+(?:error|bug|issue)|syntax\s+(?:error|issue))/i,
      // Code changes
      /(?:change|modify|update|edit|add|remove|improve|refactor)\s+.+/i,
      // Specific error mentions
      /(?:indentation|syntax|runtime|compile|type)\s+error/i,
      // File-specific issues
      /(?:in|for|of)\s+[\w\-\.]+\s+(?:has|with|there\s+is)\s+(?:a\s+)?(?:bug|error|issue|problem)/i,
    ];

    for (const pattern of intentPatterns) {
      const match = message.match(pattern);
      if (match) {
        // Try to extract a meaningful sentence or phrase
        const matchText = match[0];
        
        // If it's a short phrase, try to get more context
        if (matchText.length < 30) {
          // Look for the sentence containing the match
          const sentenceMatch = message.match(new RegExp(`[^.!?]*(?:${matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[^.!?]*[.!?]?`, 'i'));
          if (sentenceMatch && sentenceMatch[0].trim().length > 10) {
            return sentenceMatch[0].trim();
          }
        }
        
        return matchText.trim();
      }
    }

    // Fallback: if message mentions specific file or has code context, use a simplified version
    const fileMatch = message.match(/@file:([\w\-\.]+)/i) || message.match(/(?:file|in)\s+([\w\-\.]+)/i);
    if (fileMatch || lowerMessage.includes('indentation') || lowerMessage.includes('bug') || 
        lowerMessage.includes('error') || lowerMessage.includes('issue')) {
      // Create a simple summary from key words
      const keyWords: string[] = [];
      const hasFix = lowerMessage.includes('fix');
      
      if (lowerMessage.includes('bug')) {
        keyWords.push('bug');
      } else if (lowerMessage.includes('error')) {
        keyWords.push('error');
      } else if (lowerMessage.includes('issue')) {
        keyWords.push('issue');
      }
      
      if (lowerMessage.includes('indentation')) {
        keyWords.push('indentation issue');
      } else if (lowerMessage.includes('syntax')) {
        keyWords.push('syntax error');
      }
      
      if (fileMatch) {
        keyWords.push(`in ${fileMatch[1]}`);
      }
      
      if (keyWords.length > 0) {
        const prefix = hasFix ? 'Fix ' : '';
        return `${prefix}${keyWords.join(', ')}`;
      }
    }

    // Last resort: use first meaningful sentence (skip very short messages)
    if (message.length > 50) {
      const firstSentence = message.match(/^[^.!?]+[.!?]?/);
      if (firstSentence && firstSentence[0].trim().length > 20) {
        return firstSentence[0].trim();
      }
    }

    // If message is reasonably descriptive, use it as-is (but clean it up)
    if (message.length > 30 && message.length < 200) {
      // Remove @file: references for cleaner summary
      return message.replace(/@file:\s*/gi, '').trim();
    }

    return null;
  }

  /**
   * Link files to a specific query (by index or last query)
   */
  linkFilesToQuery(files: string[], queryIndex?: number): void {
    if (!this.state || this.state.queries.length === 0) return;

    const index = queryIndex !== undefined 
      ? queryIndex 
      : this.state.queries.length - 1;

    if (index >= 0 && index < this.state.queries.length) {
      const query = this.state.queries[index];
      files.forEach(file => {
        if (!query.relatedFiles.includes(file)) {
          query.relatedFiles.push(file);
        }
        // Update referred files array (deduplicate by file path)
        if (!this.state!.referredFiles.some(rf => rf.file === file)) {
          this.state!.referredFiles.push({ file });
        }
      });
      this.state.lastUpdated = Date.now();
      console.log(`[ChatManager] Linked ${files.length} file(s) to query at index ${index}`);
    }
  }

  /**
   * Get all meaningful queries (filter out greetings)
   */
  getMeaningfulQueries(): string[] {
    if (!this.state) return [];

    return this.state.queries
      .filter(q => {
        const trimmed = q.query.toLowerCase().trim();
        // Filter out simple greetings
        return !(trimmed.length < 10 && /^(hi|hello|hey|thanks?|ok|okay)$/i.test(trimmed));
      })
      .map(q => q.query);
  }

  /**
   * Get all queries (for aggregation)
   */
  getAllQueries(): string[] {
    if (!this.state) return [];
    return this.state.queries.map(q => q.query);
  }

  /**
   * Get aggregated prompt for stage transition
   * Combines all queries into a single prompt
   */
  getAggregatedPrompt(): string {
    const queries = this.getMeaningfulQueries();
    
    if (queries.length === 0) {
      return '';
    }

    if (queries.length === 1) {
      return queries[0];
    }

    // Aggregate multiple queries
    return `Please address the following requests:\n\n${queries.join('\n\n')}`;
  }

  /**
   * Get all referred files
   */
  getReferredFiles(): Array<{ file: string; description?: string }> {
    if (!this.state) return [];
    return [...this.state.referredFiles];
  }

  /**
   * Get all related files (for backward compatibility)
   * @deprecated Use getReferredFiles() instead
   */
  getAllRelatedFiles(): string[] {
    if (!this.state) return [];
    return this.state.referredFiles.map(rf => rf.file);
  }

  /**
   * Get problem summary
   */
  getProblemSummary(): string | undefined {
    return this.state?.problemSummary;
  }

  /**
   * Get full chat state (for debugging/inspection)
   */
  getState(): ChatState | null {
    if (!this.state) return null;
    return {
      ...this.state,
      referredFiles: [...this.state.referredFiles], // Copy the array
    };
  }

  /**
   * Clear chat state (when transitioning out of chat stage or starting new conversation)
   */
  clear(): void {
    this.state = null;
    console.log(`[ChatManager] Cleared chat state`);
  }

  /**
   * Export chat state for transition to assumptions stage
   */
  exportForTransition(): {
    queries: string[];
    aggregatedPrompt: string;
    problemSummary?: string;
    referredFiles: Array<{ file: string; description?: string }>;
  } {
    if (!this.state) {
      return {
        queries: [],
        aggregatedPrompt: '',
        referredFiles: [],
      };
    }

    return {
      queries: this.getMeaningfulQueries(),
      aggregatedPrompt: this.getAggregatedPrompt(),
      problemSummary: this.state.problemSummary,
      referredFiles: this.getReferredFiles(),
    };
  }

  /**
   * Check if chat state has meaningful content
   */
  hasContent(): boolean {
    return this.state !== null && this.state.queries.length > 0;
  }
}

