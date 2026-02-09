import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { ConfirmationManager } from "./confirmationManager";
import { TransitionHandler } from "./transitionHandler";
import { NativeToolsManager } from "../nativeToolManager";
import { ChatManager } from "./chatManager";
import { AssumptionsManager } from "./assumptionsManager";
import { ConversationContextManager } from "./conversationContext";
import { StageDetector } from "./stageDetector";
import { ImplementationManager } from "./implementationManager";
import { logStepInfo } from "../utils/logger";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
export type WorkflowStage = "chat" | "simple" | "assumptions" | "implementation";

/**
 * Trigger types for state transitions
 */
export type TransitionTrigger =
  | "move_to_implementation"
  | "move_to_assumptions"
  | "move_to_chat"
  | "move_to_simple"
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
  contextManager?: ConversationContextManager;
  implementationManager?: ImplementationManager;
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
 * NOTE: Transition actions are implemented inline in the TRANSITION_TABLE below.
 * Inline callbacks keep the table declarative while allowing access to managers
 * provided in the TransitionContext at runtime.
 */

/**
 * Helper for verbose_info transitions.
 * Returns the current stage to indicate a handled self-loop (no stage change).
 * This makes the intent explicit and centralizes any verbose-info side-effects
 * (e.g. asking the transitionHandler to generate or log verbose diagnostics).
 */
