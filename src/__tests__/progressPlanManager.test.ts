import { ProgressPlanManager, ProgressPlan, PlanStep } from '../progressPlanManager';

describe('ProgressPlanManager', () => {
  let manager: ProgressPlanManager;

  beforeEach(() => {
    manager = new ProgressPlanManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('createPlan', () => {
    it('should create a plan with given steps', () => {
      const taskId = 'test-task-1';
      const originalPrompt = 'Create a new feature';
      const steps = [
        { description: 'Step 1 description' },
        { description: 'Step 2 description' },
      ];

      const plan = manager.createPlan(taskId, originalPrompt, 'hard', steps);

      expect(plan.taskId).toBe(taskId);
      expect(plan.originalPrompt).toBe(originalPrompt);
      expect(plan.complexity).toBe('hard');
      expect(plan.totalSteps).toBe(2);
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].stepNumber).toBe(1);
      expect(plan.steps[0].description).toBe('Step 1 description');
      expect(plan.steps[0].status).toBe('pending');
      expect(plan.steps[1].stepNumber).toBe(2);
      expect(plan.steps[1].description).toBe('Step 2 description');
      expect(plan.steps[1].status).toBe('pending');
      expect(plan.createdAt).toBeDefined();
      expect(plan.completedAt).toBeUndefined();
    });

    it('should create a simple plan', () => {
      const taskId = 'test-task-simple';
      const steps = [{ description: 'Single step goal' }];

      const plan = manager.createPlan(taskId, 'Simple task', 'simple', steps);

      expect(plan.complexity).toBe('simple');
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps).toHaveLength(1);
    });

    it('should handle steps with tools', () => {
      const taskId = 'test-task-tools';
      const steps = [
        {
          description: 'Description',
          tools: ['read_file', 'write_file'],
        },
      ];

      const plan = manager.createPlan(taskId, 'Task with tools', 'hard', steps);

      expect(plan.steps[0].tools).toEqual(['read_file', 'write_file']);
    });

    it('should default tools to empty array if not provided', () => {
      const taskId = 'test-task-no-tools';
      const steps = [{ description: 'Step without tools' }];

      const plan = manager.createPlan(taskId, 'Task', 'simple', steps);

      expect(plan.steps[0].tools).toEqual([]);
    });

    it('should assign sequential step numbers', () => {
      const taskId = 'test-task-sequential';
      const steps = [
        { description: 'Step 1' },
        { description: 'Step 2' },
        { description: 'Step 3' },
        { description: 'Step 4' },
      ];

      const plan = manager.createPlan(taskId, 'Task', 'hard', steps);

      plan.steps.forEach((step, index) => {
        expect(step.stepNumber).toBe(index + 1);
      });
    });

    it('should store the plan for retrieval', () => {
      const taskId = 'test-task-stored';
      const steps = [{ description: 'Test goal' }];

      manager.createPlan(taskId, 'Task', 'simple', steps);

      const retrievedPlan = manager.getPlan(taskId);
      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan?.taskId).toBe(taskId);
    });
  });

  describe('getPlan', () => {
    it('should return undefined for non-existent plan', () => {
      const plan = manager.getPlan('non-existent-task');
      expect(plan).toBeUndefined();
    });

    it('should return the plan for existing task ID', () => {
      const taskId = 'test-task-get';
      const steps = [{ description: 'Test goal' }];

      const createdPlan = manager.createPlan(taskId, 'Task', 'simple', steps);
      const retrievedPlan = manager.getPlan(taskId);

      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan).toEqual(createdPlan);
    });
  });

  describe('updateStepStatus', () => {
    it('should update step status successfully', () => {
      const taskId = 'test-task-update';
      const steps = [
        { description: 'Step 1' },
        { description: 'Step 2' },
        { description: 'Step 3' },
      ];

      manager.createPlan(taskId, 'Task', 'hard', steps);

      const result = manager.updateStepStatus(taskId, 2, 'in_progress');
      const plan = manager.getPlan(taskId);

      expect(result).toBe(true);
      expect(plan?.steps[1].status).toBe('in_progress');
      expect(plan?.steps[0].status).toBe('pending');
      expect(plan?.steps[2].status).toBe('pending');
    });

    it('should set completedAt when all steps are completed', () => {
      const taskId = 'test-task-complete';
      const steps = [{ description: 'Step 1' }, { description: 'Step 2' }];

      manager.createPlan(taskId, 'Task', 'hard', steps);

      manager.updateStepStatus(taskId, 1, 'completed');
      let plan = manager.getPlan(taskId);
      expect(plan?.completedAt).toBeUndefined();

      manager.updateStepStatus(taskId, 2, 'completed');
      plan = manager.getPlan(taskId);

      expect(plan?.completedAt).toBeDefined();
      expect(typeof plan?.completedAt).toBe('number');
    });

    it('should return false for non-existent task', () => {
      const result = manager.updateStepStatus('non-existent', 1, 'in_progress');
      expect(result).toBe(false);
    });

    it('should return false for non-existent step number', () => {
      const taskId = 'test-task';
      manager.createPlan(taskId, 'Task', 'simple', [{ description: 'Step 1' }]);

      const result = manager.updateStepStatus(taskId, 999, 'in_progress');
      expect(result).toBe(false);
    });

    it('should handle all status transitions', () => {
      const taskId = 'test-task-statuses';
      manager.createPlan(taskId, 'Task', 'simple', [{ description: 'Step 1' }]);

      manager.updateStepStatus(taskId, 1, 'in_progress');
      expect(manager.getPlan(taskId)?.steps[0].status).toBe('in_progress');

      manager.updateStepStatus(taskId, 1, 'completed');
      expect(manager.getPlan(taskId)?.steps[0].status).toBe('completed');
    });
  });

  describe('completePlan', () => {
    it('should mark all steps as completed', () => {
      const taskId = 'test-task-complete-all';
      const steps = [
        { description: 'Step 1' },
        { description: 'Step 2' },
        { description: 'Step 3' },
      ];

      manager.createPlan(taskId, 'Task', 'hard', steps);

      const result = manager.completePlan(taskId);
      const plan = manager.getPlan(taskId);

      expect(result).toBe(true);
      expect(plan?.steps.every((step) => step.status === 'completed')).toBe(true);
      expect(plan?.completedAt).toBeDefined();
    });

    it('should return false for non-existent task', () => {
      const result = manager.completePlan('non-existent');
      expect(result).toBe(false);
    });

    it('should set completedAt timestamp', () => {
      const taskId = 'test-task-timestamp';
      manager.createPlan(taskId, 'Task', 'simple', [{ description: 'Step 1' }]);

      const beforeTime = Date.now();
      manager.completePlan(taskId);
      const afterTime = Date.now();
      const plan = manager.getPlan(taskId);

      expect(plan?.completedAt).toBeDefined();
      if (plan?.completedAt) {
        expect(plan.completedAt).toBeGreaterThanOrEqual(beforeTime);
        expect(plan.completedAt).toBeLessThanOrEqual(afterTime);
      }
    });
  });

  describe('deletePlan', () => {
    it('should delete an existing plan', () => {
      const taskId = 'test-task-delete';
      manager.createPlan(taskId, 'Task', 'simple', [{ description: 'Step 1' }]);

      expect(manager.getPlan(taskId)).toBeDefined();

      const result = manager.deletePlan(taskId);

      expect(result).toBe(true);
      expect(manager.getPlan(taskId)).toBeUndefined();
    });

    it('should return false for non-existent plan', () => {
      const result = manager.deletePlan('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getAllPlans', () => {
    it('should return empty array when no plans exist', () => {
      const plans = manager.getAllPlans();
      expect(plans).toEqual([]);
    });

    it('should return all plans', () => {
      const taskId1 = 'task-1';
      const taskId2 = 'task-2';
      const taskId3 = 'task-3';

      manager.createPlan(taskId1, 'Task 1', 'simple', [{ description: 'Step 1' }]);
      manager.createPlan(taskId2, 'Task 2', 'hard', [{ description: 'Step 1' }, { description: 'Step 2' }]);
      manager.createPlan(taskId3, 'Task 3', 'simple', [{ description: 'Step 1' }]);

      const plans = manager.getAllPlans();

      expect(plans).toHaveLength(3);
      expect(plans.map((p) => p.taskId)).toContain(taskId1);
      expect(plans.map((p) => p.taskId)).toContain(taskId2);
      expect(plans.map((p) => p.taskId)).toContain(taskId3);
    });
  });

  describe('clearAll', () => {
    it('should clear all plans', () => {
      manager.createPlan('task-1', 'Task 1', 'simple', [{ description: 'Step 1' }]);
      manager.createPlan('task-2', 'Task 2', 'hard', [{ description: 'Step 1' }]);
      manager.createPlan('task-3', 'Task 3', 'simple', [{ description: 'Step 1' }]);

      expect(manager.getAllPlans()).toHaveLength(3);

      manager.clearAll();

      expect(manager.getAllPlans()).toHaveLength(0);
      expect(manager.getPlan('task-1')).toBeUndefined();
      expect(manager.getPlan('task-2')).toBeUndefined();
      expect(manager.getPlan('task-3')).toBeUndefined();
    });

    it('should not throw error when clearing empty manager', () => {
      expect(() => manager.clearAll()).not.toThrow();
    });
  });

  describe('toJSON', () => {
    it('should convert plan to JSON string', () => {
      const taskId = 'test-task-json';
      const steps = [
        { description: 'Description 1' },
        { description: 'Description 2' },
      ];

      const plan = manager.createPlan(taskId, 'Task', 'hard', steps);
      const json = manager.toJSON(plan);

      expect(json).toBeDefined();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.taskId).toBe(taskId);
      expect(parsed.originalPrompt).toBe('Task');
      expect(parsed.complexity).toBe('hard');
      expect(parsed.steps).toHaveLength(2);
    });

    it('should include all plan fields in JSON', () => {
      const plan = manager.createPlan('test', 'Prompt', 'simple', [{ description: 'Goal' }]);
      plan.completedAt = Date.now();

      const json = manager.toJSON(plan);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('taskId');
      expect(parsed).toHaveProperty('originalPrompt');
      expect(parsed).toHaveProperty('complexity');
      expect(parsed).toHaveProperty('totalSteps');
      expect(parsed).toHaveProperty('steps');
      expect(parsed).toHaveProperty('createdAt');
      expect(parsed).toHaveProperty('completedAt');
    });
  });

  describe('fromJSON', () => {
    it('should parse valid JSON string to plan', () => {
      const planData: ProgressPlan = {
        taskId: 'test-task-parse',
        originalPrompt: 'Test prompt',
        complexity: 'hard',
        totalSteps: 2,
        steps: [
          {
            stepNumber: 1,
            description: 'Step 1 description',
            tools: ['tool1'],
            status: 'pending',
          },
          {
            stepNumber: 2,
            description: 'Step 2 goal',
            status: 'in_progress',
          },
        ],
        createdAt: Date.now(),
      };

      const json = JSON.stringify(planData);
      const parsed = manager.fromJSON(json);

      expect(parsed).toBeDefined();
      expect(parsed?.taskId).toBe(planData.taskId);
      expect(parsed?.originalPrompt).toBe(planData.originalPrompt);
      expect(parsed?.complexity).toBe(planData.complexity);
      expect(parsed?.steps).toHaveLength(2);
      expect(parsed?.steps[0].description).toBe('Step 1 description');
      expect(parsed?.steps[0].tools).toEqual(['tool1']);
      expect(parsed?.steps[1].status).toBe('in_progress');
    });

    it('should return null for invalid JSON', () => {
      const invalidJson = 'not valid json {';
      const parsed = manager.fromJSON(invalidJson);

      expect(parsed).toBeNull();
    });

    it('should return null for empty string', () => {
      const parsed = manager.fromJSON('');
      expect(parsed).toBeNull();
    });

    
  });

  describe('integration', () => {
    it('should handle full lifecycle: create, update, complete, delete', () => {
      const taskId = 'test-lifecycle';
      const steps = [
        { description: 'Step 1', tools: ['read_file'] },
        { description: 'Step 2', tools: ['write_file'] },
        { description: 'Step 3', tools: ['replace_file'] },
      ];

      // Create
      const plan = manager.createPlan(taskId, 'Lifecycle test', 'hard', steps);
      expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);

      // Update step 1 to in_progress
      manager.updateStepStatus(taskId, 1, 'in_progress');
      expect(manager.getPlan(taskId)?.steps[0].status).toBe('in_progress');

      // Update step 1 to completed
      manager.updateStepStatus(taskId, 1, 'completed');
      expect(manager.getPlan(taskId)?.steps[0].status).toBe('completed');

      // Update step 2 to completed
      manager.updateStepStatus(taskId, 2, 'completed');
      expect(manager.getPlan(taskId)?.steps[1].status).toBe('completed');

      // Complete all remaining steps
      manager.completePlan(taskId);
      const finalPlan = manager.getPlan(taskId);
      expect(finalPlan?.steps.every((s) => s.status === 'completed')).toBe(true);
      expect(finalPlan?.completedAt).toBeDefined();

      // Delete
      manager.deletePlan(taskId);
      expect(manager.getPlan(taskId)).toBeUndefined();
    });

    it('should handle multiple plans independently', () => {
      const taskId1 = 'task-1';
      const taskId2 = 'task-2';

      manager.createPlan(taskId1, 'Task 1', 'simple', [{ description: 'Step 1' }]);
      manager.createPlan(taskId2, 'Task 2', 'hard', [{ description: 'Step 1' }, { description: 'Step 2' }]);

      manager.updateStepStatus(taskId1, 1, 'completed');
      manager.updateStepStatus(taskId2, 1, 'in_progress');

      const plan1 = manager.getPlan(taskId1);
      const plan2 = manager.getPlan(taskId2);

      expect(plan1?.steps[0].status).toBe('completed');
      expect(plan2?.steps[0].status).toBe('in_progress');
      expect(plan2?.steps[1].status).toBe('pending');

      manager.deletePlan(taskId1);
      expect(manager.getPlan(taskId1)).toBeUndefined();
      expect(manager.getPlan(taskId2)).toBeDefined();
    });
  });
});

