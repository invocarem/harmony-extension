import { AutoTransitionManager } from "../harmony/autoTransitionManager";
import { ProgressPlanManager } from "../progressPlanManager";

describe("AutoTransitionManager", () => {
  let manager: AutoTransitionManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new AutoTransitionManager(progressPlanManager);
  });

  describe("shouldAutoTransitionFromAssumptions - step extraction", () => {
    it("should stay in assumptions when LLM response does not contain steps (no plan from prompt)", () => {
      const originalPrompt = `help me to create a hello module
Step 1. create hello.py which greet function and main block
Step 2. create hello.test.py to test greet
Step 3. write hello.md to document hello module`;

      // LLM response that doesn't repeat the steps – we do not extract steps from prompt
      const llmContent =
        "I will help you create the hello module with all required files.";

      const mockContext = {
        originalPrompt: originalPrompt,
        currentStage: "assumptions",
        progressPlan: null,
      };

      const result = manager.shouldAutoTransitionFromAssumptions(
        llmContent,
        undefined,
        undefined,
        originalPrompt,
        mockContext as any
      );

      // No plan or steps detected in content → do not transition, stay in assumptions
      expect(result.shouldTransition).toBe(false);
      expect(result.plan).toBeUndefined();
    });
  });
});