const verboseInfoAction: TransitionAction = async (ctx) => {
  console.log(`[Action] verbose_info: staying in ${ctx.currentStage}`);
  // If a transitionHandler supports a verbose/info method, call it safely.
  try {
    // Not all transition handlers may implement handleVerboseInfo; check first.
    // This is intentionally non-blocking: failures should not change stage.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const th: any = ctx.transitionHandler;
    if (th && typeof th.handleVerboseInfo === "function") {
      await th.handleVerboseInfo(ctx.currentStage, ctx.prompt);
    }
  } catch (e: any) {
    console.error("[Action] verbose_info: error generating verbose info", e);
  }
  return ctx.currentStage;
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
    action: async (ctx) => {
      const {
        prompt,
        transitionHandler,
        nativeToolsManager,
        assumptionsManager,
      } = ctx;
      if (
        assumptionsManager &&
        !assumptionsManager.allowMoveToImplementation()
      ) {
        console.log(
          `[Action] move_to_implementation: Staying in assumptions (no plan created yet)`
        );
        return "assumptions" as WorkflowStage;
      }
      if (transitionHandler) {
        await transitionHandler.handleAssumptionsToImplementationTransition(
          prompt,
          nativeToolsManager
        );
      }
      return "implementation" as WorkflowStage;
    },
    priority: 100,
  },
  {
    from: "implementation",
    to: "chat",
    trigger: "move_to_chat",
    action: (ctx) => {
      console.log(`[Action] move_to_chat: ${ctx.currentStage} -> chat`);
      return "chat";
    },
    priority: 100,
  },
  {
    from: "assumptions",
    to: "chat",
    trigger: "move_to_chat",
    action: (ctx) => {
      console.log(`[Action] move_to_chat: ${ctx.currentStage} -> chat`);
      return "chat";
    },
    priority: 100,
  },
  {
    from: "simple",
    to: "chat",
    trigger: "move_to_chat",
    action: (ctx) => {
      console.log(`[Action] move_to_chat: ${ctx.currentStage} -> chat`);
      return "chat";
    },
    priority: 100,
  },
  {
    from: "chat",
    to: "simple",
    trigger: "move_to_simple",
    action: (ctx) => {
      console.log(`[Action] move_to_simple: ${ctx.currentStage} -> simple`);
      return "simple";
    },
    priority: 100,
  },
  {
    from: "assumptions",
    to: "simple",
    trigger: "move_to_simple",
    action: (ctx) => {
      console.log(`[Action] move_to_simple: ${ctx.currentStage} -> simple`);
      return "simple";
    },
    priority: 100,
  },
  {
    from: "implementation",
    to: "simple",
    trigger: "move_to_simple",
    action: (ctx) => {
      console.log(`[Action] move_to_simple: ${ctx.currentStage} -> simple`);
      return "simple";
    },
    priority: 100,
  },
  {
    from: "simple",
    to: "assumptions",
    trigger: "move_to_assumptions",
    action: async (ctx) => {
      console.log(`[Action] move_to_assumptions: simple -> assumptions`);
      const {
        prompt,
        conversationHistory,
        transitionHandler,
        nativeToolsManager,
      } = ctx;
      if (transitionHandler) {
        await transitionHandler.handleChatToAssumptionsTransition(
          prompt,
          conversationHistory,
          nativeToolsManager
        );
      }
      return "assumptions" as WorkflowStage;
    },
    priority: 100,
  },
  {
    from: "chat",
    to: "assumptions",
    trigger: "move_to_assumptions",
    action: async (ctx) => {
      const {
        prompt,
        conversationHistory,
        transitionHandler,
        nativeToolsManager,
        chatManager,
      } = ctx;
      const isExplicitCommand = /^@cmd:move_to_assumptions/i.test(prompt);

      const hasMeaningfulUserQuery = (): boolean => {
        if (!conversationHistory || conversationHistory.length === 0)
          return false;
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
          if (message.role !== "user") return false;
          const content = message.content?.trim() ?? "";
          if (!content) return false;
          if (
            isCommand(content) ||
            isStageTransitionCommand(content) ||
            isTrivialGreeting(content)
          )
            return false;
          return true;
        });
      };

      if (chatManager) {
        const hasProblems = chatManager.hasUnansweredProblems();
        const allowTransition = chatManager.allowMoveToAssumptions();
        const allowTransitionFromHistory =
          isExplicitCommand && hasMeaningfulUserQuery();
        if (!hasProblems && !allowTransition && !allowTransitionFromHistory) {
          console.log(
            `[Action] move_to_assumptions: Staying in chat (no unanswered problems or meaningful queries)`
          );
          return "chat" as WorkflowStage;
        }
      }

      if (transitionHandler) {
        await transitionHandler.handleChatToAssumptionsTransition(
          prompt,
          conversationHistory,
          nativeToolsManager
        );
      }

      return "assumptions" as WorkflowStage;
    },
    priority: 100,
  },

  // Implementation stage self-loops (execute step, stay in stage)
  {
    from: "implementation",
    to: "implementation",
    trigger: "step",
    action: async (ctx): Promise<WorkflowStage | null> => {
      console.log(`[Action] step: staying in implementation`);
      try {
        const impl = ctx.implementationManager;
        const nativeTools = ctx.nativeToolsManager;
        const contextMgr = ctx.contextManager;

        if (impl) {
          // Ensure there's a current step or advance to one
          let current = impl.getCurrentStep();
          if (!current) {
            const advanced = impl.advanceToNextStep();
            current = advanced || undefined;
          } else if (current.status === "pending") {
            // Mark pending step as in_progress
            impl.advanceToNextStep();
          }

          // Start execution tracking for the current step
          const stepNumber = current?.stepNumber;
          if (stepNumber !== undefined) {
            impl.startStepTracking(stepNumber);

            // Generate diagnostic step file if possible (non-blocking)
            if (nativeTools && contextMgr) {
              await impl.generateImplementationStepFile(
                stepNumber,
                contextMgr.getCodeContexts ? contextMgr.getCodeContexts() : [],
                nativeTools,
                contextMgr
              );
            }
          }
        }
      } catch (e: any) {
        console.error(`[Action] step: error executing implementation step:`, e);
      }
      return "implementation";
    },
    priority: 100,
  },
  {
    from: "implementation",
    to: "implementation",
    trigger: "auto",
    action: async (ctx): Promise<WorkflowStage | null> => {
      console.log(`[Action] auto: staying in implementation (auto mode)`);
      try {
        const impl = ctx.implementationManager;
        const nativeTools = ctx.nativeToolsManager;
        const contextMgr = ctx.contextManager;

        if (impl) {
          // Ensure there's a current step or advance to one
          let current = impl.getCurrentStep();
          if (!current) {
            current = impl.advanceToNextStep() || undefined;
          }

          // Start execution tracking and generate diagnostic file for current step
          const stepNumber = current?.stepNumber;
          if (stepNumber !== undefined) {
            impl.startStepTracking(stepNumber);
            if (nativeTools && contextMgr) {
              await impl.generateImplementationStepFile(
                stepNumber,
                contextMgr.getCodeContexts ? contextMgr.getCodeContexts() : [],
                nativeTools,
                contextMgr
              );
            }
          }
        }
      } catch (e: any) {
        console.error(`[Action] auto: error executing auto implementation:`, e);
      }
      return "implementation";
    },
    priority: 100,
  },

  // All stages self-loops (generate verboseInfo, stay in stage)
  {
    from: "chat",
    to: "chat",
    trigger: "verbose_info",
    action: verboseInfoAction,
    priority: 100,
  },
  {
    from: "simple",
    to: "simple",
    trigger: "verbose_info",
    action: verboseInfoAction,
    priority: 100,
  },
  {
    from: "assumptions",
    to: "assumptions",
    trigger: "verbose_info",
    action: verboseInfoAction,
    priority: 100,
  },
  {
    from: "implementation",
    to: "implementation",
    trigger: "verbose_info",
    action: verboseInfoAction,
    priority: 100,
  },

  // Regular prompt handling (stage-specific default behavior)
  {
    from: "chat",
    to: "chat",
    trigger: "prompt",
    action: async (ctx) => {
      if (ctx.transitionHandler)
        await ctx.transitionHandler.handleChatPromptAction();
      return "chat" as WorkflowStage;
    },
    priority: 10,
  },
  {
    from: "simple",
    to: "simple",
    trigger: "prompt",
    action: async (ctx) => {
      console.log(`[Action] prompt: staying in simple stage`);
      return "simple" as WorkflowStage;
    },
    priority: 10,
  },
  {
    from: "assumptions",
    to: "assumptions",
    trigger: "plan",
    action: async (ctx) => {
      if (ctx.transitionHandler)
        await ctx.transitionHandler.handleAssumptionsPromptAction();
      return "assumptions" as WorkflowStage;
    },
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
  ["chat", new Set<WorkflowStage>(["simple", "assumptions"])],
  ["simple", new Set<WorkflowStage>(["chat", "assumptions"])],
  ["assumptions", new Set<WorkflowStage>(["implementation", "chat", "simple"])],
  ["implementation", new Set<WorkflowStage>(["chat", "assumptions", "simple"])],
]);

