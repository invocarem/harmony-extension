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

  describe('extractStepsFromText', () => {
    it('should prefer execution plan steps over edge case discussions', () => {
      // Simulate LLM response that contains both edge cases and execution plan
      const content = `**4. Numbered plan (one step per distinct requirement)**

*Requirement identified*: Convert the DOCX file bliu.docx to Markdown and return the result.

**Step 1:** Locate the file bliu.docx in the workspace.
- Use find_files with the name pattern "bliu.docx" (case-insensitive, not a regex) to obtain the full path.
- Verify that exactly one match is returned. If none or multiple matches are found, handle the edge cases (report "file not found" or request clarification).

**Step 2:** Read the file's binary content and prepare the parameters for the conversion tool.
- Use read_file on the path obtained in Step 1 to get the raw bytes of the DOCX.
- Determine the file size (length of the byte array).
- Encode the binary content to a Base-64 string (the conversion tool expects content_base64).

**Step 3:** Call the MCP tool convert_docx_to_markdown with the prepared arguments.
- Pass content_base64 (the Base-64 string from Step 2), filename: "bliu.docx", and file_size (from Step 2).
- Capture the tool's response, which should be the Markdown representation of the document.
- Return that Markdown text to the user.

**5. Complexity assessment**
The task involves three distinct actions (search, read & encode, convert) and handling of possible edge cases, so it is **moderately complex** (requires >2 steps). The plan is therefore classified as a **hard** task.

**Plan Progress:**
Step 1: **File not found** – If bliu.docx does not exist, we must report that back to the user.
Step 2: **Multiple matches** – If more than one file matches the pattern (e.g., bliu.docx and bliu (copy).docx), we should pick the exact match; otherwise we may need clarification.
Step 3: **Large file** – If the file is unusually large, the tool might reject it; we would need to inform the user about size limits.
Step 4: **Corrupted DOCX** – If the conversion tool fails because the file is not a valid DOCX, we should surface the error.
Step 5: **Binary reading** – The workspace tools (read_file) return text; to obtain a Base-64 representation we must read the file as binary.`;

      const steps = manager.extractStepsFromText(content, undefined, 'hard');

      // Should extract the execution plan (3 steps), not the edge cases (5 steps)
      expect(steps.length).toBe(3);
      expect(steps[0].goal).toContain('Locate');
      expect(steps[0].goal).toContain('bliu.docx');
      expect(steps[1].goal).toContain('Read');
      expect(steps[1].goal).toContain('binary content');
      expect(steps[2].goal).toContain('Call');
      expect(steps[2].goal).toContain('convert_docx_to_markdown');

      // Should NOT include edge cases
      expect(steps.some(s => s.goal.includes('File not found'))).toBe(false);
      expect(steps.some(s => s.goal.includes('Multiple matches'))).toBe(false);
      expect(steps.some(s => s.goal.includes('Large file'))).toBe(false);
      expect(steps.some(s => s.goal.includes('Corrupted DOCX'))).toBe(false);
      expect(steps.some(s => s.goal.includes('Binary reading'))).toBe(false);
    });
  });
});

