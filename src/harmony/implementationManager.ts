/**
 * Implementation stage state management
 * Tracks file creation, step completion, and manages implementation process
 */

import { ProgressPlanManager, ProgressPlan, PlanStep } from "../progressPlanManager";
import { CodeContext } from "./codeContext";
import { ConversationContextManager } from "./conversationContext";
import { NativeToolsManager } from "../nativeToolManager";

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
  referredFiles: Array<{ file: string; description?: string }>;  // Files referred to/mentioned in assumptions stage
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
      referredFiles: [],
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
    const allFileModToolCalls = toolCalls.filter(tc => fileModificationTools.includes(tc.name));
    const successfulFileMods = allFileModToolCalls.filter(tc => !tc.result?.isError);

    // If there were file modification tool calls but all failed, revert step to pending
    if (allFileModToolCalls.length > 0 && successfulFileMods.length === 0) {
      if (currentStep.status === 'in_progress') {
        this.progressPlanManager.updateStepStatus(this.state.taskId, currentStep.stepNumber, 'pending');
        console.log(`[ImplementationManager] Reverted step ${currentStep.stepNumber} to pending due to tool call failures`);
      }
      return undefined;
    }

    if (successfulFileMods.length === 0) {
      return undefined;
    }

    // Record all file creations and filter files to only those that match the current step
    const filesForCurrentStep: string[] = [];
    for (const toolCall of successfulFileMods) {
      const filePath = toolCall.arguments?.file_path || toolCall.arguments?.filePath;
      if (filePath) {
        // Always record the file creation (even if it doesn't match the step)
        const status = toolCall.name === 'replace_file' ? 'replaced' : 'created';
        this.recordFileCreated(filePath, currentStep.stepNumber, status);
        
        // Check if file matches current step using filterCodeContextsForStep
        const tempCodeContext = new CodeContext(filePath, ['']);
        const matched = this.filterCodeContextsForStep([tempCodeContext], currentStep);
        if (matched.length > 0) {
          filesForCurrentStep.push(filePath);
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
      
      // For test files, check first and require explicit mention - don't fall through to other checks
      if (fileName.endsWith('.test.py') || fileName.endsWith('_test.py') || fileName.includes('.test.')) {
        // Test files must be explicitly mentioned in step - exact filename match only
        const exactFileNamePattern = new RegExp(`\\b${this.escapeRegex(fileName)}\\b`, 'i');
        const matchesExact = exactFileNamePattern.test(stepText);
        const matchesTestKeyword = stepText.includes('test') || stepText.includes('test.') || stepText.includes('_test');
        // Only match if exact filename is mentioned OR test keyword is explicitly mentioned with base name
        if (!matchesExact && !matchesTestKeyword) {
          return false; // Test files that don't match explicitly should not match at all
        }
        return true;
      }
      
      // First check: exact filename match (e.g., "hello.py" matches "create hello.py")
      // Only check for non-test files
      const fileNamePattern = new RegExp(`\\b${this.escapeRegex(fileName)}\\b`, 'i');
      if (fileNamePattern.test(stepText)) {
        return true;
      }
      
      // For markdown files, require explicit mention
      if (fileName.endsWith('.md')) {
        return stepText.includes('document') || stepText.includes('doc') || stepText.includes('.md') || stepText.includes(fileName);
      }
      
      // Second check: base name match with file type validation (for non-test files)
      // Extract base name (everything before the first dot)
      const baseName = fileName.split('.')[0]; // e.g., "hello" from "hello.py"
      
      // Only match if base name appears AND file type matches step description
      if (stepText.includes(baseName)) {
        // If step mentions test/document, don't match regular .py files
        if (stepText.includes('test') || stepText.includes('document') || stepText.includes('doc')) {
          return false;
        }
        // For regular .py files, must explicitly mention .py or the exact filename
        if (fileName.endsWith('.py')) {
          return stepText.includes('.py') || stepText.includes(fileName);
        }
        // For other file types, allow base name match
        return true;
      }
      
      return false;
    });

    // If we found matches, return them. Otherwise, if there's only one context, use it.
    // This handles cases where the step doesn't explicitly mention the filename
    if (matchedContexts.length > 0) {
      return matchedContexts;
    }
    
    // Fallback: if only one code context remains, use it
    // BUT: Don't match test files or markdown files unless step explicitly mentions them
    const remainingContexts = codeContexts.filter(cc => {
      if (!cc.waitForCreate) return false;
      const fileName = cc.name.toLowerCase();
      // Don't match test files unless step mentions test
      if (fileName.endsWith('.test.py') || fileName.endsWith('_test.py') || fileName.includes('.test.')) {
        return stepText.includes('test') || stepText.includes('test.') || stepText.includes('_test') || stepText.includes(fileName);
      }
      // Don't match markdown files unless step mentions document/doc
      if (fileName.endsWith('.md')) {
        return stepText.includes('document') || stepText.includes('doc') || stepText.includes('.md') || stepText.includes(fileName);
      }
      return true;
    });
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
      referredFiles: [...this.state.referredFiles],
      createdFiles: [...this.state.createdFiles],
      completedSteps: [...this.state.completedSteps],
      taskId: this.state.taskId,
      lastUpdated: this.state.lastUpdated,
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

  /**
   * Generate assumption_data.json file when transitioning from assumptions to implementation stage
   * Creates the CodeContext and generates the diagnostic file
   * Also stores the referred files from assumptions stage in ImplementationManager state
   * 
   * @param assumptionsExport - Data exported from assumptions stage
   * @param nativeToolsManager - Tool manager to create the file
   * @param contextManager - Context manager to store CodeContext
   */
  async generateAssumptionDataFile(
    assumptionsExport: {
      assumptions: string[];
      codeSnippets: Array<{ file: string; description?: string }>;
      progressPlan?: ProgressPlan;
      summary: string;
    },
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager
  ): Promise<void> {
    // Store referred files from assumptions stage in ImplementationManager state
    if (!this.state) {
      this.initialize(assumptionsExport.progressPlan?.taskId);
    }
    if (this.state) {
      this.state.referredFiles = [...assumptionsExport.codeSnippets];
      this.state.lastUpdated = Date.now();
      console.log(`[ImplementationManager] Stored ${assumptionsExport.codeSnippets.length} referred file(s) from assumptions stage`);
    }
    // Create assumption_data.json CodeContext with progressPlan
    // Note: planSteps is redundant (it's already in progressPlan.steps), so we don't include it
    const assumptionsData = {
      assumptions: assumptionsExport.assumptions,
      codeSnippets: assumptionsExport.codeSnippets,
      progressPlan: assumptionsExport.progressPlan,
      summary: assumptionsExport.summary,
    };

    const assumptionDataJson = JSON.stringify(assumptionsData, null, 2);
    const assumptionDataLines = assumptionDataJson.split('\n');
    const assumptionDataContext = new CodeContext(
      'assumption_data.json',
      assumptionDataLines,
      false, // waitForCreate: false - just store, don't create file yet
      'v1',
      Date.now(),
      'Assumptions and analysis data from assumptions stage'
    );

    // Store in context manager if provided
    if (contextManager) {
      contextManager.addCodeContext(assumptionDataContext);
      console.log(`[ImplementationManager] Saved assumption_data to CodeContext (${assumptionsExport.assumptions.length} assumptions, ${assumptionsExport.codeSnippets.length} code snippets${assumptionsExport.progressPlan ? `, plan with ${assumptionsExport.progressPlan.totalSteps} step(s)` : ''})`);
    }

    // Generate the file if nativeToolsManager is provided
    if (nativeToolsManager && contextManager) {
      const context = contextManager.getContext();
      if (context?.codeContexts) {
        const versions = context.codeContexts.get('assumption_data.json');
        if (versions) {
          const activeVersion = versions.find(v => v.isActive);
          if (activeVersion && !activeVersion.waitForCreate) {
            try {
              const content = activeVersion.getContentAsString();
              if (content && content.trim().length > 0) {
                console.log(`[ImplementationManager] Implementation stage: Auto-generating diagnostic file: assumption_data.json`);
                try {
                  const createResult = await nativeToolsManager.callTool('create_file', {
                    file_path: 'assumption_data.json',
                    content: content
                  });
                  
                  if (createResult && !createResult.isError) {
                    console.log(`[ImplementationManager] ✅ Successfully created diagnostic file: assumption_data.json`);
                  } else if (createResult && createResult.content?.[0]?.text?.includes('already exists')) {
                    // File exists, use replace_file
                    const replaceResult = await nativeToolsManager.callTool('replace_file', {
                      file_path: 'assumption_data.json',
                      content: content
                    });
                    if (replaceResult && !replaceResult.isError) {
                      console.log(`[ImplementationManager] ✅ Successfully updated diagnostic file: assumption_data.json`);
                    } else {
                      const errorMsg = replaceResult?.content?.[0]?.text || 'Unknown error';
                      console.warn(`[ImplementationManager] ⚠️ Failed to update diagnostic file assumption_data.json: ${errorMsg}`);
                    }
                  } else {
                    const errorMsg = createResult?.content?.[0]?.text || 'Unknown error';
                    console.warn(`[ImplementationManager] ⚠️ Failed to create diagnostic file assumption_data.json: ${errorMsg}`);
                  }
                } catch (error: any) {
                  // Silently ignore errors during diagnostic file creation (non-critical)
                  console.warn(`[ImplementationManager] ⚠️ Error creating diagnostic file assumption_data.json:`, error.message || error);
                }
              }
            } catch (error: any) {
              console.warn(`[ImplementationManager] ⚠️ Error creating diagnostic file assumption_data.json:`, error);
            }
          }
        }
      }
    }
  }
}

