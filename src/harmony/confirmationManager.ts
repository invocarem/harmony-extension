import { WorkflowStage } from "./stageStateMachine";
import { ChatMessage } from "../conversationManager";
import { Rule } from "../rulesManager";

/**
 * Represents a pending confirmation that the user can respond to
 */
export interface PendingConfirmation {
  action: 'move_to_assumptions' | 'move_to_implementation';
  targetStage: WorkflowStage;
  sourceStage: WorkflowStage;
  timestamp: number;
  originalQuery?: string; // Original user query that led to this confirmation
}

/**
 * Represents a pending rule confirmation
 */
export interface PendingRuleConfirmation {
  rules: Rule[];
  query: string;
  sourceStage: WorkflowStage;
  timestamp: number;
}

/**
 * Manages confirmation detection and handling across workflow stages
 * 
 * Responsibilities:
 * - Detect when assistant asks for confirmation to proceed
 * - Store pending confirmation state
 * - Check if user responses are confirmations
 * - Provide confirmation context for stage transitions
 */
export class ConfirmationManager {
  private pendingConfirmation: PendingConfirmation | null = null;
  private pendingRuleConfirmation: PendingRuleConfirmation | null = null;
  private confirmedRules: Map<string, Set<string>> = new Map(); // query hash -> confirmed rule IDs

