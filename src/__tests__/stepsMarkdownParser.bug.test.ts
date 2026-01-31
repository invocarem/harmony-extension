/**
 * Tests for step extraction bug where multiple steps get merged into one
 * This test file demonstrates the real-world bug reported by the user
 */

import { StepsMarkdownParser } from "../utils/stepsMarkdownParser";
import { AutoTransitionManager } from "../harmony/autoTransitionManager";
import { ProgressPlanManager } from "../progressPlanManager";

describe("StepsMarkdownParser - Bug: Steps getting merged", () => {
  describe("Real-world bug case", () => {
    it("should extract all 4 steps separately, not merge Steps 2-4 into one", () => {
      // This is the actual LLM output from the user's report
      const llmOutput = `**Restated problem**

The user wants a bug fix for the \`calc.py\` script.
We need to examine the provided file, identify any defects, and outline the changes required to make the module work correctly (including the command‑line interface).

**User requests identified**

1. **Bug fix on \`calc.py\`** – locate and correct errors in the script.

**Assumptions**

- The core arithmetic functions (\`add\`, \`subtract\`, \`multiply\`, \`divide\`) are intended to operate on numeric (float) inputs and return the correct result.
- The script is run from the command line as \`python calc.py <operation> <num1> <num2>\`.
- The only bugs are those visible in the source (e.g., indentation, missing information in messages, improper handling of unknown operations). No hidden runtime errors are expected.
- No additional features (e.g., support for more operations or advanced error handling) are required unless they directly resolve the identified bugs.
- The environment uses Python 3.x where standard exception handling works.

**Edge cases / special considerations**

- **Indentation error** in the \`divide\` function: the \`raise ValueError\` line must be indented under the \`if\` block.
- **Missing operation name** in the "unknown operation" message: the formatted string currently prints \`Unknown operation: \` without the actual operation.
- **Potential conversion error**: converting \`sys.argv[2]\` and \`sys.argv[3]\` to \`float\` could raise a \`ValueError\` if non‑numeric strings are supplied. Adding a try/except around the conversion will give a clearer error message.
- **Division by zero** is already handled, but we must ensure the raised exception propagates correctly to the CLI (i.e., prints a user‑friendly message and exits with a non‑zero status).
- **CLI exit codes**: ensure the script exits with \`1\` on any error (invalid usage, unknown operation, conversion error, division by zero).

**Complexity assessment**

The fix involves a few straightforward code edits (indentation, message formatting, optional input validation). This is a **Simple** task (≈2–3 steps).

**Implementation plan (one step per request)**

**Step 1:**
Correct the indentation in the \`divide\` function so that the \`raise ValueError("Cannot divide by zero")\` line is properly nested under the \`if b == 0:\` block.

**Step 2:**
Update the "unknown operation" error message to include the actual operation supplied (\`op\`). Change \`print(f"Unknown operation: ")\` to \`print(f"Unknown operation: {op}")\`.

**Step 3 (optional but recommended for robustness):**
Wrap the conversion of command‑line arguments to \`float\` in a \`try/except\` block that catches \`ValueError\`. On failure, print a clear message such as \`Invalid numeric arguments.\` and exit with status \`1\`. Also, catch the \`ValueError\` raised by \`divide\` (division by zero) and print its message before exiting.

**Step 4 (finalization):**
After making the above changes, ensure the script still imports the arithmetic functions correctly and that the CLI prints the computed result when valid inputs are provided.

---

Here's my implementation plan. Should I proceed to the Implementation stage to execute it?`;

      // Parse steps using StepsMarkdownParser
      const result = StepsMarkdownParser.extractPlanAndSteps(llmOutput);
      
      console.log('Extracted steps:', JSON.stringify(result.steps, null, 2));
      
      // The parser extracts all numbered steps, including from "User requests identified"
      // Filter to get only the implementation plan steps (Steps 1-4 from Implementation plan section)
      const implementationSteps = result.steps.filter(s => 
        s.content.includes("Correct the indentation") ||
        s.content.includes("Update the \"unknown operation\"") ||
        s.content.includes("Wrap the conversion") ||
        s.content.includes("After making the above changes")
      );
      
      // Should extract 4 implementation plan steps
      expect(implementationSteps.length).toBe(4);
      
      // Verify each step is extracted separately (not merged)
      const step1 = implementationSteps.find(s => s.content.includes("Correct the indentation"));
      const step2 = implementationSteps.find(s => s.content.includes("Update the \"unknown operation\""));
      const step3 = implementationSteps.find(s => s.content.includes("Wrap the conversion"));
      const step4 = implementationSteps.find(s => s.content.includes("After making the above changes"));
      
      expect(step1).toBeDefined();
      expect(step1!.content).not.toContain("Step 3");
      expect(step1!.content).not.toContain("Step 4");
      
      expect(step2).toBeDefined();
      expect(step2!.content).not.toContain("Step 3");
      expect(step2!.content).not.toContain("Step 4");
      
      expect(step3).toBeDefined();
      expect(step3!.content).not.toContain("Step 4");
      
      expect(step4).toBeDefined();
    });

    it("should handle steps with parenthetical labels like 'Step 3 (optional)'", () => {
      const text = `**Step 1:**
First step content here.

**Step 2:**
Second step content.

**Step 3 (optional but recommended for robustness):**
Third step with optional label.

**Step 4 (finalization):**
Fourth step with finalization label.`;

      const result = StepsMarkdownParser.extractPlanAndSteps(text);
      
      console.log('Steps with labels:', JSON.stringify(result.steps, null, 2));
      
      // Should extract 4 steps
      expect(result.steps.length).toBe(4);
      
      expect(result.steps[0].number).toBe(1);
      expect(result.steps[1].number).toBe(2);
      expect(result.steps[2].number).toBe(3);
      expect(result.steps[3].number).toBe(4);
    });
  });

  
});