/**
 * Table-based state machine for workflow stage transitions
 * Uses a transition table instead of if-else chains
 */
export class StageStateMachine {
  // Optional orchestrator references (set via setupOrchestrator)
  private transitionHandler?: TransitionHandler;
  private contextManager?: ConversationContextManager;
  private stageDetector?: StageDetector;
  private chatManager?: ChatManager;
  private assumptionsManager?: AssumptionsManager;
  private implementationManager?: ImplementationManager;

  /**
   * Configure orchestration helpers so the state machine can perform side-effects
   * Previously handled by StateTransitionManager; this keeps transition logic
   * colocated in the state machine module.
   */
  setupOrchestrator(
    contextManager: ConversationContextManager,
    stageDetector: StageDetector,
    chatManager: ChatManager,
    assumptionsManager: AssumptionsManager,
    implementationManager: ImplementationManager
  ) {
    this.contextManager = contextManager;
    this.stageDetector = stageDetector;
    this.chatManager = chatManager;
    this.assumptionsManager = assumptionsManager;
    this.implementationManager = implementationManager;
    this.transitionHandler = new TransitionHandler(
      contextManager,
      chatManager,
      assumptionsManager,
      implementationManager
    );
    // Wire transition handler into the detector
    this.stageDetector.setTransitionHandler(this.transitionHandler);
  }
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

