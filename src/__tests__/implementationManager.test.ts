import { ImplementationManager } from '../harmony/implementationManager';
import { ProgressPlanManager, ProgressPlan } from '../progressPlanManager';
import { CodeContext } from '../harmony/codeContext';

describe('ImplementationManager', () => {
  let manager: ImplementationManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new ImplementationManager(progressPlanManager);
  });

  describe('initialization', () => {
    it('should initialize with empty state', () => {
      manager.initialize();
      expect(manager.getCreatedFiles()).toEqual([]);
      expect(manager.getCompletedSteps()).toEqual([]);
      expect(manager.getTaskId()).toBeUndefined();
      const state = manager.getState();
      expect(state?.referredFiles).toEqual([]);
    });

    it('should initialize with taskId', () => {
      manager.initialize('task-123');
      expect(manager.getTaskId()).toBe('task-123');
      expect(manager.getCreatedFiles()).toEqual([]);
      expect(manager.getCompletedSteps()).toEqual([]);
      const state = manager.getState();
      expect(state?.referredFiles).toEqual([]);
    });

    it('should auto-initialize when setting taskId without explicit init', () => {
      manager.setTaskId('task-456');
      expect(manager.getTaskId()).toBe('task-456');
      const state = manager.getState();
      expect(state?.referredFiles).toEqual([]);
    });
  });

  describe('setTaskId', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should set task ID', () => {
      manager.setTaskId('task-123');
      expect(manager.getTaskId()).toBe('task-123');
    });

    it('should update task ID', () => {
      manager.setTaskId('task-1');
      manager.setTaskId('task-2');
      expect(manager.getTaskId()).toBe('task-2');
    });

    it('should update lastUpdated timestamp', () => {
      manager.initialize();
      const before = Date.now();
      manager.setTaskId('task-123');
      const state = manager.getState();
      expect(state?.lastUpdated).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getProgressPlan', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return undefined when no taskId is set', () => {
      expect(manager.getProgressPlan()).toBeUndefined();
    });

    it('should return undefined when taskId is set but plan does not exist', () => {
      manager.setTaskId('non-existent-task');
      expect(manager.getProgressPlan()).toBeUndefined();
    });

    it('should return plan when taskId is set and plan exists', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      
      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan?.taskId).toBe('task-123');
      expect(retrievedPlan?.originalPrompt).toBe('Test task');
    });

    it('should return updated plan when plan is modified in ProgressPlanManager', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      
      // Update step status in ProgressPlanManager
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan?.steps[0].status).toBe('completed');
      expect(retrievedPlan?.steps[1].status).toBe('pending');
    });
  });

  describe('getCurrentStep', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return undefined when no plan exists', () => {
      expect(manager.getCurrentStep()).toBeUndefined();
    });

    it('should return first pending step when all steps are pending', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      
      const currentStep = manager.getCurrentStep();
      expect(currentStep).toBeDefined();
      expect(currentStep?.stepNumber).toBe(1);
      expect(currentStep?.goal).toBe('Step 1');
      expect(currentStep?.status).toBe('pending');
    });

    it('should return in_progress step when one exists', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      progressPlanManager.updateStepStatus('task-123', 2, 'in_progress');
      
      const currentStep = manager.getCurrentStep();
      expect(currentStep).toBeDefined();
      expect(currentStep?.stepNumber).toBe(2);
      expect(currentStep?.status).toBe('in_progress');
    });

    it('should return undefined when all steps are completed', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      expect(manager.getCurrentStep()).toBeUndefined();
    });
  });

  describe('completeStep', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return false when no state exists', () => {
      manager.clear();
      expect(manager.completeStep(1)).toBe(false);
    });

    it('should return false when no taskId is set', () => {
      manager.initialize();
      expect(manager.completeStep(1)).toBe(false);
    });

    it('should complete a step and update ProgressPlanManager', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      
      const success = manager.completeStep(1);
      expect(success).toBe(true);
      expect(manager.getCompletedSteps()).toContain(1);
      
      const updatedPlan = manager.getProgressPlan();
      expect(updatedPlan?.steps[0].status).toBe('completed');
    });

    it('should not add duplicate step to completedSteps', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      
      manager.completeStep(1);
      manager.completeStep(1); // Try again
      
      expect(manager.getCompletedSteps()).toEqual([1]);
    });

    it('should return false when step does not exist', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      
      expect(manager.completeStep(999)).toBe(false);
    });
  });

  describe('advanceToNextStep', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return undefined when no plan exists', () => {
      expect(manager.advanceToNextStep()).toBeUndefined();
    });

    it('should return undefined when no taskId is set', () => {
      manager.initialize();
      expect(manager.advanceToNextStep()).toBeUndefined();
    });

    it('should advance to next pending step', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      const nextStep = manager.advanceToNextStep();
      expect(nextStep).toBeDefined();
      expect(nextStep?.stepNumber).toBe(2);
      expect(nextStep?.goal).toBe('Step 2');
      
      const updatedPlan = manager.getProgressPlan();
      expect(updatedPlan?.steps[1].status).toBe('in_progress');
    });

    it('should return undefined when no more steps are pending', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      expect(manager.advanceToNextStep()).toBeUndefined();
    });
  });

  describe('recordFileCreated', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should record a file creation', () => {
      manager.recordFileCreated('test.py', 1, 'created');
      
      const files = manager.getCreatedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].file).toBe('test.py');
      expect(files[0].stepNumber).toBe(1);
      expect(files[0].status).toBe('created');
      expect(files[0].createdAt).toBeDefined();
    });

    it('should record a file replacement', () => {
      manager.recordFileCreated('test.py', 1, 'replaced');
      
      const files = manager.getCreatedFiles();
      expect(files[0].status).toBe('replaced');
    });

    it('should record a file creation error', () => {
      manager.recordFileCreated('test.py', 1, 'error', 'File already exists');
      
      const files = manager.getCreatedFiles();
      expect(files[0].status).toBe('error');
      expect(files[0].error).toBe('File already exists');
    });

    it('should update existing record for same file and step', () => {
      manager.recordFileCreated('test.py', 1, 'created');
      const firstRecord = manager.getCreatedFiles()[0];
      const originalCreatedAt = firstRecord.createdAt;
      
      manager.recordFileCreated('test.py', 1, 'replaced');
      
      const files = manager.getCreatedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].status).toBe('replaced');
      expect(files[0].createdAt).toBe(originalCreatedAt); // Preserved
    });

    it('should record multiple files for same step', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      manager.recordFileCreated('file2.py', 1, 'created');
      
      const files = manager.getCreatedFiles();
      expect(files).toHaveLength(2);
      expect(files.map(f => f.file)).toEqual(['file1.py', 'file2.py']);
    });

    it('should record files for different steps', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      manager.recordFileCreated('file2.py', 2, 'created');
      
      const files = manager.getCreatedFiles();
      expect(files).toHaveLength(2);
      expect(manager.getFilesForStep(1)).toHaveLength(1);
      expect(manager.getFilesForStep(2)).toHaveLength(1);
    });

    it('should auto-initialize when recording without explicit init', () => {
      manager.clear();
      manager.recordFileCreated('test.py', 1, 'created');
      
      expect(manager.getCreatedFiles()).toHaveLength(1);
    });
  });

  describe('filterCodeContextsForStep', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return empty array when no code contexts provided', () => {
      const step = {
        stepNumber: 1,
        goal: 'create hello.py',
        description: 'Create a Python file',
      };
      expect(manager.filterCodeContextsForStep([], step)).toEqual([]);
    });

    it('should match code context by exact filename in step goal', () => {
      const step = {
        stepNumber: 1,
        goal: 'create hello.py',
        description: 'Create a Python file',
      };
      const codeContext1 = new CodeContext('hello.py', ['print("Hello")']);
      const codeContext2 = new CodeContext('world.py', ['print("World")']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext1, codeContext2], step);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('hello.py');
    });

    it('should match code context by filename in step description', () => {
      const step = {
        stepNumber: 1,
        goal: 'Create a file',
        description: 'create hello.py with greeting function',
      };
      const codeContext = new CodeContext('hello.py', ['def greet(): pass']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext], step);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('hello.py');
    });

    it('should match test files when step mentions test', () => {
      const step = {
        stepNumber: 2,
        goal: 'create hello.test.py to test greet',
        description: 'Create test file',
      };
      const codeContext = new CodeContext('hello.test.py', ['import unittest']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext], step);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('hello.test.py');
    });

    it('should match markdown files when step mentions document', () => {
      const step = {
        stepNumber: 3,
        goal: 'write hello.md to document hello module',
        description: 'Create documentation',
      };
      const codeContext = new CodeContext('hello.md', ['# Hello Module']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext], step);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('hello.md');
    });

    it('should return single context when only one remains (fallback)', () => {
      const step = {
        stepNumber: 1,
        goal: 'create a file',
        description: 'Generic step',
      };
      const codeContext = new CodeContext('hello.py', ['print("Hello")']);
      codeContext.waitForCreate = true;
      
      const filtered = manager.filterCodeContextsForStep([codeContext], step);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('hello.py');
    });

    it('should return empty array when multiple contexts exist but none match', () => {
      const step = {
        stepNumber: 1,
        goal: 'create test.py',
        description: 'Create test file',
      };
      const codeContext1 = new CodeContext('file1.py', ['code1']);
      const codeContext2 = new CodeContext('file2.py', ['code2']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext1, codeContext2], step);
      expect(filtered).toEqual([]);
    });

    it('should match by base name when step mentions base name', () => {
      const step = {
        stepNumber: 1,
        goal: 'create hello.py',
        description: 'Create hello file',
      };
      const codeContext = new CodeContext('hello.py', ['print("Hello")']);
      
      const filtered = manager.filterCodeContextsForStep([codeContext], step);
      expect(filtered).toHaveLength(1);
    });
  });

  describe('getCreatedFiles and getFilesForStep', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return empty array when no files created', () => {
      expect(manager.getCreatedFiles()).toEqual([]);
    });

    it('should return all created files', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      manager.recordFileCreated('file2.py', 1, 'created');
      manager.recordFileCreated('file3.py', 2, 'created');
      
      const files = manager.getCreatedFiles();
      expect(files).toHaveLength(3);
    });

    it('should return files for specific step', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      manager.recordFileCreated('file2.py', 2, 'created');
      manager.recordFileCreated('file3.py', 2, 'created');
      
      const step1Files = manager.getFilesForStep(1);
      expect(step1Files).toHaveLength(1);
      expect(step1Files[0].file).toBe('file1.py');
      
      const step2Files = manager.getFilesForStep(2);
      expect(step2Files).toHaveLength(2);
    });

    it('should return empty array for step with no files', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      expect(manager.getFilesForStep(2)).toEqual([]);
    });
  });

  describe('isComplete', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return false when no plan exists', () => {
      expect(manager.isComplete()).toBe(false);
    });

    it('should return false when no taskId is set', () => {
      manager.initialize();
      expect(manager.isComplete()).toBe(false);
    });

    it('should return false when not all steps are completed', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      expect(manager.isComplete()).toBe(false);
    });

    it('should return true when all steps are completed', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      progressPlanManager.updateStepStatus('task-123', 2, 'completed');
      
      expect(manager.isComplete()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      manager.initialize('task-123');
      manager.recordFileCreated('test.py', 1, 'created');
      manager.completeStep(1);
      
      manager.clear();
      
      expect(manager.getCreatedFiles()).toEqual([]);
      expect(manager.getCompletedSteps()).toEqual([]);
      expect(manager.getTaskId()).toBeUndefined();
      expect(manager.getState()).toBeNull();
    });

    it('should clear referredFiles when cleared', async () => {
      manager.initialize();
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [
          { file: 'test.py', description: 'Test file' },
        ],
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      expect(manager.getState()?.referredFiles).toHaveLength(1);
      
      manager.clear();
      expect(manager.getState()).toBeNull();
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      manager.initialize();
    });

    it('should return message when state is not initialized', () => {
      manager.clear();
      const summary = manager.getSummary();
      expect(summary).toContain('No implementation data');
    });

    it('should return summary with progress info', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
        ]
      );
      manager.setTaskId('task-123');
      manager.recordFileCreated('file1.py', 1, 'created');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      
      const summary = manager.getSummary();
      expect(summary).toContain('1');
      expect(summary).toContain('2');
      expect(summary).toContain('step(s)');
      expect(summary).toContain('file(s)');
    });

    it('should return summary with zero progress when nothing is done', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      manager.setTaskId('task-123');
      
      const summary = manager.getSummary();
      expect(summary).toContain('0');
      expect(summary).toContain('1');
    });

    it('should return summary without plan info when no plan exists', () => {
      manager.recordFileCreated('file1.py', 1, 'created');
      
      const summary = manager.getSummary();
      expect(summary).toContain('0'); // 0 steps completed
      expect(summary).toContain('1'); // 1 file created
    });
  });

  describe('getState', () => {
    it('should return null when state is not initialized', () => {
      expect(manager.getState()).toBeNull();
    });

    it('should return copy of state', () => {
      manager.initialize('task-123');
      manager.recordFileCreated('test.py', 1, 'created');
      manager.completeStep(1);
      
      const state1 = manager.getState();
      const state2 = manager.getState();
      
      expect(state1).not.toBe(state2); // Different objects
      expect(state1?.createdFiles).not.toBe(state2?.createdFiles); // Different arrays
      expect(state1?.completedSteps).not.toBe(state2?.completedSteps); // Different arrays
      expect(state1?.referredFiles).not.toBe(state2?.referredFiles); // Different arrays
      expect(state1?.createdFiles).toEqual(state2?.createdFiles);
      expect(state1?.completedSteps).toEqual(state2?.completedSteps);
      expect(state1?.referredFiles).toEqual(state2?.referredFiles);
    });
  });

  describe('referredFiles from assumptions stage', () => {
    it('should store referredFiles when generateAssumptionDataFile is called', async () => {
      manager.initialize();
      
      const assumptionsExport = {
        assumptions: ['Assumption 1', 'Assumption 2'],
        codeSnippets: [
          { file: 'test1.py', description: 'Test file 1' },
          { file: 'test2.py', description: 'Test file 2' },
        ],
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      const state = manager.getState();
      expect(state?.referredFiles).toHaveLength(2);
      expect(state?.referredFiles).toEqual(assumptionsExport.codeSnippets);
    });

    it('should initialize state if not initialized when generateAssumptionDataFile is called', async () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'simple',
        [{ goal: 'Step 1' }]
      );
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [
          { file: 'test.py', description: 'Test file' },
        ],
        progressPlan: plan,
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      expect(manager.getTaskId()).toBe('task-123');
      const state = manager.getState();
      expect(state?.referredFiles).toHaveLength(1);
      expect(state?.referredFiles[0]).toEqual({ file: 'test.py', description: 'Test file' });
    });

    it('should store empty array when codeSnippets is empty', async () => {
      manager.initialize();
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [],
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      const state = manager.getState();
      expect(state?.referredFiles).toEqual([]);
    });

    it('should overwrite existing referredFiles when generateAssumptionDataFile is called multiple times', async () => {
      manager.initialize();
      
      const firstExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [
          { file: 'file1.py', description: 'First file' },
        ],
        summary: 'First summary',
      };

      await manager.generateAssumptionDataFile(firstExport);
      let state = manager.getState();
      expect(state?.referredFiles).toHaveLength(1);
      
      const secondExport = {
        assumptions: ['Assumption 2'],
        codeSnippets: [
          { file: 'file2.py', description: 'Second file' },
          { file: 'file3.py', description: 'Third file' },
        ],
        summary: 'Second summary',
      };

      await manager.generateAssumptionDataFile(secondExport);
      state = manager.getState();
      expect(state?.referredFiles).toHaveLength(2);
      expect(state?.referredFiles).toEqual(secondExport.codeSnippets);
      expect(state?.referredFiles[0].file).toBe('file2.py');
    });

    it('should store referredFiles with description', async () => {
      manager.initialize();
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [
          { file: 'test.py', description: 'Test file with description' },
        ],
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      const state = manager.getState();
      expect(state?.referredFiles[0].file).toBe('test.py');
      expect(state?.referredFiles[0].description).toBe('Test file with description');
    });

    it('should store referredFiles without description', async () => {
      manager.initialize();
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: [
          { file: 'test.py' },
        ],
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      const state = manager.getState();
      expect(state?.referredFiles[0].file).toBe('test.py');
      expect(state?.referredFiles[0].description).toBeUndefined();
    });

    it('should create a copy of referredFiles array (not reference)', async () => {
      manager.initialize();
      
      const codeSnippets = [
        { file: 'test1.py', description: 'File 1' },
        { file: 'test2.py', description: 'File 2' },
      ];
      
      const assumptionsExport = {
        assumptions: ['Assumption 1'],
        codeSnippets: codeSnippets,
        summary: 'Test summary',
      };

      await manager.generateAssumptionDataFile(assumptionsExport);
      
      const state = manager.getState();
      expect(state?.referredFiles).not.toBe(codeSnippets); // Different array reference
      expect(state?.referredFiles).toEqual(codeSnippets); // Same content
      
      // Modifying original should not affect state
      codeSnippets.push({ file: 'test3.py', description: 'File 3' });
      const state2 = manager.getState();
      expect(state2?.referredFiles).toHaveLength(2); // Still 2, not 3
    });
  });

  describe('integration with ProgressPlanManager', () => {
    it('should work with multiple plans in ProgressPlanManager', () => {
      const plan1 = progressPlanManager.createPlan('task-1', 'Task 1', 'simple', [{ goal: 'Step 1' }]);
      const plan2 = progressPlanManager.createPlan('task-2', 'Task 2', 'hard', [
        { goal: 'Step 1' },
        { goal: 'Step 2' },
      ]);
      
      manager.initialize();
      manager.setTaskId('task-1');
      expect(manager.getProgressPlan()?.taskId).toBe('task-1');
      
      manager.setTaskId('task-2');
      expect(manager.getProgressPlan()?.taskId).toBe('task-2');
      expect(manager.getProgressPlan()?.totalSteps).toBe(2);
    });

    it('should reflect plan updates from ProgressPlanManager', () => {
      const plan = progressPlanManager.createPlan(
        'task-123',
        'Test task',
        'hard',
        [
          { goal: 'Step 1' },
          { goal: 'Step 2' },
          { goal: 'Step 3' },
        ]
      );
      manager.initialize();
      manager.setTaskId('task-123');
      
      // Update steps in ProgressPlanManager
      progressPlanManager.updateStepStatus('task-123', 1, 'in_progress');
      progressPlanManager.updateStepStatus('task-123', 1, 'completed');
      progressPlanManager.updateStepStatus('task-123', 2, 'in_progress');
      
      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan?.steps[0].status).toBe('completed');
      expect(retrievedPlan?.steps[1].status).toBe('in_progress');
      expect(retrievedPlan?.steps[2].status).toBe('pending');
      
      const currentStep = manager.getCurrentStep();
      expect(currentStep?.stepNumber).toBe(2);
      expect(currentStep?.status).toBe('in_progress');
    });
  });

  describe('processFileCreations', () => {
    beforeEach(() => {
      const plan: ProgressPlan = {
        taskId: 'test-task',
        originalPrompt: 'Create hello module',
        complexity: 'hard',
        totalSteps: 3,
        steps: [
          {
            stepNumber: 1,
            goal: 'Step 1: create hello.py which greet function and main block',
            description: 'create hello.py which greet function and main block',
            status: 'in_progress',
            tools: []
          },
          {
            stepNumber: 2,
            goal: 'Step 2: create hello.test.py to test greet',
            description: 'create hello.test.py to test greet',
            status: 'pending',
            tools: []
          },
          {
            stepNumber: 3,
            goal: 'Step 3: write hello.md to document hello module',
            description: 'write hello.md to document hello module',
            status: 'pending',
            tools: []
          }
        ],
        createdAt: Date.now()
      };
      progressPlanManager.createPlan(
        plan.taskId,
        plan.originalPrompt,
        plan.complexity,
        plan.steps.map(s => ({ goal: s.goal, description: s.description, tools: s.tools }))
      );
      manager.initialize('test-task');
    });

    it('should complete step 1 when hello.py is created', () => {
      const toolCalls = [
        {
          name: 'create_file',
          arguments: { file_path: 'hello.py', content: 'def greet(): pass' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);

      expect(completedStep).toBe(1);
      const plan = manager.getProgressPlan();
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('pending');
    });

    it('should NOT complete step 1 when hello.test.py is created', () => {
      const toolCalls = [
        {
          name: 'create_file',
          arguments: { file_path: 'hello.test.py', content: 'import unittest' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);

      expect(completedStep).toBeUndefined();
      const plan = manager.getProgressPlan();
      expect(plan?.steps[0].status).toBe('in_progress');
    });

    it('should only complete step 1 when multiple files are created but only hello.py matches', () => {
      const toolCalls = [
        {
          name: 'create_file',
          arguments: { file_path: 'hello.py', content: 'def greet(): pass' },
          result: { isError: false }
        },
        {
          name: 'create_file',
          arguments: { file_path: 'hello.test.py', content: 'import unittest' },
          result: { isError: false }
        },
        {
          name: 'create_file',
          arguments: { file_path: 'hello.md', content: '# Hello' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);

      expect(completedStep).toBe(1);
      const plan = manager.getProgressPlan();
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('pending');
      expect(plan?.steps[2].status).toBe('pending');
    });

    it('should record all file creations even if step is not completed', () => {
      const toolCalls = [
        {
          name: 'create_file',
          arguments: { file_path: 'hello.test.py', content: 'import unittest' },
          result: { isError: false }
        }
      ];

      manager.processFileCreations(toolCalls);

      const files = manager.getFilesForStep(1);
      expect(files.length).toBe(1);
      expect(files[0].file).toBe('hello.test.py');
      expect(files[0].status).toBe('created');
    });

    it('should return undefined if no current step', () => {
      // Complete all steps
      manager.completeStep(1);
      manager.advanceToNextStep();
      manager.completeStep(2);
      manager.advanceToNextStep();
      manager.completeStep(3);

      const toolCalls = [
        {
          name: 'create_file',
          arguments: { file_path: 'hello.py', content: 'def greet(): pass' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);
      expect(completedStep).toBeUndefined();
    });

    it('should return undefined if no successful file modifications', () => {
      const toolCalls = [
        {
          name: 'read_file',
          arguments: { file_path: 'hello.py' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);
      expect(completedStep).toBeUndefined();
    });

    it('should handle replace_file tool calls', () => {
      const toolCalls = [
        {
          name: 'replace_file',
          arguments: { file_path: 'hello.py', content: 'def greet(): pass' },
          result: { isError: false }
        }
      ];

      const completedStep = manager.processFileCreations(toolCalls);

      expect(completedStep).toBe(1);
      const files = manager.getFilesForStep(1);
      expect(files[0].status).toBe('replaced');
    });
  });
});

