import { AutoTransitionManager } from "../harmony/autoTransitionManager";
import { ProgressPlanManager } from "../progressPlanManager";

describe("AutoTransitionManager - Implementation plan header fix", () => {
  let manager: AutoTransitionManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new AutoTransitionManager(progressPlanManager);
  });

  it("should correctly extract 1 step when LLM response has 'Implementation plan' header", () => {
    const content = `Implementation plan (one step per distinct request)  

Step 1: Execute the command python calc.py add 2 3 in the repository root using the terminal tool and capture the script's standard output.  

Complexity assessment – This task is simple (1 step).  

---

Here's my implementation plan. Should I proceed to the Implementation stage to execute it?`;

    const steps = manager.extractStepsFromText(content, undefined, "simple");
    expect(steps.length).toBe(1);
    expect(steps[0].description).toContain("Execute the command python calc.py add 2 3");
  });

  it("should prefer plan section steps over numbered list in analysis text", () => {
    const content = `Let me analyze this task:

1. Read the file
2. Parse the content
3. Extract data
4. Format output
5. Return result

Implementation plan

Step 1: Execute the command python calc.py add 2 3 in the repository root using the terminal tool and capture the script's standard output.

This is a simple task that can be completed in one step.`;


    const steps = manager.extractStepsFromText(content, undefined, "simple");
    expect(steps.length).toBe(1);
    expect(steps[0].description).toContain("Execute the command python calc.py add 2 3");
    expect(steps[0].description).not.toContain("Read the file");
  });

  it("should handle 'Execution plan' header variant", () => {
    const content = `Execution plan

Step 1: Run the command in terminal
Step 2: Capture the output
Step 3: Verify results`;

    // First just check step extraction works
    const steps = manager.extractStepsFromText(content, undefined, "hard");
    expect(steps.length).toBe(3);
    expect(steps[0].description).toContain("Run the command in terminal");
    expect(steps[1].description).toContain("Capture the output");
    expect(steps[2].description).toContain("Verify results");

  });
});
