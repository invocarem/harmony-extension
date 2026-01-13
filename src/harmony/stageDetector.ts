import { ChatMessage } from "../conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { ConfirmationManager } from "./confirmationManager";

/**
 * Detects the appropriate workflow stage based on the prompt
 */
export class StageDetector {
  constructor(
    private stageStateMachine: StageStateMachine
  ) {}

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
  detectStage(
    prompt: string,
    conversationHistory: readonly ChatMessage[] | undefined,
    conversationContext: ConversationContext | null,
    confirmationManager?: ConfirmationManager
  ): WorkflowStage {
    // Get current stage from context or default to init
    const currentStage = conversationContext?.currentStage || 'init';
    
    // Init stage always transitions to chat
    if (currentStage === 'init') {
      return 'chat';
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
    
    // Use state machine to determine next stage
    const nextStage = this.stageStateMachine.determineNextStage(currentStage, prompt, conversationHistory, confirmationManager);
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

