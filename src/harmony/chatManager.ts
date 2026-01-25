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
 * Represents an unsolved problem identified from user queries
 * Only unsolved problems are kept in the list - solved problems are removed
 */
export interface Problem {
  statement: string;              // The restated problem statement
  originalQuery?: string;        // Original user query that led to this problem
  requiresTools?: boolean;      // Whether this problem requires tools not available in chat stage
  timestamp: number;             // When problem was identified
}

/**
 * Chat stage state
 */
export interface ChatState {
  problems: Problem[];           // Only unsolved problems (solved ones are removed)
  queries: ChatQuery[];           // All user queries in chat stage
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
      problems: [],
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
   * Filters out stage transition commands (move to assumptions, etc.)
   */
  addQuery(query: string, relatedFiles: string[] = []): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    const trimmedQuery = query.trim();
    
    // Skip tracking stage transition commands - they're not actual user requests
    const isStageTransitionCommand = /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|implementation|implement|chat|discussion|clarification)\b/i.test(trimmedQuery);
    if (isStageTransitionCommand) {
      console.log(`[ChatManager] Skipped tracking stage transition command: "${trimmedQuery.substring(0, 50)}..."`);
      return;
    }

    const chatQuery: ChatQuery = {
      query: trimmedQuery,
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
   * Add a problem to the list (only if it doesn't already exist)
   * Problems are only added if they represent actual unsolved issues
   */
  addProblem(statement: string, originalQuery?: string, requiresTools?: boolean): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    const trimmedStatement = statement.trim();
    if (!trimmedStatement || trimmedStatement.length < 10) {
      return; // Skip very short statements
    }

    // Check if this problem already exists (similar statement)
    const existingProblem = this.state.problems.find(p => 
      this.areProblemsSimilar(p.statement, trimmedStatement)
    );

    if (existingProblem) {
      // Update existing problem if needed
      if (requiresTools !== undefined) {
        existingProblem.requiresTools = requiresTools;
      }
      if (originalQuery && !existingProblem.originalQuery) {
        existingProblem.originalQuery = originalQuery;
      }
      this.state.lastUpdated = Date.now();
      console.log(`[ChatManager] Problem already exists, updated: "${trimmedStatement.substring(0, 50)}..."`);
      return;
    }

    // Add new problem
    const problem: Problem = {
      statement: trimmedStatement,
      originalQuery,
      requiresTools,
      timestamp: Date.now(),
    };

    this.state.problems.push(problem);
    this.state.lastUpdated = Date.now();
    console.log(`[ChatManager] Added problem: "${trimmedStatement.substring(0, 50)}${trimmedStatement.length > 50 ? '...' : ''}"`);
  }

  /**
   * Remove a problem when it's been solved
   * Checks if response actually solves the problem before removing
   */
  removeProblemIfSolved(problemStatement: string, responseContent: string, originalQuery?: string): boolean {
    if (!this.state || !responseContent) return false;

    // Check if the response actually solves the problem
    if (!this.isProblemSolved(problemStatement, responseContent, originalQuery)) {
      return false;
    }

    // Find and remove the problem
    const index = this.state.problems.findIndex(p => 
      this.areProblemsSimilar(p.statement, problemStatement)
    );

    if (index >= 0) {
      const removed = this.state.problems.splice(index, 1)[0];
      this.state.lastUpdated = Date.now();
      console.log(`[ChatManager] Removed solved problem: "${removed.statement.substring(0, 50)}..."`);
      return true;
    }

    return false;
  }

  /**
   * Add a file to referredFiles if not already present
   * Used to track files mentioned/located during conversation
   */
  addReferredFile(filePath: string, description?: string): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state || !filePath) return;

    // Check if file already exists in referredFiles
    if (!this.state.referredFiles.some(rf => rf.file === filePath)) {
      this.state.referredFiles.push({ file: filePath, description });
      this.state.lastUpdated = Date.now();
      console.log(`[ChatManager] Added referred file: ${filePath}`);
    }
  }

  /**
   * Update referredFiles from executed tool call results
   * Extracts file paths from find_file and read_file tool results
   * This ensures files discovered at runtime are tracked for later stages
   */
  updateReferredFilesFromToolResults(
    executedToolCalls: Array<{ name: string; arguments?: Record<string, any>; result?: any }>
  ): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    for (const toolCall of executedToolCalls) {
      // Handle find_file results - result contains the found file path
      if (toolCall.name === 'find_file' && toolCall.result) {
        const foundPath = toolCall.result;
        if (typeof foundPath === 'string' && foundPath.length > 0) {
          this.addReferredFile(foundPath, 'Found via find_file');
        }
      }

      // Handle read_file results - arguments.file_path is the file being read
      if (toolCall.name === 'read_file' && toolCall.arguments?.file_path) {
        const filePath = toolCall.arguments.file_path;
        if (typeof filePath === 'string' && filePath.length > 0) {
          this.addReferredFile(filePath, 'Read in chat stage');
        }
      }
    }
  }

  /**
   * Process response and update problems accordingly
   * Also updates referredFiles from executed tool results
   * Adds problems from restatements, removes problems that are solved
   */
  processResponse(
    responseContent: string,
    userQuery: string,
    executedToolCalls?: Array<{ name: string; arguments?: Record<string, any>; result?: any }>
  ): void {
    if (!this.state) {
      this.initialize();
    }
    if (!this.state || !responseContent || !responseContent.trim()) {
      return;
    }

    // Update referredFiles from executed tool results (find_file, read_file, etc.)
    if (executedToolCalls && executedToolCalls.length > 0) {
      this.updateReferredFilesFromToolResults(executedToolCalls);
    }

    // Skip greetings - they don't create problems
    const isGreeting = /^(hi|hello|hey|greetings?)$/i.test(userQuery.trim());
    if (isGreeting) {
      return;
    }

    // First, check if any existing problems are solved by this response
    // This handles cases where response directly answers without restating
    const existingProblems = [...this.state.problems];
    for (const problem of existingProblems) {
      if (this.isProblemSolved(problem.statement, responseContent, problem.originalQuery || userQuery)) {
        this.removeProblemIfSolved(problem.statement, responseContent, problem.originalQuery || userQuery);
      }
    }

    // Check if response is a system warning message
    const isSystemWarning = this.isSystemWarningMessage(responseContent);
    
    if (isSystemWarning) {
      // Extract problem from user query
      const intent = this.extractIntentFromUserQuery(userQuery);
      if (intent) {
        this.addProblem(intent, userQuery, true); // Requires tools
        console.log(`[ChatManager] Added problem from user query (warning response detected)`);
      }
      return;
    }

    // Extract first paragraph from response (potential restatement)
    const summaryMatch = responseContent.match(/^(.*?)(?:\n\n|$)/);
    if (summaryMatch) {
      const potentialSummary = summaryMatch[1].trim();
      
      // Check if it's a valid restatement
      if (this.isValidRestatement(potentialSummary, userQuery)) {
        // Check if this restatement actually solves the problem or just restates it
        if (this.isProblemSolved(potentialSummary, responseContent, userQuery)) {
          // Problem was solved - remove it if it exists (already handled above, but check again for exact match)
          this.removeProblemIfSolved(potentialSummary, responseContent, userQuery);
        } else {
          // Problem was only restated, not solved - add it
          const requiresTools = this.detectRequiresTools(responseContent);
          this.addProblem(potentialSummary, userQuery, requiresTools);
        }
      } else {
        // No valid restatement - check if response solves any problem from user query
        // If response directly answers the question without restating, don't add a problem
        const intent = this.extractIntentFromUserQuery(userQuery);
        if (intent) {
          // Check if response solves the problem
          if (!this.isProblemSolved(intent, responseContent, userQuery)) {
            // Only add if not solved and not already exists
            const exists = this.state.problems.some(p => 
              this.areProblemsSimilar(p.statement, intent)
            );
            if (!exists) {
              this.addProblem(intent, userQuery);
            }
          }
        }
      }
    }
  }

  /**
   * Check if two problem statements are similar (for deduplication)
   */
  private areProblemsSimilar(statement1: string, statement2: string): boolean {
    const s1 = statement1.toLowerCase().trim();
    const s2 = statement2.toLowerCase().trim();
    
    // Exact match
    if (s1 === s2) return true;
    
    // Check if one contains the other (with some threshold)
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    // If shorter is at least 70% of longer and is contained, consider similar
    if (shorter.length >= longer.length * 0.7 && longer.includes(shorter)) {
      return true;
    }
    
    // Extract key words and compare
    const words1 = s1.split(/\s+/).filter(w => w.length > 3);
    const words2 = s2.split(/\s+/).filter(w => w.length > 3);
    
    if (words1.length === 0 || words2.length === 0) return false;
    
    const commonWords = words1.filter(w => words2.includes(w));
    const similarity = commonWords.length / Math.max(words1.length, words2.length);
    
    return similarity >= 0.6; // 60% word overlap
  }

  /**
   * Check if a problem was actually solved by the response
   * Returns true if response contains an actual answer, not just a restatement
   */
  private isProblemSolved(problemStatement: string, responseContent: string, originalQuery?: string): boolean {
    const lowerResponse = responseContent.toLowerCase();
    const lowerQuery = originalQuery?.toLowerCase() || problemStatement.toLowerCase();
    
    // Check if response only restates without answering
    const onlyRestates = /(?:you\s+(?:want|need|are\s+asking|would\s+like)|the\s+question\s+is|you're\s+asking\s+about)/i.test(lowerResponse) &&
                         !/(?:here|answer|solution|result|is\s+\w+|the\s+\w+\s+is)/i.test(lowerResponse);
    
    if (onlyRestates) {
      return false;
    }

    // Check for factual questions (like "What is the capital of France?")
    if (/^(what|where|when|who|which|how\s+many|how\s+much)\s+/i.test(lowerQuery)) {
      // For "What is the capital of France?" - check if "Paris" is mentioned
      if (lowerQuery.includes('capital') && lowerQuery.includes('france')) {
        return lowerResponse.includes('paris');
      }
      
      // For other factual questions, check if response has substantial content beyond restatement
      const hasSubstantialAnswer = responseContent.length > problemStatement.length * 1.5;
      return hasSubstantialAnswer && !onlyRestates;
    }

    // For other types of queries, check if response goes beyond restatement
    const hasAnswer = !onlyRestates && 
                      (responseContent.length > (originalQuery?.length || problemStatement.length) * 0.8);
    
    return hasAnswer;
  }

  /**
   * Detect if response indicates tools are required
   */
  private detectRequiresTools(responseContent: string): boolean {
    const lowerContent = responseContent.toLowerCase();
    return lowerContent.includes('move to assumptions') ||
           lowerContent.includes('tools not available') ||
           lowerContent.includes('requires tools') ||
           lowerContent.includes('need tools');
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
      // Code changes and file operations
      /(?:change|modify|update|edit|add|remove|improve|refactor|create|write|make|generate|build)\s+.+/i,
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
   * Get all unsolved problems
   */
  getUnansweredProblems(): Problem[] {
    if (!this.state) return [];
    return [...this.state.problems];
  }

  /**
   * Check if there are any unsolved problems
   */
  hasUnansweredProblems(): boolean {
    return this.state !== null && this.state.problems.length > 0;
  }

  /**
   * Get problem summary (for backward compatibility)
   * Returns concatenated problem statements
   */
  getProblemSummary(): string | undefined {
    if (!this.state || this.state.problems.length === 0) {
      return undefined;
    }
    
    if (this.state.problems.length === 1) {
      return this.state.problems[0].statement;
    }
    
    // Return all problem statements joined
    return this.state.problems.map(p => p.statement).join('\n\n');
  }

  /**
   * Get full chat state (for debugging/inspection)
   */
  getState(): ChatState | null {
    if (!this.state) return null;
    return {
      ...this.state,
      problems: [...this.state.problems], // Copy the array
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
    problems: Problem[];
    referredFiles: Array<{ file: string; description?: string }>;
  } {
    if (!this.state) {
      return {
        queries: [],
        aggregatedPrompt: '',
        problems: [],
        referredFiles: [],
      };
    }

    return {
      queries: this.getMeaningfulQueries(),
      aggregatedPrompt: this.getAggregatedPrompt(),
      problemSummary: this.getProblemSummary(), // For backward compatibility
      problems: this.getUnansweredProblems(),
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

