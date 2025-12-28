import { ChatMessage } from "./conversationManager";
import { MCPToolResult } from "./mcpClient";

export type WorkflowStage = 'chat' | 'assumptions' | 'implementation';

/**
 * State machine for workflow stage transitions
 * Follows the rules defined in STATE_MACHINE.md
 * 
 * Valid Transitions:
 * - Chat → Analysis (Assumptions)
 * - Analysis → Implementation
 * - Analysis → Chat
 * - Implementation → Chat
 * - Implementation → Analysis
 * 
 * Invalid Transitions:
 * - Chat → Implementation (NOT ALLOWED - must go through Analysis first)
 */
export class StageStateMachine {
  // Valid transitions: from -> [to stages]
  private readonly validTransitions: Map<WorkflowStage, Set<WorkflowStage>>;

  constructor() {
    this.validTransitions = new Map([
      ['chat', new Set<WorkflowStage>(['assumptions'])],
      ['assumptions', new Set<WorkflowStage>(['implementation', 'chat'])],
      ['implementation', new Set<WorkflowStage>(['chat', 'assumptions'])]
    ]);
  }

  /**
   * Check if a transition from one stage to another is valid
   */
  canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
    if (from === to) return true; // Can stay in same stage
    const allowed = this.validTransitions.get(from);
    return allowed ? allowed.has(to) : false;
  }

  /**
   * Determine next stage based on prompt and current stage
   * Returns the target stage, or null if should stay in current stage
   * 
   * Follows STATE_MACHINE.md rules:
   * - Chat → Analysis: Code-related keywords or file operations without extensions
   * - Analysis → Implementation: Explicit file operations with extensions
   * - Implementation → Chat: Error indicators or clarification requests
   * - Implementation → Analysis: Need to regenerate code
   */
  determineNextStage(
    currentStage: WorkflowStage,
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): WorkflowStage | null {
    const promptLower = prompt.toLowerCase().trim();

    // Explicit stage transition commands
    // Note: Chat → Implementation is NOT ALLOWED per state machine rules
    // Must go through Analysis stage first
    if (/\b(move\s+to|go\s+to|start|begin)\s+(implementation|implement)\b/i.test(promptLower)) {
      // Explicit "move to implementation" command - only valid from Analysis stage
      const target = 'implementation';
      return this.canTransition(currentStage, target) ? target : null;
    }
    
    if (/\b(move\s+to|go\s+to|start|begin)\s+(create|modify|write|edit)\b/i.test(promptLower)) {
      // Commands like "move to create" - check if valid transition
      const target = 'implementation';
      return this.canTransition(currentStage, target) ? target : null;
    }
    
    // Direct implementation commands (e.g., "now create the file", "implement it")
    // These should only work from Analysis stage (not from Chat, per state machine rules)
    if (/\b(now|then|next|please)\s+(create|write|make|implement|build|generate).*\b(file|code|implementation)\b/i.test(promptLower) ||
        /\b(do\s+it|implement\s+it|create\s+it|create\s+the\s+file|write\s+the\s+file|make\s+the\s+file)\b/i.test(promptLower)) {
      // Explicit implementation command - only valid from Analysis stage
      const target = 'implementation';
      return this.canTransition(currentStage, target) ? target : null;
    }
    
    if (/\b(move\s+to|go\s+to|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i.test(promptLower)) {
      const target = 'assumptions';
      return this.canTransition(currentStage, target) ? target : null;
    }
    
    if (/\b(move\s+to|go\s+to|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i.test(promptLower)) {
      const target = 'chat';
      return this.canTransition(currentStage, target) ? target : null;
    }

    // Chat → Analysis: Code-related questions or file operation intent (without explicit extensions)
    // Per STATE_MACHINE.md: File operations WITHOUT explicit extensions go to Analysis first
    if (currentStage === 'chat') {
      const codeKeywords = /\b(code|snippet|example|solution|how\s+to|fix|update|refactor|improve).*\b(code|function|class|method|variable|snippet)\b/i;
      const fileOperationKeywords = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change).*\b(file|module|class|function|component|feature)\b/i;
      
      // File operations WITH explicit extensions should go to Analysis first (then Implementation)
      // But if we're in chat and see a file extension, we should still go to Analysis first
      const fileOperationWithExtension = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change)(?:\s+\w+)*\s+\w+\.\w{2,4}(\s|$)/i;
      
      // If it has an extension, it's a file operation - go to Analysis first
      // This follows STATE_MACHINE.md: Chat → Analysis → Implementation (never skip stages)
      if (fileOperationWithExtension.test(promptLower)) {
        return this.canTransition(currentStage, 'assumptions') ? 'assumptions' : null;
      }
      
      if (codeKeywords.test(promptLower) || fileOperationKeywords.test(promptLower)) {
        return this.canTransition(currentStage, 'assumptions') ? 'assumptions' : null;
      }
    }

    // Analysis → Implementation: Explicit file operations with extensions
    // Per STATE_MACHINE.md: File operations WITH extensions go to Implementation
    if (currentStage === 'assumptions') {
      const fileOperationWithExtension = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change)(?:\s+\w+)*\s+\w+\.\w{2,4}(\s|$)/i;
      const explicitFileOps = /\b(create_file|write_file|replace_file|update_file|edit_file|modify_file)\b/i;
      const explicitImplementation = /\b(now|then|next|please|do\s+it|implement\s+it|create\s+it)\b/i;
      
      if (fileOperationWithExtension.test(promptLower) || explicitFileOps.test(promptLower) || explicitImplementation.test(promptLower)) {
        return this.canTransition(currentStage, 'implementation') ? 'implementation' : null;
      }
    }

    // Implementation → Chat: Error indicators or clarification requests
    // Per STATE_MACHINE.md: Error recovery transitions
    if (currentStage === 'implementation') {
      const clarificationKeywords = /\b(what|how|why|clarify|explain|understand|confused|error|wrong|doesn'?t\s+work|not\s+working)\b/i;
      if (clarificationKeywords.test(promptLower)) {
        return this.canTransition(currentStage, 'chat') ? 'chat' : null;
      }
    }

    // Implementation → Analysis: Need to regenerate code
    // Per STATE_MACHINE.md: Need to regenerate code or fix code issues
    if (currentStage === 'implementation') {
      const regenerateKeywords = /\b(regenerate|redo|fix\s+the\s+code|update\s+the\s+code|change\s+the\s+code|modify\s+the\s+code)\b/i;
      if (regenerateKeywords.test(promptLower)) {
        return this.canTransition(currentStage, 'assumptions') ? 'assumptions' : null;
      }
    }

    return null; // Stay in current stage
  }

  /**
   * Check if we should transition back to chat due to errors in tool execution
   * Per STATE_MACHINE.md: Auto-transition from Implementation to Chat on errors
   */
  shouldTransitionToChatOnError(
    currentStage: WorkflowStage,
    toolResults: Array<{ name: string; result?: MCPToolResult }>
  ): boolean {
    // Only transition from implementation to chat on errors
    if (currentStage !== 'implementation') {
      return false;
    }

    // Check if there are significant errors that require clarification
    // Per STATE_MACHINE.md: File modification errors with keywords like "not found", etc.
    const hasFileModificationErrors = toolResults.some(tr => {
      const isFileMod = ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tr.name);
      const hasError = tr.result?.isError;
      const errorText = tr.result?.content?.[0]?.text?.toLowerCase() || '';
      
      // Critical errors that might need clarification
      // Per STATE_MACHINE.md: "not found", "permission denied", "invalid", "missing", "required", "cannot", "unable"
      const needsClarification = 
        errorText.includes('not found') ||
        errorText.includes('permission denied') ||
        errorText.includes('invalid') ||
        errorText.includes('missing') ||
        errorText.includes('required') ||
        errorText.includes('cannot') ||
        errorText.includes('unable');
      
      return isFileMod && hasError && needsClarification;
    });

    return hasFileModificationErrors;
  }
}