  /**
   * Detect confirmation questions in assistant responses and store pending confirmation
   * 
   * Looks for patterns like:
   * - "Would you like me to continue...?"
   * - "Reply 'yes' to proceed"
   * - "Should I proceed to assumptions stage?"
   * - "Do you want me to move to implementation?"
   */
  detectAndStoreConfirmation(
    assistantContent: string,
    currentStage: WorkflowStage,
    conversationHistory?: readonly ChatMessage[]
  ): void {
    if (!assistantContent || currentStage === 'init' || currentStage === 'implementation') {
      return; // No confirmations in init or implementation stages
    }

    const contentLower = assistantContent.toLowerCase();

    // Patterns that indicate a request to move to assumptions stage
    const moveToAssumptionsPatterns = [
      /(?:would you like|do you want|should I|can I).*?(?:proceed|continue|move).*?(?:assumptions|analysis|analyze)/i,
      /(?:reply|say|type).*?['"]yes['"].*?(?:proceed|continue|move).*?(?:assumptions|analysis)/i,
      /(?:move|proceed|go).*?(?:assumptions|analysis).*?(?:stage|phase)/i,
      /(?:to.*?use.*?tools?|to.*?invoke.*?tools?|to.*?call.*?tools?).*?(?:assumptions|analysis)/i,
    ];

    // Patterns that indicate a request to move to implementation stage
    const moveToImplementationPatterns = [
      /(?:would you like|do you want|should I|can I).*?(?:proceed|continue|move).*?(?:implementation|implement|create|write)/i,
      /(?:reply|say|type).*?['"]yes['"].*?(?:proceed|continue|move).*?(?:implementation|implement)/i,
      /(?:move|proceed|go).*?(?:implementation|implement).*?(?:stage|phase)/i,
      /(?:create|write|implement).*?(?:files?|code).*?(?:implementation|implement)/i,
    ];

    // Check for move to assumptions confirmation
    if (currentStage === 'chat' && moveToAssumptionsPatterns.some(pattern => pattern.test(contentLower))) {
      // Extract original query from conversation history if available
      const originalQuery = this.extractOriginalQuery(conversationHistory);
      
      this.pendingConfirmation = {
        action: 'move_to_assumptions',
        targetStage: 'assumptions',
        sourceStage: currentStage,
        timestamp: Date.now(),
        originalQuery,
      };
      console.log(`[ConfirmationManager] Detected confirmation request: move_to_assumptions from ${currentStage}`);
      return;
    }

    // Check for move to implementation confirmation
    if (currentStage === 'assumptions' && moveToImplementationPatterns.some(pattern => pattern.test(contentLower))) {
      const originalQuery = this.extractOriginalQuery(conversationHistory);
      
      this.pendingConfirmation = {
        action: 'move_to_implementation',
        targetStage: 'implementation',
        sourceStage: currentStage,
        timestamp: Date.now(),
        originalQuery,
      };
      console.log(`[ConfirmationManager] Detected confirmation request: move_to_implementation from ${currentStage}`);
      return;
    }

    // Clear any existing confirmation if no new one is detected
    if (this.pendingConfirmation && this.pendingConfirmation.sourceStage !== currentStage) {
      console.log(`[ConfirmationManager] Cleared pending confirmation (stage changed from ${this.pendingConfirmation.sourceStage} to ${currentStage})`);
      this.pendingConfirmation = null;
    }
  }

  /**
   * Check if a user message is a confirmation response
   * 
   * Recognizes patterns like:
   * - "yes", "yep", "yeah", "y"
   * - "ok", "okay", "sure"
   * - "proceed", "continue", "go ahead"
   * - "do it", "let's go"
   */
  isConfirmationResponse(userMessage: string): boolean {
    if (!userMessage || !userMessage.trim()) {
      return false;
    }

    const messageLower = userMessage.toLowerCase().trim();
    
    // Simple affirmative responses
    const simpleConfirmations = [
      /^(yes|yep|yeah|y|ok|okay|sure|certainly|absolutely|definitely|of course)$/i,
      /^(proceed|continue|go ahead|let'?s go|do it|let'?s do it)$/i,
      /^(sounds good|that works|good idea|agreed)$/i,
    ];

    return simpleConfirmations.some(pattern => pattern.test(messageLower));
  }

  /**
   * Get pending confirmation for the current stage
   * 
   * Returns the pending confirmation if:
   * - A confirmation is pending
   * - The confirmation matches the current stage
   * - The confirmation is not too old (within 5 minutes)
   */
  getPendingConfirmation(currentStage: WorkflowStage): PendingConfirmation | null {
    if (!this.pendingConfirmation) {
      return null;
    }

    // Check if confirmation matches current stage
    if (this.pendingConfirmation.sourceStage !== currentStage) {
      return null;
    }

    // Check if confirmation is too old (5 minutes timeout)
    const age = Date.now() - this.pendingConfirmation.timestamp;
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (age > maxAge) {
      console.log(`[ConfirmationManager] Pending confirmation expired (age: ${Math.round(age / 1000)}s)`);
      this.pendingConfirmation = null;
      return null;
    }

    return this.pendingConfirmation;
  }

  /**
   * Consume and clear the pending confirmation
   * 
   * Returns the confirmation if it exists and matches the current stage,
   * then clears it. Use this when the confirmation has been acted upon.
   */
  consumeConfirmation(currentStage: WorkflowStage): PendingConfirmation | null {
    const confirmation = this.getPendingConfirmation(currentStage);
    if (confirmation) {
      console.log(`[ConfirmationManager] Consuming confirmation: ${confirmation.action}`);
      this.pendingConfirmation = null;
    }
    return confirmation;
  }

  /**
   * Clear any pending confirmation
   */
  clear(): void {
    if (this.pendingConfirmation) {
      console.log(`[ConfirmationManager] Clearing pending confirmation: ${this.pendingConfirmation.action}`);
    }
    this.pendingConfirmation = null;
  }

  /**
   * Check if there's a pending confirmation
   */
  hasPendingConfirmation(): boolean {
    return this.pendingConfirmation !== null;
  }

  /**
   * Store pending rule confirmation for user review
   * Called when applicable rules are detected during chat stage
   */
  storePendingRuleConfirmation(rules: Rule[], query: string, stage: WorkflowStage): void {
    if (!rules || rules.length === 0) {
      this.pendingRuleConfirmation = null;
      return;
    }

    this.pendingRuleConfirmation = {
      rules,
      query,
      sourceStage: stage,
      timestamp: Date.now(),
    };

    console.log(`[ConfirmationManager] Stored ${rules.length} rule(s) for confirmation: ${rules.map(r => r.id).join(', ')}`);
  }

  /**
   * Get pending rule confirmation for user review
   */
  getPendingRuleConfirmation(): PendingRuleConfirmation | null {
    if (!this.pendingRuleConfirmation) {
      return null;
    }

    // Check if confirmation is too old (5 minutes timeout)
    const age = Date.now() - this.pendingRuleConfirmation.timestamp;
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (age > maxAge) {
      console.log(`[ConfirmationManager] Pending rule confirmation expired`);
      this.pendingRuleConfirmation = null;
      return null;
    }

    return this.pendingRuleConfirmation;
  }

  /**
   * Confirm specific rules from pending confirmation
   * User indicates which rules are relevant
   */
  confirmRules(ruleIds: string[]): void {
    if (!this.pendingRuleConfirmation) {
      console.log(`[ConfirmationManager] No pending rule confirmation to confirm`);
      return;
    }

    // Create hash for this query to track confirmed rules
    const queryHash = this.hashString(this.pendingRuleConfirmation.query);
    
    if (!this.confirmedRules.has(queryHash)) {
      this.confirmedRules.set(queryHash, new Set());
    }

    const confirmed = this.confirmedRules.get(queryHash)!;
    ruleIds.forEach(id => confirmed.add(id));

    console.log(`[ConfirmationManager] Confirmed ${ruleIds.length} rule(s): ${ruleIds.join(', ')}`);
    this.pendingRuleConfirmation = null;
  }

  /**
   * Reject/skip specific rules from pending confirmation
   * User indicates which rules are NOT relevant
   */
  rejectRules(ruleIds: string[]): void {
    if (!this.pendingRuleConfirmation) {
      console.log(`[ConfirmationManager] No pending rule confirmation to reject`);
      return;
    }

    // Don't add to confirmed - just clear the pending
    console.log(`[ConfirmationManager] Rejected ${ruleIds.length} rule(s): ${ruleIds.join(', ')}`);
    this.pendingRuleConfirmation = null;
  }

  /**
   * Get confirmed rules for a given query
   * Returns only the rules that user explicitly confirmed
   */
  getConfirmedRules(query: string): string[] {
    const queryHash = this.hashString(query);
    const confirmed = this.confirmedRules.get(queryHash);
    return confirmed ? Array.from(confirmed) : [];
  }

  /**
   * Check if a rule is confirmed for a given query
   */
  isRuleConfirmed(query: string, ruleId: string): boolean {
    const queryHash = this.hashString(query);
    const confirmed = this.confirmedRules.get(queryHash);
    return confirmed ? confirmed.has(ruleId) : false;
  }

  /**
   * Clear all rule confirmations
   */
  clearRuleConfirmations(): void {
    this.confirmedRules.clear();
    this.pendingRuleConfirmation = null;
    console.log(`[ConfirmationManager] Cleared all rule confirmations`);
  }

  /**
   * Simple hash function for query strings
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract the original user query from conversation history
   */
  private extractOriginalQuery(conversationHistory?: readonly ChatMessage[]): string | undefined {
    if (!conversationHistory || conversationHistory.length === 0) {
      return undefined;
    }

    // Find the last user message before the most recent assistant message
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'user') {
        return conversationHistory[i].content;
      }
    }

    return undefined;
  }
}

