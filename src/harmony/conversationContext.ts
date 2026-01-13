import { WorkflowStage } from "./stageStateMachine";
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
  // Map from filename to array of versions
  codeContexts?: Map<string, CodeContext[]>;
  // First-principles thinking mode (disabled by default)
  firstPrinciplesMode?: boolean;
  firstPrinciplesState?: {
    questionsAsked: number;        // How many questions asked (0-12)
    questionsRemaining: number;    // How many questions left
    answers: Record<number, string>; // Question number → answer mapping
    synthesisGenerated?: boolean;   // Has synthesis been generated?
    synthesis?: {
      coreTruths: string[];
      falseAssumptions: string[];
      reconstruction: string;
      actionableInsights: string[];
    };
  };
}

/**
 * Manages conversation context state
 */
export class ConversationContextManager {
  private context: ConversationContext | null = null;

  /**
   * Initialize a new conversation context
   */
  initialize(originalPrompt: string, initialStage: WorkflowStage = 'init'): ConversationContext {
    // Preserve existing progressPlan if context is being re-initialized
    const existingPlan = this.context?.progressPlan;
    const existingCodeContexts = this.context?.codeContexts;
    
    this.context = {
      originalPrompt,
      currentStage: initialStage,
      stageHistory: [{ stage: initialStage, enteredAt: Date.now(), prompt: originalPrompt }],
      steps: [],
      maxSteps: 5,
      currentStep: 1,
      // Preserve progressPlan if it exists (important for implementation stage)
      ...(existingPlan && { progressPlan: existingPlan }),
      // Preserve codeContexts if they exist
      ...(existingCodeContexts && { codeContexts: existingCodeContexts }),
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
   * If context doesn't exist, creates a minimal context to store the plan
   */
  setProgressPlan(plan: ProgressPlan): void {
    if (!this.context) {
      // Create a minimal context if it doesn't exist to preserve the plan
      this.context = {
        originalPrompt: plan.originalPrompt || '',
        currentStage: 'chat',
        stageHistory: [{ stage: 'chat', enteredAt: Date.now() }],
        steps: [],
        maxSteps: 5,
        currentStep: 1,
        progressPlan: plan,
      };
    } else {
      this.context.progressPlan = plan;
    }
  }

  /**
   * Extract description from user prompt or AI response
   * For initial generation: uses the user's original request
   * For updates: extracts the change description from user prompt
   */
  private extractDescription(userPrompt?: string, aiResponse?: string): string | undefined {
    if (userPrompt) {
      // Use user prompt as description (keep concise, max 200 chars)
      const trimmed = userPrompt.trim();
      if (trimmed.length > 200) {
        return trimmed.substring(0, 197) + '...';
      }
      return trimmed;
    }
    if (aiResponse) {
      // Fallback: extract summary from AI response (first sentence or first 200 chars)
      const firstSentence = aiResponse.split(/[.!?]\s+/)[0];
      if (firstSentence.length <= 200) {
        return firstSentence;
      }
      return aiResponse.substring(0, 197) + '...';
    }
    return undefined;
  }

  /**
   * Increment version number (e.g., v1 -> v2, v2 -> v3)
   */
  private incrementVersion(version: string): string {
    const match = version.match(/^v(\d+)(?:\.\d+)?$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      return `v${num + 1}`;
    }
    // If version format is unexpected, default to v2
    return 'v2';
  }

  /**
   * Add code context that's ready for file creation
   * Preserves version history and auto-increments versions on updates
   * @param codeContext The code context to add
   * @param userPrompt Optional user prompt for description extraction
   * @param aiResponse Optional AI response for description extraction
   */
  addCodeContext(codeContext: CodeContext, userPrompt?: string, aiResponse?: string): void {
    if (!this.context) return;
    
    if (!this.context.codeContexts) {
      this.context.codeContexts = new Map<string, CodeContext[]>();
    }
    
    const fileName = codeContext.name;
    const existingVersions = this.context.codeContexts.get(fileName) || [];
    
    if (existingVersions.length > 0) {
      // Update existing - preserve history
      // Find the active version (or latest if none is active)
      const activeVersion = existingVersions.find(v => v.isActive) || 
                           existingVersions.sort((a, b) => {
                             // Sort by version number
                             const aNum = parseInt(a.version.match(/^v(\d+)/i)?.[1] || '0', 10);
                             const bNum = parseInt(b.version.match(/^v(\d+)/i)?.[1] || '0', 10);
                             return bNum - aNum;
                           })[0];
      
      // Mark existing active version as inactive
      activeVersion.isActive = false;
      
      // Create new version
      const newVersion = this.incrementVersion(activeVersion.version);
      codeContext.version = newVersion;
      codeContext.previousVersion = activeVersion.version;
      codeContext.timestamp = Date.now();
      codeContext.isActive = true;
      
      // Extract description if not already set
      if (!codeContext.description) {
        codeContext.description = this.extractDescription(userPrompt, aiResponse);
      }
      
      // Add new version (keep old ones)
      existingVersions.push(codeContext);
      this.context.codeContexts.set(fileName, existingVersions);
    } else {
      // First version
      if (codeContext.version === 'v1' && !codeContext.description) {
        // Set description if not already set
        codeContext.description = this.extractDescription(userPrompt, aiResponse);
      }
      codeContext.timestamp = Date.now();
      codeContext.isActive = true;
      this.context.codeContexts.set(fileName, [codeContext]);
    }
  }

  /**
   * Get all code contexts waiting for creation (active versions only)
   */
  getCodeContexts(): CodeContext[] {
    if (!this.context?.codeContexts) return [];
    
    const activeContexts: CodeContext[] = [];
    for (const versions of this.context.codeContexts.values()) {
      const active = versions.find(cc => cc.waitForCreate && cc.isActive);
      if (active) {
        activeContexts.push(active);
      }
    }
    return activeContexts;
  }

  /**
   * Get all versions of a specific file
   */
  getCodeContextVersions(fileName: string): CodeContext[] {
    if (!this.context?.codeContexts) return [];
    
    const versions = this.context.codeContexts.get(fileName) || [];
    return versions.sort((a, b) => {
      // Sort by version number (descending - newest first)
      const aNum = parseInt(a.version.match(/^v(\d+)/i)?.[1] || '0', 10);
      const bNum = parseInt(b.version.match(/^v(\d+)/i)?.[1] || '0', 10);
      return bNum - aNum;
    });
  }

  /**
   * Get the active version of a specific file
   */
  getActiveCodeContext(fileName: string): CodeContext | null {
    if (!this.context?.codeContexts) return null;
    
    const versions = this.context.codeContexts.get(fileName);
    if (!versions) return null;
    
    return versions.find(cc => cc.isActive) || null;
  }

  /**
   * Revert to a specific version of a file
   * @param fileName The file name
   * @param version The version to revert to (e.g., "v1", "v2")
   * @returns true if reversion was successful, false otherwise
   */
  revertToVersion(fileName: string, version: string): boolean {
    if (!this.context?.codeContexts) return false;
    
    const versions = this.getCodeContextVersions(fileName);
    const targetVersion = versions.find(v => v.version === version);
    
    if (!targetVersion) return false;
    
    // Mark all versions as inactive
    versions.forEach(v => v.isActive = false);
    
    // Activate target version
    targetVersion.isActive = true;
    
    return true;
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
   * Marks the active version of the file as created
   */
  markCodeContextCreated(fileName: string): void {
    if (!this.context?.codeContexts) return;
    
    // Find the active version of the file
    const codeContext = this.getActiveCodeContext(fileName);
    if (codeContext) {
      codeContext.waitForCreate = false;
    }
  }

  /**
   * Enable or disable first-principles thinking mode
   */
  setFirstPrinciplesMode(enabled: boolean): void {
    if (!this.context) return;
    
    this.context.firstPrinciplesMode = enabled;
    
    if (enabled && !this.context.firstPrinciplesState) {
      // Initialize first-principles state
      this.context.firstPrinciplesState = {
        questionsAsked: 0,
        questionsRemaining: 12,
        answers: {},
        synthesisGenerated: false,
      };
    } else if (!enabled) {
      // Clear first-principles state when disabled
      this.context.firstPrinciplesState = undefined;
    }
  }

  /**
   * Get first-principles mode status
   */
  isFirstPrinciplesMode(): boolean {
    return this.context?.firstPrinciplesMode === true;
  }

  /**
   * Get first-principles state
   */
  getFirstPrinciplesState() {
    return this.context?.firstPrinciplesState;
  }

  /**
   * Record a question-answer pair in first-principles state
   */
  recordFirstPrinciplesAnswer(questionNumber: number, answer: string): void {
    if (!this.context?.firstPrinciplesState) return;
    
    const state = this.context.firstPrinciplesState;
    state.answers[questionNumber] = answer;
    state.questionsAsked = Math.max(state.questionsAsked, questionNumber);
    state.questionsRemaining = Math.max(0, 12 - state.questionsAsked);
  }

  /**
   * Mark synthesis as generated
   */
  markSynthesisGenerated(synthesis: {
    coreTruths: string[];
    falseAssumptions: string[];
    reconstruction: string;
    actionableInsights: string[];
  }): void {
    if (!this.context?.firstPrinciplesState) return;
    
    this.context.firstPrinciplesState.synthesisGenerated = true;
    this.context.firstPrinciplesState.synthesis = synthesis;
  }

  /**
   * Clear the conversation context
   */
  clear(): void {
    this.context = null;
  }
}

