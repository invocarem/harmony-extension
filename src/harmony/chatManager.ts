/**
 * Chat stage state management
 * Tracks queries, files, and provides aggregation for stage transitions
 */

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
  allRelatedFiles: Set<string>;      // All files mentioned across all queries
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
      allRelatedFiles: new Set<string>(),
      lastUpdated: Date.now(),
    };
    console.log(`[ChatManager] Initialized chat state`);
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
    
    // Update file set
    relatedFiles.forEach(file => {
      this.state!.allRelatedFiles.add(file);
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
        this.state!.allRelatedFiles.add(file);
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
   * Get all related files
   */
  getAllRelatedFiles(): string[] {
    if (!this.state) return [];
    return Array.from(this.state.allRelatedFiles);
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
      allRelatedFiles: new Set(this.state.allRelatedFiles), // Copy the Set
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
    relatedFiles: string[];
  } {
    if (!this.state) {
      return {
        queries: [],
        aggregatedPrompt: '',
        relatedFiles: [],
      };
    }

    return {
      queries: this.getMeaningfulQueries(),
      aggregatedPrompt: this.getAggregatedPrompt(),
      problemSummary: this.state.problemSummary,
      relatedFiles: this.getAllRelatedFiles(),
    };
  }

  /**
   * Check if chat state has meaningful content
   */
  hasContent(): boolean {
    return this.state !== null && this.state.queries.length > 0;
  }
}

