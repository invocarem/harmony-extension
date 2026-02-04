import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { ConfirmationManager } from "./confirmationManager";
import { TransitionHandler } from "./transitionHandler";
import { NativeToolsManager } from "../nativeToolManager";
import { ChatManager } from "./chatManager";
import { AssumptionsManager } from "./assumptionsManager";
export type WorkflowStage = "chat" | "assumptions" | "implementation";

/**
 * Trigger types for state transitions
 */
export type TransitionTrigger =
  | "move_to_implementation"
  | "move_to_assumptions"
  | "move_to_chat"
  | "step" // Execute one step, stay in implementation
  | "auto" // Execute one step, stay in implementation (auto mode)
  | "verbose_info" // Generate verboseInfo, stay in current stage (works from any stage)
  | "prompt" // Regular user prompt (stage-specific behavior)
  | "plan" // Create or update plan (assumptions stage only)
  | "none";

/**
 * Context passed to transition action functions
 */
export interface TransitionContext {
  prompt: string;
  currentStage: WorkflowStage;
  conversationHistory?: readonly ChatMessage[];
  confirmationManager?: ConfirmationManager;
  transitionHandler?: TransitionHandler;
  nativeToolsManager?: NativeToolsManager;
  chatManager?: ChatManager;
  assumptionsManager?: AssumptionsManager;
}

/**
 * Transition action function
 * Returns: target stage to transition to, current stage to stay, or null to abort transition
 * Can be async to perform side effects
 */
export type TransitionAction = (
  context: TransitionContext
) => Promise<WorkflowStage | null> | WorkflowStage | null;

/**
 * Transition table entry
 */
interface TransitionRule {
  from: WorkflowStage;
  to: WorkflowStage;
  trigger: TransitionTrigger;
  action: TransitionAction;
  priority: number; // Higher priority = checked first
}

/**
 * ============================================
 * TRANSITION ACTION FUNCTIONS
 * ============================================
 * Each action function receives context and decides whether to proceed with transition
 * Can perform side effects using transitionHandler
 */

/**
 * Action: Move to assumptions from chat
 * For explicit @cmd:move_to_assumptions - always transition (user's direct intent)
 * For natural language - check if there are unanswered problems
 * Side effect: Save aggregated prompts
 */
const moveToAssumptionsFromChat: TransitionAction = async (
  context
): Promise<WorkflowStage | null> => {
  const {
    prompt,
    currentStage,
    conversationHistory,
    transitionHandler,
    nativeToolsManager,
    chatManager,
  } = context;

  // Check if this is an explicit @cmd: command
  const isExplicitCommand = /^@cmd:move_to_assumptions/i.test(prompt);

  const hasMeaningfulUserQuery = (): boolean => {
    if (!conversationHistory || conversationHistory.length === 0) {
      return false;
    }

    const isTrivialGreeting = (text: string): boolean =>
      /^(hi|hello|hey|greetings?|good\s+(morning|afternoon|evening|day))$/i.test(
        text
      );

    const isStageTransitionCommand = (text: string): boolean =>
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|implementation|implement|chat|discussion|clarification)\b/i.test(
        text
      );

    const isCommand = (text: string): boolean => /^@cmd:/i.test(text);

    return conversationHistory.some((message) => {
      if (message.role !== "user") {
        return false;
      }
      const content = message.content?.trim() ?? "";
      if (!content) {
        return false;
      }
      if (
        isCommand(content) ||
        isStageTransitionCommand(content) ||
        isTrivialGreeting(content)
      ) {
        return false;
      }
      return true;
    });
  };

  // Validate transition: require either unanswered problems OR meaningful query
  // This prevents transition from fresh chat or trivial greetings
  if (chatManager) {
    const hasProblems = chatManager.hasUnansweredProblems();
    const allowTransition = chatManager.allowMoveToAssumptions();
    const allowTransitionFromHistory =
      isExplicitCommand && hasMeaningfulUserQuery();

    if (!hasProblems && !allowTransition && !allowTransitionFromHistory) {
      console.log(
        `[Action] move_to_assumptions: Staying in chat (no unanswered problems or meaningful queries)`
      );
      return "chat" as WorkflowStage; // Stay in chat
    }
  }

  console.log(
    `[Action] move_to_assumptions: chat -> assumptions${isExplicitCommand ? " (explicit command)" : ""}`
  );

  // Perform side effect: save aggregated prompts
  if (transitionHandler) {
    await transitionHandler.handleChatToAssumptionsTransition(
      prompt,
      conversationHistory,
      nativeToolsManager
    );
  }

  return "assumptions" as WorkflowStage;
};

