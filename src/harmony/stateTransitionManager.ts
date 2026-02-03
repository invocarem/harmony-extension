import { ConversationContextManager } from "./conversationContext";
import { ChatManager } from "./chatManager";
import { AssumptionsManager } from "./assumptionsManager";
import { StageDetector } from "./stageDetector";
import { WorkflowStage } from "./stageStateMachine";
import { NativeToolsManager } from "../nativeToolManager";
import { ImplementationManager } from "./implementationManager";
import { ChatMessage } from "../conversationManager";
import { logStepInfo } from "../utils/logger";
import { TransitionHandler } from "./transitionHandler";

/**
 * StateTransitionManager
 * Orchestrates state transitions and stage management
 * Delegates transition side effects to TransitionHandler
 */
export class StateTransitionManager {
  private transitionHandler: TransitionHandler;

  constructor(
    private contextManager: ConversationContextManager,
    private stageDetector: StageDetector,
    private chatManager: ChatManager,
    private assumptionsManager: AssumptionsManager,
    private implementationManager: ImplementationManager
  ) {
    this.transitionHandler = new TransitionHandler(
      contextManager,
      chatManager,
      assumptionsManager,
      implementationManager
    );
    
    // Wire transitionHandler to stageDetector
    this.stageDetector.setTransitionHandler(this.transitionHandler);
  }

  /**
   * Initialize or update conversation context on first call
   */
  async initializeConversation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!this.contextManager.hasContext()) {
      this.contextManager.initialize(prompt, "chat");
      const context = this.contextManager.getContext();

      if (context && context.currentStage === "chat") {
        console.log(`[Harmony] Initializing conversation at chat stage`);
        
        // Initialize chat manager for tracking
        const chatManager = this.chatManager;
        if (chatManager && !chatManager.hasContent()) {
          chatManager.initialize();
        }
      }

      // Detect if we should transition further from chat
      const updatedContext = this.contextManager.getContext();
      if (updatedContext) {
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

      // Initialize chat manager when entering chat stage
      if (
        finalContext?.currentStage === "chat" &&
        !this.chatManager.hasContent()
      ) {
        this.chatManager.initialize();
      }
    }
  }

  /**
   * Check and perform stage transitions if needed
   * Returns true if LLM call should be skipped (e.g., when transitioning to assumptions with a transition command)
   */
  async checkAndPerformStageTransition(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<{ shouldSkipLLM: boolean; message?: string }> {
    const context = this.contextManager.getContext();
    if (!context) {
      return { shouldSkipLLM: false };
    }

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

      // Check if this is a stage transition command
      const isTransitionCommand = /\b(move\s+to|go\s+to|goto|start|begin)\s+(assumptions|analysis|analyze|implementation|implement|chat)\b/i.test(prompt);

      // NOTE: Transition side effects are now handled by action functions in stageStateMachine
      // No need to call transitionHandler methods here anymore

      // Validate implementation transition has a plan
      if (detectedStage === "implementation") {
        await this.transitionHandler.validateImplementationTransition();
      }

      // Perform the transition
      this.contextManager.updateStage(detectedStage, prompt);

      const updatedContext = this.contextManager.getContext();
      if (updatedContext?.currentStage === detectedStage) {
        console.log(
          `[Harmony] ✅ Stage successfully updated in context: ${updatedContext.currentStage}`
        );
        
        // If transitioning with a transition command (just "move to X" without additional message),
        // skip LLM call and return a success message
        if (isTransitionCommand) {
          console.log(`[Harmony] 🔄 Transitioned to ${detectedStage} stage with transition command - skipping LLM call`);
          return {
            shouldSkipLLM: true,
            message: `✓ Transitioned to ${detectedStage} stage`
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

  /**
   * Handle continuation stage check
   */
  async handleContinuation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context) {
      return;
    }

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

  /**
   * Log current stage info
   */
  logCurrentStageInfo(isContinuation: boolean): void {
    const context = this.contextManager.getContext();
    if (context && isContinuation) {
      logStepInfo(
        context.currentStep,
        context.maxSteps,
        context.originalPrompt
      );
    }
  }

  /**
   * Check if max steps exceeded
   */
  isMaxStepsExceeded(): boolean {
    const context = this.contextManager.getContext();
    return context ? context.currentStep > context.maxSteps : false;
  }

  /**
   * Get current stage
   */
  getCurrentStage(): WorkflowStage {
    const context = this.contextManager.getContext();
    return context?.currentStage || "chat";
  }
}
