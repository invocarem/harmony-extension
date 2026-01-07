import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { ConfirmationManager } from "./confirmationManager";

export type WorkflowStage = 'init' | 'chat' | 'assumptions' | 'implementation';

/**
 * Trigger types for state transitions
 */
export type TransitionTrigger = 
  | 'initialize'
  | 'move_to_implementation'
  | 'move_to_assumptions'
  | 'move_to_chat'
  | 'code_keywords'
  | 'file_operations_without_ext'
  | 'file_operations_with_ext'
  | 'explicit_implementation_command'
  | 'error_recovery'
  | 'regenerate_code'
  | 'clarification_request'
  | 'none';

/**
 * Transition table entry
 */
interface TransitionRule {
  from: WorkflowStage;
  trigger: TransitionTrigger;
  to: WorkflowStage;
  priority: number; // Higher priority = checked first
}

/**
 * State machine transition table
 * This table defines all valid state transitions
 */
const TRANSITION_TABLE: TransitionRule[] = [
  // Initialization (highest priority)
  { from: 'init', trigger: 'initialize', to: 'chat', priority: 100 },
  
  // Explicit commands (high priority)
  { from: 'assumptions', trigger: 'move_to_implementation', to: 'implementation', priority: 100 },
  { from: 'implementation', trigger: 'move_to_assumptions', to: 'assumptions', priority: 100 },
  { from: 'implementation', trigger: 'move_to_chat', to: 'chat', priority: 100 },
  { from: 'chat', trigger: 'move_to_assumptions', to: 'assumptions', priority: 100 },
  
  // Explicit implementation commands from assumptions
  { from: 'assumptions', trigger: 'explicit_implementation_command', to: 'implementation', priority: 90 },
  
  // Error recovery (high priority)
  { from: 'implementation', trigger: 'error_recovery', to: 'chat', priority: 80 },
  
  // Code regeneration
  { from: 'implementation', trigger: 'regenerate_code', to: 'assumptions', priority: 70 },
  
  // Clarification requests
  { from: 'implementation', trigger: 'clarification_request', to: 'chat', priority: 60 },
  
  // Chat -> Assumptions transitions (DISABLED: Auto-transition removed, requires explicit "move to assumptions")
  // { from: 'chat', trigger: 'code_keywords', to: 'assumptions', priority: 50 },
  // { from: 'chat', trigger: 'file_operations_without_ext', to: 'assumptions', priority: 50 },
  // { from: 'chat', trigger: 'file_operations_with_ext', to: 'assumptions', priority: 50 },
];

/**
 * Valid transitions map (for quick lookup)
 */
const VALID_TRANSITIONS: Map<WorkflowStage, Set<WorkflowStage>> = new Map([
  ['init', new Set<WorkflowStage>(['chat'])],
  ['chat', new Set<WorkflowStage>(['assumptions'])],
  ['assumptions', new Set<WorkflowStage>(['implementation', 'chat'])],
  ['implementation', new Set<WorkflowStage>(['chat', 'assumptions'])]
]);

/**
 * Table-based state machine for workflow stage transitions
 * Uses a transition table instead of if-else chains
 */