    if (
      /\b(move\s+to|go\s+to|goto|start|begin)\s+(simple|code|snippet|example)\b/i.test(
        promptLower
      ) ||
      /@cmd:move[_-]?to[_-]?simple/i.test(promptLower) ||
      /@simple/i.test(promptLower)
    ) {
      return "move_to_simple";
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

    // In simple stage, regular prompts stay in simple (generate more code snippets)
    if (currentStage === "simple") {
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
      contextManager: this.contextManager,
      implementationManager: this.implementationManager,
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

  /* Orchestration helpers (moved from StateTransitionManager)
   * These methods use the orchestrator set by `setupOrchestrator`.
   */
  async initializeConversation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!this.contextManager) return;

    if (!this.contextManager.hasContext()) {
      this.contextManager.initialize(prompt, "simple");
      const context = this.contextManager.getContext();

      if (context && context.currentStage === "simple") {
        console.log(`[Harmony] Initializing conversation at simple stage`);

        // Create .harmony folder if it doesn't exist (only on first conversation initialization)
        try {
          const workspaceFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceFolder) {
            const harmonyFolder = path.join(workspaceFolder, ".harmony");
            if (!fs.existsSync(harmonyFolder)) {
              fs.mkdirSync(harmonyFolder, { recursive: true });
              console.log(
                `[Harmony] Created .harmony folder at ${harmonyFolder}`
              );
            }
          }
        } catch (error) {
          console.warn(`[Harmony] Failed to create .harmony folder:`, error);
        }

        // Initialize chat manager for this conversation
        if (this.chatManager && !this.chatManager.hasContent()) {
          this.chatManager.initialize();
        }
      }

      // Detect if we should transition further from chat
      const updatedContext = this.contextManager.getContext();
      if (updatedContext && this.stageDetector) {
        const detectedStage = await this.stageDetector.detectStage(
          prompt,
          conversationHistory,
          updatedContext
        );
        if (detectedStage !== "chat") {
          console.log(
            `[Harmony] Stage transition detected at start: chat -> ${detectedStage}`
          );
          this.contextManager.updateStage(detectedStage, prompt);
        }
      }

      const finalContext = this.contextManager.getContext();
      console.log(
        `[Harmony] Starting new conversation in stage: ${finalContext?.currentStage || "chat"}`
      );

      if (
        finalContext?.currentStage === "chat" &&
        this.chatManager &&
        !this.chatManager.hasContent()
      ) {
        this.chatManager.initialize();
      }
    }
  }

  async checkAndPerformStageTransition(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<{ shouldSkipLLM: boolean; message?: string }> {
    if (!this.contextManager || !this.stageDetector) {
      return { shouldSkipLLM: false };
    }

    const context = this.contextManager.getContext();
    if (!context) return { shouldSkipLLM: false };

    const previousStage = context.currentStage;
    console.log(
      `[Harmony] Checking stage transition. Current stage: ${previousStage}, Prompt: "${prompt.substring(0, 50)}..."`
    );

    const detectedStage = await this.stageDetector.detectStage(
      prompt,
      conversationHistory,
      context,
      undefined,
      nativeToolsManager
    );

    console.log(
      `[Harmony] State machine detected stage: ${detectedStage} (was: ${previousStage})`
    );

    if (detectedStage !== previousStage) {
      console.log(
        `[Harmony] ✅ STAGE TRANSITION APPROVED: ${previousStage} -> ${detectedStage}`
      );

      const isTransitionCommand =
        /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|implementation|implement|chat)\b/i.test(
          prompt
        );

      if (detectedStage === "implementation" && this.transitionHandler) {
        await this.transitionHandler.validateImplementationTransition();
      }

      this.contextManager.updateStage(detectedStage, prompt);

      const updatedContext = this.contextManager.getContext();
      if (updatedContext?.currentStage === detectedStage) {
        console.log(
          `[Harmony] ✅ Stage successfully updated in context: ${updatedContext.currentStage}`
        );
        if (isTransitionCommand) {
          console.log(
            `[Harmony] 🔄 Transitioned to ${detectedStage} stage with transition command - skipping LLM call`
          );
          return {
            shouldSkipLLM: true,
            message: `✓ Transitioned to ${detectedStage} stage`,
          };
        }
      } else {
        console.error(
          `[Harmony] ❌ ERROR: Stage update failed! Expected: ${detectedStage}, Got: ${updatedContext?.currentStage}`
        );
      }
    } else {
      console.log(
        `[Harmony] Stage remains: ${previousStage} (no transition needed)`
      );
    }

    return { shouldSkipLLM: false };
  }

  async handleContinuation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!this.contextManager || !this.stageDetector) return;
    const context = this.contextManager.getContext();
    if (!context) return;

    const detectedStage = await this.stageDetector.detectStage(
      prompt,
      conversationHistory,
      context
    );
    const previousStage = context.currentStage;

    if (detectedStage !== previousStage) {
      console.log(
        `[Harmony] Stage transition: ${previousStage} -> ${detectedStage}`
      );
      this.contextManager.updateStage(detectedStage, prompt);
    }
  }

  logCurrentStageInfo(isContinuation: boolean): void {
    if (!this.contextManager) return;
    const context = this.contextManager.getContext();
    if (context && isContinuation) {
      logStepInfo(
        context.continueStep,
        context.continueLimit,
        context.originalPrompt
      );
    }
  }

  isMaxStepsExceeded(): boolean {
    if (!this.contextManager) return false;
    const context = this.contextManager.getContext();
    return context ? context.continueStep > context.continueLimit : false;
  }

  getCurrentStage(): WorkflowStage {
    if (!this.contextManager) return "chat";
    const context = this.contextManager.getContext();
    return context?.currentStage || "chat";
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

      simple: `## Current Stage: SIMPLE/CODE GENERATION

**PRIMARY GOAL:**
- Generate clean, working code snippets directly from user request
- Provide code in markdown code blocks with proper syntax highlighting
- Include brief explanations where helpful
- No file creation or complex planning required

**DO:**
✅ Generate complete, working code snippets
✅ Use proper markdown code blocks with language tags
✅ Include inline comments for clarity
✅ Provide multiple examples if request is ambiguous
✅ Use read-only tools to understand existing code context
✅ Keep explanations concise and focused on the code
✅ Suggest filenames/paths where code would logically go

**DO NOT:**
❌ Create implementation plans or step-by-step breakdowns
❌ Use file creation/modification tools (create_file, edit_file, etc.)
❌ Generate incomplete or placeholder code (TODO comments are fine for extension points)
❌ Provide excessive explanations (code should be well-commented)
❌ Use MCP tools (not needed for code snippets)

**CODE FORMAT:**
\`\`\`language
// Brief description or comment
// Code snippet here
\`\`\`

**EXAMPLE OUTPUT:**
"Here's a Python function to parse JSON:

\`\`\`python
# Function to safely parse JSON with error handling
import json

def parse_json_safely(json_string):
    try:
        return json.loads(json_string)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return None
\`\`\`

This could go in \`utils/json_parser.py\`."

**WHEN TO SUGGEST CHANGING STAGES:**
- If task requires multiple files → suggest "assumptions" stage for planning
- If user needs clarification → suggest "chat" stage
- If ready to implement in workspace → suggest "implementation" stage
- If request is complex with many requirements → suggest "assumptions" stage

**COMPLETION:**
After providing code, ask: "Does this help? Need modifications, or ready to implement this in your workspace?"

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
- **If a plan already exists and the user provides feedback/comments** - INCORPORATE the user's feedback into an UPDATED plan. Do NOT simply regenerate the same plan. Adjust steps, add new steps, remove steps, or modify descriptions based on the user's comments
- **Assess actual complexity** - Determine the complexity based on ALL requirements identified, not just the first one
- **Create a comprehensive plan** - Your plan must address ALL identified user requirements, not just one

**Response structure (order matters):**
1. **Assumptions** – List any assumptions (place this section first, before the Implementation plan block).
2. **Edge cases** – List edge cases and special considerations (place after Assumptions, still before the Implementation plan block).
3. **Implementation plan block** – Contains ONLY the numbered steps, with the exact header and footer below.

  **Implementation plan block (strict format):**
  - **Header**: Start the block with exactly: **Implementation plan (begin)**
  - **Content**: Include ONLY "Step 1:", "Step 2:", "Step 3:" lines (and their descriptions). Do NOT put **Assumptions** or **Edge cases** inside this block; those belong above.
  - **Log**: Inside the Implementation plan block, each "Step N:" line MUST include an explicit "Log:" line instructing creation of 'step_[N]_log.txt' containing status, timestamp, and relevant code/context snapshots (and any __created__/__edited__/__replaced__ entries).
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
      simple: {
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
      // Only allow specific tools (chat and simple stages)
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
