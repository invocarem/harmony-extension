import { SnippetManager, SnippetRequirement } from "../harmony/snippetManager";
import { ConversationContextManager } from "../harmony/conversationContext";
import { CodeContextType } from "../harmony/codeContext";

describe("SnippetManager", () => {
  let snippetManager: SnippetManager;
  let contextManager: ConversationContextManager;

  beforeEach(() => {
    contextManager = new ConversationContextManager();
    snippetManager = new SnippetManager(contextManager);
  });

  describe("initialization", () => {
    it("should start with no requirements", () => {
      expect(snippetManager.getRequirements()).toEqual([]);
      expect(snippetManager.hasRequirements()).toBe(false);
    });

    it("should initialize from prompt with bug fix request", () => {
      const prompt = "fix the bug in calculateTotal.ts";
      snippetManager.initializeFromPrompt(prompt, 1);

      const requirements = snippetManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].type).toBe("bug_fix");
      expect(requirements[0].targetFile).toBe("calculateTotal.ts");
      expect(requirements[0].description).toContain("calculateTotal.ts");
      expect(requirements[0].isComplete).toBe(false);
      expect(requirements[0].stepNumber).toBe(1);
    });

    it("should initialize from prompt with feature addition request", () => {
      const prompt = "add a new function to utils.ts";
      snippetManager.initializeFromPrompt(prompt, 2);

      const requirements = snippetManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].type).toBe("feature_addition");
      expect(requirements[0].targetFile).toBe("utils.ts");
      expect(requirements[0].isComplete).toBe(false);
      expect(requirements[0].stepNumber).toBe(2);
    });

    it("should initialize from prompt with question request", () => {
      const prompt = "explain how the authentication works";
      snippetManager.initializeFromPrompt(prompt);

      const requirements = snippetManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].type).toBe("question");
      expect(requirements[0].isComplete).toBe(false);
    });

    it("should create task CodeContexts for file-related requirements", () => {
      const prompt = "fix the bug in auth.ts";
      snippetManager.initializeFromPrompt(prompt, 1);

      const requirements = snippetManager.getRequirements();
      expect(requirements).toHaveLength(1);
      const contextMap = requirements[0].codeContextsByName;
      expect(contextMap).toBeDefined();
      expect(contextMap?.get("auth.ts")).toBeDefined();
      expect(contextMap?.get("auth.ts")?.type).toBe(CodeContextType.TASK);
      expect(contextMap?.get("auth.ts")?.waitForCreate).toBe(true);
    });

    it("should not create CodeContexts for question requirements", () => {
      const prompt = "what is the purpose of this file?";
      snippetManager.initializeFromPrompt(prompt);

      const requirements = snippetManager.getRequirements();
      expect(requirements[0].codeContextsByName).toBeUndefined();
    });
  });

  describe("parseRequirements", () => {
    it("should parse multiple bug fix patterns", () => {
      const patterns = [
        "fix the bug in handler.ts",
        "fix handler.ts",
        "bug in handler.ts",
      ];

      for (const pattern of patterns) {
        const reqs = snippetManager.parseRequirements(pattern);
        // Should return exactly 1 requirement (no duplicates)
        expect(reqs).toHaveLength(1);
        expect(reqs[0].type).toBe("bug_fix");
        expect(reqs[0].targetFile).toBe("handler.ts");
      }
    });

    it("should parse multiple feature addition patterns", () => {
      const patterns = [
        "add a new function to service.ts",
        "create a new method in service.ts",
        "implement a new feature in service.ts",
      ];

      for (const pattern of patterns) {
        const reqs = snippetManager.parseRequirements(pattern);
        // Should return exactly 1 requirement (no duplicates)
        expect(reqs).toHaveLength(1);
        expect(reqs[0].type).toBe("feature_addition");
        expect(reqs[0].targetFile).toBe("service.ts");
      }
    });

    it("should detect command execution requests", () => {
      const patterns = [
        "run calc.py with 1 2",
        "execute the script calc.py",
        "run the command in the terminal",
      ];

      for (const pattern of patterns) {
        const reqs = snippetManager.parseRequirements(pattern);
        expect(reqs).toHaveLength(1);
        expect(reqs[0].type).toBe("question");
        expect(reqs[0].description.toLowerCase()).toContain("execute");
      }
    });

    it("should allow command execution with a question", () => {
      const prompt =
        "run calc.py add 2 2 and suggest the best approach for divide by zero";
      const reqs = snippetManager.parseRequirements(prompt);

      const hasExecution = reqs.some(
        (r) =>
          r.type === "question" &&
          r.description.toLowerCase().includes("execute")
      );
      const hasQuestion = reqs.some(
        (r) =>
          r.type === "question" &&
          r.description.toLowerCase().includes("generate")
      );
      expect(hasExecution).toBe(true);
      expect(hasQuestion).toBe(true);
    });

    it("should detect questions", () => {
      const patterns = [
        "explain how this works",
        "what does this function do",
        "how can I improve this",
        "why is this failing",
        "describe the algorithm",
      ];

      for (const pattern of patterns) {
        const reqs = snippetManager.parseRequirements(pattern);
        expect(reqs).toHaveLength(1);
        expect(reqs[0].type).toBe("question");
      }
    });

    it("should create generic text_generation for unrecognized patterns", () => {
      const prompt = "do something interesting";
      const reqs = snippetManager.parseRequirements(prompt);

      expect(reqs).toHaveLength(1);
      expect(reqs[0].type).toBe("text_generation");
    });

    it("should extract file names with various formats", () => {
      const patterns = [
        { prompt: "fix bug in src/utils/helper.ts", shouldMatch: true },
        { prompt: "fix the helper.ts file", shouldMatch: true },
        { prompt: "fix a helper.ts", shouldMatch: true },
      ];

      for (const { prompt, shouldMatch } of patterns) {
        const reqs = snippetManager.parseRequirements(prompt);
        if (shouldMatch) {
          expect(reqs.length).toBeGreaterThan(0);
          expect(reqs[0].targetFile).toBeTruthy();
        }
      }
    });
  });

  describe("addRequirement", () => {
    it("should add a new requirement", () => {
      const requirement: SnippetRequirement = {
        type: "bug_fix",
        description: "Fix null pointer",
        targetFile: "app.ts",
        isComplete: false,
      };

      snippetManager.addRequirement(requirement);
      expect(snippetManager.getRequirements()).toHaveLength(1);
      expect(snippetManager.getRequirements()[0]).toEqual(requirement);
    });

    it("should not add duplicate requirements", () => {
      const requirement: SnippetRequirement = {
        type: "bug_fix",
        description: "Fix null pointer",
        targetFile: "app.ts",
        isComplete: false,
      };

      snippetManager.addRequirement(requirement);
      snippetManager.addRequirement(requirement);

      // Should still have only one
      expect(snippetManager.getRequirements()).toHaveLength(1);
    });

    it("should allow different requirements for the same file", () => {
      const req1: SnippetRequirement = {
        type: "bug_fix",
        description: "Fix null pointer",
        targetFile: "app.ts",
        isComplete: false,
      };

      const req2: SnippetRequirement = {
        type: "feature_addition",
        description: "Add logging",
        targetFile: "app.ts",
        isComplete: false,
      };

      snippetManager.addRequirement(req1);
      snippetManager.addRequirement(req2);

      expect(snippetManager.getRequirements()).toHaveLength(2);
    });
  });

  describe("extractCodeContextsFromResponse", () => {
    beforeEach(() => {
      // Clear and initialize fresh to avoid test pollution
      contextManager = new ConversationContextManager();
      contextManager.initialize("test", "snippet");
      snippetManager = new SnippetManager(contextManager);
      snippetManager.initializeFromPrompt("fix bug in calc.ts", 1);
    });

    it("should extract code blocks from response", () => {
      const response = `Here's the fix:

\`\`\`typescript calc.ts
function calculate(a: number, b: number): number {
  return a + b;
}
\`\`\`
`;

      snippetManager.extractCodeContextsFromResponse(response, 1);

      const requirements = snippetManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].targetFile).toBe("calc.ts");
      const contextMap = requirements[0].codeContextsByName;
      expect(contextMap?.get("calc.ts")?.content.length).toBeGreaterThan(0);
      expect(requirements[0].isComplete).toBe(true);
    });

    it("should handle multiple code blocks", () => {
      const response = `Here are multiple fixes:

\`\`\`typescript file1.ts
export const x = 1;
\`\`\`

\`\`\`typescript file2.ts
export const y = 2;
\`\`\`
`;

      snippetManager.extractCodeContextsFromResponse(response, 1);

      const taskContexts = snippetManager.getTaskCodeContexts();
      // Should have original calc.ts (1) plus two new ones (file1.ts, file2.ts) = 3
      expect(taskContexts.length).toBeGreaterThanOrEqual(3);
    });

    it("should mark question requirements as complete when substantial text response", () => {
      const questionManager = new SnippetManager(contextManager);
      questionManager.initializeFromPrompt("explain how this works");

      const response =
        "This is a detailed explanation that goes on for quite a while explaining the concepts.";
      questionManager.extractCodeContextsFromResponse(response);

      const requirements = questionManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].isComplete).toBe(true);
    });

    it("should not mark question complete for short response", () => {
      const questionManager = new SnippetManager(contextManager);
      questionManager.initializeFromPrompt("what is this?");

      const response = "Short.";
      questionManager.extractCodeContextsFromResponse(response);

      const requirements = questionManager.getRequirements();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].isComplete).toBe(false);
    });

    it("should create new requirements for unmatched code blocks", () => {
      const response = `\`\`\`typescript newfile.ts
export const z = 3;
\`\`\``;

      snippetManager.extractCodeContextsFromResponse(response, 1);

      const requirements = snippetManager.getRequirements();
      // Should have original calc.ts (1) + new requirement (newfile.ts) = 2
      expect(requirements.length).toBe(2);

      const newReq = requirements.find((r) => r.targetFile === "newfile.ts");
      expect(newReq).toBeDefined();
      expect(newReq?.type).toBe("text_generation");
      expect(newReq?.codeContextsByName?.get("newfile.ts")).toBeDefined();
    });
  });

  describe("completion tracking", () => {
    it("should check if all tasks are complete", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      snippetManager = new SnippetManager(contextManager);
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);

      // Initially not complete
      expect(snippetManager.areAllTasksComplete()).toBe(false);

      // Add code content
      const response = `\`\`\`typescript test.ts
const x = 1;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response, 1);

      // Now should be complete
      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });

    it("should return true when no requirements", () => {
      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });

    it("should handle question-only requirements", () => {
      snippetManager.addRequirement({
        type: "question",
        description: "Explain this",
        isComplete: false,
      });

      expect(snippetManager.areAllTasksComplete()).toBe(false);

      const response =
        "This is a comprehensive explanation with lots of details about the topic.";
      snippetManager.extractCodeContextsFromResponse(response);

      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });

    it("should complete command execution after exec_terminal", () => {
      snippetManager.addRequirement({
        type: "question",
        description: "Execute calc.py",
        targetFile: "calc.py",
        isComplete: false,
      });

      expect(snippetManager.areAllTasksComplete()).toBe(false);

      snippetManager.markCommandExecutionComplete([
        { name: "exec_terminal", arguments: { command: "python calc.py" } },
      ]);

      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });

    it("should store exec_terminal output in command CodeContext", () => {
      snippetManager.addRequirement({
        type: "question",
        description: "Execute calc.py",
        targetFile: "calc.py",
        isComplete: false,
      });

      snippetManager.markCommandExecutionComplete([
        {
          name: "exec_terminal",
          arguments: { command: "python calc.py add 2 3" },
          result: {
            content: [{ type: "text", text: "5" }],
          },
        },
      ]);

      const req = snippetManager
        .getRequirements()
        .find((r) => r.description === "Execute calc.py");
      const contextMap = req?.codeContextsByName;
      expect(contextMap).toBeDefined();
      expect(contextMap?.get("calc.py")?.content).toEqual([
        "Command: python calc.py add 2 3",
        "5",
      ]);
    });

    it("should get pending requirements", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      snippetManager = new SnippetManager(contextManager);
      snippetManager.initializeFromPrompt("fix bug in a.ts");
      snippetManager.addRequirement({
        type: "bug_fix",
        description: "Fix bug in b.ts",
        targetFile: "b.ts",
        isComplete: false,
      });

      const pending = snippetManager.getPendingRequirements();
      expect(pending.length).toBeGreaterThanOrEqual(2);

      // Complete one
      const response = `\`\`\`typescript a.ts
const x = 1;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response, 1);

      const stillPending = snippetManager.getPendingRequirements();
      // b.ts should still be pending
      const bPending = stillPending.find((p) => p.targetFile === "b.ts");
      expect(bPending).toBeDefined();
    });

    it("should get pending task CodeContexts", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      snippetManager = new SnippetManager(contextManager);
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);

      const pendingTasks = snippetManager.getPendingTaskCodeContexts();
      expect(pendingTasks.length).toBeGreaterThanOrEqual(1);

      // Complete it
      const response = `\`\`\`typescript test.ts
const complete = true;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response, 1);

      const stillPending = snippetManager.getPendingTaskCodeContexts();
      expect(stillPending).toHaveLength(0);
    });
  });

  describe("reference CodeContexts", () => {
    beforeEach(() => {
      // Initialize context manager properly
      contextManager = new ConversationContextManager();
      contextManager.initialize("test prompt", "chat");
      snippetManager = new SnippetManager(contextManager);
    });

    it("should add reference CodeContext", () => {
      const content = ["line 1", "line 2"];
      snippetManager.addReferenceCodeContext(
        "ref.ts",
        content,
        "Reference file"
      );

      const refContexts = snippetManager.getReferenceCodeContexts();
      expect(refContexts).toHaveLength(1);
      expect(refContexts[0].name).toBe("ref.ts");
      expect(refContexts[0].type).toBe(CodeContextType.REFERENCE);
      expect(refContexts[0].waitForCreate).toBe(false);
    });

    it("should get file reference by name", () => {
      snippetManager.addReferenceCodeContext("test.ts", ["code"]);

      const ref = snippetManager.getFileReference("test.ts");
      expect(ref).toBeDefined();
      expect(ref?.name).toBe("test.ts");
    });

    it("should match file reference by basename", () => {
      snippetManager.addReferenceCodeContext("src/utils/test.ts", ["code"]);

      const ref = snippetManager.getFileReference("test.ts");
      expect(ref).toBeDefined();
      expect(ref?.name).toBe("src/utils/test.ts");
    });

    it("should return null for missing file reference", () => {
      const ref = snippetManager.getFileReference("missing.ts");
      expect(ref).toBeNull();
    });

    it("should check if file needs to be read", () => {
      snippetManager.addReferenceCodeContext("available.ts", ["code"]);

      // needsFileRead checks if getFileReference returns null
      const hasRef = snippetManager.getFileReference("available.ts");
      expect(hasRef).not.toBeNull();
      expect(snippetManager.needsFileRead("missing.ts")).toBe(true);
    });

    it("should separate task and reference CodeContexts", () => {
      // Create fresh manager to avoid duplicate requirements from other tests
      contextManager = new ConversationContextManager();
      contextManager.initialize("test", "chat");
      snippetManager = new SnippetManager(contextManager);

      // Add task context
      snippetManager.initializeFromPrompt("fix bug in task.ts", 1);

      // Add reference context
      snippetManager.addReferenceCodeContext("ref.ts", ["code"]);

      const taskContexts = snippetManager.getTaskCodeContexts();
      const refContexts = snippetManager.getReferenceCodeContexts();

      expect(taskContexts.length).toBeGreaterThanOrEqual(1);
      const taskContext = taskContexts.find((tc) => tc.name === "task.ts");
      expect(taskContext).toBeDefined();
      expect(taskContext?.type).toBe(CodeContextType.TASK);

      expect(refContexts).toHaveLength(1);
      expect(refContexts[0].name).toBe("ref.ts");
      expect(refContexts[0].type).toBe(CodeContextType.REFERENCE);
    });
  });

  describe("createTaskCodeContextsFromRequirements", () => {
    it("should create CodeContexts for existing requirements without contexts", () => {
      // Manually add requirements without CodeContexts
      snippetManager.addRequirement({
        type: "bug_fix",
        description: "Fix bug",
        targetFile: "app.ts",
        isComplete: false,
      });

      snippetManager.createTaskCodeContextsFromRequirements(2);

      const requirements = snippetManager.getRequirements();
      const contextMap = requirements[0].codeContextsByName;
      expect(contextMap?.get("app.ts")).toBeDefined();
      expect(contextMap?.get("app.ts")?.type).toBe(CodeContextType.TASK);
      expect(requirements[0].stepNumber).toBe(2);
    });

    it("should not create CodeContexts for question requirements", () => {
      snippetManager.addRequirement({
        type: "question",
        description: "Explain",
        isComplete: false,
      });

      snippetManager.createTaskCodeContextsFromRequirements(1);

      const requirements = snippetManager.getRequirements();
      expect(requirements[0].codeContextsByName).toBeUndefined();
    });

    it("should not duplicate CodeContexts", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);
      const beforeCount = snippetManager.getTaskCodeContexts().length;

      // Try to create again
      snippetManager.createTaskCodeContextsFromRequirements(1);

      const afterCount = snippetManager.getTaskCodeContexts().length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe("clear", () => {
    it("should clear all requirements", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);
      expect(snippetManager.hasRequirements()).toBe(true);

      snippetManager.clear();

      expect(snippetManager.hasRequirements()).toBe(false);
      expect(snippetManager.getRequirements()).toEqual([]);
    });
  });

  describe("hasRequirements", () => {
    it("should return true when requirements exist", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts");
      expect(snippetManager.hasRequirements()).toBe(true);
    });

    it("should return false when no requirements", () => {
      expect(snippetManager.hasRequirements()).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty response", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);
      snippetManager.extractCodeContextsFromResponse("", 1);

      expect(snippetManager.areAllTasksComplete()).toBe(false);
    });

    it("should handle response with no code blocks", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);
      snippetManager.extractCodeContextsFromResponse(
        "Just plain text response",
        1
      );

      expect(snippetManager.areAllTasksComplete()).toBe(false);
    });

    it("should handle malformed code blocks", () => {
      snippetManager.initializeFromPrompt("fix bug in test.ts", 1);
      const response = "```\ncode without language or file\n```";

      snippetManager.extractCodeContextsFromResponse(response, 1);
      // Should not crash
    });

    it("should handle requirements with no target file", () => {
      snippetManager.addRequirement({
        type: "text_generation",
        description: "Generate text",
        isComplete: false,
      });

      snippetManager.createTaskCodeContextsFromRequirements(1);

      // Should not crash, requirement should have no CodeContext
      const requirements = snippetManager.getRequirements();
      expect(requirements[0].codeContextsByName).toBeUndefined();
    });

    it("should handle mixed complete and incomplete requirements", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      snippetManager = new SnippetManager(contextManager);
      snippetManager.initializeFromPrompt("fix bug in a.ts", 1);
      snippetManager.addRequirement({
        type: "bug_fix",
        description: "Fix bug in b.ts",
        targetFile: "b.ts",
        isComplete: false,
      });
      // Create CodeContext for b.ts requirement
      snippetManager.createTaskCodeContextsFromRequirements(1);

      // Complete first one
      const response = `\`\`\`typescript a.ts
const done = true;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response, 1);

      expect(snippetManager.areAllTasksComplete()).toBe(false);

      const pending = snippetManager.getPendingRequirements();
      const bPending = pending.find((p) => p.targetFile === "b.ts");
      expect(bPending).toBeDefined();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete workflow: initialize -> extract -> complete", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      contextManager.initialize("test", "snippet");
      snippetManager = new SnippetManager(contextManager);

      // 1. Initialize from user prompt - use simpler prompt to avoid duplicate requirements
      const userPrompt = "implement auth.ts";
      snippetManager.addRequirement({
        type: "feature_addition",
        description: "Implement auth.ts",
        targetFile: "auth.ts",
        isComplete: false,
      });
      snippetManager.createTaskCodeContextsFromRequirements(1);

      expect(snippetManager.hasRequirements()).toBe(true);
      expect(snippetManager.areAllTasksComplete()).toBe(false);

      // 2. LLM provides code fix
      const llmResponse = `Here's the fix for auth.ts:

\`\`\`typescript auth.ts
export function authenticate(token: string): boolean {
  if (!token) return false;
  return validateToken(token);
}
\`\`\``;

      snippetManager.extractCodeContextsFromResponse(llmResponse, 1);

      // 3. Check completion
      expect(snippetManager.areAllTasksComplete()).toBe(true);
      expect(snippetManager.getPendingRequirements()).toHaveLength(0);
    });

    it("should handle workflow with reference context", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      contextManager.initialize("test", "snippet");
      snippetManager = new SnippetManager(contextManager);

      // 1. Add reference from chat stage
      snippetManager.addReferenceCodeContext(
        "config.ts",
        ["export const API_URL = 'https://api.example.com';"],
        "Config reference"
      );

      // 2. Initialize snippet task
      snippetManager.addRequirement({
        type: "feature_addition",
        description: "Add validation to user.ts",
        targetFile: "user.ts",
        isComplete: false,
      });
      snippetManager.createTaskCodeContextsFromRequirements(1);

      // 3. Verify we can check if file exists as reference
      const configRef = snippetManager.getFileReference("config.ts");
      expect(configRef).not.toBeNull();
      expect(snippetManager.needsFileRead("user.ts")).toBe(true);

      // 4. Complete task
      const response = `\`\`\`typescript user.ts
export function validateUser(user: any): boolean {
  return !!user.name && !!user.email;
}
\`\`\``;

      snippetManager.extractCodeContextsFromResponse(response, 1);
      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });

    it("should handle multi-file requirements", () => {
      // Create fresh manager
      contextManager = new ConversationContextManager();
      contextManager.initialize("test", "snippet");
      snippetManager = new SnippetManager(contextManager);

      // Manually add requirements to avoid parser ambiguity
      snippetManager.addRequirement({
        type: "bug_fix",
        description: "Fix bug in handler.ts",
        targetFile: "handler.ts",
        isComplete: false,
      });
      snippetManager.addRequirement({
        type: "bug_fix",
        description: "Fix bug in service.ts",
        targetFile: "service.ts",
        isComplete: false,
      });
      snippetManager.createTaskCodeContextsFromRequirements(1);

      const requirements = snippetManager.getRequirements();
      expect(requirements.length).toBe(2);

      // Complete first file
      const response1 = `\`\`\`typescript handler.ts
export const fixed = true;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response1, 1);

      expect(snippetManager.areAllTasksComplete()).toBe(false);

      // Complete second file
      const response2 = `\`\`\`typescript service.ts
export const alsoFixed = true;
\`\`\``;
      snippetManager.extractCodeContextsFromResponse(response2, 1);

      expect(snippetManager.areAllTasksComplete()).toBe(true);
    });
  });
});