export class StageStateMachine {
  /**
   * Check if a transition from one stage to another is valid
   */
  canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
    if (from === to) {
      return true; // Can stay in same stage
    }
    const allowed = VALID_TRANSITIONS.get(from);
    return allowed ? allowed.has(to) : false;
  }

  /**
   * Detect trigger from prompt
   */
  private detectTrigger(
    prompt: string,
    currentStage: WorkflowStage,
    confirmationManager?: ConfirmationManager
  ): TransitionTrigger {
    const promptLower = prompt.toLowerCase().trim();

    // Init stage always transitions to chat (handled separately, but included for completeness)
    if (currentStage === 'init') {
      return 'initialize';
    }

    // Check for confirmation responses (high priority - checked before explicit commands)
    if (confirmationManager) {
      const pendingConfirmation = confirmationManager.getPendingConfirmation(currentStage);
      if (pendingConfirmation && confirmationManager.isConfirmationResponse(prompt)) {
        console.log(`[StageStateMachine] Confirmation detected: ${pendingConfirmation.action} from ${currentStage}`);
        // Consume the confirmation
        confirmationManager.consumeConfirmation(currentStage);
        return pendingConfirmation.action as TransitionTrigger;
      }
    }

    // Explicit commands (checked after confirmations)
    if (/\b(move\s+to|go\s+to|goto|start|begin)\s+(implementation|implement)\b/i.test(promptLower)) {
      return 'move_to_implementation';
    }
    
    if (/\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i.test(promptLower)) {
      return 'move_to_assumptions';
    }
    
    if (/\b(move\s+to|go\s+to|goto|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i.test(promptLower)) {
      return 'move_to_chat';
    }

    // Explicit implementation commands
    if (/\b(now|then|next|please)\s+(create|write|make|implement|build|generate).*\b(file|code|implementation)\b/i.test(promptLower) ||
        /\b(do\s+it|implement\s+it|create\s+it|create\s+the\s+file|write\s+the\s+file|make\s+the\s+file)\b/i.test(promptLower) ||
        /\b(create_file|write_file|replace_file|update_file|edit_file|modify_file)\b/i.test(promptLower)) {
      return 'explicit_implementation_command';
    }

    // Error recovery and clarification (from implementation)
    if (currentStage === 'implementation') {
      const clarificationKeywords = /\b(what|how|why|clarify|explain|understand|confused|error|wrong|doesn'?t\s+work|not\s+working)\b/i;
      if (clarificationKeywords.test(promptLower)) {
        return 'clarification_request';
      }
      
      const regenerateKeywords = /\b(regenerate|redo|fix\s+the\s+code|update\s+the\s+code|change\s+the\s+code|modify\s+the\s+code)\b/i;
      if (regenerateKeywords.test(promptLower)) {
        return 'regenerate_code';
      }
    }

    // Chat -> Assumptions triggers
    if (currentStage === 'chat') {
      const codeKeywords = /\b(code|snippet|example|solution|how\s+to|fix|update|refactor|improve).*\b(code|function|class|method|variable|snippet)\b/i;
      if (codeKeywords.test(promptLower)) {
        return 'code_keywords';
      }
      
      const fileOperationKeywords = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change).*\b(file|module|class|function|component|feature)\b/i;
      if (fileOperationKeywords.test(promptLower)) {
        return 'file_operations_without_ext';
      }
      
      const fileOperationWithExtension = /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change)(?:\s+\w+)*\s+\w+\.\w{2,4}(\s|$)/i;
      if (fileOperationWithExtension.test(promptLower)) {
        return 'file_operations_with_ext';
      }
    }

    return 'none';
  }

  /**
   * Determine next stage using transition table
   * Returns the target stage, or null if should stay in current stage
   */
  determineNextStage(
    currentStage: WorkflowStage,
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    confirmationManager?: ConfirmationManager
  ): WorkflowStage | null {
    // Detect trigger from prompt
    const trigger = this.detectTrigger(prompt, currentStage, confirmationManager);
    
    if (trigger === 'none') {
      return null; // Stay in current stage
    }

    // Find matching transition in table (sorted by priority)
    const matchingTransitions = TRANSITION_TABLE
      .filter(rule => rule.from === currentStage && rule.trigger === trigger)
      .sort((a, b) => b.priority - a.priority);

    if (matchingTransitions.length === 0) {
      console.log(`[StageStateMachine] No transition found for: ${currentStage} + ${trigger}`);
      return null;
    }

    // Use highest priority matching transition
    const transition = matchingTransitions[0];
    
    // Verify transition is valid
    if (!this.canTransition(currentStage, transition.to)) {
      console.log(`[StageStateMachine] Transition rejected: ${currentStage} -> ${transition.to} (invalid per state machine rules)`);
      return null;
    }

    console.log(`[StageStateMachine] ✅ Transition approved: ${currentStage} -> ${transition.to} (trigger: ${trigger})`);
    return transition.to;
  }

  /**
   * Check if we should transition back to chat due to errors in tool execution
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
    const hasFileModificationErrors = toolResults.some(tr => {
      const isFileMod = ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tr.name);
      const hasError = tr.result?.isError;
      const errorText = tr.result?.content?.[0]?.text?.toLowerCase() || '';
      
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
    const instructions: Record<WorkflowStage, string> = {
      'init': `## Current Stage: INITIALIZATION

You are in the **Initialization** stage. The conversation is about to begin.
This stage should quickly transition to the Chat stage.`,

      'chat': `## Current Stage: CHAT/CLARIFICATION

You are in the **Chat/Clarification** stage. Your goal is to:
- **CRITICAL: ALWAYS restate the user's problem FIRST** - Your response MUST begin by restating their question/problem in your own words to show understanding
- Understand and clarify the user's problem or question
- **Tool Availability**: Only read-only tools (read_file, list_files, grep_files) are available. MCP tools are NOT available in this stage.
- **If the user's question requires MCP tools**: 
  1. Restate the problem in your own words
  2. Identify what specific tools/data are needed
  3. Clearly state that we'll move to the assumptions stage to use those tools
  4. DO NOT attempt to answer directly without the required tools
- **When read-only tools are helpful**: Use them to gather code context, then provide a concise, actionable response
- **When no tools are needed**: Respond directly and helpfully to the user's query
- **Be direct and concise**: Provide clear answers without excessive reasoning or explanation
- **Structured output**: Only provide JSON or other structured formats if you have the necessary data/tools. Otherwise, acknowledge the need for tool access
- **Avoid verbose reasoning**: Focus on delivering the answer, not explaining every step of your thought process

**Stage Flow**: Chat → Analysis (assumptions) → Implementation. Never skip stages.
**IMPORTANT**: Your response must ALWAYS start by restating the user's problem/question in your own words.`,


      'assumptions': `## Current Stage: ASSUMPTIONS/ANALYSIS

⚠️ **CRITICAL RESTRICTION**: You are in the **Assumptions/Analysis** stage. File modification tools (create_file, replace_file, write_file, update_file, delete_file, edit_file, modify_file) are NOT available and MUST NOT be used.

**MCP Tools are AVAILABLE**: Use MCP tools (analyze_latin, data lookups, etc.) when needed by calling: \`<tool_call name="tool_name" args='{"param": "value"}' />\`

**Your goal is to:**
- **Use MCP tools immediately** when data is needed - don't just describe what you would do
- **Analyze comprehensively**: Review ALL conversation history from the beginning - examine ALL user messages to identify ALL distinct requests, not just the first or most recent one
- **Identify all requirements**: Count and list all user requests from the conversation history. If there are 3 requests, you must address all 3
- **Assess complexity**: Determine task complexity based on ALL requirements identified (simple = 1-2 steps, hard = 3+ steps)
- **Create numbered plan**: You MUST format your plan steps as "Step 1:", "Step 2:", "Step 3:" (with colon) - this is critical for the system to detect complexity correctly
- **Address all requirements**: Your plan must cover ALL identified user requirements from the conversation, not just one
- **Provide code snippets** in markdown code blocks with file paths (e.g., \`\`\`python calc.py)
- Use read/search tools (read_file, grep_files, list_files) to understand the codebase

**ABSOLUTE REQUIREMENTS:**
- ❌ DO NOT use any file modification tools
- ✅ DO use MCP tools when the user's request requires them
- ✅ DO review ALL conversation history to identify ALL user requests
- ✅ DO format your plan with explicit step numbering: "Step 1:", "Step 2:", "Step 3:" (with colon)
- ✅ DO create a step for each distinct user request you identified
- ✅ DO provide code snippets in markdown code blocks with file paths
- ✅ DO explain your assumptions clearly`,


'implementation': `## Current Stage: IMPLEMENTATION

You are in the **Implementation** stage. Your goal is to:
- **Call create_file or replace_file tool** to create/modify files
- Use create_file for new files, replace_file for modifying existing files
- All tools are available, including file modification tools

**CODE SOURCE PRIORITY**:
1. **First, check conversation history** - Use code snippets from the Analysis stage if available
2. **If no code exists in history** - Generate the code content needed for the file

**IMPORTANT**:
- Your response MUST include a tool call (create_file or replace_file)
- **DO NOT try to read files that should be created** - If a file doesn't exist yet, just create it directly
- If code exists in conversation history, extract and use it (be efficient)
- If code doesn't exist, generate it as part of your tool call
- Keep responses concise - focus on executing the file creation
- Example: <tool_call name="create_file" args='{"file_path": "hello.py", "content": "print(\\\"Hello!\\\")"}' />

**Note**: Prefer using code from Analysis stage if available. Generate code only if needed.`

      };

    return instructions[stage] || '';
  }

  /**
   * Filter tools based on current workflow stage
   * Uses a table-based approach instead of if-else
   */
  getAllowedTools<T extends { name: string }>(
    allTools: T[],
    stage: WorkflowStage
  ): T[] {
    const toolRules: Record<WorkflowStage, { allowed: string[]; blocked: string[] }> = {
      'init': {
        allowed: [], // No tools available in init stage
        blocked: [] // All tools blocked (conversation not started)
      },
      'chat': {
        allowed: ['read_file', 'list_files', 'grep_files', 'search_files', 'read_directory'],
        blocked: ['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file']
      },
      'assumptions': {
        allowed: [], // All tools except blocked ones
        blocked: ['create_file', 'replace_file', 'write_file', 'update_file', 'delete_file', 'edit_file', 'modify_file']
      },
      'implementation': {
        allowed: [], // All tools allowed
        blocked: []
      }
    };

    const rule = toolRules[stage];
    
    if (rule.blocked.length === 0 && rule.allowed.length === 0 && stage === 'implementation') {
      // All tools allowed (implementation stage)
      return allTools;
    }
    
    if (rule.allowed.length > 0) {
      // Only allow specific tools (chat stage)
      return allTools.filter(tool => rule.allowed.includes(tool.name));
    }
    
    if (stage === 'init') {
      // No tools available in init stage
      return [];
    }
    
    // Block specific tools (assumptions stage)
    return allTools.filter(tool => !rule.blocked.includes(tool.name));
  }
}
