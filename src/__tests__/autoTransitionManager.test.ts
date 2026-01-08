import { AutoTransitionManager } from '../harmony/autoTransitionManager';
import { ProgressPlanManager } from '../progressPlanManager';

describe('AutoTransitionManager', () => {
  let manager: AutoTransitionManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new AutoTransitionManager(progressPlanManager);
  });

  describe('detectTaskComplexity', () => {

    it('should detect "hard" complexity for exact user prompt format with Step 1., Step 2., Step 3.', () => {
      const originalPrompt = `help me to create a hello module
Step 1. create hello.py which greet function and main block
Step 2. create test_hello.py to test greet
Step 3. write hello.md to document hello module`;

      // Test that it detects from originalPrompt when LLM response doesn't have steps
      const llmContent = 'I will analyze the requirements and create the hello module files.';
      const complexity = manager.detectTaskComplexity(llmContent, undefined, undefined, originalPrompt);

      expect(complexity).toBe('hard');
    });

    it('should detect "hard" complexity for exact user prompt even without originalPrompt param', () => {
      const content = `help me to create a hello module
Step 1. create hello.py which greet function and main block
Step 2. create hello.test.py to test greet
Step 3. write hello.md to document hello module`;

      const complexity = manager.detectTaskComplexity(content);

      expect(complexity).toBe('hard');
    });

    it('should detect "hard" complexity when original prompt has 3 steps with "Step 1.", "Step 2.", "Step 3." format', () => {
      // This test should FAIL - demonstrating the bug where originalPrompt is not checked
      const originalPrompt = `Step 1. write hello.py to greet Marie, provide greet() and main() functions
Step 2. write hello.test.py to test greet function
Step 3. write hello.md to document hello.py and its tests`;

      // Simulate LLM response that doesn't explicitly repeat the steps
      // (which is what happens in practice - LLM may not repeat user's step format)
      const llmContent = 'I will help you create the hello.py file with greet and main functions, along with tests and documentation.';
      const llmReasoning = 'This is a multi-step task that requires creating three files.';

      // Now with originalPrompt parameter, it should check originalPrompt as fallback
      const complexity = manager.detectTaskComplexity(llmContent, llmReasoning, undefined, originalPrompt);

      // Expected: 'hard' (because originalPrompt has 3 steps, even though LLM response doesn't)
      expect(complexity).toBe('hard');
    });

    it('should detect "hard" complexity when LLM response explicitly has 3 steps', () => {
      const content = `Step 1: Create hello.py
Step 2: Create hello.test.py
Step 3: Create hello.md`;

      const complexity = manager.detectTaskComplexity(content);

      expect(complexity).toBe('hard');
    });

    it('should detect "simple" complexity when there are only 1-2 steps', () => {
      const content = 'Step 1: Create hello.py\nStep 2: Add tests';

      const complexity = manager.detectTaskComplexity(content);

      expect(complexity).toBe('simple');
    });

    it('should detect "hard" complexity when numbered list has 3+ items', () => {
      const content = `1. Create hello.py
2. Create hello.test.py
3. Create hello.md`;

      const complexity = manager.detectTaskComplexity(content);

      expect(complexity).toBe('hard');
    });

    it('should detect "hard" complexity when LLM response is simple but originalPrompt has 3+ steps', () => {
      // This is the key bug fix: LLM response might only show 1-2 steps,
      // but originalPrompt has 3+ steps, so we should detect it as 'hard'
      const originalPrompt = `help me to create a hello module
Step 1. create hello.py which greet function and main block
Step 2. create hello.test.py to test greet
Step 3. write hello.md to document hello module`;

      // LLM response that only mentions 1-2 steps or doesn't repeat the format
      const llmContent = 'I will create hello.py with a greet function. Then I will add tests.';
      const llmReasoning = 'This involves creating a Python module and tests.';

      // Should detect as 'hard' because originalPrompt has 3 steps
      const complexity = manager.detectTaskComplexity(llmContent, llmReasoning, undefined, originalPrompt);

      expect(complexity).toBe('hard');
    });

    it('should prefer "hard" over "simple" when one source indicates hard complexity', () => {
      const originalPrompt = `Step 1. create file1.py
Step 2. create file2.py
Step 3. create file3.py`;

      // LLM response that only shows 1 step
      const llmContent = 'Step 1: I will create the first file.';

      // Should detect as 'hard' because originalPrompt has 3 steps
      const complexity = manager.detectTaskComplexity(llmContent, undefined, undefined, originalPrompt);

      expect(complexity).toBe('hard');
    });
  });

  describe('shouldAutoTransitionFromAssumptions - step extraction', () => {
    it('should extract steps from originalPrompt when LLM response does not contain steps', () => {
      const contextManager = (manager as any).progressPlanManager;
      const originalPrompt = `help me to create a hello module
Step 1. create hello.py which greet function and main block
Step 2. create hello.test.py to test greet
Step 3. write hello.md to document hello module`;

      // LLM response that doesn't repeat the steps
      const llmContent = 'I will help you create the hello module with all required files.';
      
      const mockContext = {
        originalPrompt: originalPrompt,
        currentStage: 'assumptions',
        progressPlan: null
      };

      const result = manager.shouldAutoTransitionFromAssumptions(
        llmContent,
        undefined,
        undefined,
        originalPrompt,
        mockContext as any
      );

      expect(result.shouldTransition).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.complexity).toBe('hard');
      // Should extract 3 steps from originalPrompt
      expect(result.plan?.totalSteps).toBe(3);
      expect(result.plan?.steps.length).toBe(3);
      
      // Verify step content
      expect(result.plan?.steps[0].goal).toContain('hello.py');
      expect(result.plan?.steps[1].goal).toContain('hello.test.py');
      expect(result.plan?.steps[2].goal).toContain('hello.md');
    });
  });
});

