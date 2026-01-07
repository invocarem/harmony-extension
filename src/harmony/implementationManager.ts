/**
 * Implementation stage state management
 * Tracks file creation, step completion, and manages implementation process
 */

import { ProgressPlanManager, ProgressPlan, PlanStep } from "../progressPlanManager";
import { CodeContext } from "./codeContext";

/**
 * Represents a file created during implementation stage
 */
export interface ImplementationFile {
  file: string;
  stepNumber: number;
  createdAt: number;
  status: 'created' | 'replaced' | 'error';
  error?: string;
}

/**
 * Implementation stage state
 */
export interface ImplementationState {
  createdFiles: ImplementationFile[];  // Files created during implementation
  completedSteps: number[];            // Step numbers that have been completed
  taskId?: string;                     // Reference to ProgressPlan taskId
  lastUpdated: number;
}

/**
 * Manages implementation stage state and operations
 * 
 * Responsibilities:
 * - Track files created during implementation stage
 * - Track step completion status
 * - Match CodeContexts to plan steps
 * - Manage implementation process flow
 */
export class ImplementationManager {
  private state: ImplementationState | null = null;
  private progressPlanManager: ProgressPlanManager;

  constructor(progressPlanManager: ProgressPlanManager) {
    this.progressPlanManager = progressPlanManager;
  }

  /**
   * Initialize implementation state (called when entering implementation stage)
   */
  initialize(taskId?: string): void {
    this.state = {
      createdFiles: [],
      completedSteps: [],
      taskId,
      lastUpdated: Date.now(),
    };
    console.log(`[ImplementationManager] Initialized implementation state${taskId ? ` for task: ${taskId}` : ''}`);
    
    // When initializing, set the first pending step to in_progress
    if (taskId) {
      const plan = this.progressPlanManager.getPlan(taskId);
      if (plan) {
        const firstPendingStep = plan.steps.find(step => step.status === 'pending');
        if (firstPendingStep) {
          this.progressPlanManager.updateStepStatus(taskId, firstPendingStep.stepNumber, 'in_progress');
          console.log(`[ImplementationManager] Set step ${firstPendingStep.stepNumber} to in_progress on initialization`);
        }
      }
    }
  }

