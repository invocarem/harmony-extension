import { ChatMessage } from "../conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";

/**
 * Detects the appropriate workflow stage based on the prompt
 */
export class StageDetector {
  constructor(
    private stageStateMachine: StageStateMachine
  ) {}

  /**
   * Detect the appropriate workflow stage based on the prompt using state machine
   */
  detectStage(
    prompt: string,
    conversationHistory: readonly ChatMessage[] | undefined,
    conversationContext: ConversationContext | null
  ): WorkflowStage {
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

    // Get current stage from context or default to chat
    const currentStage = conversationContext?.currentStage || 'chat';
    
    // Use state machine to determine next stage
    const nextStage = this.stageStateMachine.determineNextStage(currentStage, prompt, conversationHistory);
    if (nextStage !== null) {
      return nextStage;
    }

    // For continuations, maintain current stage unless explicitly changed
    if (conversationContext) {
      return conversationContext.currentStage;
    }

    // Default: chat stage for general questions
    return 'chat';
  }
}

