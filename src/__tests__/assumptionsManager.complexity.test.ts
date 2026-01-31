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
        [{ description: 'Execute the task implementation' }]
      );
      
      manager.setTaskId('simple-task-123');
      manager.addAssumption('This is a simple task that requires creating one file.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.taskId).toBe('simple-task-123');
      expect(exportData.progressPlan?.complexity).toBe('simple');
      expect(exportData.progressPlan?.totalSteps).toBe(1);
      
      // Verify steps are included in progressPlan (planSteps is redundant)
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps).toHaveLength(1);
      expect(exportData.progressPlan?.steps[0].description).toContain('Execute the task');
      expect(exportData.progressPlan?.steps[0].stepNumber).toBe(1);
      
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
          { description: 'Create the main file' },
          { description: 'Verify it works' }
        ]
      );
      
      manager.setTaskId('simple-task-2steps');
      manager.addAssumption('This task has two steps.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.complexity).toBe('simple');
      expect(exportData.progressPlan?.totalSteps).toBe(2);
      
      // Verify steps are included in progressPlan (planSteps is redundant)
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps).toHaveLength(2);
      expect(exportData.progressPlan?.steps[0].stepNumber).toBe(1);
      expect(exportData.progressPlan?.steps[1].stepNumber).toBe(2);
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
          { description: 'Create directories and config files' },
          { description: 'Create API endpoints' },
          { description: 'Create user interface' },
          { description: 'Write unit and integration tests' }
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
      
      // Verify steps are included in progressPlan (planSteps is redundant)
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps).toHaveLength(4);
      expect(exportData.progressPlan?.steps[0].stepNumber).toBe(1);
      expect(exportData.progressPlan?.steps[0].description).toBe('Create directories and config files');
      expect(exportData.progressPlan?.steps[3].stepNumber).toBe(4);
      expect(exportData.progressPlan?.steps[3].description).toBe('Write unit and integration tests');
      
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
          { description: 'Main application file', tools: ['create_file'] },
          { description: 'Configuration file', tools: ['create_file', 'write_file'] },
          { description: 'Documentation', tools: ['replace_file'] }
        ]
      );
      
      manager.setTaskId('hard-task-with-tools');
      manager.addAssumption('Complex task with specific tools for each step.');
      
      const exportData = manager.exportForTransition();
      
      // Verify progressPlan is included
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.complexity).toBe('hard');
      
      // Verify steps include tools (planSteps is redundant, use progressPlan.steps)
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps[0].tools).toEqual(['create_file']);
      expect(exportData.progressPlan?.steps[1].tools).toEqual(['create_file', 'write_file']);
      expect(exportData.progressPlan?.steps[2].tools).toEqual(['replace_file']);
    });
  });

  describe('assumption_data.json structure verification', () => {
    it('should create correct assumption_data.json structure for simple task', () => {
      const plan = progressPlanManager.createPlan(
        'simple-task',
        'Simple task',
        'simple',
        [{ description: 'Complete task' }]
      );
      
      manager.setTaskId('simple-task');
      manager.addAssumption('Test assumption');
      manager.addCodeSnippet('test.py', 'Test file');
      
      const exportData = manager.exportForTransition();
      
      // Simulate assumption_data.json structure (planSteps is redundant, removed)
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        summary: exportData.summary,
      };
      
      // Verify all required fields are present
      expect(assumptionData.assumptions).toBeDefined();
      expect(assumptionData.codeSnippets).toBeDefined();
      expect(assumptionData.progressPlan).toBeDefined();
      expect(assumptionData.summary).toBeDefined();
      
      // Verify progressPlan structure
      expect(assumptionData.progressPlan?.taskId).toBe('simple-task');
      expect(assumptionData.progressPlan?.complexity).toBe('simple');
      expect(assumptionData.progressPlan?.totalSteps).toBe(1);
      expect(assumptionData.progressPlan?.steps).toBeDefined();
      expect(assumptionData.progressPlan?.createdAt).toBeDefined();
    });

    it('should create correct assumption_data.json structure for hard task', () => {
      const plan = progressPlanManager.createPlan(
        'hard-task',
        'Hard task',
        'hard',
        [
          { description: 'Step 1' },
          { description: 'Step 2' },
          { description: 'Step 3' }
        ]
      );
      
      manager.setTaskId('hard-task');
      manager.addAssumption('Test assumption 1');
      manager.addAssumption('Test assumption 2');
      manager.addCodeSnippet('file1.py', 'File 1');
      manager.addCodeSnippet('file2.py', 'File 2');
      
      const exportData = manager.exportForTransition();
      
      // Simulate assumption_data.json structure (planSteps is redundant, removed)
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        summary: exportData.summary,
      };
      
      // Verify all required fields are present
      expect(assumptionData.assumptions).toHaveLength(2);
      expect(assumptionData.codeSnippets).toHaveLength(2);
      expect(assumptionData.progressPlan).toBeDefined();
      
      // Verify progressPlan structure
      expect(assumptionData.progressPlan?.taskId).toBe('hard-task');
      expect(assumptionData.progressPlan?.complexity).toBe('hard');
      expect(assumptionData.progressPlan?.totalSteps).toBe(3);
      expect(assumptionData.progressPlan?.steps).toHaveLength(3);
    });
  });

  describe('JSON serialization verification', () => {
    it('should serialize simple task assumption_data.json correctly', () => {
      const plan = progressPlanManager.createPlan(
        'simple-task',
        'Simple task',
        'simple',
        [{ description: 'Complete task' }]
      );
      
      manager.setTaskId('simple-task');
      manager.addAssumption('Test');
      
      const exportData = manager.exportForTransition();
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
        summary: exportData.summary,
      };
      
      // Verify it can be serialized to JSON
      const json = JSON.stringify(assumptionData, null, 2);
      expect(json).toBeTruthy();
      
      // Verify it can be parsed back
      const parsed = JSON.parse(json);
      expect(parsed.progressPlan).toBeDefined();
      expect(parsed.progressPlan.complexity).toBe('simple');
      expect(parsed.progressPlan.steps).toBeDefined();
      expect(parsed.progressPlan.steps.length).toBe(1);
    });

    it('should serialize hard task assumption_data.json correctly', () => {
      const plan = progressPlanManager.createPlan(
        'hard-task',
        'Hard task',
        'hard',
        [
          { description: 'First step' },
          { description: 'Second step' },
          { description: 'Third step' }
        ]
      );
      
      manager.setTaskId('hard-task');
      manager.addAssumption('Test');
      
      const exportData = manager.exportForTransition();
      const assumptionData = {
        assumptions: exportData.assumptions,
        codeSnippets: exportData.codeSnippets,
        progressPlan: exportData.progressPlan,
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
      expect(parsed.progressPlan.steps).toBeDefined();
      expect(parsed.progressPlan.steps.length).toBe(3);
    });
  });
});