  /**
   * Set the task ID reference to ProgressPlan
   * Called when entering implementation stage with an existing plan
   */
  setTaskId(taskId: string): void {
    if (!this.state) {
      this.initialize(taskId);
      return;
    }

    if (!this.state) return;

    this.state.taskId = taskId;
    this.state.lastUpdated = Date.now();
    console.log(`[ImplementationManager] Set task ID: ${taskId}`);
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
   * Get current step (pending or in_progress)
   */
  getCurrentStep(): PlanStep | undefined {
    const plan = this.getProgressPlan();
    if (!plan) {
      return undefined;
    }

    return plan.steps.find(step => 
      step.status === 'pending' || step.status === 'in_progress'
    );
  }

  /**
   * Mark a step as completed
   */
  completeStep(stepNumber: number): boolean {
    if (!this.state || !this.state.taskId) {
      console.warn(`[ImplementationManager] Cannot complete step ${stepNumber}: no state or taskId`);
      return false;
    }

    const plan = this.progressPlanManager.getPlan(this.state.taskId);
    if (!plan) {
      console.warn(`[ImplementationManager] Cannot complete step ${stepNumber}: plan not found`);
      return false;
    }

    const success = this.progressPlanManager.updateStepStatus(
      this.state.taskId,
      stepNumber,
      'completed'
    );

    if (success && !this.state.completedSteps.includes(stepNumber)) {
      this.state.completedSteps.push(stepNumber);
      this.state.lastUpdated = Date.now();
      console.log(`[ImplementationManager] Marked step ${stepNumber} as completed`);
    }

    return success;
  }

  /**
   * Mark next step as in_progress
   */
  advanceToNextStep(): PlanStep | undefined {
    if (!this.state || !this.state.taskId) {
      return undefined;
    }

    const plan = this.progressPlanManager.getPlan(this.state.taskId);
    if (!plan) {
      return undefined;
    }

    const nextStep = plan.steps.find(step => step.status === 'pending');
    if (!nextStep) {
      return undefined;
    }

    const success = this.progressPlanManager.updateStepStatus(
      this.state.taskId,
      nextStep.stepNumber,
      'in_progress'
    );

    if (success) {
      this.state.lastUpdated = Date.now();
      console.log(`[ImplementationManager] Advanced to step ${nextStep.stepNumber}: ${nextStep.goal}`);
    }

    return success ? nextStep : undefined;
  }

  /**
   * Process file creations from tool calls and complete the current step if files match
   * Returns the step number that was completed, or undefined if no step was completed
   */
  processFileCreations(toolCalls: Array<{ name: string; arguments: Record<string, any>; result?: any }>): number | undefined {
    if (!this.state || !this.state.taskId) {
      return undefined;
    }

    const currentStep = this.getCurrentStep();
    if (!currentStep) {
      return undefined;
    }

    const fileModificationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
    const successfulFileMods = toolCalls.filter(tc => 
      fileModificationTools.includes(tc.name) && !tc.result?.isError
    );

    if (successfulFileMods.length === 0) {
      return undefined;
    }

    // Filter files to only those that match the current step
    const filesForCurrentStep: string[] = [];
    for (const toolCall of successfulFileMods) {
      const filePath = toolCall.arguments?.file_path || toolCall.arguments?.filePath;
      if (filePath) {
        // Check if file matches current step using filterCodeContextsForStep
        const tempCodeContext = new CodeContext(filePath, ['']);
        const matched = this.filterCodeContextsForStep([tempCodeContext], currentStep);
        if (matched.length > 0) {
          filesForCurrentStep.push(filePath);
          const status = toolCall.name === 'replace_file' ? 'replaced' : 'created';
          this.recordFileCreated(filePath, currentStep.stepNumber, status);
        }
      }
    }

    // Only complete step if at least one file matches this step
    if (filesForCurrentStep.length > 0) {
      const success = this.completeStep(currentStep.stepNumber);
      if (success) {
        console.log(
          `[ImplementationManager] Completed step ${currentStep.stepNumber} (${currentStep.goal}) after creating file(s): ${filesForCurrentStep.join(', ')}`
        );
        return currentStep.stepNumber;
      }
    } else {
      console.log(
        `[ImplementationManager] Created file(s) but none match current step ${currentStep.stepNumber} (${currentStep.goal}), not completing step`
      );
    }

    return undefined;
  }

  /**
   * Record a file creation
   */
  recordFileCreated(
    fileName: string,
    stepNumber: number,
    status: 'created' | 'replaced' | 'error' = 'created',
    error?: string
  ): void {
    if (!this.state) {
      this.initialize();
    }

    if (!this.state) return;

    // Check if file already recorded
    const existingIndex = this.state.createdFiles.findIndex(f => f.file === fileName && f.stepNumber === stepNumber);
    if (existingIndex >= 0) {
      // Update existing record
      this.state.createdFiles[existingIndex] = {
        file: fileName,
        stepNumber,
        createdAt: this.state.createdFiles[existingIndex].createdAt,
        status,
        error,
      };
    } else {
      // Add new record
      this.state.createdFiles.push({
        file: fileName,
        stepNumber,
        createdAt: Date.now(),
        status,
        error,
      });
    }

    this.state.lastUpdated = Date.now();
    console.log(`[ImplementationManager] Recorded file: ${fileName} for step ${stepNumber} (${status})`);
  }

  /**
   * Filter code contexts to match the current step
   * Matches based on filename mentioned in step goal/description
   */
  filterCodeContextsForStep(codeContexts: CodeContext[], step: PlanStep): CodeContext[] {
    if (!codeContexts || codeContexts.length === 0) {
      return [];
    }

    // Extract potential filenames from step goal and description
    const stepText = `${step.goal} ${step.description || ''}`.toLowerCase();
    
    // Find code contexts whose filename is mentioned in the step
    const matchedContexts = codeContexts.filter(codeContext => {
      const fileName = codeContext.name.toLowerCase();
      const baseName = fileName.split('.')[0]; // e.g., "hello" from "hello.py"
      
      // First check: exact filename match (e.g., "hello.py" matches "create hello.py")
      const fileNamePattern = new RegExp(`\\b${this.escapeRegex(fileName)}\\b`, 'i');
      if (fileNamePattern.test(stepText)) {
        return true;
      }
      
      // Second check: base name match with file type validation
      // Only match if base name appears AND file type matches step description
      if (stepText.includes(baseName)) {
        return this.isFileTypeMatch(fileName, stepText);
      }
      
      return false;
    });

    // If we found matches, return them. Otherwise, if there's only one context, use it.
    // This handles cases where the step doesn't explicitly mention the filename
    if (matchedContexts.length > 0) {
      return matchedContexts;
    }
    
    // Fallback: if only one code context remains, use it
    const remainingContexts = codeContexts.filter(cc => cc.waitForCreate);
    if (remainingContexts.length === 1) {
      return remainingContexts;
    }

    // If multiple contexts remain and none match, return empty to let LLM decide
    return [];
  }

  /**
   * Check if file type matches step description
   */
  private isFileTypeMatch(fileName: string, stepText: string): boolean {
    // Check test files first - must explicitly mention test
    if (fileName.endsWith('.test.py') || fileName.endsWith('_test.py')) {
      // For test files, require explicit mention of "test" or the exact filename pattern
      // Don't match if step only mentions base name without test keyword
      return stepText.includes('test') || stepText.includes('test.') || stepText.includes('_test') || stepText.includes(fileName);
    }
    // Check markdown files - must explicitly mention document/doc/md
    if (fileName.endsWith('.md')) {
      return stepText.includes('document') || stepText.includes('doc') || stepText.includes('.md') || stepText.includes(fileName);
    }
    // For regular .py files, must NOT be a test file, and must match .py or be the main file
    if (fileName.endsWith('.py') && !fileName.includes('.test.') && !fileName.endsWith('_test.py')) {
      // If step mentions test/document, don't match regular .py
      if (stepText.includes('test') || stepText.includes('document') || stepText.includes('doc')) {
        return false;
      }
      // Must explicitly mention .py OR the exact filename
      return stepText.includes('.py') || stepText.includes(fileName);
    }
    return false;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get all created files
   */
  getCreatedFiles(): ImplementationFile[] {
    if (!this.state) return [];
    return [...this.state.createdFiles];
  }

  /**
   * Get files created for a specific step
   */
  getFilesForStep(stepNumber: number): ImplementationFile[] {
    if (!this.state) return [];
    return this.state.createdFiles.filter(f => f.stepNumber === stepNumber);
  }

  /**
   * Get completed steps
   */
  getCompletedSteps(): number[] {
    if (!this.state) return [];
    return [...this.state.completedSteps];
  }

  /**
   * Get task ID
   */
  getTaskId(): string | undefined {
    return this.state?.taskId;
  }

  /**
   * Get full implementation state (for debugging/inspection)
   */
  getState(): ImplementationState | null {
    if (!this.state) return null;
    return {
      ...this.state,
      createdFiles: [...this.state.createdFiles],
      completedSteps: [...this.state.completedSteps],
    };
  }

  /**
   * Check if implementation is complete (all steps completed)
   */
  isComplete(): boolean {
    const plan = this.getProgressPlan();
    if (!plan) {
      return false;
    }

    return plan.steps.every(step => step.status === 'completed');
  }

  /**
   * Clear implementation state (when transitioning out of implementation stage or starting new conversation)
   */
  clear(): void {
    this.state = null;
    console.log(`[ImplementationManager] Cleared implementation state`);
  }

  /**
   * Get summary of implementation progress
   */
  getSummary(): string {
    if (!this.state) {
      return 'No implementation data collected.';
    }

    const plan = this.getProgressPlan();
    const totalSteps = plan?.totalSteps || 0;
    const completedCount = this.state.completedSteps.length;
    const createdCount = this.state.createdFiles.length;

    return `Implementation progress: ${completedCount}/${totalSteps} step(s) completed, ${createdCount} file(s) created.`;
  }
}

