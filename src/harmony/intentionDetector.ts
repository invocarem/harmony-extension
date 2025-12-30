/**
 * Detects user intent from the prompt to determine if file operations should be extracted
 */
export enum UserIntent {
  CREATE = 'create',        // Create new files/code
  EXPLAIN = 'explain',       // Explain existing code
  REFACTOR = 'refactor',     // Improve/restructure code
  MODIFY = 'modify',         // Edit/update existing code
  DEBUG = 'debug',           // Fix errors/issues
  REVIEW = 'review',         // Analyze/inspect code
  UNKNOWN = 'unknown'        // Cannot determine
}

/**
 * Detects the user's intent from their prompt
 * Used to determine whether file extraction should occur (e.g., don't extract files when user asks to explain)
 */
export class IntentionDetector {
  /**
   * Detect user intent from the prompt
   * @param prompt The user's prompt/query
   * @returns The detected intent
   */
  detectIntent(prompt: string): UserIntent {
    const promptLower = prompt.toLowerCase().trim();
    
    // EXPLAIN patterns (highest priority - most common false positive)
    // Check these first to prevent extracting files during explanations
    const explainPatterns = [
      /^(?:explain|what does|how does|describe|walkthrough|walk through|tell me about|what is|show me how)/i,
      /(?:explain|explanation|understand|understanding|what does|how does|describe|walkthrough)/i,
      /(?:can you|could you|please).*(?:explain|describe|tell me|show me)/i,
      /(?:what|how).*(?:does|works?|handles?|implements?)/i,
      /(?:clear|detailed|brief).*(?:walkthrough|explanation|overview|summary)/i,
    ];
    if (explainPatterns.some(p => p.test(promptLower))) {
      return UserIntent.EXPLAIN;
    }
    
    // REVIEW patterns (should not extract files)
    const reviewPatterns = [
      /^(?:review|check|analyze|evaluate|inspect|examine|look at)/i,
      /(?:review|check|analyze|evaluate|inspect|examine).*(?:code|file|this)/i,
      /(?:let'?s|let us).*(?:look|examine|see|check)/i,
    ];
    if (reviewPatterns.some(p => p.test(promptLower))) {
      return UserIntent.REVIEW;
    }
    
    // CREATE patterns (should allow file extraction)
    const createPatterns = [
      /^(?:create|write|generate|make|new|implement|build|set up|initialize)/i,
      /(?:create|write|generate|make|new|implement|build).*(?:file|code|script|function|class)/i,
      /(?:add|add a|add an).*(?:file|new file)/i,
      /(?:I need|I want|I'd like).*(?:to create|to write|to generate|to make|to implement)/i,
    ];
    if (createPatterns.some(p => p.test(promptLower))) {
      return UserIntent.CREATE;
    }
    
    // REFACTOR patterns (should allow file extraction)
    const refactorPatterns = [
      /^(?:refactor|improve|optimize|clean up|restructure|reorganize|modernize|enhance)/i,
      /(?:refactor|improve|optimize|clean up|restructure|reorganize|modernize|enhance).*(?:code|this|file)/i,
      /(?:make|make it).*(?:better|cleaner|more efficient|faster)/i,
    ];
    if (refactorPatterns.some(p => p.test(promptLower))) {
      return UserIntent.REFACTOR;
    }
    
    // MODIFY patterns (should allow file extraction)
    const modifyPatterns = [
      /^(?:change|update|edit|modify|fix|correct|adjust|alter|replace)/i,
      /(?:change|update|edit|modify|fix|correct|adjust|alter|replace).*(?:code|file|this|the)/i,
      /(?:I need|I want).*(?:to change|to update|to edit|to modify|to fix)/i,
    ];
    if (modifyPatterns.some(p => p.test(promptLower))) {
      return UserIntent.MODIFY;
    }
    
    // DEBUG patterns (should allow file extraction)
    const debugPatterns = [
      /^(?:debug|fix error|why is|what's wrong|troubleshoot|resolve|solve)/i,
      /(?:error|bug|issue|problem|broken|not working|doesn't work|isn't working)/i,
      /(?:fix|fixing|fixed).*(?:error|bug|issue|problem)/i,
    ];
    if (debugPatterns.some(p => p.test(promptLower))) {
      return UserIntent.DEBUG;
    }
    
    return UserIntent.UNKNOWN;
  }

  /**
   * Check if file extraction should be allowed based on intent
   * @param intent The detected user intent
   * @returns true if file extraction should be allowed, false otherwise
   */
  shouldAllowFileExtraction(intent: UserIntent): boolean {
    // Allow extraction for: CREATE, REFACTOR, MODIFY, DEBUG
    // Disallow for: EXPLAIN, REVIEW, UNKNOWN (require explicit claims)
    return [
      UserIntent.CREATE,
      UserIntent.REFACTOR,
      UserIntent.MODIFY,
      UserIntent.DEBUG
    ].includes(intent);
  }
}

