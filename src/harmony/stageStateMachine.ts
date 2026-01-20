import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { ConfirmationManager } from "./confirmationManager";

export type WorkflowStage = "init" | "chat" | "assumptions" | "implementation";

/**
 * Trigger types for state transitions
 */
export type TransitionTrigger =
  | "initialize"
  | "move_to_implementation"
  | "move_to_assumptions"
  | "move_to_chat"
  | "code_keywords"
  | "file_operations_without_ext"
  | "file_operations_with_ext"
  | "explicit_implementation_command"
  | "error_recovery"
  | "regenerate_code"
  | "clarification_request"
  | "next_step" // Execute one step, stay in implementation
  | "auto" // Execute one step, stay in implementation (auto mode)
  | "verbose_info" // Generate verboseInfo, stay in current stage (works from any stage)
  | "none";

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
  { from: "init", trigger: "initialize", to: "chat", priority: 100 },

  // Explicit commands (high priority)
  {
    from: "assumptions",
    trigger: "move_to_implementation",
    to: "implementation",
    priority: 100,
  },
  {
    from: "implementation",
    trigger: "move_to_assumptions",
    to: "assumptions",
    priority: 100,
  },
  {
    from: "implementation",
    trigger: "move_to_chat",
    to: "chat",
    priority: 100,
  },
  {
    from: "chat",
    trigger: "move_to_assumptions",
    to: "assumptions",
    priority: 100,
  },

  // Explicit implementation commands from assumptions
  {
    from: "assumptions",
    trigger: "explicit_implementation_command",
    to: "implementation",
    priority: 90,
  },

  // Error recovery (high priority)
  {
    from: "implementation",
    trigger: "error_recovery",
    to: "chat",
    priority: 80,
  },

  // Code regeneration
  {
    from: "implementation",
    trigger: "regenerate_code",
    to: "assumptions",
    priority: 70,
  },

  // Clarification requests
  {
    from: "implementation",
    trigger: "clarification_request",
    to: "chat",
    priority: 60,
  },

  // Implementation stage self-loops (execute step, stay in stage)
  {
    from: "implementation",
    trigger: "next_step",
    to: "implementation",
    priority: 100,
  },
  {
    from: "implementation",
    trigger: "auto",
    to: "implementation",
    priority: 100,
  },

  // All stages self-loops (generate verboseInfo, stay in stage)
  { from: "init", trigger: "verbose_info", to: "init", priority: 100 },
  { from: "chat", trigger: "verbose_info", to: "chat", priority: 100 },
  {
    from: "assumptions",
    trigger: "verbose_info",
    to: "assumptions",
    priority: 100,
  },
  {
    from: "implementation",
    trigger: "verbose_info",
    to: "implementation",
    priority: 100,
  },

  // Chat -> Assumptions transitions (DISABLED: Auto-transition removed, requires explicit "move to assumptions")
  // { from: 'chat', trigger: 'code_keywords', to: 'assumptions', priority: 50 },
  // { from: 'chat', trigger: 'file_operations_without_ext', to: 'assumptions', priority: 50 },
  // { from: 'chat', trigger: 'file_operations_with_ext', to: 'assumptions', priority: 50 },
];

/**
 * Valid transitions map (for quick lookup)
 */
