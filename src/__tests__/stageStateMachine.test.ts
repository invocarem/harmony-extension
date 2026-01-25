import { StageStateMachine, WorkflowStage } from "../harmony/stageStateMachine";
import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";

describe("StageStateMachine", () => {
  let stateMachine: StageStateMachine;

  beforeEach(() => {
    stateMachine = new StageStateMachine();
  });

  describe("getInstructions()", () => {
    it("should return chat stage instructions", () => {
      const instructions = stateMachine
        .getInstructions("chat")
        .toLocaleLowerCase();

      expect(instructions).toContain("chat/clarification");
      expect(instructions).toContain("restate");
      // Chat stage restricts to read-only tools, which implies file modification tools are not available
      expect(instructions).toContain("read-only tools");
      expect(instructions).toContain("gather context");
      expect(instructions).toContain("analysis stage");
    });

    it("should return assumptions stage instructions", () => {
      const instructions = stateMachine
        .getInstructions("assumptions")
        .toLocaleLowerCase();

      expect(instructions).toContain("assumptions/analysis");
      expect(instructions).toContain("file modification tools");
      expect(instructions).toContain("analyze comprehensively");
      expect(instructions).toMatch(/format.*plan.*steps|Step 1|Step 2/);
    });

    it("should return implementation stage instructions", () => {
      let instructions = stateMachine.getInstructions("implementation");
      instructions = instructions.toLowerCase();

      expect(instructions).toContain("implementation");
      expect(instructions).toContain("create_file");
      expect(instructions).toContain("replace_file");
      expect(instructions).toContain("all tools are available");
      expect(instructions).toContain("follow the plan");
    });

    it("should return empty string for invalid stage", () => {
      // TypeScript should prevent this, but test runtime behavior
      const instructions = stateMachine.getInstructions(
        "invalid" as WorkflowStage
      );
      expect(instructions).toBe("");
    });
  });

  describe("getAllowedTools()", () => {
    const allTools = [
      {
        name: "read_file",
        description: "Read a file",
        type: "native" as const,
      },
      {
        name: "list_files",
        description: "List files",
        type: "native" as const,
      },
      {
        name: "grep_files",
        description: "Search files",
        type: "native" as const,
      },
      {
        name: "create_file",
        description: "Create a file",
        type: "native" as const,
      },
      {
        name: "replace_file",
        description: "Replace file content",
        type: "native" as const,
      },
      {
        name: "delete_file",
        description: "Delete a file",
        type: "native" as const,
      },
      { name: "custom_tool", description: "Custom tool", type: "mcp" as const },
    ];

    it("should filter out file modification tools in chat stage", () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, "chat");

      const allowedNames = allowedTools.map((t) => t.name);
      expect(allowedNames).toContain("read_file");
      expect(allowedNames).toContain("list_files");
      expect(allowedNames).toContain("grep_files");
      // MCP tools are NOT available in chat stage, only read-only native tools
      expect(allowedNames).not.toContain("custom_tool");
      expect(allowedNames).not.toContain("create_file");
      expect(allowedNames).not.toContain("replace_file");
      expect(allowedNames).not.toContain("delete_file");
    });

    it("should filter out file modification tools and MCP tools in assumptions stage", () => {
      const allowedTools = stateMachine.getAllowedTools(
        allTools,
        "assumptions"
      );

      const allowedNames = allowedTools.map((t) => t.name);
      expect(allowedNames).toContain("read_file");
      expect(allowedNames).toContain("list_files");
      expect(allowedNames).toContain("grep_files");
      // MCP tools are NOT available in assumptions stage anymore
      expect(allowedNames).not.toContain("custom_tool");
      expect(allowedNames).not.toContain("create_file");
      expect(allowedNames).not.toContain("replace_file");
      expect(allowedNames).not.toContain("delete_file");
    });

    it("should allow all tools in implementation stage", () => {
      const allowedTools = stateMachine.getAllowedTools(
        allTools,
        "implementation"
      );

      expect(allowedTools.length).toBe(allTools.length);
      const allowedNames = allowedTools.map((t) => t.name);
      expect(allowedNames).toContain("read_file");
      expect(allowedNames).toContain("create_file");
      expect(allowedNames).toContain("replace_file");
      expect(allowedNames).toContain("delete_file");
      expect(allowedNames).toContain("custom_tool");
    });

    it("should preserve tool properties when filtering", () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, "chat");

      const readFileTool = allowedTools.find((t) => t.name === "read_file");
      expect(readFileTool).toBeDefined();
      expect(readFileTool?.description).toBe("Read a file");
      expect(readFileTool?.type).toBe("native");
    });

    it("should handle empty tools array", () => {
      const allowedTools = stateMachine.getAllowedTools([], "chat");
      expect(allowedTools).toEqual([]);
    });

    it("should handle read-only tools list correctly in chat stage", () => {
      const toolsWithReadOnly = [
        { name: "read_file" },
        { name: "list_files" },
        { name: "grep_files" },
        { name: "search_files" },
        { name: "read_directory" },
        { name: "create_file" },
      ];

      const allowedTools = stateMachine.getAllowedTools(
        toolsWithReadOnly,
        "chat"
      );
      const allowedNames = allowedTools.map((t) => t.name);

      expect(allowedNames).toContain("read_file");
      expect(allowedNames).toContain("list_files");
      expect(allowedNames).toContain("grep_files");
      expect(allowedNames).toContain("search_files");
      expect(allowedNames).toContain("read_directory");
      expect(allowedNames).not.toContain("create_file");
    });
  });

  describe("canTransition()", () => {
    it("should allow staying in the same stage", () => {
      expect(stateMachine.canTransition("chat", "chat")).toBe(true);
      expect(stateMachine.canTransition("assumptions", "assumptions")).toBe(
        true
      );
      expect(
        stateMachine.canTransition("implementation", "implementation")
      ).toBe(true);
    });

    it("should allow valid transitions", () => {
      // Chat → Assumptions
      expect(stateMachine.canTransition("chat", "assumptions")).toBe(true);

      // Assumptions → Implementation
      expect(stateMachine.canTransition("assumptions", "implementation")).toBe(
        true
      );

      // Assumptions → Chat
      expect(stateMachine.canTransition("assumptions", "chat")).toBe(true);

      // Implementation → Chat
      expect(stateMachine.canTransition("implementation", "chat")).toBe(true);

      // Implementation → Assumptions
      expect(stateMachine.canTransition("implementation", "assumptions")).toBe(
        true
      );
    });

    it("should disallow invalid transitions", () => {
      // Chat → Implementation (NOT ALLOWED - must go through Analysis first)
      expect(stateMachine.canTransition("chat", "implementation")).toBe(false);
    });
  });

  describe("determineNextStage()", () => {
    it('should detect explicit "move to implementation" command from assumptions stage', async () => {
      const nextStage = await stateMachine.determineNextStage(
        "assumptions",
        "move to implementation"
      );
      expect(nextStage).toBe("implementation");
    });

    it('should reject "move to implementation" from chat stage (invalid transition)', async () => {
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to implementation"
      );
      expect(nextStage).toBe(null); // Invalid transition
    });

    it("should NOT auto-transition from chat to assumptions for code-related questions (auto-transition disabled)", async () => {
      // Auto-transition is disabled - code keywords no longer trigger auto-transition
      // Users must explicitly say "move to assumptions" to transition
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "how to implement a function"
      );
      expect(nextStage).toBeNull(); // Should stay in chat stage
    });

    it("should NOT auto-transition from chat to assumptions for file operations (auto-transition disabled)", async () => {
      // Auto-transition is disabled - file operations no longer trigger auto-transition
      // Users must explicitly say "move to assumptions" to transition
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "create hello.py file"
      );
      expect(nextStage).toBeNull(); // Should stay in chat stage
    });

    it('should detect explicit "move to assumptions" command from chat stage', async () => {
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions"
      );
      expect(nextStage).toBe("assumptions");
    });

    it('should transition to assumptions with move_to_assumptions command even for trivial prompts', async () => {
      // When user explicitly types "move to assumptions", it should work
      // The action function checks the TRIGGER PROMPT, not what came before
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions"
      );
      expect(nextStage).toBe("assumptions");
    });

    it('should demonstrate action function conditional logic', async () => {
      // The action function receives the prompt and can decide whether to transition
      // For "move to assumptions" trigger, the action checks if the prompt itself is meaningful
      
      // Case 1: Meaningful prompt with move command -> transition
      const meaningful = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions to create a new feature"
      );
      expect(meaningful).toBe("assumptions");
      
      // Case 2: The trigger detection happens first
      // If user types just "hi", no trigger is detected, so action never runs
      const trivial = await stateMachine.determineNextStage(
        "chat",
        "hi"
      );
      expect(trivial).toBeNull(); // No trigger detected
    });

    it("should NOT auto-transition from assumptions to implementation for file operations (auto-transition disabled)", async () => {
      // Auto-transition is disabled - file operations with extensions no longer auto-transition
      // Users must explicitly say "move to implementation" to transition
      const nextStage = await stateMachine.determineNextStage(
        "assumptions",
        "create config.json"
      );
      expect(nextStage).toBeNull(); // Should stay in assumptions stage
    });

    it("should detect @cmd:back_to_chat command and transition to chat from implementation", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "implementation",
        "@cmd:back_to_chat"
      );
      expect(nextStage).toBe("chat");
    });

    it("should detect @cmd:back-to-chat command (with hyphens) and transition to chat from implementation", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "implementation",
        "@cmd:back-to-chat"
      );
      expect(nextStage).toBe("chat");
    });

    it("should detect @cmd:next as alias for next_step and stay in implementation", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "implementation",
        "@cmd:next"
      );
      expect(nextStage).toBe("implementation");
    });

    it("should detect @cmd:next_step (original) and stay in implementation", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "implementation",
        "@cmd:next_step"
      );
      expect(nextStage).toBe("implementation");
    });

    it("should detect @cmd:verbose as alias for verbose_info and stay in current stage", async () => {
      const nextStage = await stateMachine.determineNextStage("chat", "@cmd:verbose");
      expect(nextStage).toBe("chat");
    });

    it("should detect @cmd:verbose_info (original) and stay in current stage", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "implementation",
        "@cmd:verbose_info"
      );
      expect(nextStage).toBe("implementation");
    });

    it("should return null when no transition is needed", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "hello, how are you?"
      );
      expect(nextStage).toBe(null);
    });
  });

  describe("shouldTransitionToChatOnError()", () => {
    const createErrorResult = (errorText: string): MCPToolResult => ({
      content: [{ type: "text", text: errorText }],
      isError: true,
    });

    const createSuccessResult = (): MCPToolResult => ({
      content: [{ type: "text", text: "Success" }],
      isError: false,
    });

    it("should return false for non-implementation stages", () => {
      const toolResults = [
        { name: "create_file", result: createErrorResult("not found") },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError("chat", toolResults)
      ).toBe(false);
      expect(
        stateMachine.shouldTransitionToChatOnError("assumptions", toolResults)
      ).toBe(false);
    });

    it('should return true for file modification errors with "not found" in implementation stage', () => {
      const toolResults = [
        { name: "create_file", result: createErrorResult("File not found") },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(true);
    });

    it("should return true for file modification errors with various error keywords", () => {
      const errorKeywords = [
        "permission denied",
        "invalid path",
        "missing file",
        "required field",
        "cannot create",
        "unable to write",
      ];

      errorKeywords.forEach((keyword) => {
        const toolResults = [
          {
            name: "replace_file",
            result: createErrorResult(`Error: ${keyword}`),
          },
        ];
        expect(
          stateMachine.shouldTransitionToChatOnError(
            "implementation",
            toolResults
          )
        ).toBe(true);
      });
    });

    it("should return false for non-file-modification tool errors", () => {
      const toolResults = [
        { name: "read_file", result: createErrorResult("not found") },
        { name: "list_files", result: createErrorResult("permission denied") },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(false);
    });

    it("should return false when file modification tools succeed", () => {
      const toolResults = [
        { name: "create_file", result: createSuccessResult() },
        { name: "replace_file", result: createSuccessResult() },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(false);
    });

    it("should return false when file modification errors do not require clarification", () => {
      const toolResults = [
        {
          name: "create_file",
          result: createErrorResult("File already exists"),
        }, // Not a clarification error
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(false);
    });

    it("should return true when at least one file modification tool has clarification-requiring error", () => {
      const toolResults = [
        { name: "read_file", result: createSuccessResult() },
        { name: "create_file", result: createErrorResult("File not found") }, // This triggers transition
        { name: "replace_file", result: createSuccessResult() },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(true);
    });

    it("should handle tool results without error details", () => {
      const toolResults = [
        { name: "create_file", result: undefined },
        { name: "create_file", result: { content: [], isError: false } },
      ];

      expect(
        stateMachine.shouldTransitionToChatOnError(
          "implementation",
          toolResults
        )
      ).toBe(false);
    });
  });
});