/**
 * Action: Move to implementation from assumptions
 * Side effect: Save assumptions data
 */
const moveToImplementation: TransitionAction = async (
  context
): Promise<WorkflowStage | null> => {
  const { prompt, transitionHandler, nativeToolsManager, assumptionsManager } =
    context;

  // Validate transition: require plan to be created or updated
  // This prevents premature transition before assumptions analysis is complete
  if (assumptionsManager && !assumptionsManager.allowMoveToImplementation()) {
    console.log(
      `[Action] move_to_implementation: Staying in assumptions (no plan created yet)`
    );
    return "assumptions" as WorkflowStage; // Stay in assumptions
  }

  console.log(`[Action] move_to_implementation: assumptions -> implementation`);

  // Perform side effect: save assumptions data
  if (transitionHandler) {
    await transitionHandler.handleAssumptionsToImplementationTransition(
      prompt,
      nativeToolsManager
    );
  }

  return "implementation" as WorkflowStage;
};

/**
 * Action: Move to chat
 */
const moveToChat: TransitionAction = (context) => {
  console.log(`[Action] move_to_chat: ${context.currentStage} -> chat`);
  return "chat";
};

/**
 * Action: Next step (stay in implementation)
 */
const nextStep: TransitionAction = (context) => {
  console.log(`[Action] step: staying in implementation`);
  return "implementation";
};

/**
 * Action: Auto mode (stay in implementation)
 */
const autoMode: TransitionAction = (context) => {
  console.log(`[Action] auto: staying in implementation`);
  return "implementation";
};

/**
 * Action: Verbose info (stay in current stage)
 */
const verboseInfo: TransitionAction = (context) => {
  console.log(`[Action] verbose_info: staying in ${context.currentStage}`);
  return context.currentStage;
};

/**
 * Action: Restate user's problem (stay in chat stage)
 * Used when user provides a regular prompt in chat stage
 */
const restateAction: TransitionAction = async (
  context
): Promise<WorkflowStage> => {
  console.log(
    `[Action] restate: staying in chat - will restate user's problem and clarify`
  );

  // Perform side effect: ensure ChatManager is ready
  if (context.transitionHandler) {
    await context.transitionHandler.handleChatPromptAction();
  }

  return "chat" as WorkflowStage;
};

/**
 * Action: Generate or update plan (stay in assumptions stage)
 * Used when user provides a regular prompt in assumptions stage
 */
const generateOrUpdatePlanAction: TransitionAction = async (
  context
): Promise<WorkflowStage> => {
  console.log(
    `[Action] generate_or_update_plan: staying in assumptions - will generate/update plan`
  );

  // Perform side effect: ensure AssumptionsManager is ready
  if (context.transitionHandler) {
    await context.transitionHandler.handleAssumptionsPromptAction();
  }

  return "assumptions" as WorkflowStage;
};

/**
 * ============================================
 * TRANSITION TABLE
 * ============================================
 * Format: [from_state, to_state, trigger, action_function, priority]
 */
