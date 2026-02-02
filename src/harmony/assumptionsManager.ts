/**
 * Assumptions stage state management
 * Tracks assumptions/analysis responses, code snippets, and provides aggregation for stage transitions
 */

import {
  ProgressPlanManager,
  ProgressPlan,
  PlanStep,
} from "../progressPlanManager";
import { AutoTransitionManager } from "./autoTransitionManager";
import { NativeToolsManager } from "../nativeToolManager";
import { ConversationContextManager } from "./conversationContext";
import { CodeContext } from "./codeContext";
import { ChatMessage } from "../conversationManager";

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
  assumptions: string[]; // Assistant analysis/assumption responses
  codeSnippets: AssumptionCodeSnippet[]; // Code snippets extracted
  taskId?: string; // Reference to ProgressPlan taskId
  lastUpdated: number;
  allowMoveToImplementation: boolean; // True when a plan has been created or updated
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
  private autoTransitionManager: AutoTransitionManager;

  constructor(
    progressPlanManager: ProgressPlanManager,
    autoTransitionManager?: AutoTransitionManager
  ) {
    this.progressPlanManager = progressPlanManager;
    // Create AutoTransitionManager if not provided (for backwards compatibility)
    this.autoTransitionManager =
      autoTransitionManager || new AutoTransitionManager(progressPlanManager);
  }

  /**
   * Initialize assumptions state (called when entering assumptions stage)
   */
  initialize(): void {
    this.state = {
      assumptions: [],
      codeSnippets: [],
      lastUpdated: Date.now(),
      allowMoveToImplementation: false,
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
      console.log(
        `[AssumptionsManager] Added assumption: "${trimmed.substring(0, 50)}${trimmed.length > 50 ? "..." : ""}"`
      );
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
    const existingIndex = this.state.codeSnippets.findIndex(
      (s) => s.file === file
    );
    if (existingIndex >= 0) {
      // Update existing snippet
      this.state.codeSnippets[existingIndex] = {
        file,
        description:
          description || this.state.codeSnippets[existingIndex].description,
        extractedAt:
          this.state.codeSnippets[existingIndex].extractedAt || Date.now(),
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
    console.log(
      `[AssumptionsManager] Added code snippet: ${file}${description ? ` (${description})` : ""}`
    );
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
   * Check if transition to implementation is allowed (plan has been created or updated)
   */
  allowMoveToImplementation(): boolean {
    return this.state !== null && this.state.allowMoveToImplementation;
  }

  /**
   * Create or update a plan based on assumptions stage response
   * This is the central place for plan creation during assumptions stage
   *
   * @param existingTaskId - Optional taskId of an existing plan to update (e.g., from context manager)
   */
  createOrUpdatePlan(
    content: string,
    originalPrompt: string,
    reasoning?: string,
    toolCalls?: any[],
    existingTaskId?: string
  ): ProgressPlan | null {
    if (!originalPrompt) {
      return null;
    }

    // Use AutoTransitionManager for complexity detection
    let complexity: "simple" | "hard" =
      this.autoTransitionManager.detectTaskComplexity(
        content,
        reasoning,
        toolCalls,
        originalPrompt
      ) || "simple";

    // Extract steps from LLM content only; no plan/steps → do not update, stay in assumptions
    let steps = this.autoTransitionManager.getStepsFromContent(content);
    if (steps.length === 0) {
      console.log(
        `[AssumptionsManager] No plan or steps detected in content, not updating plan`
      );
      return null;
    }

    // If the content only yields 0-2 actionable steps, treat it as a simple task
    const isGenericFallback =
      steps.length > 0 && /^complete\s+the\s+task$/i.test(steps[0].description);
    if ((complexity === "hard" && steps.length <= 2) || isGenericFallback) {
      complexity = "simple";
      console.log(
        `[AssumptionsManager] Detected <3 steps or generic fallback with hard complexity, reverting to simple plan (${steps.length} step(s))`
      );
    }

    // Use existing plan if available, otherwise create new one
    // Priority: 1. existingTaskId parameter, 2. this.state?.taskId, 3. create new
    let plan: ProgressPlan;
    const taskIdToUse = existingTaskId || this.state?.taskId;

    if (taskIdToUse) {
      const existingPlan = this.progressPlanManager.getPlan(taskIdToUse);
      if (existingPlan) {
        // Update existing plan
        this.progressPlanManager.updatePlanSteps(
          taskIdToUse,
          steps,
          true // preserveStatus
        );
        plan = this.progressPlanManager.getPlan(taskIdToUse)!;
        // Ensure taskId is set in state if it wasn't already
        if (!this.state?.taskId) {
          this.setTaskId(taskIdToUse);
        }
      } else {
        // Plan not found, create new plan
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        plan = this.progressPlanManager.createPlan(
          taskId,
          originalPrompt,
          complexity,
          steps
        );
        this.setTaskId(taskId);
      }
    } else {
      // Create new plan
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      plan = this.progressPlanManager.createPlan(
        taskId,
        originalPrompt,
        complexity,
        steps
      );
      this.setTaskId(taskId);
    }

    console.log(
      `[AssumptionsManager] Plan ${plan.taskId} - ${complexity} complexity, ${plan.totalSteps} step(s)`
    );
    
    // Enable transition to implementation once plan is created/updated
    if (this.state) {
      this.state.allowMoveToImplementation = true;
      console.log(`[AssumptionsManager] Transition to implementation now allowed`);
    }
    
    return plan;
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
        summary: "No assumptions data collected.",
      };
    }

    // Get progressPlan from ProgressPlanManager if taskId is set
    let progressPlan = this.state.taskId
      ? this.progressPlanManager.getPlan(this.state.taskId)
      : undefined;

    // ENFORCEMENT: If no plan exists and we have originalPrompt, create a plan
    // Use the centralized plan creation method
    if (!progressPlan && originalPrompt) {
      const createdPlan = this.createOrUpdatePlan("", originalPrompt);
      if (createdPlan) {
        progressPlan = createdPlan;
      }
    }

    // Create summary
    const summary = `Analysis and assumptions from ${this.state.assumptions.length} response(s) in assumptions stage. Generated ${this.state.codeSnippets.length} code snippet(s).${progressPlan ? ` Plan created with ${progressPlan.totalSteps} step(s) (complexity: ${progressPlan.complexity}).` : ""}`;

    return {
      assumptions: [...this.state.assumptions],
      codeSnippets: this.state.codeSnippets.map((s) => ({
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
    return (
      this.state !== null &&
      (this.state.assumptions.length > 0 || this.state.codeSnippets.length > 0)
    );
  }

  /**
   * Generate aggregated_prompt.json file when transitioning from chat to assumptions stage
   * Creates the CodeContext and generates the diagnostic file
   *
   * @param chatData - Data from chat stage (queries, assistant responses, related files)
   * @param conversationHistory - Full conversation history to extract chat stage messages
   * @param nativeToolsManager - Tool manager to create the file
   * @param contextManager - Context manager to store CodeContext
   */
  async generateAggregatedPromptFile(
    chatData: {
      queries: string[];
      assistantResponses: Array<{ content: string; reasoning?: string }>;
      referredFiles: Array<{ file: string; description?: string }>;
    },
    conversationHistory: readonly ChatMessage[] | undefined,
    nativeToolsManager?: NativeToolsManager,
    contextManager?: ConversationContextManager
  ): Promise<void> {
    if (!chatData.queries || chatData.queries.length === 0) {
      console.log(
        `[AssumptionsManager] No chat queries to aggregate, skipping aggregated_prompt.json generation`
      );
      return;
    }

    // Create JSON structure for aggregated_prompt
    const aggregatedPromptData = {
      queries: chatData.queries,
      assistantResponses: chatData.assistantResponses || [],
      referredFiles: chatData.referredFiles || [],
      summary: `Aggregated user queries from chat stage: ${chatData.queries.length} queries, ${chatData.assistantResponses.length || 0} assistant responses, ${chatData.referredFiles.length || 0} referred files`,
    };

    // Save aggregatedPrompt as JSON to CodeContext
    const promptJson = JSON.stringify(aggregatedPromptData, null, 2);
    const promptLines = promptJson.split("\n");
    const promptContext = new CodeContext(
      "aggregated_prompt.json",
      promptLines,
      false, // waitForCreate: false - just store, don't create file yet
      "v1",
      Date.now(),
      "Aggregated user queries and assistant responses from chat stage"
    );

    // Store in context manager if provided
    if (contextManager) {
      contextManager.addCodeContext(promptContext);
      console.log(
        `[AssumptionsManager] Saved aggregatedPrompt to CodeContext (${chatData.queries.length} queries, ${chatData.assistantResponses.length || 0} assistant responses, ${chatData.referredFiles.length || 0} referred files)`
      );
    }

    // Generate the file if nativeToolsManager is provided
    if (nativeToolsManager && contextManager) {
      const context = contextManager.getContext();
      if (context?.codeContexts) {
        const versions = context.codeContexts.get("aggregated_prompt.json");
        if (versions) {
          const activeVersion = versions.find((v) => v.isActive);
          if (activeVersion && !activeVersion.waitForCreate) {
            try {
              const content = activeVersion.getContentAsString();
              if (content && content.trim().length > 0) {
                console.log(
                  `[AssumptionsManager] Assumptions stage: Auto-generating diagnostic file: aggregated_prompt.json`
                );
                try {
                  const createResult = await nativeToolsManager.callTool(
                    "create_file",
                    {
                      file_path: ".harmony/aggregated_prompt.json",
                      content: content,
                    }
                  );

                  if (createResult && !createResult.isError) {
                    console.log(
                      `[AssumptionsManager] ✅ Successfully created diagnostic file: aggregated_prompt.json`
                    );
                  } else if (
                    createResult &&
                    createResult.content?.[0]?.text?.includes("already exists")
                  ) {
                    // File exists, use replace_file
                    const replaceResult = await nativeToolsManager.callTool(
                      "replace_file",
                      {
                        file_path: ".harmony/aggregated_prompt.json",
                        content: content,
                      }
                    );
                    if (replaceResult && !replaceResult.isError) {
                      console.log(
                        `[AssumptionsManager] ✅ Successfully updated diagnostic file: aggregated_prompt.json`
                      );
                    } else {
                      const errorMsg =
                        replaceResult?.content?.[0]?.text || "Unknown error";
                      console.warn(
                        `[AssumptionsManager] ⚠️ Failed to update diagnostic file aggregated_prompt.json: ${errorMsg}`
                      );
                    }
                  } else {
                    const errorMsg =
                      createResult?.content?.[0]?.text || "Unknown error";
                    console.warn(
                      `[AssumptionsManager] ⚠️ Failed to create diagnostic file aggregated_prompt.json: ${errorMsg}`
                    );
                  }
                } catch (error: any) {
                  // Silently ignore errors during diagnostic file creation (non-critical)
                  console.warn(
                    `[AssumptionsManager] ⚠️ Error creating diagnostic file aggregated_prompt.json:`,
                    error.message || error
                  );
                }
              }
            } catch (error: any) {
              console.warn(
                `[AssumptionsManager] ⚠️ Error creating diagnostic file aggregated_prompt.json:`,
                error
              );
            }
          }
        }
      }
    }
  }
}
