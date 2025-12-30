import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";

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
    // Users must go through Assumptions stage first
    if (/\b(move\s+to|go\s+to|goto|start|begin)\s+(implementation|implement)\b/i.test(promptLower)) {
      // Explicit "move to implementation" command
      const target = 'implementation';
      if (this.canTransition(currentStage, target)) {
        console.log(`[StageStateMachine] Transitioning from ${currentStage} to ${target} based on explicit command`);
        return target;
      } else {
        // Invalid transition - reject it (e.g., chat → implementation is not allowed)
        console.log(`[StageStateMachine] Cannot transition from ${currentStage} to ${target} - invalid transition per state machine rules`);
        return null;
      }
    }
    
    if (/\b(move\s+to|go\s+to|goto|start|begin)\s+(create|modify|write|edit)\b/i.test(promptLower)) {
      // Commands like "move to create" - check if valid transition
      const target = 'implementation';
      if (this.canTransition(currentStage, target)) {
        console.log(`[StageStateMachine] Transitioning from ${currentStage} to ${target} based on create/modify command`);
        return target;
      } else {
        console.log(`[StageStateMachine] Cannot transition from ${currentStage} to ${target} - invalid transition`);
        return null;
      }
    }
    
    // Direct implementation commands (e.g., "now create the file", "implement it")
    // These should only work from Analysis stage (not from Chat, per state machine rules)
    if (/\b(now|then|next|please)\s+(create|write|make|implement|build|generate).*\b(file|code|implementation)\b/i.test(promptLower) ||
        /\b(do\s+it|implement\s+it|create\s+it|create\s+the\s+file|write\s+the\s+file|make\s+the\s+file)\b/i.test(promptLower)) {
      // Explicit implementation command - only valid from Analysis stage
      const target = 'implementation';
      return this.canTransition(currentStage, target) ? target : null;
    }
    
    if (/\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i.test(promptLower)) {
      const target = 'assumptions';
      if (this.canTransition(currentStage, target)) {
        console.log(`[StageStateMachine] Transitioning from ${currentStage} to ${target} based on explicit command`);
        return target;
      }
      return null;
    }
    
    if (/\b(move\s+to|go\s+to|goto|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i.test(promptLower)) {
      const target = 'chat';
      if (this.canTransition(currentStage, target)) {
        console.log(`[StageStateMachine] Transitioning from ${currentStage} to ${target} based on explicit command`);
        return target;
      }
      return null;
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

    // Analysis → Implementation: Only explicit transition commands allowed
    // Auto-transition from Assumptions to Implementation is DISABLED
    // Users must explicitly type "move to implementation" to transition
    // This ensures users have control over when to proceed to implementation stage
    // 
    // Previously, file operations with extensions would auto-transition, but that's now disabled:
    // if (currentStage === 'assumptions') {
    //   const fileOperationWithExtension = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change)(?:\s+\w+)*\s+\w+\.\w{2,4}(\s|$)/i;
    //   if (fileOperationWithExtension.test(promptLower)) {
    //     return this.canTransition(currentStage, 'implementation') ? 'implementation' : null;
    //   }
    // }
    
    // Only explicit implementation commands work from Analysis stage
    if (currentStage === 'assumptions') {
      const explicitFileOps = /\b(create_file|write_file|replace_file|update_file|edit_file|modify_file)\b/i;
      const explicitImplementation = /\b(now|then|next|please|do\s+it|implement\s+it|create\s+it)\b/i;
      
      // Only transition on explicit commands, not just file operations with extensions
      if (explicitFileOps.test(promptLower) || explicitImplementation.test(promptLower)) {
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

  /**
   * Get stage-specific instructions for prompts
   */
  getInstructions(stage: WorkflowStage): string {
    switch (stage) {
      case 'chat':
        return `## Current Stage: CHAT/CLARIFICATION

You are in the **Chat/Clarification** stage. Your goal is to:
- **CRITICAL: ALWAYS restate the user's problem FIRST** - Your response MUST begin by restating their question/problem in your own words to show understanding
- Understand and clarify the user's problem or question
- Ask clarifying questions if needed
- Provide helpful explanations and guidance
- Do NOT use file modification tools (create_file, replace_file, etc.)
- Do NOT generate code or create files yet
- You may use read-only tools (read_file, list_files, grep_files) to gather context if helpful

**Stage Flow**: Chat → Analysis (code generation) → Implementation (file creation). Never skip stages.
**IMPORTANT**: Your response must ALWAYS start by restating the user's problem/question in your own words, then provide your answer or clarification.`;

      case 'assumptions':
        return `## Current Stage: ASSUMPTIONS/ANALYSIS

⚠️ **CRITICAL RESTRICTION**: You are in the **Assumptions/Analysis** stage. You MUST provide code snippets ONLY. File modification tools (create_file, replace_file, write_file, update_file, delete_file, edit_file, modify_file) are NOT available and MUST NOT be used.

**Your goal is to:**
- **Analyze the problem** and break it down into steps (create a plan/todo list for complex tasks)
- Explain your assumptions about the codebase
- **For multi-step tasks**: Provide a clear plan with numbered steps (e.g., "1. Create hello.py", "2. Add greeting function", etc.)
- **MUST provide code snippets/examples** in markdown code blocks with file paths (e.g., \`\`\`python calc.py)
- Show code solutions in formatted code blocks - this is the ONLY way to provide code in this stage
- You may use read/search tools (read_file, grep_files, list_files) to understand the codebase

**ABSOLUTE REQUIREMENTS:**
- ❌ DO NOT use create_file, replace_file, or any file modification tools
- ✅ DO provide code snippets in markdown code blocks with file paths
- ✅ DO format code blocks like: \`\`\`python calc.py\n[your code here]\n\`\`\`
- When rules specify "provide code snippets", you MUST follow them exactly

**For complex tasks**: Break down the task into steps and create a clear implementation plan before providing code snippets.`;

      case 'implementation':
        return `## Current Stage: IMPLEMENTATION

You are in the **Implementation** stage. Your goal is to:
- **Call create_file or replace_file tool** to actually create/modify files
- Use create_file for new files, replace_file for modifying existing files
- All tools are available, including file modification tools

**CODE SOURCE PRIORITY**:
1. **First, check conversation history** - If code snippets were generated in the Analysis stage, use that existing code (avoid regenerating)
2. **If no code exists in history** - Then generate the code content needed for the file

**IMPORTANT**:
- Your response MUST include a tool call (create_file or replace_file) to create the file
- If code exists in conversation history, extract and use it (be efficient)
- If code doesn't exist, generate it as part of your tool call
- Keep responses concise - focus on executing the file creation
- Example: <tool_call name="create_file" args='{"file_path": "hello.py", "content": "print(\\\"Hello!\\\")"}' />

**Note**: Prefer using code from Analysis stage if available. Generate code only if needed.`;

      default:
        return '';
    }
  }

  /**
   * Filter tools based on current workflow stage
   * Returns only the tools that are allowed in the given stage
   */
  getAllowedTools<T extends { name: string }>(
    allTools: T[],
    stage: WorkflowStage
  ): T[] {
    if (stage === 'chat') {
      // Chat stage: Only allow read-only tools for context gathering
      const readOnlyTools = ['read_file', 'list_files', 'grep_files', 'search_files', 'read_directory'];
      return allTools.filter(tool => 
        readOnlyTools.includes(tool.name) || 
        !['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file'].includes(tool.name)
      );
    }
    
    if (stage === 'assumptions') {
      // Assumptions stage: Allow read/search tools, but NO file modification tools
      const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file'];
      return allTools.filter(tool => !fileModificationTools.includes(tool.name));
    }
    
    // Implementation stage: All tools allowed
    return allTools;
  }
}

