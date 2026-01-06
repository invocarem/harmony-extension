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
  });
});

