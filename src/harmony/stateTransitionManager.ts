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
  }

  /**
   * Initialize or update conversation context on first call
   */
  async initializeConversation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!this.contextManager.hasContext()) {
      this.contextManager.initialize(prompt, "init");
      const context = this.contextManager.getContext();

      if (context && context.currentStage === "init") {
        console.log(`[Harmony] Initializing conversation: init -> chat`);
        this.contextManager.updateStage("chat", prompt);
        
        // Handle init to chat transition
        await this.transitionHandler.handleInitToChatTransition();
      }

      // Detect if we should transition further from chat
      const updatedContext = this.contextManager.getContext();
      if (updatedContext) {
        const detectedStage = this.stageDetector.detectStage(
          prompt,
          conversationHistory,
          updatedContext
        );
        if (detectedStage !== "chat" && detectedStage !== "init") {
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
   */
  async checkAndPerformStageTransition(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context) {
      return;
    }

    const previousStage = context.currentStage;
    console.log(
      `[Harmony] Checking stage transition. Current stage: ${previousStage}, Prompt: "${prompt.substring(0, 50)}..."`
    );

    const detectedStage = this.stageDetector.detectStage(
      prompt,
      conversationHistory,
      context
    );

    console.log(
      `[Harmony] State machine detected stage: ${detectedStage} (was: ${previousStage})`
    );

    if (detectedStage !== previousStage) {
      console.log(
        `[Harmony] ✅ STAGE TRANSITION APPROVED: ${previousStage} -> ${detectedStage}`
      );

      // Delegate transition side effects to handler
      if (previousStage === "chat" && detectedStage === "assumptions") {
        await this.transitionHandler.handleChatToAssumptionsTransition(
          prompt,
          conversationHistory,
          nativeToolsManager
        );
      } else if (
        previousStage === "assumptions" &&
        detectedStage === "implementation"
      ) {
        await this.transitionHandler.handleAssumptionsToImplementationTransition(
          prompt,
          nativeToolsManager
        );
      }

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

    const detectedStage = this.stageDetector.detectStage(
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