const VALID_TRANSITIONS: Map<WorkflowStage, Set<WorkflowStage>> = new Map([
  ["init", new Set<WorkflowStage>(["chat"])],
  ["chat", new Set<WorkflowStage>(["assumptions"])],
  ["assumptions", new Set<WorkflowStage>(["implementation", "chat"])],
  ["implementation", new Set<WorkflowStage>(["chat", "assumptions"])],
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
   * Detect trigger from prompt (public method to get detected trigger)
   */
  detectTrigger(
    prompt: string,
    currentStage: WorkflowStage,
    confirmationManager?: ConfirmationManager
  ): TransitionTrigger {
    const promptLower = prompt.toLowerCase().trim();

    // Init stage always transitions to chat (handled separately, but included for completeness)
    if (currentStage === "init") {
      return "initialize";
    }

    // Check for confirmation responses (high priority - checked before explicit commands)
    if (confirmationManager) {
      const pendingConfirmation =
        confirmationManager.getPendingConfirmation(currentStage);
      if (
        pendingConfirmation &&
        confirmationManager.isConfirmationResponse(prompt)
      ) {
        console.log(
          `[StageStateMachine] Confirmation detected: ${pendingConfirmation.action} from ${currentStage}`
        );
        // Consume the confirmation
        confirmationManager.consumeConfirmation(currentStage);
        return pendingConfirmation.action as TransitionTrigger;
      }
    }

    // Explicit commands (checked after confirmations)
    if (
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(implementation|implement)\b/i.test(
        promptLower
      )
    ) {
      return "move_to_implementation";
    }

    if (
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i.test(
        promptLower
      )
    ) {
      return "move_to_assumptions";
    }

    if (
      /\b(move\s+to|go\s+to|goto|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i.test(
        promptLower
      ) ||
      /@cmd:back[_-]?to[_-]?chat/i.test(promptLower)
    ) {
      return "move_to_chat";
    }

    // Explicit implementation commands
    if (
      /\b(now|then|next|please)\s+(create|write|make|implement|build|generate).*\b(file|code|implementation)\b/i.test(
        promptLower
      ) ||
      /\b(do\s+it|implement\s+it|create\s+it|create\s+the\s+file|write\s+the\s+file|make\s+the\s+file)\b/i.test(
        promptLower
      ) ||
      /\b(create_file|write_file|replace_file|update_file|edit_file|modify_file)\b/i.test(
        promptLower
      )
    ) {
      return "explicit_implementation_command";
    }

    // Detect verbose_info command (works from any stage) - check before stage-specific triggers
    if (
      /@cmd:verbose(?:[_-]?info)?|verbose\s+info|show\s+info|display\s+info/i.test(
        promptLower
      )
    ) {
      return "verbose_info";
    }

    // Error recovery and clarification (from implementation)
    if (currentStage === "implementation") {
      // Detect next_step and auto commands (only in implementation stage)
      // Check for @cmd:next_step or natural language equivalents
      if (
        /@cmd:next(?:[_-]?step)?|next\s+step|continue|proceed|advance/i.test(
          promptLower
        )
      ) {
        return "next_step";
      }

      // Check for @cmd:auto or natural language equivalents
      if (/@cmd:auto|auto\s+mode|execute\s+all/i.test(promptLower)) {
        return "auto";
      }

      const clarificationKeywords =
        /\b(what|how|why|clarify|explain|understand|confused|error|wrong|doesn'?t\s+work|not\s+working)\b/i;
      if (clarificationKeywords.test(promptLower)) {
        return "clarification_request";
      }

      const regenerateKeywords =
        /\b(regenerate|redo|fix\s+the\s+code|update\s+the\s+code|change\s+the\s+code|modify\s+the\s+code)\b/i;
      if (regenerateKeywords.test(promptLower)) {
        return "regenerate_code";
      }
    }

    // Chat -> Assumptions triggers
    if (currentStage === "chat") {
      const codeKeywords =
        /\b(code|snippet|example|solution|how\s+to|fix|update|refactor|improve).*\b(code|function|class|method|variable|snippet)\b/i;
      if (codeKeywords.test(promptLower)) {
        return "code_keywords";
      }

      const fileOperationKeywords =
        /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change).*\b(file|module|class|function|component|feature)\b/i;
      if (fileOperationKeywords.test(promptLower)) {
        return "file_operations_without_ext";
      }

      const fileOperationWithExtension =
        /\b(create|write|make|add|implement|code|generate|build|update|modify|edit|change)(?:\s+\w+)*\s+\w+\.\w{2,4}(\s|$)/i;
      if (fileOperationWithExtension.test(promptLower)) {
        return "file_operations_with_ext";
      }
    }

    return "none";
  }

  /**
   * Determine next stage using transition table
   * Returns the target stage, or null if should stay in current stage
   * For self-loop transitions (same stage), returns the current stage
   */
  determineNextStage(
    currentStage: WorkflowStage,
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    confirmationManager?: ConfirmationManager
  ): WorkflowStage | null {
    // Detect trigger from prompt
    const trigger = this.detectTrigger(
      prompt,
      currentStage,
      confirmationManager
    );

    if (trigger === "none") {
      return null; // Stay in current stage
    }

    // Find matching transition in table (sorted by priority)
    const matchingTransitions = TRANSITION_TABLE.filter(
      (rule) => rule.from === currentStage && rule.trigger === trigger
    ).sort((a, b) => b.priority - a.priority);

    if (matchingTransitions.length === 0) {
      console.log(
        `[StageStateMachine] No transition found for: ${currentStage} + ${trigger}`
      );
      return null;
    }

    // Use highest priority matching transition
    const transition = matchingTransitions[0];

    // Verify transition is valid
    if (!this.canTransition(currentStage, transition.to)) {
      console.log(
        `[StageStateMachine] Transition rejected: ${currentStage} -> ${transition.to} (invalid per state machine rules)`
      );
      return null;
    }

    // For self-loop transitions (same stage), return the current stage
    // This indicates an event occurred (next_step, auto, verbose_info) without stage change
    if (currentStage === transition.to) {
      console.log(
        `[StageStateMachine] ✅ Event detected: ${currentStage} (trigger: ${trigger}) - staying in same stage`
      );
      return currentStage;
    }

    console.log(
      `[StageStateMachine] ✅ Transition approved: ${currentStage} -> ${transition.to} (trigger: ${trigger})`
    );
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
    if (currentStage !== "implementation") {
      return false;
    }

    // Check if there are significant errors that require clarification
    const hasFileModificationErrors = toolResults.some((tr) => {
      const isFileMod = [
        "create_file",
        "replace_file",
        "write_file",
        "update_file",
      ].includes(tr.name);
      const hasError = tr.result?.isError;
      const errorText = tr.result?.content?.[0]?.text?.toLowerCase() || "";

      const needsClarification =
        errorText.includes("not found") ||
        errorText.includes("permission denied") ||
        errorText.includes("invalid") ||
        errorText.includes("missing") ||
        errorText.includes("required") ||
        errorText.includes("cannot") ||
        errorText.includes("unable");

      return isFileMod && hasError && needsClarification;
    });

    return hasFileModificationErrors;
  }

  /**
   * Get stage-specific instructions for prompts
   */
  getInstructions(stage: WorkflowStage): string {
    const instructions: Record<WorkflowStage, string> = {
      init: `## Current Stage: INITIALIZATION

You are in the **Initialization** stage. The conversation is about to begin.
This stage should quickly transition to the Chat stage.`,

      chat: `## Current Stage: CHAT/CLARIFICATION

**PRIMARY GOAL**
- Restate user's problem in your own words to show understanding; 
- Understand and clarify any ambiguities in the user's request;

**DO:**
✅ Restate user's problem in your own words
✅ Ask clarifying questions about requirements, constraints, edge cases
✅ Use read-only tools to gather context about the codebase
✅ Identify ALL distinct requests in the conversation history

**DO NOT:**
❌ Provide solutions, code, or implementation ideas
❌ Jump to analysis without complete understanding
❌ Use any file modification tools

**EXCEPTION**: For trivial, non-code questions (e.g., "What time is it?"), provide direct answer

**COMPLETION CRITERIA**:
- You have restated the problem accurately
- You have asked all necessary clarifying questions
- You understand ALL user requests
- User has confirmed your understanding

**NEXT STAGE PROPOSAL**: When understanding is complete, propose: 
"I now understand your requirements. Shall I move to the Analysis stage to create an implementation plan?"

**ADDITIONAL CONTEXT**:
- Use read/search tools (read_file, grep_files, list_files) to understand the codebase
- **Tool Availability**: Only read-only tools (read_file, list_files, grep_files) are available. MCP tools are NOT available in this stage.
`,

      assumptions: `## Current Stage: ASSUMPTIONS/ANALYSIS
**PRIMARY GOAL**: Create comprehensive implementation plan before writing any code

**MANDATORY FORMAT**: Your plan MUST use numbered steps: "Step 1:", "Step 2:", "Step 3:" (with colon)

**REQUIREMENTS:**
1. Review ENTIRE conversation history from the beginning
2. Count and list ALL user requests (e.g., "3 requests identified")
3. Create one step for EACH distinct request
4. Assess complexity: Simple (1-2 steps) vs Hard (3+ steps)
5. List ALL assumptions and edge cases
6. Use read/search tools to understand codebase context

**ABSOLUTE PROHIBITIONS:**
❌ NO file modification tools
❌ NO code snippets or implementation details
❌ NO MCP tools (focus on analysis, not execution)

**COMPLETION CRITERIA**:
- Restatement of the problem/requirements
- Numbered plan exists covering ALL user requests
- Edge cases and special considerations
- Complexity assessment complete

**NEXT STAGE PROPOSAL**: Present plan and ask:
"Here's my implementation plan. Should I proceed to the Implementation stage to execute it?"

## Additional Context

**IMPORTANT: Comprehensive Analysis**
- **Review ALL conversation history above** - Examine ALL user messages and assistant responses from the beginning. Do not focus only on the first or most recent message
- **Identify ALL user requests** - Count and list all distinct user requests/queries from the conversation history. The user may have made multiple separate requests
- **Analyze the current prompt below** - Consider both the conversation history and the current prompt together
- **Assess actual complexity** - Determine the complexity based on ALL requirements identified, not just the first one
- **Create a comprehensive plan** - Your plan must address ALL identified user requirements, not just one

**Creating Your Plan:**
- **Format steps clearly** - You MUST format your plan steps as "Step 1:", "Step 2:", "Step 3:" (with colon) so the system can detect complexity correctly
- **One step per requirement** - If you identified 3 distinct user requests, create at least 3 steps (one for each requirement)
- **Number your steps** - Always use explicit numbering: "Step 1:", "Step 2:", "Step 3:" - this is critical for the system to detect task complexity
- **Don't combine unrelated requests** - Each distinct user request should have its own step unless they're truly part of one task

**Workflow:**
- **Analyze comprehensively** - Review ALL conversation history to identify ALL user requests
- **List assumptions** - Clearly state any assumptions you're making about the codebase, requirements, or context
- **List edge cases** - Identify edge cases and special considerations that need to be handled
- **Create numbered plan** - Format your plan with clear step numbering: "Step 1:", "Step 2:", "Step 3:"
- **DO NOT generate code** - Describe what needs to be done, not the actual implementation. Code generation happens in the Implementation stage.

`,

      implementation: `## Current Stage: IMPLEMENTATION/EXECUTION

**PRIMARY GOAL**: Execute the numbered plan from Analysis stage

**FIRST ACTION**: Review the numbered plan from Assumptions stage

**EXECUTION RULES**:
1. Follow steps in EXACT order from the plan
2. For each step, generate the actual code/content
3. Use appropriate tools:
   - All tools are available
   - create_file for new files: <tool_call name="create_file" args='{"file_path": "hello.py", "content": "print(\\\"Hello!\\\")"}' />
   - replace_file for modifications  
   - exec_terminal for commands: <tool_call name="exec_terminal" args='{"command": "npm run compile"}' />
   - MCP tools when relevant :  <tool_call name="tool_name" args='{"param": "value"}' />

**CRITICAL REQUIREMENTS**:
✅ Your response MUST include at least one tool call if work remains
✅ Generate actual code content - don't describe, implement
✅ DO NOT read files that should be created (just create them)
✅ If step requires multiple files, create them in logical order      

**COMPLETION CHECK**:
After each tool call, verify:
- File created/modified successfully
- Terminal command executed properly
- Step objectives achieved

**FINALIZATION**: Follow the plan, when ALL plan steps are complete:
1. Verify all user requests are addressed
2. Provide execution summary
3. Ask if user wants to: modify, add features, or end
`,
    };

    return instructions[stage] || "";
  }

  /**
   * Filter tools based on current workflow stage
   * Uses a table-based approach instead of if-else
   */
  getAllowedTools<T extends { name: string; type?: string }>(
    allTools: T[],
    stage: WorkflowStage
  ): T[] {
    const toolRules: Record<
      WorkflowStage,
      { allowed: string[]; blocked: string[] }
    > = {
      init: {
        allowed: [], // No tools available in init stage
        blocked: [], // All tools blocked (conversation not started)
      },
      chat: {
        allowed: [
          "read_file",
          "list_files",
          "grep_files",
          "search_files",
          "read_directory",
        ],
        blocked: [
          "create_file",
          "replace_file",
          "write_file",
          "update_file",
          "delete_file",
          "edit_file",
          "modify_file",
        ],
      },
      assumptions: {
        allowed: [], // All tools except blocked ones
        blocked: [
          "create_file",
          "replace_file",
          "write_file",
          "update_file",
          "delete_file",
          "edit_file",
          "modify_file",
        ],
      },
      implementation: {
        allowed: [], // All tools allowed
        blocked: [],
      },
    };

    const rule = toolRules[stage];

    if (
      rule.blocked.length === 0 &&
      rule.allowed.length === 0 &&
      stage === "implementation"
    ) {
      // All tools allowed (implementation stage)
      return allTools;
    }

    if (rule.allowed.length > 0) {
      // Only allow specific tools (chat stage)
      return allTools.filter((tool) => rule.allowed.includes(tool.name));
    }

    if (stage === "init") {
      // No tools available in init stage
      return [];
    }

    if (stage === "assumptions") {
      // Block file modification tools AND MCP tools in assumptions stage
      return allTools.filter(
        (tool) => !rule.blocked.includes(tool.name) && tool.type !== "mcp"
      );
    }

    // Block specific tools (other stages)
    return allTools.filter((tool) => !rule.blocked.includes(tool.name));
  }
}
