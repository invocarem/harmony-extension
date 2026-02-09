import { ConversationContextManager } from "../harmony/conversationContext";
import { PromptBuilder } from "../harmony/promptBuilder";
import { StageStateMachine } from "../harmony/stageStateMachine";
import { ProgressPlanManager } from "../progressPlanManager";
import { CodeContext } from "../harmony/codeContext";
import { NativeToolsManager } from "../nativeToolManager";

describe("PromptBuilder - Multi-Step Content Injection", () => {
  let promptBuilder: PromptBuilder;
  let stageStateMachine: StageStateMachine;
  let contextManager: ConversationContextManager;
  let progressPlanManager: ProgressPlanManager;
  let nativeToolsManager: NativeToolsManager;

  beforeEach(() => {
    stageStateMachine = new StageStateMachine();
    contextManager = new ConversationContextManager();
    progressPlanManager = new ProgressPlanManager();
    contextManager.initialize("test prompt");

    // Mock NativeToolsManager with a simple read_file implementation
    nativeToolsManager = {
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
      const taskId = progressPlanManager.createPlan({
        goal: "Test multi-step",
        steps: [
          { description: "Create crc16.awk file", stepNumber: 1 },
          { description: "Add CRC calculation logic", stepNumber: 2 },
          { description: "Add output formatting", stepNumber: 3 },
        ],
      });

      // Initialize implementation manager with the plan
      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      // Move step 1 to in_progress
      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add file created in step 1 to implementationStepContexts
      const fileContent = [
        "#!/usr/bin/awk -f",
        "# CRC16 calculator",
        "BEGIN { print 'Starting...' }",
      ];
      const codeContext = new CodeContext(
        "crc16.awk",
        fileContent,
        false,
        "v1",
        Date.now(),
        "Created in step 1",
        undefined,
        true,
        1 // stepNumber = 1
      );

      contextManager.addImplementationStepContext(codeContext);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test diagnostic filtering",
        steps: [
          { description: "Create file", stepNumber: 1 },
          { description: "Modify file", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add a code file
      const codeFile = new CodeContext(
        "app.js",
        ["console.log('Hello');"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      // Add a log file (should be filtered out)
      const logFile = new CodeContext(
        "step_1_log.txt",
        ["Status: __completed__", "Created app.js"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      contextManager.addImplementationStepContext(codeFile);
      contextManager.addImplementationStepContext(logFile);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test 2-file fallback",
        steps: [
          { description: "Create files", stepNumber: 1 },
          { description: "Modify files", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add 2 code files
      const file1 = new CodeContext(
        "utils.js",
        ["export const helper = () => {};"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      const file2 = new CodeContext(
        "main.js",
        ["import { helper } from './utils';"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      contextManager.addImplementationStepContext(file1);
      contextManager.addImplementationStepContext(file2);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test filename matching",
        steps: [
          { description: "Create calculator.py", stepNumber: 1 },
          { description: "Add calculator functions", stepNumber: 2 }, // "calculator" without .py
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      const codeFile = new CodeContext(
        "calculator.py",
        ["def add(a, b):", "    return a + b"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      contextManager.addImplementationStepContext(codeFile);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test 3+ files without match",
        steps: [
          { description: "Create multiple files", stepNumber: 1 },
          { description: "Add general improvements", stepNumber: 2 }, // No specific filename
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add 3 code files (more than fallback threshold)
      ["file1.js", "file2.js", "file3.js"].forEach((name) => {
        const file = new CodeContext(
          name,
          [`// ${name} content`],
          false,
          "v1",
          Date.now(),
          undefined,
          undefined,
          true,
          1
        );
        contextManager.addImplementationStepContext(file);
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
      const taskId = progressPlanManager.createPlan({
        goal: "Test warning",
        steps: [
          { description: "Create config.json", stepNumber: 1 },
          { description: "Update config", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      const file = new CodeContext(
        "config.json",
        ['{ "version": "1.0" }'],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      contextManager.addImplementationStepContext(file);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test step 1",
        steps: [
          { description: "Create initial file", stepNumber: 1 },
          { description: "Modify file", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test log detection",
        steps: [
          { description: "Create files", stepNumber: 1 },
          { description: "Continue", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      // Add various log file formats
      const logFiles = [
        "step_1_log.txt",
        "step_2_log.md",
        "step-3-log.txt",
        "step1_log.txt",
      ];

      logFiles.forEach((name) => {
        const log = new CodeContext(
          name,
          ["Status: completed"],
          false,
          "v1",
          Date.now(),
          undefined,
          undefined,
          true,
          1
        );
        contextManager.addImplementationStepContext(log);
      });

      // Add one actual code file
      const codeFile = new CodeContext(
        "app.ts",
        ["const x = 1;"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );
      contextManager.addImplementationStepContext(codeFile);

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
      const taskId = progressPlanManager.createPlan({
        goal: "Test assumption data detection",
        steps: [
          { description: "Create files", stepNumber: 1 },
          { description: "Continue", stepNumber: 2 },
        ],
      });

      stageStateMachine.initialize(
        progressPlanManager,
        undefined as any,
        undefined as any
      );
      const implementationManager = (stageStateMachine as any)
        .implementationManager;
      implementationManager.initialize(taskId);

      progressPlanManager.updateStepStatus(taskId, 1, "in_progress");

      const assumptionFile = new CodeContext(
        "assumption_data.json",
        ['{"assumptions": []}'],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      const codeFile = new CodeContext(
        "main.rs",
        ["fn main() {}"],
        false,
        "v1",
        Date.now(),
        undefined,
        undefined,
        true,
        1
      );

      contextManager.addImplementationStepContext(assumptionFile);
      contextManager.addImplementationStepContext(codeFile);

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
