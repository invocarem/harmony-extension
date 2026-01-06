/**
 * Progress Plan Manager
 * Manages multi-step plans for complex tasks in the Assumptions stage
 */

export interface PlanStep {
  stepNumber: number;
  goal: string;
  description?: string;
  tools?: string[]; // Tools that might be needed for this step
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface ProgressPlan {
  taskId: string;
  originalPrompt: string;
  complexity: 'simple' | 'hard';
  totalSteps: number;
  steps: PlanStep[];
  createdAt: number;
  completedAt?: number;
}

/**
 * ProgressPlanManager - Manages task plans
 */
export class ProgressPlanManager {
  private plans: Map<string, ProgressPlan> = new Map();

  /**
   * Create a new progress plan for a task
   */
  createPlan(
    taskId: string,
    originalPrompt: string,
    complexity: 'simple' | 'hard',
    steps: Array<{ goal: string; description?: string; tools?: string[] }>
  ): ProgressPlan {
    const planSteps: PlanStep[] = steps.map((step, index) => ({
      stepNumber: index + 1,
      goal: step.goal,
      description: step.description,
      tools: step.tools || [],
      status: 'pending',
    }));

    const plan: ProgressPlan = {
      taskId,
      originalPrompt,
      complexity,
      totalSteps: planSteps.length,
      steps: planSteps,
      createdAt: Date.now(),
    };

    this.plans.set(taskId, plan);
    return plan;
  }

  /**
   * Get a plan by task ID
   */
  getPlan(taskId: string): ProgressPlan | undefined {
    return this.plans.get(taskId);
  }

  /**
   * Update step status in a plan
   */
  updateStepStatus(taskId: string, stepNumber: number, status: PlanStep['status']): boolean {
    const plan = this.plans.get(taskId);
    if (!plan) {
      return false;
    }

    const step = plan.steps.find((s) => s.stepNumber === stepNumber);
    if (!step) {
      return false;
    }

    step.status = status;

    // Check if all steps are completed
    if (plan.steps.every((s) => s.status === 'completed')) {
      plan.completedAt = Date.now();
    }

    return true;
  }

  /**
   * Update step details (goal, description, tools) in a plan
   * Preserves the step's current status unless explicitly provided
   */
  updateStep(
    taskId: string,
    stepNumber: number,
    updates: { goal?: string; description?: string; tools?: string[]; status?: PlanStep['status'] }
  ): boolean {
    const plan = this.plans.get(taskId);
    if (!plan) {
      return false;
    }

    const step = plan.steps.find((s) => s.stepNumber === stepNumber);
    if (!step) {
      return false;
    }

    // Update provided fields
    if (updates.goal !== undefined) {
      step.goal = updates.goal;
    }
    if (updates.description !== undefined) {
      step.description = updates.description;
    }
    if (updates.tools !== undefined) {
      step.tools = updates.tools;
    }
    if (updates.status !== undefined) {
      step.status = updates.status;
    }

    // Check if all steps are completed
    if (plan.steps.every((s) => s.status === 'completed')) {
      plan.completedAt = Date.now();
    }

    return true;
  }

  /**
   * Update or replace plan steps
   * If step numbers match existing steps, they are updated; otherwise new steps are added
   * Updates totalSteps count
   */
  updatePlanSteps(
    taskId: string,
    newSteps: Array<{ goal: string; description?: string; tools?: string[] }>,
    preserveStatus: boolean = true
  ): boolean {
    const plan = this.plans.get(taskId);
    if (!plan) {
      return false;
    }

    // Create new step objects with step numbers
    const updatedSteps: PlanStep[] = newSteps.map((step, index) => {
      const stepNumber = index + 1;
      const existingStep = plan.steps.find((s) => s.stepNumber === stepNumber);
      
      return {
        stepNumber,
        goal: step.goal,
        description: step.description,
        tools: step.tools || [],
        // Preserve status if requested and step exists, otherwise default to pending
        status: preserveStatus && existingStep ? existingStep.status : 'pending',
      };
    });

    plan.steps = updatedSteps;
    plan.totalSteps = updatedSteps.length;

    // Check if all steps are completed
    if (plan.steps.every((s) => s.status === 'completed')) {
      plan.completedAt = Date.now();
    } else if (plan.completedAt) {
      // If plan was completed but now has incomplete steps, clear completedAt
      plan.completedAt = undefined;
    }

    return true;
  }

  /**
   * Mark a plan as completed
   */
  completePlan(taskId: string): boolean {
    const plan = this.plans.get(taskId);
    if (!plan) {
      return false;
    }

    plan.steps.forEach((step) => {
      step.status = 'completed';
    });
    plan.completedAt = Date.now();
    return true;
  }

  /**
   * Delete a plan
   */
  deletePlan(taskId: string): boolean {
    return this.plans.delete(taskId);
  }

  /**
   * Get all plans
   */
  getAllPlans(): ProgressPlan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Clear all plans
   */
  clearAll(): void {
    this.plans.clear();
  }

  /**
   * Convert plan to JSON string
   */
  toJSON(plan: ProgressPlan): string {
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Parse plan from JSON string
   */
  fromJSON(json: string): ProgressPlan | null {
    try {
      return JSON.parse(json) as ProgressPlan;
    } catch (error) {
      console.error('[ProgressPlanManager] Error parsing plan JSON:', error);
      return null;
    }
  }
}