const TRANSITION_TABLE: TransitionRule[] = [
  // Explicit commands (high priority)
  {
    from: "assumptions",
    to: "implementation",
    trigger: "move_to_implementation",
    action: moveToImplementation,
    priority: 100,
  },
  {
    from: "implementation",
    to: "chat",
    trigger: "move_to_chat",
    action: moveToChat,
    priority: 100,
  },
  {
    from: "chat",
    to: "assumptions",
    trigger: "move_to_assumptions",
    action: moveToAssumptionsFromChat,
    priority: 100,
  },

  // Implementation stage self-loops (execute step, stay in stage)
  {
    from: "implementation",
    to: "implementation",
    trigger: "step",
    action: nextStep,
    priority: 100,
  },
  {
    from: "implementation",
    to: "implementation",
    trigger: "auto",
    action: autoMode,
    priority: 100,
  },

  // All stages self-loops (generate verboseInfo, stay in stage)
  {
    from: "chat",
    to: "chat",
    trigger: "verbose_info",
    action: verboseInfo,
    priority: 100,
  },
  {
    from: "assumptions",
    to: "assumptions",
    trigger: "verbose_info",
    action: verboseInfo,
    priority: 100,
  },
  {
    from: "implementation",
    to: "implementation",
    trigger: "verbose_info",
    action: verboseInfo,
    priority: 100,
  },

  // Regular prompt handling (stage-specific default behavior)
  {
    from: "chat",
    to: "chat",
    trigger: "prompt",
    action: restateAction,
    priority: 10,
  },
  {
    from: "assumptions",
    to: "assumptions",
    trigger: "plan",
    action: generateOrUpdatePlanAction,
    priority: 10,
  },

  // Chat -> Assumptions transitions (DISABLED: Auto-transition removed, requires explicit "move to assumptions")
  // { from: 'chat', to: 'assumptions', trigger: 'code_keywords', action: ..., priority: 50 },
  // { from: 'chat', to: 'assumptions', trigger: 'file_operations_without_ext', action: ..., priority: 50 },
  // { from: 'chat', to: 'assumptions', trigger: 'file_operations_with_ext', action: ..., priority: 50 },
];

/**
 * Valid transitions map (for quick lookup)
 */
/**
 * Valid transitions map (for quick lookup)
 */
