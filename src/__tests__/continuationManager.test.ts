import { ContinuationManager } from "../harmony/continuationManager";
import { WorkflowStage } from "../harmony/stageStateMachine";
import { ConversationContext } from "../harmony/conversationContext";

describe("ContinuationManager", () => {
  let manager: ContinuationManager;

  beforeEach(() => {
    manager = new ContinuationManager();
  });

  describe("Word boundary regex fix", () => {
    it("should not match 'ready' within 'already' in continuation check", () => {
      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content =
        "Based on what I can see from the current directory structure, let me check if there's already a `hello.py` file or if we need to create one.";

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      // Should continue because "already" contains "ready" but shouldn't match with word boundaries
      // The content doesn't have explicit completion words
      expect(result).toBe(true);
    });

    it("should match actual 'ready' word when task is ready", () => {
      const executedToolCalls = [
        {
          name: "create_file",
          arguments: { path: "hello.py" },
        },
      ];

      const content = "The file is ready and complete.";

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      // Should NOT continue because "ready" is an actual completion word
      expect(result).toBe(false);
    });

    it("should continue when only discovery tools and no explicit continuation words", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content =
        "The file contains alsoRandomFunction() which we need to examine.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      // Should continue because only discovery tools used and no code generated
      // The snippet stage prioritizes "only discovery tools" logic over word boundary checks
      expect(result).toBe(true);
    });

    it("should match actual 'also' word for continuation", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "We need to also check the configuration file.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      // Should continue because "also" is an actual continuation word
      expect(result).toBe(true);
    });
  });

  describe("Snippet stage continuation", () => {
    it("should continue when only discovery tools used and no code generated", () => {
      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content = "Let me check the current directory structure.";

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        false,
        "snippet",
        null
      );

      expect(result).toBe(true);
    });

    it("should stop when code snippets are generated with completion phrase", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "example.py" },
        },
      ];

      const content = `Here's the code you need:

\`\`\`python
def greet():
    print("Hello")

if __name__ == "__main__":
    greet()
\`\`\``;

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        false,
        "snippet",
        null
      );

      expect(result).toBe(false);
    });

    it("should continue when response is too short (likely incomplete)", () => {
      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content = "Let me check";

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        false,
        "snippet",
        null
      );

      expect(result).toBe(true);
    });

    it("should continue when code has continuation hints", () => {
      const executedToolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
      }> = [];

      const content = `The first part:

\`\`\`python
def greet():
    print("Hello")
\`\`\`

Next, we need to add the main block.`;

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        false,
        "snippet",
        null
      );

      expect(result).toBe(true);
    });
  });

  describe("Chat stage continuation", () => {
    it("should continue for file task with only discovery tools", () => {
      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content =
        "Checking the directory structure to understand the project.";

      const result = manager.shouldContinueTask(
        "update config.json",
        executedToolCalls,
        content,
        false,
        "chat",
        null
      );

      expect(result).toBe(true);
    });

    it("should stop when file task shows completion in chat stage", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "config.json" },
        },
      ];

      const content =
        "Here is the current configuration that you need to update.";

      const result = manager.shouldContinueTask(
        "read config.json",
        executedToolCalls,
        content,
        false,
        "chat",
        null
      );

      expect(result).toBe(false);
    });
  });

  describe("Continuation limit", () => {
    it("should stop when reached continuation limit", () => {
      const conversationContext: ConversationContext = {
        originalPrompt: "examine code",
        currentStage: "snippet" as WorkflowStage,
        stageHistory: [],
        steps: [],
        continueStep: 5,
        continueLimit: 5,
      };

      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        "We need to continue checking more files.",
        false,
        "snippet",
        conversationContext
      );

      expect(result).toBe(false);
    });

    it("should continue when at continuation limit but not exceeded", () => {
      const conversationContext: ConversationContext = {
        originalPrompt: "examine code",
        currentStage: "snippet" as WorkflowStage,
        stageHistory: [],
        steps: [],
        continueStep: 4,
        continueLimit: 5,
      };

      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        "We need to continue checking more files.",
        false,
        "snippet",
        conversationContext
      );

      // Should continue because step 4+1=5 equals limit but doesn't exceed it
      // Only stops when continueStep > continueLimit
      expect(result).toBe(true);
    });

    it("should continue when under continuation limit", () => {
      const conversationContext: ConversationContext = {
        originalPrompt: "create hello.py",
        currentStage: "snippet" as WorkflowStage,
        stageHistory: [],
        steps: [],
        continueStep: 2,
        continueLimit: 5,
      };

      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        "Checking files.",
        false,
        "snippet",
        conversationContext
      );

      expect(result).toBe(true);
    });
  });

  describe("Already in continuation checks", () => {
    it("should stop when in continuation with tools executed and completion suggested", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "The task is now complete and all files are processed.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      expect(result).toBe(false);
    });

    it("should continue when in continuation with explicit need for more work", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "We still need to check additional configuration files.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      expect(result).toBe(true);
    });

    it("should stop when in continuation without explicit need for more work", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "The file contains some functions.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      expect(result).toBe(false);
    });
  });

  describe("Edge cases with substrings", () => {
    it("should not trigger on 'manifest' containing 'next'", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "package.json" },
        },
      ];

      const content = "The package manifest contains all dependencies.";

      const result = manager.shouldContinueTask(
        "check dependencies",
        executedToolCalls,
        content,
        true,
        "snippet",
        null
      );

      expect(result).toBe(false);
    });

    it("should continue when response is short even with word 'complete' in substring", () => {
      const executedToolCalls = [
        {
          name: "create_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "The autocompletion feature is implemented.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        false,
        "snippet",
        null
      );

      // Should continue because response is short (< 100 chars) even though it has 'completion'
      // The short response check takes precedence
      expect(result).toBe(true);
    });

    it("should trigger on actual 'next' word", () => {
      const executedToolCalls = [
        {
          name: "read_file",
          arguments: { path: "test.ts" },
        },
      ];

      const content = "First file examined. Next we should check another file.";

      const result = manager.shouldContinueTask(
        "examine code",
        executedToolCalls,
        content,
        true,
        "snippet",
        null
      );

      expect(result).toBe(true);
    });
  });

  describe("Real-world scenario: hello.py creation at step 5/5", () => {
    it("should stop at step 5 when continuation limit is 5", () => {
      const conversationContext: ConversationContext = {
        originalPrompt: "create hello.py with greet function and main block",
        currentStage: "snippet" as WorkflowStage,
        stageHistory: [],
        steps: [],
        continueStep: 5,
        continueLimit: 5,
      };

      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content = `Looking at this scenario, I need to understand what's happening here. The user wants me to create \`hello.py\` with a \`greet\` function and main block, but according to my instructions, I'm in the SNIPPET/QUICK PROBLEM SOLVING stage where I can't actually modify files directly.

Let me review the current state:
1. We're at step 5 of 5 in the continuation process
2. Current stage is "snippet" 
3. The original task was "create hello.py with greet function and main block"`;

      const result = manager.shouldContinueTask(
        "create hello.py with greet function and main block",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        conversationContext
      );

      // Should NOT continue because we've reached the continuation limit (step 5/5)
      expect(result).toBe(false);
    });

    it("should stop when providing code snippet with instructions in snippet stage", () => {
      const conversationContext: ConversationContext = {
        originalPrompt: "create hello.py with greet function and main block",
        currentStage: "snippet" as WorkflowStage,
        stageHistory: [],
        steps: [],
        continueStep: 2,
        continueLimit: 5,
      };

      const executedToolCalls: Array<{
        name: string;
        arguments: Record<string, any>;
      }> = [];

      const content = `Here's the code for \`hello.py\`:

\`\`\`python
def greet(name="World"):
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet())
    print(greet("Python"))
\`\`\`

**What this code does:**
- Defines a \`greet()\` function that takes an optional parameter \`name\` (defaults to "World")
- Returns a formatted greeting string
- Includes a main block (\`if __name__ == "__main__":\`) that demonstrates how to use the function
- Shows multiple examples of calling the function

To implement this, you'll need to:
1. Create a new file named \`hello.py\` in your workspace directory
2. Copy and paste the code above into the file
3. Save the file
4. Run it with \`python hello.py\` to see the output

Would you like me to help test this code or make any adjustments to the functionality?`;

      const result = manager.shouldContinueTask(
        "create hello.py with greet function and main block",
        executedToolCalls,
        content,
        false,
        "snippet",
        conversationContext
      );

      // Should NOT continue because we have code snippets with completion phrase
      expect(result).toBe(false);
    });

    it("should stop when long explanation is provided without continuation hints", () => {
      const executedToolCalls = [
        {
          name: "list_files",
          arguments: { directory_path: "." },
        },
      ];

      const content = `Looking at this scenario, I need to understand what's happening here. The user wants me to create \`hello.py\` with a \`greet\` function and main block, but according to my instructions, I'm in the SNIPPET/QUICK PROBLEM SOLVING stage where I can't actually modify files directly. This is a complete explanation of the situation.`;

      const result = manager.shouldContinueTask(
        "create hello.py",
        executedToolCalls,
        content,
        true, // isAlreadyContinuation = true
        "snippet",
        null
      );

      // Should NOT continue - already in continuation with tool calls and no explicit continuation hints
      expect(result).toBe(false);
    });
  });
});
