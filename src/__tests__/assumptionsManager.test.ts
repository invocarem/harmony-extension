import { AssumptionsManager } from "../harmony/assumptionsManager";
import { ProgressPlanManager } from "../progressPlanManager";

describe("AssumptionsManager", () => {
  let manager: AssumptionsManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new AssumptionsManager(progressPlanManager);
  });

  describe("initialization", () => {
    it("should initialize with empty state", () => {
      manager.initialize();
      expect(manager.getAllAssumptions()).toEqual([]);
      expect(manager.getAllCodeSnippets()).toEqual([]);
      expect(manager.getTaskId()).toBeUndefined();
    });

    it("should auto-initialize when adding assumption without explicit init", () => {
      manager.addAssumption("Test assumption");
      expect(manager.hasContent()).toBe(true);
      expect(manager.getAllAssumptions()).toHaveLength(1);
    });

    it("should auto-initialize when adding code snippet without explicit init", () => {
      manager.addCodeSnippet("test.py", "Test file");
      expect(manager.hasContent()).toBe(true);
      expect(manager.getAllCodeSnippets()).toHaveLength(1);
    });
  });

  describe("addAssumption", () => {
    beforeEach(() => {
      manager.initialize();
    });

    it("should add assumption to state", () => {
      manager.addAssumption("This is a test assumption");
      expect(manager.getAllAssumptions()).toHaveLength(1);
      expect(manager.getAllAssumptions()[0]).toBe("This is a test assumption");
    });

    it("should trim whitespace from assumptions", () => {
      manager.addAssumption("  Trimmed assumption  ");
      expect(manager.getAllAssumptions()[0]).toBe("Trimmed assumption");
    });

    it("should not add empty assumptions", () => {
      manager.addAssumption("");
      manager.addAssumption("   ");
      expect(manager.getAllAssumptions()).toHaveLength(0);
    });

    it("should add multiple assumptions", () => {
      manager.addAssumption("Assumption 1");
      manager.addAssumption("Assumption 2");
      manager.addAssumption("Assumption 3");
      expect(manager.getAllAssumptions()).toHaveLength(3);
    });

    it("should update lastUpdated timestamp", () => {
      const before = Date.now();
      manager.addAssumption("Test");
      const state = manager.getState();
      expect(state?.lastUpdated).toBeGreaterThanOrEqual(before);
    });
  });

  describe("addCodeSnippet", () => {
    beforeEach(() => {
      manager.initialize();
    });

    it("should add code snippet to state", () => {
      manager.addCodeSnippet("test.py", "Test file description");
      expect(manager.getAllCodeSnippets()).toHaveLength(1);
      expect(manager.getAllCodeSnippets()[0].file).toBe("test.py");
      expect(manager.getAllCodeSnippets()[0].description).toBe(
        "Test file description"
      );
    });

    it("should add code snippet without description", () => {
      manager.addCodeSnippet("test.py");
      expect(manager.getAllCodeSnippets()).toHaveLength(1);
      expect(manager.getAllCodeSnippets()[0].file).toBe("test.py");
      expect(manager.getAllCodeSnippets()[0].description).toBeUndefined();
    });

    it("should update existing snippet for same file", () => {
      manager.addCodeSnippet("test.py", "Original description");
      manager.addCodeSnippet("test.py", "Updated description");
      expect(manager.getAllCodeSnippets()).toHaveLength(1);
      expect(manager.getAllCodeSnippets()[0].description).toBe(
        "Updated description"
      );
    });

    it("should preserve extractedAt when updating existing snippet", () => {
      manager.addCodeSnippet("test.py", "Original");
      const firstSnippet = manager.getAllCodeSnippets()[0];
      const originalExtractedAt = firstSnippet.extractedAt;

      manager.addCodeSnippet("test.py", "Updated");
      const updatedSnippet = manager.getAllCodeSnippets()[0];
      expect(updatedSnippet.extractedAt).toBe(originalExtractedAt);
    });

    it("should add multiple different code snippets", () => {
      manager.addCodeSnippet("file1.py", "File 1");
      manager.addCodeSnippet("file2.py", "File 2");
      manager.addCodeSnippet("file3.py", "File 3");
      expect(manager.getAllCodeSnippets()).toHaveLength(3);
    });

    it("should set extractedAt timestamp for new snippets", () => {
      manager.addCodeSnippet("test.py");
      const snippet = manager.getAllCodeSnippets()[0];
      expect(snippet.extractedAt).toBeDefined();
      expect(typeof snippet.extractedAt).toBe("number");
    });
  });

  describe("setTaskId", () => {
    beforeEach(() => {
      manager.initialize();
    });

    it("should set task ID", () => {
      manager.setTaskId("task-123");
      expect(manager.getTaskId()).toBe("task-123");
    });

    it("should update task ID", () => {
      manager.setTaskId("task-1");
      manager.setTaskId("task-2");
      expect(manager.getTaskId()).toBe("task-2");
    });
  });

  describe("getProgressPlan", () => {
    beforeEach(() => {
      manager.initialize();
    });

    it("should return undefined when no taskId is set", () => {
      expect(manager.getProgressPlan()).toBeUndefined();
    });

    it("should return undefined when taskId is set but plan does not exist", () => {
      manager.setTaskId("non-existent-task");
      expect(manager.getProgressPlan()).toBeUndefined();
    });

    it("should return plan when taskId is set and plan exists", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "simple",
        [{ goal: "Step 1" }]
      );
      manager.setTaskId("task-123");

      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan?.taskId).toBe("task-123");
      expect(retrievedPlan?.originalPrompt).toBe("Test task");
    });

    it("should return updated plan when plan is modified in ProgressPlanManager", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "hard",
        [{ goal: "Step 1" }, { goal: "Step 2" }]
      );
      manager.setTaskId("task-123");

      // Update step status in ProgressPlanManager
      progressPlanManager.updateStepStatus("task-123", 1, "completed");

      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan?.steps[0].status).toBe("completed");
      expect(retrievedPlan?.steps[1].status).toBe("pending");
    });
  });

  describe("exportForTransition", () => {
    beforeEach(() => {
      manager.initialize();
    });

    it("should export empty data when state is not initialized", () => {
      manager.clear();
      const exportData = manager.exportForTransition();
      expect(exportData.assumptions).toEqual([]);
      expect(exportData.codeSnippets).toEqual([]);
      expect(exportData.progressPlan).toBeUndefined();
      expect(exportData.summary).toContain("No assumptions data");
    });

    it("should export assumptions and code snippets", () => {
      manager.addAssumption("Assumption 1");
      manager.addAssumption("Assumption 2");
      manager.addCodeSnippet("file1.py", "File 1");
      manager.addCodeSnippet("file2.py", "File 2");

      const exportData = manager.exportForTransition();
      expect(exportData.assumptions).toHaveLength(2);
      expect(exportData.codeSnippets).toHaveLength(2);
      expect(exportData.assumptions).toContain("Assumption 1");
      expect(exportData.assumptions).toContain("Assumption 2");
    });

    it("should export progressPlan when taskId is set and plan exists", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "hard",
        [
          { goal: "Step 1", description: "First step" },
          { goal: "Step 2", description: "Second step" },
        ]
      );
      manager.setTaskId("task-123");

      const exportData = manager.exportForTransition();
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.taskId).toBe("task-123");
      expect(exportData.progressPlan?.totalSteps).toBe(2);
      expect(exportData.progressPlan?.complexity).toBe("hard");
    });

    it("should export progressPlan with steps (planSteps is redundant, use progressPlan.steps)", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "hard",
        [
          { goal: "Step 1", description: "First step", tools: ["create_file"] },
          { goal: "Step 2", description: "Second step" },
        ]
      );
      manager.setTaskId("task-123");

      const exportData = manager.exportForTransition();
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps).toHaveLength(2);
      expect(exportData.progressPlan?.steps[0].stepNumber).toBe(1);
      expect(exportData.progressPlan?.steps[0].goal).toBe("Step 1");
      expect(exportData.progressPlan?.steps[0].description).toBe("First step");
      expect(exportData.progressPlan?.steps[0].tools).toEqual(["create_file"]);
      expect(exportData.progressPlan?.steps[1].stepNumber).toBe(2);
    });

    it("should not export progressPlan when taskId is set but plan does not exist", () => {
      manager.setTaskId("non-existent-task");
      const exportData = manager.exportForTransition();
      expect(exportData.progressPlan).toBeUndefined();
    });

    it("should include plan info in summary when plan exists", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "simple",
        [{ goal: "Step 1" }]
      );
      manager.setTaskId("task-123");
      manager.addAssumption("Test assumption");

      const exportData = manager.exportForTransition();
      expect(exportData.summary).toContain("1 response(s)");
      expect(exportData.summary).toContain("1 step(s)");
      expect(exportData.summary).toContain("complexity: simple");
    });

    it("should create summary without plan info when no plan exists", () => {
      manager.addAssumption("Test assumption");
      manager.addCodeSnippet("test.py");

      const exportData = manager.exportForTransition();
      expect(exportData.summary).toContain("1 response(s)");
      expect(exportData.summary).toContain("1 code snippet(s)");
      expect(exportData.summary).not.toContain("Plan created");
    });

    it("should create a default plan when exporting for transition if no plan exists and originalPrompt is provided", () => {
      manager.addAssumption("Test assumption");
      manager.addCodeSnippet("test.py", "Test file");
      const originalPrompt = "create hello.py to greet Mary";

      const exportData = manager.exportForTransition(originalPrompt);

      // Verify plan was created
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.originalPrompt).toBe(originalPrompt);
      expect(exportData.progressPlan?.complexity).toBe("simple");
      expect(exportData.progressPlan?.totalSteps).toBe(1);

      // Verify steps (planSteps is redundant, use progressPlan.steps)
      expect(exportData.progressPlan?.steps).toBeDefined();
      expect(exportData.progressPlan?.steps).toHaveLength(1);
      expect(exportData.progressPlan?.steps[0].goal).toBe("Complete the task");
      expect(exportData.progressPlan?.steps[0].description).toContain(
        "Execute the task:"
      );
      expect(exportData.progressPlan?.steps[0].description).toContain(
        originalPrompt
      );
      expect(exportData.progressPlan?.steps[0].status).toBe("pending");
      expect(exportData.progressPlan?.steps[0].stepNumber).toBe(1);

      // Verify taskId was set
      expect(manager.getTaskId()).toBeDefined();
      expect(manager.getTaskId()).toBe(exportData.progressPlan?.taskId);

      // Verify summary includes plan info
      expect(exportData.summary).toContain("Plan created");
      expect(exportData.summary).toContain("1 step(s)");
      expect(exportData.summary).toContain("complexity: simple");
    });

    it("should NOT create a plan when exporting for transition if no originalPrompt is provided", () => {
      manager.addAssumption("Test assumption");
      manager.addCodeSnippet("test.py");

      const exportData = manager.exportForTransition();

      // Verify no plan was created
      expect(exportData.progressPlan).toBeUndefined();
      expect(manager.getTaskId()).toBeUndefined();
    });

    it("should NOT create a plan if one already exists when exporting for transition", () => {
      // Create an existing plan
      const existingPlan = progressPlanManager.createPlan(
        "existing-task-123",
        "Existing task",
        "hard",
        [
          { goal: "Step 1", description: "First step" },
          { goal: "Step 2", description: "Second step" },
        ]
      );
      manager.setTaskId("existing-task-123");
      manager.addAssumption("Test assumption");

      const exportData = manager.exportForTransition("New prompt");

      // Verify existing plan is used, not a new one created
      expect(exportData.progressPlan).toBeDefined();
      expect(exportData.progressPlan?.taskId).toBe("existing-task-123");
      expect(exportData.progressPlan?.originalPrompt).toBe("Existing task"); // Original prompt, not new one
      expect(exportData.progressPlan?.complexity).toBe("hard");
      expect(exportData.progressPlan?.totalSteps).toBe(2);
      expect(exportData.progressPlan?.steps).toHaveLength(2);
    });

    it("should export updated plan when plan is modified", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "hard",
        [{ goal: "Step 1" }, { goal: "Step 2" }]
      );
      manager.setTaskId("task-123");

      // Update step status
      progressPlanManager.updateStepStatus("task-123", 1, "completed");

      const exportData = manager.exportForTransition();
      expect(exportData.progressPlan?.steps[0].status).toBe("completed");
      expect(exportData.progressPlan?.steps[1].status).toBe("pending");
    });
  });

  describe("clear", () => {
    it("should clear all state", () => {
      manager.initialize();
      manager.addAssumption("Test");
      manager.addCodeSnippet("test.py");
      manager.setTaskId("task-123");

      manager.clear();

      expect(manager.hasContent()).toBe(false);
      expect(manager.getAllAssumptions()).toEqual([]);
      expect(manager.getAllCodeSnippets()).toEqual([]);
      expect(manager.getTaskId()).toBeUndefined();
      expect(manager.getState()).toBeNull();
    });
  });

  describe("hasContent", () => {
    it("should return false when state is null", () => {
      expect(manager.hasContent()).toBe(false);
    });

    it("should return false when state is empty", () => {
      manager.initialize();
      expect(manager.hasContent()).toBe(false);
    });

    it("should return true when assumptions exist", () => {
      manager.initialize();
      manager.addAssumption("Test");
      expect(manager.hasContent()).toBe(true);
    });

    it("should return true when code snippets exist", () => {
      manager.initialize();
      manager.addCodeSnippet("test.py");
      expect(manager.hasContent()).toBe(true);
    });

    it("should return true when both assumptions and code snippets exist", () => {
      manager.initialize();
      manager.addAssumption("Test");
      manager.addCodeSnippet("test.py");
      expect(manager.hasContent()).toBe(true);
    });
  });

  describe("getState", () => {
    it("should return null when state is not initialized", () => {
      expect(manager.getState()).toBeNull();
    });

    it("should return copy of state", () => {
      manager.initialize();
      manager.addAssumption("Test");
      manager.addCodeSnippet("test.py");

      const state1 = manager.getState();
      const state2 = manager.getState();

      expect(state1).not.toBe(state2); // Different objects
      expect(state1?.assumptions).not.toBe(state2?.assumptions); // Different arrays
      expect(state1?.codeSnippets).not.toBe(state2?.codeSnippets); // Different arrays
      expect(state1?.assumptions).toEqual(state2?.assumptions);
      expect(state1?.codeSnippets).toEqual(state2?.codeSnippets);
    });
  });

  describe("integration with ProgressPlanManager", () => {
    it("should work with multiple plans in ProgressPlanManager", () => {
      const plan1 = progressPlanManager.createPlan(
        "task-1",
        "Task 1",
        "simple",
        [{ goal: "Step 1" }]
      );
      const plan2 = progressPlanManager.createPlan("task-2", "Task 2", "hard", [
        { goal: "Step 1" },
        { goal: "Step 2" },
      ]);

      manager.initialize();
      manager.setTaskId("task-1");
      expect(manager.getProgressPlan()?.taskId).toBe("task-1");

      manager.setTaskId("task-2");
      expect(manager.getProgressPlan()?.taskId).toBe("task-2");
      expect(manager.getProgressPlan()?.totalSteps).toBe(2);
    });

    it("should reflect plan updates from ProgressPlanManager", () => {
      const plan = progressPlanManager.createPlan(
        "task-123",
        "Test task",
        "hard",
        [{ goal: "Step 1" }, { goal: "Step 2" }, { goal: "Step 3" }]
      );
      manager.initialize();
      manager.setTaskId("task-123");

      // Update steps in ProgressPlanManager
      progressPlanManager.updateStepStatus("task-123", 1, "in_progress");
      progressPlanManager.updateStepStatus("task-123", 1, "completed");
      progressPlanManager.updateStepStatus("task-123", 2, "in_progress");

      const retrievedPlan = manager.getProgressPlan();
      expect(retrievedPlan?.steps[0].status).toBe("completed");
      expect(retrievedPlan?.steps[1].status).toBe("in_progress");
      expect(retrievedPlan?.steps[2].status).toBe("pending");

      // Export should reflect updates
      const exportData = manager.exportForTransition();
      expect(exportData.progressPlan?.steps[0].status).toBe("completed");
      expect(exportData.progressPlan?.steps[1].status).toBe("in_progress");
      expect(exportData.progressPlan?.steps[2].status).toBe("pending");
    });
  });

  describe('createOrUpdatePlan - bug fix for "move to implementation" preserving simple plans', () => {
    beforeEach(() => {
      progressPlanManager = new ProgressPlanManager();
      manager = new AssumptionsManager(progressPlanManager);
      manager.initialize();
    });

    /**
     * BUG SCENARIO: "move to implementation" should preserve the simple plan from assumptions
     *
     * Chat:
     *   User: "what is 2+2?"
     *   AI: "2+2 = 4"
     *
     * Move to Assumptions:
     *   AI analysis with numbered list (looks like 3 headings, not 3 execution steps):
     *     "1. Restatement of the problem / requirements"
     *     "2. Analysis of the problem space"
     *     "3. Estimated complexity assessment"
     *   But only 1 actual execution step: "Provide the numeric result..."
     *
     * Move to Implementation:
     *   Should preserve the 1-step plan, NOT create generic 3-step fallback
     */
    it("should NOT upgrade simple 1-step plan to generic 3-step plan when transition to implementation", () => {
      const originalPrompt = "what is 2+2?";

      // Simulate assumptions stage response with numbered structure (like the jinja template)
      // This looks like 3 steps but is really just section headings
      const assumptionsContent = `
**1. Restatement of the problem / requirements**
The user is asking for the result of 2+2.

**2. Analysis of the problem space**
This is a basic arithmetic operation.

**3. Estimated complexity assessment**
Very simple arithmetic calculation.

**Numbered plan:**
1. Provide the numeric result of the addition, stating that 2 + 2 equals 4.
`;

      // Create plan from assumptions response
      const plan = manager.createOrUpdatePlan(
        assumptionsContent,
        originalPrompt,
        undefined, // reasoning
        undefined, // toolCalls
        undefined // existingTaskId
      );

      // VERIFY: Plan should have exactly 1 step (the actual execution step)
      // NOT 3 steps (the generic fallback)
      expect(plan).toBeDefined();
      expect(plan?.totalSteps).toBe(1);
      expect(plan?.complexity).toBe("simple");
      expect(plan?.steps).toHaveLength(1);
      expect(plan?.steps[0].goal).toContain("Provide the numeric result");
      expect(plan?.steps[0].stepNumber).toBe(1);
      expect(plan?.steps[0].status).toBe("pending");
    });

    it("should preserve 2-step simple plan instead of upgrading to generic 3-step plan", () => {
      const originalPrompt = "Create a simple calculator that adds two numbers";

      const assumptionsContent = `
**1. Restatement of the problem / requirements**
Create a calculator function that adds two numbers.

**2. Analysis of the problem space**
Need a simple add function and test cases.

**Numbered plan:**
1. Create calc.py with an add function
2. Create test_calc.py with test cases
`;

      const plan = manager.createOrUpdatePlan(
        assumptionsContent,
        originalPrompt,
        undefined,
        undefined,
        undefined
      );

      // VERIFY: Plan should have exactly 2 steps
      // NOT the generic 3-step fallback
      expect(plan).toBeDefined();
      expect(plan?.totalSteps).toBe(2);
      expect(plan?.complexity).toBe("simple");
      expect(plan?.steps).toHaveLength(2);
      expect(plan?.steps[0].goal).toContain("calc.py");
      expect(plan?.steps[1].goal).toContain("test_calc.py");
    });

    it("should keep 3+ step hard plans when truly complex", () => {
      const originalPrompt = "Build a web app with auth";

      const assumptionsContent = `
**1. Restatement**
Build a web app with user authentication.

**2. Analysis**
Requires backend, frontend, database.

**3. Complexity**
Hard task - multiple components.

**Numbered plan:**
1. Set up database schema and models
2. Implement authentication endpoints
3. Create frontend login UI
4. Integrate frontend with backend APIs
`;

      const plan = manager.createOrUpdatePlan(
        assumptionsContent,
        originalPrompt,
        undefined,
        undefined,
        undefined
      );

      // VERIFY: Plan should have 4 steps (actual hard task)
      expect(plan).toBeDefined();
      expect(plan?.totalSteps).toBe(4);
      expect(plan?.complexity).toBe("hard");
      expect(plan?.steps).toHaveLength(4);
    });

    it("should extract steps from 'Plan (all steps needed):' section with bold markdown format", () => {
      // Real-world scenario: User asks multiple questions
      const originalPrompt = "what is 2 + 2? and 9 / 2?";

      // This is the actual format from the jinja template when there are multiple questions
      const assumptionsContent = `
**Restated problem**

You want the results of two simple arithmetic calculations:

1. What is 2 + 2?  
2. What is 9 ÷ 2?

**Identified user requests**

1. Compute the sum 2 + 2.  
2. Compute the division 9 / 2.

**Assumptions & edge cases**

- The user is asking for the exact numeric results, not a programming implementation.  
- For the division, the user likely expects a decimal (floating‑point) result rather than integer truncation.  
- No special formatting or rounding is required unless otherwise specified.

**Plan (all steps needed)**

**Step 1:** Provide the result of the addition 2 + 2.  
**Step 2:** Provide the result of the division 9 / 2, expressed as a decimal (4.5).  

These two steps satisfy all identified requests.
`;

      const plan = manager.createOrUpdatePlan(
        assumptionsContent,
        originalPrompt,
        undefined,
        undefined,
        undefined
      );

      // VERIFY: Plan should have exactly 2 steps (not generic 3-step fallback)
      // The steps should be extracted from "Plan (all steps needed)" section
      expect(plan).toBeDefined();
      expect(plan?.totalSteps).toBe(2);
      expect(plan?.complexity).toBe("simple");
      expect(plan?.steps).toHaveLength(2);
      expect(plan?.steps[0].goal).toContain("addition 2 + 2");
      expect(plan?.steps[1].goal).toContain("division 9 / 2");
    });
  });
});