const VALID_TRANSITIONS: Map<WorkflowStage, Set<WorkflowStage>> = new Map([
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
      ) ||
      /@cmd:move[_-]?to[_-]?implementation/i.test(promptLower)
    ) {
      return "move_to_implementation";
    }

    if (
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|plan|design)\b/i.test(
        promptLower
      ) ||
      /@cmd:move[_-]?to[_-]?assumptions/i.test(promptLower)
    ) {
      return "move_to_assumptions";
    }

    if (
      /\b(move\s+to|go\s+to|goto|back\s+to|return\s+to|clarify|chat|talk|discuss)\s+(chat|discussion|clarification)\b/i.test(
        promptLower
      ) ||
      /@cmd:back[_-]?to[_-]?chat/i.test(promptLower) ||
      /@cmd:move[_-]?to[_-]?chat/i.test(promptLower)
    ) {
      return "move_to_chat";
    }

    // Detect verbose_info command (works from any stage)
    if (
      /@cmd:verbose(?:[_-]?info)?|verbose\s+info|show\s+info|display\s+info/i.test(
        promptLower
      )
    ) {
      return "verbose_info";
    }

    // Detect plan command (assumptions stage only)
    if (currentStage === "assumptions") {
      if (
        /@cmd:plan|create\s+(?:a\s+)?plan|update\s+(?:the\s+)?plan|generate\s+(?:a\s+)?plan/i.test(
          promptLower
        )
      ) {
        return "plan";
      }
    }

    // Detect step and auto commands (only in implementation stage)
    if (currentStage === "implementation") {
      // Check for @cmd:step or natural language equivalents
      if (
        /@cmd:(?:step|next[_-]?step)|next\s+step|continue|proceed|advance/i.test(
          promptLower
        )
      ) {
        return "step";
      }

      // Check for @cmd:auto or natural language equivalents
      if (/@cmd:auto|auto\s+mode|execute\s+all/i.test(promptLower)) {
        return "auto";
      }
    }

    // Default: regular prompt (stage-specific behavior)
    // This allows each stage to handle regular user prompts differently
    if (currentStage === "chat") {
      return "prompt";
    }

    // In assumptions stage, regular prompts trigger plan update (fallback)
    if (currentStage === "assumptions") {
      return "plan";
    }

    return "none";
  }

  /**
   * Determine next stage using transition table
   * Returns the target stage, or null if should stay in current stage
   * For self-loop transitions (same stage), returns the current stage
   */
  async determineNextStage(
    currentStage: WorkflowStage,
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    confirmationManager?: ConfirmationManager,
    transitionHandler?: TransitionHandler,
    nativeToolsManager?: NativeToolsManager,
    chatManager?: ChatManager,
    assumptionsManager?: AssumptionsManager
  ): Promise<WorkflowStage | null> {
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

    // Call the action function to determine actual target stage
    const transitionContext: TransitionContext = {
      prompt,
      currentStage,
      conversationHistory,
      confirmationManager,
      transitionHandler,
      nativeToolsManager,
      chatManager,
      assumptionsManager,
    };

    const targetStage = await transition.action(transitionContext);

    if (targetStage === null) {
      console.log(
        `[StageStateMachine] Action function aborted transition: ${currentStage} + ${trigger}`
      );
      return null;
    }

    // Verify transition is valid
    if (!this.canTransition(currentStage, targetStage)) {
      console.log(
        `[StageStateMachine] Transition rejected: ${currentStage} -> ${targetStage} (invalid per state machine rules)`
      );
      return null;
    }

    // For self-loop transitions (same stage), return the current stage
    // This indicates an event occurred (step, auto, verbose_info) without stage change
    if (currentStage === targetStage) {
      console.log(
        `[StageStateMachine] ✅ Event detected: ${currentStage} (trigger: ${trigger}) - staying in same stage`
      );
      return currentStage;
    }

    console.log(
      `[StageStateMachine] ✅ Transition approved: ${currentStage} -> ${targetStage} (trigger: ${trigger})`
    );
    return targetStage;
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
        "edit_file",
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
  getInstructions(stage: WorkflowStage, harmonyMode: boolean = true): string {
    const instructions: Record<WorkflowStage, string> = {
      chat: `## Current Stage: CHAT/CLARIFICATION

**PRIMARY GOAL:**
- Restate user's problem in your own words to show understanding; 
- Understand and clarify any ambiguities in the user's request;
- Use **read-only native tools** to understand codebase context
- If **rules** are available, ask user which ones are relevant

**DO:**
✅ Review conversation history, synthesize all previous messages
✅ Restate user's problem in your own words to show understanding
✅ If the request is genuinely unclear, ask clarifying questions
✅ Use read-only tools to gather context about the codebase
✅ Identify ALL distinct requirements in the conversation history
✅ If rules are available, ask: "I found applicable rule(s): [list]. Are these relevant to your task? (yes/no/which ones)"

**DO NOT:**
❌ Ask excessive questions, or provide solutions, code, or implementation ideas
❌ Jump to analysis without complete understanding
❌ Use any file modification tools and MCP tools
❌ Force rules on the user - always ask if they're relevant

**EXCEPTION**: For trivial, non-code questions (e.g., "What time is it?"), provide direct answer

**APPROACH:**
1. **First, restate** - Always start by paraphrasing their request to show you understand it
2. **Then, handle rules** - If any rules match the query, ask user to confirm relevance
3. **Only then, assess clarity** - Determine if anything is genuinely unclear or missing
4. **Ask minimal questions** - Only ask about ambiguous points, edge cases not covered, or missing requirements
5. **For trivial requests** - Provide direct answers to simple questions (e.g., "What time is it?")

**RULE CONFIRMATION WORKFLOW**:
- If applicable rules detected: **"I found rule(s): [name]. Should I apply these? (yes/no)"**
- Wait for user confirmation before proceeding
- Only use rules user explicitly confirmed as relevant
- Skip rules user says are not relevant

**COMPLETION CRITERIA**:
- You have restated the problem accurately
- You have asked all necessary clarifying questions
- You understand ALL user requests
- User has confirmed your understanding
- (If applicable) User has confirmed which rules are relevant

**NEXT STAGE PROPOSAL**: When understanding is complete, propose: 
"I now understand your requirements. Shall I move to the Analysis stage to create an implementation plan?"

`,

      assumptions: `## Current Stage: ASSUMPTIONS/ANALYSIS
**PRIMARY GOAL:** 
- Create comprehensive implementation plan to solve user's problems.

**MANDATORY FORMAT**: Your plan MUST use numbered steps: "Step 1:", "Step 2:", "Step 3:" (with colon)

**REQUIREMENTS:**
1. Review ENTIRE conversation history from the beginning
2. Identify and list ALL distinct requirements (functional tasks/deliverables)
3. Create one step for EACH logical requirement or deliverable
4. Assess complexity: Simple (1-2 steps) vs Hard (3+ steps)
5. List ALL assumptions and edge cases

**ABSOLUTE PROHIBITIONS:**
❌ NO file modification tools
❌ NO code snippets or implementation details
❌ NO MCP tools (focus on analysis, not execution)

**COMPLETION CRITERIA**:
- Numbered plan covers all identified requirements

**NEXT STAGE PROPOSAL**: Present plan and ask:
"Here's my implementation plan. Should I proceed to the Implementation stage to execute it?"

## Additional Context

**IMPORTANT: Comprehensive Analysis**
- **Review ALL conversation history above** - Examine ALL user messages and assistant responses from the beginning. Do not focus only on the first or most recent message
- **Identify ALL requirements** - Extract and list all distinct functional requirements/deliverables from the conversation. Note: One user message may contain multiple requirements; multiple messages may clarify one requirement
- **Analyze the current prompt below** - Consider both the conversation history and the current prompt together
- **Assess actual complexity** - Determine the complexity based on ALL requirements identified, not just the first one
- **Create a comprehensive plan** - Your plan must address ALL identified user requirements, not just one

**Response structure (order matters):**
1. **Assumptions** – List any assumptions (place this section first, before the Implementation plan block).
2. **Edge cases** – List edge cases and special considerations (place after Assumptions, still before the Implementation plan block).
3. **Implementation plan block** – Contains ONLY the numbered steps, with the exact header and footer below.

**Implementation plan block (strict format):**
- **Header**: Start the block with exactly: **Implementation plan (begin)**
- **Content**: Include ONLY "Step 1:", "Step 2:", "Step 3:" lines (and their descriptions). Do NOT put **Assumptions** or **Edge cases** inside this block; those belong above.
- **Output Expectation": Each step MUST produce a tangible file output named step_[N]_result.txt
- **Footer**: End the block with exactly: **Implementation plan (end)**

**Creating the numbered steps:**
- **Format steps clearly** - You MUST format your plan steps as "Step 1:", "Step 2:", "Step 3:" (with colon) so the system can detect complexity correctly
- **One step per requirement** - Break down the work into logical deliverables. If you identified 3 distinct requirements, create at least 3 steps
- **Number your steps** - Always use explicit numbering: "Step 1:", "Step 2:", "Step 3:" - this is critical for the system to detect task complexity
- **Don't combine unrelated requirements** - Each distinct functional requirement should have its own step unless they're truly part of one deliverable

**Workflow:**
- **Analyze comprehensively** - Review ALL conversation history to identify ALL functional requirements and deliverables
- **List assumptions** (above the plan block) - Clearly state any assumptions you're making about the codebase, requirements, or context
- **List edge cases** (above the plan block) - Identify edge cases and special considerations that need to be handled
- **Create numbered plan** - Put ONLY the header, steps, and footer in the Implementation plan block; keep Assumptions and Edge cases outside that block
- **DO NOT generate code** - Describe what needs to be done, not the actual implementation. Code generation happens in the Implementation stage.

`,

      implementation: `## Current Stage: IMPLEMENTATION/EXECUTION

**PRIMARY GOAL**: Execute the implementation plan from Analysis stage

**EXECUTION RULES**:
1. Restate current PlanStep description. 
2. Work on current PlanStep to generate code or context. display only the code changes needed.
3. Do not work on previous or future steps.
4. All tools are available in this stage. Use appropriate tools, see TOOL USAGE GUIDE below.
5. Each step MUST produce a tangible file output named step_[N]_result.txt, N is step number.


${
  harmonyMode
    ? `**RESPONSE FORMAT** (CRITICAL):
Use analysis channel for reasoning, final channel for tool calls. **ALWAYS close each channel with \`<|end|>\` before starting a new channel or ending your response.**

Example with reasoning and tool call:
\`\`\`
<|start|>assistant<|channel|>analysis<|message|>
I need to read the file first to see the current structure.
<|end|><|start|>assistant<|channel|>final<|message|>
<tool_call name="read_file" args='{"file_path": "test.py"}' />
<|end|>
\`\`\`

Example with just a tool call (no reasoning needed):
\`\`\`
<|start|>assistant<|channel|>final<|message|>
<tool_call name="create_file" args='{"file_path": "app.py", "content": "print(\"hello\")"}' />
<|end|>
\`\`\`

**REMEMBER**: Every \`<|channel|>\` you open MUST be closed with \`<|end|>\` - no exceptions!`
    : `**RESPONSE FORMAT**:
Use standard tool call format for tool invocations.

Example:
\`\`\`
<tool_call name="read_file" args='{"file_path": "test.py"}' />
\`\`\`

Example with multiple tool calls:
\`\`\`
<tool_call name="create_file" args='{"file_path": "app.py", "content": "print(\"hello\")"}' />
<tool_call name="read_file" args='{"file_path": "config.json"}' />
\`\`\``
}

**TOOL USAGE GUIDE**:
**replace_file**: Do not use this tool. Use edit_file instead.
**create_file**: Use for NEW files only
- Creates files with the specified content
- Only works if file does NOT exist yet
- Best for: Initial file creation, fresh implementations
- For auxiliary files, use 'stepX_' prefix to avoid naming conflicts
- **CRITICAL**: If the file doesn't exist yet, ALWAYS use create_file, NOT edit_file
**edit_file**: Use for PARTIAL file modifications of EXISTING files only
- **CRITICAL**: Only use edit_file if the file ALREADY EXISTS
- If file doesn't exist, use create_file instead
- Finds exact text and replaces only that portion
- Preserves rest of file structure and content
- Requires: old_text with enough context (3-5 lines before/after) to ensure unique match
- Best for: Small, localized changes within large files
- Example: Changing a config value, updating a function parameter, fixing a bug in one section

**exec_terminal**: Execute shell commands
- Example: <tool_call name="exec_terminal" args='{"command": "npm run compile"}' />

**MCP tools**: Use when relevant for your implementation
- Example: <tool_call name="tool_name" args='{"param": "value"}' />

**When to use each file tool:**
- **File doesn't exist yet?** → **create_file** (NEVER use edit_file for new files)
- Updating existing file (small changes)? → **edit_file**
- Updating existing file (large changes)? → Multiple **edit_file** calls or read + edit sections
- Creating new file? → **create_file**
- Multiple small changes? → Multiple **edit_file** calls (more precise)

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
        allowed: [], // All tools allowed except blocked ones
        blocked: ["replace_file"], // Block replace_file to prevent accidental overwrites
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
