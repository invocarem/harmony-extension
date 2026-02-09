import { ChatMessage } from "../conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { ConfirmationManager } from "./confirmationManager";
import { TransitionHandler } from "./transitionHandler";
import { NativeToolsManager } from "../nativeToolManager";

/**
 * Detects the appropriate workflow stage based on the prompt
 */
export class StageDetector {
  constructor(
    private stageStateMachine: StageStateMachine,
    private transitionHandler?: TransitionHandler
  ) {}

  /**
   * Set the transition handler (can be set after construction)
   */
  setTransitionHandler(handler: TransitionHandler): void {
    this.transitionHandler = handler;
  }

  /**
   * Detect if first-principles thinking mode should be activated
   */
  detectFirstPrinciplesMode(prompt: string): boolean {
    const promptLower = prompt.toLowerCase();
    const triggers = [
      /@first-principles|@fpt|@first-principles-thinking/i,
      /\bfirst\s+principles?\s+thinking/i,
      /\bbreak\s+down\s+to\s+fundamentals/i,
      /\bstrip\s+assumptions/i,
      /\bfundamental\s+analysis/i,
    ];
    return triggers.some(pattern => pattern.test(promptLower));
  }

  /**
   * Detect the appropriate workflow stage based on the prompt using state machine
   */
  async detectStage(
    prompt: string,
    conversationHistory: readonly ChatMessage[] | undefined,
    conversationContext: ConversationContext | null,
    confirmationManager?: ConfirmationManager,
    nativeToolsManager?: NativeToolsManager
  ): Promise<WorkflowStage> {
    // Get current stage from context or default to init
    const currentStage = conversationContext?.currentStage || 'init';
    
    // Init stage always transitions to simple
    if (currentStage === 'init') {
      return 'simple';
    }
    
    const promptLower = prompt.toLowerCase().trim();
    
    // Simple greetings/questions stay in chat stage
    const simpleGreetings = [
      /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|thanks?|thank\s+you)$/i,
      /^how\s+(are\s+you|do\s+you\s+do|is\s+it\s+going)$/i,
      /^what('s|s| is)\s+(your|the)\s+(name|purpose)$/i,
    ];
    
    if (simpleGreetings.some(pattern => pattern.test(promptLower))) {
      return 'chat';
    }
    
    // Use state machine to determine next stage (now async with side effects)
    const nextStage = await this.stageStateMachine.determineNextStage(
      currentStage, 
      prompt, 
      conversationHistory, 
      confirmationManager,
      this.transitionHandler,
      nativeToolsManager
    );
    
    if (nextStage !== null) {
      console.log(`[StageDetector] State machine determined stage transition: ${currentStage} -> ${nextStage}`);
      return nextStage; // IMMEDIATELY return the new stage from state machine
    }
    
    console.log(`[StageDetector] State machine returned null - staying in current stage: ${currentStage}`);

    // For continuations, maintain current stage unless explicitly changed
    if (conversationContext) {
      return conversationContext.currentStage;
    }

    // Default: chat stage for general questions (if no context, we're starting fresh)
    return 'chat';
  }
}

