/**
 * Assumptions stage state management
 * Tracks assumptions/analysis responses, code snippets, and provides aggregation for stage transitions
 */

import { ProgressPlanManager, ProgressPlan, PlanStep } from "../progressPlanManager";

/**
 * Represents a code snippet extracted during assumptions stage
 */
export interface AssumptionCodeSnippet {
  file: string;
  description?: string;
  extractedAt?: number;
}

/**
 * Assumptions stage state
 */
export interface AssumptionState {
  assumptions: string[];              // Assistant analysis/assumption responses
  codeSnippets: AssumptionCodeSnippet[];  // Code snippets extracted
  taskId?: string;                    // Reference to ProgressPlan taskId
  lastUpdated: number;
}

/**
 * Manages assumptions stage state and operations
 * 
 * Responsibilities:
 * - Track all assistant responses in assumptions stage
 * - Store code snippets extracted during assumptions stage
 * - Reference ProgressPlan created in assumptions stage
 * - Aggregate data for stage transitions (including progressPlan and planSteps)
 */
export class AssumptionsManager {
  private state: AssumptionState | null = null;
  private progressPlanManager: ProgressPlanManager;

  constructor(progressPlanManager: ProgressPlanManager) {
    this.progressPlanManager = progressPlanManager;
  }

  /**
   * Initialize assumptions state (called when entering assumptions stage)
   */
  initialize(): void {
    this.state = {
      assumptions: [],
      codeSnippets: [],
      lastUpdated: Date.now(),
    };
    console.log(`[AssumptionsManager] Initialized assumptions state`);
  }

  /**
   * Add an assumption/analysis response from assistant
   */
  addAssumption(assumption: string): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    const trimmed = assumption.trim();
    if (trimmed.length > 0) {
      this.state.assumptions.push(trimmed);
      this.state.lastUpdated = Date.now();
      console.log(`[AssumptionsManager] Added assumption: "${trimmed.substring(0, 50)}${trimmed.length > 50 ? '...' : ''}"`);
    }
  }

  /**
   * Add a code snippet extracted during assumptions stage
   */
  addCodeSnippet(file: string, description?: string): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    // Check if snippet already exists for this file
    const existingIndex = this.state.codeSnippets.findIndex(s => s.file === file);
    if (existingIndex >= 0) {
      // Update existing snippet
      this.state.codeSnippets[existingIndex] = {
        file,
        description: description || this.state.codeSnippets[existingIndex].description,
        extractedAt: this.state.codeSnippets[existingIndex].extractedAt || Date.now(),
      };
    } else {
      // Add new snippet
      this.state.codeSnippets.push({
        file,
        description,
        extractedAt: Date.now(),
      });
    }

    this.state.lastUpdated = Date.now();
    console.log(`[AssumptionsManager] Added code snippet: ${file}${description ? ` (${description})` : ''}`);
  }

  /**
   * Set the task ID reference to ProgressPlan
   * Called when a plan is created in assumptions stage
   */
  setTaskId(taskId: string): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    this.state.taskId = taskId;
    this.state.lastUpdated = Date.now();
    console.log(`[AssumptionsManager] Set task ID: ${taskId}`);
  }

  /**
   * Get the ProgressPlan from ProgressPlanManager
   * Returns undefined if no taskId is set or plan doesn't exist
   */
  getProgressPlan(): ProgressPlan | undefined {
    if (!this.state || !this.state.taskId) {
      return undefined;
    }

    return this.progressPlanManager.getPlan(this.state.taskId);
  }

  /**
   * Get all assumptions
   */
  getAllAssumptions(): string[] {
    if (!this.state) return [];
    return [...this.state.assumptions];
  }

  /**
   * Get all code snippets
   */
  getAllCodeSnippets(): AssumptionCodeSnippet[] {
    if (!this.state) return [];
    return [...this.state.codeSnippets];
  }

  /**
   * Get task ID
   */
  getTaskId(): string | undefined {
    return this.state?.taskId;
  }

  /**
   * Get full assumptions state (for debugging/inspection)
   */
  getState(): AssumptionState | null {
    if (!this.state) return null;
    return {
      ...this.state,
      assumptions: [...this.state.assumptions],
      codeSnippets: [...this.state.codeSnippets],
    };
  }

  /**
   * Clear assumptions state (when transitioning out of assumptions stage or starting new conversation)
   */
  clear(): void {
    this.state = null;
    console.log(`[AssumptionsManager] Cleared assumptions state`);
  }

  /**
   * Export assumptions data for transition to implementation stage
   * Includes assumptions, code snippets, and progressPlan
   * Note: planSteps is redundant (it's already in progressPlan.steps), so we don't export it separately
   * Ensures a plan exists before export (creates default plan if needed)
   */
  exportForTransition(originalPrompt?: string): {
    assumptions: string[];
    codeSnippets: Array<{ file: string; description?: string }>;
    progressPlan?: ProgressPlan;
    summary: string;
  } {
    if (!this.state) {
      return {
        assumptions: [],
        codeSnippets: [],
        summary: 'No assumptions data collected.',
      };
    }

    // Get progressPlan from ProgressPlanManager if taskId is set
    let progressPlan = this.state.taskId 
      ? this.progressPlanManager.getPlan(this.state.taskId)
      : undefined;

    // ENFORCEMENT: If no plan exists and we have originalPrompt, create a default plan
    if (!progressPlan && originalPrompt) {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Use originalPrompt to create a more meaningful description
      const description = originalPrompt.length > 150 
        ? `Execute the task: ${originalPrompt.substring(0, 150)}...`
        : `Execute the task: ${originalPrompt}`;
      progressPlan = this.progressPlanManager.createPlan(
        taskId,
        originalPrompt,
        'simple',
        [{ goal: 'Complete the task', description }]
      );
      this.setTaskId(taskId);
      console.log(`[AssumptionsManager] Created default plan with taskId: ${taskId}`);
    }

    // Create summary
    const summary = `Analysis and assumptions from ${this.state.assumptions.length} response(s) in assumptions stage. Generated ${this.state.codeSnippets.length} code snippet(s).${progressPlan ? ` Plan created with ${progressPlan.totalSteps} step(s) (complexity: ${progressPlan.complexity}).` : ''}`;

    return {
      assumptions: [...this.state.assumptions],
      codeSnippets: this.state.codeSnippets.map(s => ({
        file: s.file,
        description: s.description,
      })),
      progressPlan,
      // Note: planSteps is redundant (it's already in progressPlan.steps), so we don't export it
      summary,
    };
  }

  /**
   * Check if assumptions state has meaningful content
   */
  hasContent(): boolean {
    return this.state !== null && (
      this.state.assumptions.length > 0 || 
      this.state.codeSnippets.length > 0
    );
  }
}

