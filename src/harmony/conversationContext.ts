import { WorkflowStage } from "../stageStateMachine";
import { ProgressPlan } from "../progressPlanManager";
import { CodeContext } from "./codeContext";

/**
 * Conversation context for managing multi-step workflows
 */
export interface ConversationContext {
  originalPrompt: string;
  currentStage: WorkflowStage;
  stageHistory: Array<{
    stage: WorkflowStage;
    enteredAt: number;
    prompt?: string;
  }>;
  steps: Array<{
    toolCalls: Array<{ name: string; arguments: Record<string, any> }>;
    reasoning?: string;
    timestamp: number;
    stage: WorkflowStage;
  }>;
  maxSteps: number;
  currentStep: number;
  lastStageTransition?: {
    from: WorkflowStage;
    to: WorkflowStage;
  };
  progressPlan?: ProgressPlan;
  // Code contexts ready for file creation from assumptions stage
  codeContexts?: CodeContext[];
}

/**
 * Manages conversation context state
 */
export class ConversationContextManager {
  private context: ConversationContext | null = null;

  /**
   * Initialize a new conversation context
   */
  initialize(originalPrompt: string, initialStage: WorkflowStage): ConversationContext {
    this.context = {
      originalPrompt,
      currentStage: initialStage,
      stageHistory: [{ stage: initialStage, enteredAt: Date.now(), prompt: originalPrompt }],
      steps: [],
      maxSteps: 5,
      currentStep: 1,
    };
    return this.context;
  }

  /**
   * Get the current conversation context
   */
  getContext(): ConversationContext | null {
    return this.context;
  }

  /**
   * Check if context exists
   */
  hasContext(): boolean {
    return this.context !== null;
  }

  /**
   * Update the current stage
   */
  updateStage(newStage: WorkflowStage, prompt?: string): void {
    if (!this.context) return;

    const previousStage = this.context.currentStage;
    if (previousStage !== newStage) {
      this.context.currentStage = newStage;
      this.context.stageHistory.push({
        stage: newStage,
        enteredAt: Date.now(),
        prompt,
      });
      this.context.lastStageTransition = {
        from: previousStage,
        to: newStage,
      };
    }
  }

  /**
   * Add a step to the context
   */
  addStep(toolCalls: Array<{ name: string; arguments: Record<string, any> }>, reasoning?: string, stage?: WorkflowStage): void {
    if (!this.context) return;

    this.context.steps.push({
      toolCalls,
      reasoning,
      timestamp: Date.now(),
      stage: stage || this.context.currentStage,
    });
  }

  /**
   * Increment the step counter
   */
  incrementStep(): void {
    if (this.context) {
      this.context.currentStep++;
    }
  }

  /**
   * Get the current step number
   */
  getCurrentStep(): number {
    return this.context?.currentStep || 1;
  }

  /**
   * Check if we've exceeded max steps
   */
  hasExceededMaxSteps(): boolean {
    if (!this.context) return false;
    return this.context.currentStep > this.context.maxSteps;
  }

  /**
   * Check if next step would exceed max steps
   */
  wouldExceedMaxSteps(): boolean {
    if (!this.context) return false;
    return this.context.currentStep + 1 > this.context.maxSteps;
  }

  /**
   * Set the progress plan
   */
  setProgressPlan(plan: ProgressPlan): void {
    if (this.context) {
      this.context.progressPlan = plan;
    }
  }

  /**
   * Add code context that's ready for file creation
   */
  addCodeContext(codeContext: CodeContext): void {
    if (!this.context) return;
    
    if (!this.context.codeContexts) {
      this.context.codeContexts = [];
    }
    
    // Avoid duplicates by file name
    const existingIndex = this.context.codeContexts.findIndex(
      cc => cc.name === codeContext.name
    );
    
    if (existingIndex >= 0) {
      // Update existing
      this.context.codeContexts[existingIndex] = codeContext;
    } else {
      // Add new
      this.context.codeContexts.push(codeContext);
    }
  }

  /**
   * Get all code contexts waiting for creation
   */
  getCodeContexts(): CodeContext[] {
    return this.context?.codeContexts?.filter(cc => cc.waitForCreate) || [];
  }

  /**
   * Check if there are code contexts ready for implementation
   */
  hasCodeSnippetsReady(): boolean {
    const contexts = this.getCodeContexts();
    return contexts.length > 0;
  }

  /**
   * Mark code context as created (no longer waiting)
   */
  markCodeContextCreated(fileName: string): void {
    if (!this.context?.codeContexts) return;
    
    const codeContext = this.context.codeContexts.find(cc => cc.name === fileName);
    if (codeContext) {
      codeContext.waitForCreate = false;
    }
  }

  /**
   * Clear the conversation context
   */
  clear(): void {
    this.context = null;
  }
}

