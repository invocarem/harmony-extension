import { AssumptionsManager } from '../harmony/assumptionsManager';
import { ProgressPlanManager } from '../progressPlanManager';

describe('AssumptionsManager - Task Complexity Verification', () => {
  let manager: AssumptionsManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new AssumptionsManager(progressPlanManager);
    manager.initialize();
  });

  describe('Simple task progressPlan export', () => {
    it('should export progressPlan for simple tasks', () => {
      // Create a simple task plan (1 step)
      const plan = progressPlanManager.createPlan(
        'simple-task-123',
        'Create a simple hello.py file',
        'simple',
        [{ goal: 'Complete the task', description: 'Execute the task implementation' }]
      );
      
      manager.setTaskId('simple-task-123');
      manager.addAssumption('This is a simple task that requires creating one file.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.taskId).toBe('simple-task-123');
      expect(exportData.progressPlan?.complexity).toBe('simple');
      expect(exportData.progressPlan?.totalSteps).toBe(1);
      
      // Verify planSteps is included
      expect(exportData.planSteps).toBeDefined();
      expect(exportData.planSteps).toHaveLength(1);
      expect(exportData.planSteps?.[0].goal).toBe('Complete the task');
      expect(exportData.planSteps?.[0].stepNumber).toBe(1);
      
      // Verify summary includes plan info
      expect(exportData.summary).toContain('Plan created');
      expect(exportData.summary).toContain('1 step(s)');
      expect(exportData.summary).toContain('complexity: simple');
    });

    it('should export progressPlan for simple tasks with 2 steps', () => {
      // Create a simple task plan (2 steps)
      const plan = progressPlanManager.createPlan(
        'simple-task-2steps',
        'Create hello.py and test it',
        'simple',
        [
          { goal: 'Create hello.py', description: 'Create the main file' },
          { goal: 'Test the file', description: 'Verify it works' }
        ]
      );
      
      manager.setTaskId('simple-task-2steps');
      manager.addAssumption('This task has two steps.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.complexity).toBe('simple');
      expect(exportData.progressPlan?.totalSteps).toBe(2);
      
      // Verify planSteps is included
      expect(exportData.planSteps).toBeDefined();
      expect(exportData.planSteps).toHaveLength(2);
      expect(exportData.planSteps?.[0].stepNumber).toBe(1);
      expect(exportData.planSteps?.[1].stepNumber).toBe(2);
    });
  });

  describe('Hard task progressPlan export', () => {
    it('should export progressPlan for hard tasks', () => {
      // Create a hard task plan (3+ steps)
      const plan = progressPlanManager.createPlan(
        'hard-task-123',
        'Create a full-stack application',
        'hard',
        [
          { goal: 'Step 1: Setup project structure', description: 'Create directories and config files' },
          { goal: 'Step 2: Implement backend API', description: 'Create API endpoints' },
          { goal: 'Step 3: Implement frontend UI', description: 'Create user interface' },
          { goal: 'Step 4: Add tests', description: 'Write unit and integration tests' }
        ]
      );
      
      manager.setTaskId('hard-task-123');
      manager.addAssumption('This is a complex task requiring multiple steps.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.taskId).toBe('hard-task-123');
      expect(exportData.progressPlan?.complexity).toBe('hard');
      expect(exportData.progressPlan?.totalSteps).toBe(4);
      
      // Verify planSteps is included
      expect(exportData.planSteps).toBeDefined();
      expect(exportData.planSteps).toHaveLength(4);
      expect(exportData.planSteps?.[0].stepNumber).toBe(1);
      expect(exportData.planSteps?.[0].goal).toBe('Step 1: Setup project structure');
      expect(exportData.planSteps?.[3].stepNumber).toBe(4);
      expect(exportData.planSteps?.[3].goal).toBe('Step 4: Add tests');
      
      // Verify summary includes plan info
      expect(exportData.summary).toContain('Plan created');
      expect(exportData.summary).toContain('4 step(s)');
      expect(exportData.summary).toContain('complexity: hard');
    });

    it('should export progressPlan for hard tasks with tools specified', () => {
      const plan = progressPlanManager.createPlan(
        'hard-task-with-tools',
        'Create multiple files with different tools',
        'hard',
        [
          { goal: 'Create main.py', description: 'Main application file', tools: ['create_file'] },
          { goal: 'Create config.json', description: 'Configuration file', tools: ['create_file', 'write_file'] },
          { goal: 'Update README.md', description: 'Documentation', tools: ['replace_file'] }
        ]
      );
      
      manager.setTaskId('hard-task-with-tools');
      manager.addAssumption('Complex task with specific tools for each step.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.complexity).toBe('hard');
      
      // Verify planSteps includes tools
      expect(exportData.planSteps).toBeDefined();
      expect(exportData.planSteps?.[0].tools).toEqual(['create_file']);
      expect(exportData.planSteps?.[1].tools).toEqual(['create_file', 'write_file']);
      expect(exportData.planSteps?.[2].tools).toEqual(['replace_file']);
    });
  });

  describe('assumption_data.json structure verification', () => {
    it('should create correct assumption_data.json structure for simple task', () => {
      const plan = progressPlanManager.createPlan(
        'simple-task',
        'Simple task',
        'simple',
        [{ goal: 'Complete task' }]
      );
      
      manager.setTaskId('simple-task');
      manager.addAssumption('Test assumption');
      manager.addCodeSnippet('test.py', 'Test file');
      
      const exportData = manager.exportForTransition();
      
      // Simulate assumption_data.json structure
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        planSteps: exportData.planSteps,
        summary: exportData.summary,
      };
      
      // Verify all required fields are present
      expect(assumptionData.assumptions).toBeDefined();
      expect(assumptionData.codeSnippets).toBeDefined();
      expect(assumptionData.progressPlan).toBeDefined();
      expect(assumptionData.planSteps).toBeDefined();
      expect(assumptionData.summary).toBeDefined();
      
      // Verify progressPlan structure
      expect(assumptionData.progressPlan?.taskId).toBe('simple-task');
      expect(assumptionData.progressPlan?.complexity).toBe('simple');
      expect(assumptionData.progressPlan?.totalSteps).toBe(1);
      expect(assumptionData.progressPlan?.steps).toBeDefined();
      expect(assumptionData.progressPlan?.createdAt).toBeDefined();
      
      // Verify planSteps matches progressPlan.steps
      expect(assumptionData.planSteps).toEqual(assumptionData.progressPlan?.steps);
    });

    it('should create correct assumption_data.json structure for hard task', () => {
      const plan = progressPlanManager.createPlan(
        'hard-task',
        'Hard task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
          { goal: 'Step 3' }
        ]
      );
      
      manager.setTaskId('hard-task');
      manager.addAssumption('Test assumption 1');
      manager.addAssumption('Test assumption 2');
      manager.addCodeSnippet('file1.py', 'File 1');
      manager.addCodeSnippet('file2.py', 'File 2');
      
      const exportData = manager.exportForTransition();
      
      // Simulate assumption_data.json structure
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        planSteps: exportData.planSteps,
        summary: exportData.summary,
      };
      
      // Verify all required fields are present
      expect(assumptionData.assumptions).toHaveLength(2);
      expect(assumptionData.codeSnippets).toHaveLength(2);
      expect(assumptionData.progressPlan).toBeDefined();
      expect(assumptionData.planSteps).toBeDefined();
      
      // Verify progressPlan structure
      expect(assumptionData.progressPlan?.taskId).toBe('hard-task');
      expect(assumptionData.progressPlan?.complexity).toBe('hard');
      expect(assumptionData.progressPlan?.totalSteps).toBe(3);
      
      // Verify planSteps matches progressPlan.steps
      expect(assumptionData.planSteps).toEqual(assumptionData.progressPlan?.steps);
      expect(assumptionData.planSteps).toHaveLength(3);
    });
  });

  describe('JSON serialization verification', () => {
    it('should serialize simple task assumption_data.json correctly', () => {
      const plan = progressPlanManager.createPlan(
        'simple-task',
        'Simple task',
        'simple',
        [{ goal: 'Complete task' }]
      );
      
      manager.setTaskId('simple-task');
      manager.addAssumption('Test');
      
      const exportData = manager.exportForTransition();
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        planSteps: exportData.planSteps,
        summary: exportData.summary,
      };
      
      // Verify it can be serialized to JSON
      const json = JSON.stringify(assumptionData, null, 2);
      expect(json).toBeTruthy();
      
      // Verify it can be parsed back
      const parsed = JSON.parse(json);
      expect(parsed.progressPlan).toBeDefined();
      expect(parsed.progressPlan.complexity).toBe('simple');
      expect(parsed.planSteps).toBeDefined();
      expect(parsed.planSteps.length).toBe(1);
    });

    it('should serialize hard task assumption_data.json correctly', () => {
      const plan = progressPlanManager.createPlan(
        'hard-task',
        'Hard task',
        'hard',
        [
          { goal: 'Step 1', description: 'First step' },
          { goal: 'Step 2', description: 'Second step' },
          { goal: 'Step 3', description: 'Third step' }
        ]
      );
      
      manager.setTaskId('hard-task');
      manager.addAssumption('Test');
      
      const exportData = manager.exportForTransition();
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        planSteps: exportData.planSteps,
        summary: exportData.summary,
      };
      
      // Verify it can be serialized to JSON
      const json = JSON.stringify(assumptionData, null, 2);
      expect(json).toBeTruthy();
      
      // Verify it can be parsed back
      const parsed = JSON.parse(json);
      expect(parsed.progressPlan).toBeDefined();
      expect(parsed.progressPlan.complexity).toBe('hard');
      expect(parsed.progressPlan.totalSteps).toBe(3);
      expect(parsed.planSteps).toBeDefined();
      expect(parsed.planSteps.length).toBe(3);
    });
  });
});

