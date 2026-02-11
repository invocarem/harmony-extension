import { ConversationContextManager } from "../harmony/conversationContext";
import { PromptBuilder } from "../harmony/promptBuilder";
import { StageStateMachine } from "../harmony/stageStateMachine";
import { ProgressPlanManager } from "../progressPlanManager";
import { NativeToolsManager } from "../nativeToolManager";

describe("PromptBuilder - Multi-Step Content Injection", () => {
  let promptBuilder: PromptBuilder;
  let stageStateMachine: StageStateMachine;
  let contextManager: ConversationContextManager;
  let progressPlanManager: ProgressPlanManager;
  let nativeToolsManager: NativeToolsManager;
  let createPlan: (steps: string[]) => ReturnType<ProgressPlanManager["createPlan"]>;

  beforeEach(() => {
    stageStateMachine = new StageStateMachine();
    contextManager = new ConversationContextManager();
    progressPlanManager = new ProgressPlanManager();
    contextManager.initialize("test prompt");
    createPlan = (steps: string[]) => {
      const plan = progressPlanManager.createPlan(
        "task-1",
        "test prompt",
        "simple",
        steps.map((description) => ({ description }))
      );
      contextManager.setProgressPlan(plan);
      return plan;
    };

    // Mock NativeToolsManager with a simple read_file implementation
    nativeToolsManager = {
      getAvailableTools: jest.fn().mockReturnValue([]),
      callTool: jest.fn().mockResolvedValue({
        isError: false,
        content: [{ text: "// fallback file content from disk" }],
      }),
    } as any;

    promptBuilder = new PromptBuilder(
      {
        harmonyMode: "standard",
        openRouterApiKey: "test-key",
        modelName: "test-model",
      } as any,
      stageStateMachine,
      undefined,
      undefined,
      nativeToolsManager
    );
  });

  describe("Content Injection for Step 2+", () => {
    it("should inject content from step 1 file when in step 2", async () => {
      // Create a plan with 3 steps
      const plan = createPlan([
        "Create crc16.awk file",
        "Add CRC calculation logic",
        "Add output formatting",
      ]);
      const taskId = plan.taskId;

      // Move step 1 to in_progress
      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add file created in step 1 to implementationStepContexts
      const fileContent = [
        "#!/usr/bin/awk -f",
        "# CRC16 calculator",
        "BEGIN { print 'Starting...' }",
      ];
      contextManager.addImplementationStepContext(
        "crc16.awk",
        fileContent.join("\n"),
        1
      );

      // Complete step 1 and move to step 2
      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");

      // Update conversation context stage
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      // Build prompt for step 2
      const prompt = await promptBuilder.buildPrompt(
        "continue with step 2",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should include the file content
      expect(prompt).toContain("crc16.awk");
      expect(prompt).toContain("FILES FROM PREVIOUS STEPS");
      expect(prompt).toContain("#!/usr/bin/awk -f");
      expect(prompt).toContain("# CRC16 calculator");
    });

    it("should filter out diagnostic files (logs) from content injection", async () => {
      // Create a plan
      const plan = createPlan(["Create file", "Modify file"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add a code file
      contextManager.addImplementationStepContext(
        "app.js",
        "console.log('Hello');",
        1
      );

      // Add a log file (should be filtered out)
      contextManager.addImplementationStepContext(
        "step_1_log.txt",
        "Status: __completed__\nCreated app.js",
        1
      );

      // Complete step 1, start step 2
      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should inject app.js content (only 1 code file after filtering log)
      expect(prompt).toContain("app.js");
      expect(prompt).toContain("console.log('Hello')");
      expect(prompt).toContain(
        "FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION"
      );
    });

    it("should inject content for up to 2 code files (fallback logic)", async () => {
      const plan = createPlan(["Create files", "Modify files"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add 2 code files
      contextManager.addImplementationStepContext(
        "utils.js",
        "export const helper = () => {};",
        1
      );
      contextManager.addImplementationStepContext(
        "main.js",
        "import { helper } from './utils';",
        1
      );

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should inject both files (<=2 code files)
      expect(prompt).toContain("utils.js");
      expect(prompt).toContain("main.js");
      expect(prompt).toContain("export const helper");
      expect(prompt).toContain("import { helper }");
    });

    it("should match filename without extension in step description", async () => {
      const plan = createPlan([
        "Create calculator.py",
        "Add calculator functions",
      ]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      contextManager.addImplementationStepContext(
        "calculator.py",
        "def add(a, b):\n    return a + b",
        1
      );

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should inject because "calculator" matches "calculator.py" without extension
      expect(prompt).toContain("calculator.py");
      expect(prompt).toContain("def add(a, b)");
    });

    it("should not inject content when more than 2 code files and no filename match", async () => {
      const plan = createPlan([
        "Create multiple files",
        "Add general improvements",
      ]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add 3 code files (more than fallback threshold)
      ["file1.js", "file2.js", "file3.js"].forEach((name) => {
        contextManager.addImplementationStepContext(
          name,
          `// ${name} content`,
          1
        );
      });

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should NOT inject content (>2 files, no filename match)
      expect(prompt).not.toContain(
        "FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION"
      );
      // But should still warn about existing files
      expect(prompt).toContain("FILES ALREADY CREATED IN PREVIOUS STEPS");
      expect(prompt).toContain("file1.js");
    });

    it("should show warning about files from previous steps", async () => {
      const plan = createPlan(["Create config.json", "Update config"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      contextManager.addImplementationStepContext(
        "config.json",
        '{ "version": "1.0" }',
        1
      );

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should warn about not using create_file on existing files
      expect(prompt).toContain("FILES ALREADY CREATED IN PREVIOUS STEPS");
      expect(prompt).toContain("config.json");
      expect(prompt).toContain("DO NOT use create_file on these files");
      expect(prompt).toContain("use edit_file or replace_file");
    });

    it("should not inject content or warnings in step 1", async () => {
      const plan = createPlan(["Create initial file", "Modify file"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "start implementation",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should NOT have any previous step warnings or content
      expect(prompt).not.toContain("FILES ALREADY CREATED IN PREVIOUS STEPS");
      expect(prompt).not.toContain(
        "FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION"
      );
    });
  });

  describe("Diagnostic File Detection", () => {
    it("should identify step log files as diagnostic", async () => {
      const plan = createPlan(["Create files", "Continue"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add various log file formats
      const logFiles = [
        "step_1_log.txt",
        "step_2_log.md",
        "step-3-log.txt",
        "step1_log.txt",
      ];

      logFiles.forEach((name) => {
        contextManager.addImplementationStepContext(
          name,
          "Status: completed",
          1
        );
      });

      // Add one actual code file
      contextManager.addImplementationStepContext("app.ts", "const x = 1;", 1);

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should only inject the code file, not the logs
      expect(prompt).toContain("app.ts");
      expect(prompt).toContain("const x = 1");
      expect(prompt).toContain(
        "FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION"
      );

      // Log files should still appear in the warning list but not in content injection
      logFiles.forEach((logName) => {
        expect(prompt).toContain(logName); // In the warning
      });
    });

    it("should identify assumption_data.json as diagnostic", async () => {
      const plan = createPlan(["Create files", "Continue"]);
      const taskId = plan.taskId;

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      contextManager.addImplementationStepContext(
        "assumption_data.json",
        '{"assumptions": []}',
        1
      );
      contextManager.addImplementationStepContext("main.rs", "fn main() {}", 1);

      progressPlanManager.updateStepStatus(taskId, 1, "completed");
      progressPlanManager.updateStepStatus(taskId, 2, "in_progress");
      contextManager.updateStage("implementation");

      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        "continue",
        "implementation",
        context,
        false,
        [],
        "step",
        async (name, ctx) => {
          return `${ctx.stageInstructions}`;
        },
        false
      );

      // Should inject main.rs, not assumption_data.json
      expect(prompt).toContain("main.rs");
      expect(prompt).toContain("fn main()");
      expect(prompt).toContain(
        "FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION"
      );
    });
  });
});
