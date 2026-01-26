import { StageStateMachine, WorkflowStage } from "../harmony/stageStateMachine";
import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { ChatManager } from "../harmony/chatManager";

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
      // However, regular prompts now trigger "prompt" event which stays in current stage
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "how to implement a function"
      );
      expect(nextStage).toBe("chat"); // Should stay in chat stage (prompt trigger)
    });

    it("should NOT auto-transition from chat to assumptions for file operations (auto-transition disabled)", async () => {
      // Auto-transition is disabled - file operations no longer trigger auto-transition
      // Users must explicitly say "move to assumptions" to transition
      // However, regular prompts now trigger "prompt" event which stays in current stage
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "create hello.py file"
      );
      expect(nextStage).toBe("chat"); // Should stay in chat stage (prompt trigger)
    });

    it('should detect explicit "move to assumptions" command from chat stage', async () => {
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions"
      );
      expect(nextStage).toBe("assumptions");
    });

    it('should transition to assumptions when there are unanswered problems', async () => {
      // Simulate the scenario: user says "hi", then "create hello", LLM asks questions
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User's first query: "hi"
      mockChatManager.addQuery("hi");
      
      // User's second query: "create hello"
      mockChatManager.addQuery("create hello");
      
      // LLM asks questions - this creates a "problem" in ChatManager
      // Simulate the LLM asking clarifying questions by adding a problem
      mockChatManager.addProblem("What should be inside hello.py?", "create hello", false);
      
      // Verify problem exists
      expect(mockChatManager.hasUnansweredProblems()).toBe(true);
      
      // Now user types "move to assumptions" - should transition because there are unanswered problems
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      expect(nextStage).toBe("assumptions");
    });

    it('should stay in chat when moving to assumptions but there are no unanswered problems', async () => {
      // Simulate the scenario: user says "hi", LLM responds with no questions
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User's query: "hi"
      mockChatManager.addQuery("hi");
      
      // LLM responds without asking questions (no problems created)
      // Just verify no problems exist
      expect(mockChatManager.hasUnansweredProblems()).toBe(false);
      
      // Now user types "move to assumptions" - should stay in chat because no problems to work on
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "move to assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      expect(nextStage).toBe("chat"); // Should stay in chat
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

    it('should block move to assumptions when no user prompt at all (fresh chat)', async () => {
      // Scenario: User types @cmd:move_to_assumptions as their VERY FIRST command
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // No queries added, no problems - completely fresh chat
      expect(mockChatManager.hasUnansweredProblems()).toBe(false);
      
      // User tries to move to assumptions without any prior conversation
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Should stay in chat because there are no unanswered problems to work on
      expect(nextStage).toBe("chat");
    });

    it('should transition to assumptions with @cmd:move_to_assumptions even when LLM already answered', async () => {
      // BUG REPRODUCTION: User says "create hello.py", LLM responds saying it will help
      // User then uses @cmd:move_to_assumptions but system refuses because no "unanswered problems"
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User query: "create hello.py"
      mockChatManager.addQuery("create hello.py");
      
      // LLM responds affirmatively (no questions, just confirmation)
      // This means no unanswered problems exist
      mockChatManager.processResponse(
        "I can help you create hello.py. Let me analyze the requirements.",
        "create hello.py",
        []
      );
      
      // Verify no unanswered problems (LLM already responded)
      expect(mockChatManager.hasUnansweredProblems()).toBe(false);
      
      // Now user explicitly uses @cmd:move_to_assumptions command
      // This is a DIRECT USER COMMAND and should ALWAYS work
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Expected: should transition to assumptions (explicit command overrides problem detection)
      // Current bug: stays in chat because hasUnansweredProblems() returns false
      expect(nextStage).toBe("assumptions");
    });

    it('should block move to assumptions after only greeting (hi)', async () => {
      // Scenario from user logs: User types "hi", LLM responds, then user types @cmd:move_to_assumptions
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User types "hi"
      mockChatManager.addQuery("hi");
      
      // LLM responds with clarifying question (but greeting creates no problem)
      mockChatManager.processResponse('Got it! How can I help you today? Could you let me know what specific assistance you need?', 'hi');
      
      // Verify no problems exist (greeting doesn't create problems)
      expect(mockChatManager.hasUnansweredProblems()).toBe(false);
      
      // Now user tries to move to assumptions
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Should stay in chat because there are no unanswered problems
      expect(nextStage).toBe("chat");
    });

    it('should allow move to assumptions after asking real question that was not answered', async () => {
      // Scenario: User asks "what is 2+2?", LLM only restates, then user types @cmd:move_to_assumptions
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User asks a real question
      mockChatManager.addQuery("what is 2+2?");
      
      // LLM responds with restatement but no answer
      mockChatManager.processResponse('You are asking what 2+2 is. Let me help you with that calculation.', 'what is 2+2?');
      
      // Verify problem exists (question was not answered)
      expect(mockChatManager.hasUnansweredProblems()).toBe(true);
      
      // Now user tries to move to assumptions
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Should transition because there ARE unanswered problems
      expect(nextStage).toBe("assumptions");
    });

    it('should allow move to assumptions when user asks to create file', async () => {
      // Scenario: User types "create hello.py", LLM responds, then user types @cmd:move_to_assumptions
      // This is the bug the user reported!
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User asks to create a file
      mockChatManager.addQuery("create hello.py");
      
      // LLM responds with restatement (no explicit warning about tools)
      mockChatManager.processResponse('You want to create a hello.py file. What should be in the file?', 'create hello.py');
      
      // Verify problem exists with requiresTools=true
      expect(mockChatManager.hasUnansweredProblems()).toBe(true);
      const problems = mockChatManager.getUnansweredProblems();
      expect(problems[0].requiresTools).toBe(true);
      
      // Now user tries to move to assumptions
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Should transition because there ARE unanswered problems that require tools
      expect(nextStage).toBe("assumptions");
    });

    it('should block move to assumptions after trivial chat (hi + greeting)', async () => {
      // Scenario: User types "hi", LLM responds with greeting, then user types @cmd:move_to_assumptions
      const mockChatManager = new ChatManager();
      mockChatManager.initialize();
      
      // User types "hi"
      mockChatManager.addQuery("hi");
      
      // No problems added (just a greeting conversation)
      // Now user tries to move to assumptions with command
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "@cmd:move_to_assumptions",
        undefined,
        undefined,
        undefined,
        undefined,
        mockChatManager
      );
      
      // Should stay in chat because there are no unanswered problems
      expect(nextStage).toBe("chat");
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
      // If user types just "hi", prompt trigger is detected (stays in chat)
      const trivial = await stateMachine.determineNextStage(
        "chat",
        "hi"
      );
      expect(trivial).toBe("chat"); // Prompt trigger detected, stays in chat
    });

    it("should NOT auto-transition from assumptions to implementation for file operations (auto-transition disabled)", async () => {
      // Auto-transition is disabled - file operations with extensions no longer auto-transition
      // Users must explicitly say "move to implementation" to transition
      // However, regular prompts now trigger "prompt" event which stays in current stage
      const nextStage = await stateMachine.determineNextStage(
        "assumptions",
        "create config.json"
      );
      expect(nextStage).toBe("assumptions"); // Should stay in assumptions stage (prompt trigger)
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

    it("should return current stage when prompt trigger is detected", async () => {
      // Regular prompts now trigger "prompt" event which stays in current stage
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "hello, how are you?"
      );
      expect(nextStage).toBe("chat"); // Prompt trigger detected, stays in chat
    });
  });

  describe("detectTrigger()", () => {
    it("should detect prompt trigger for regular messages in chat stage", () => {
      const trigger = stateMachine.detectTrigger(
        "Can you help me understand this code?",
        "chat"
      );
      expect(trigger).toBe("prompt");
    });

    it("should detect plan trigger for regular messages in assumptions stage", () => {
      const trigger = stateMachine.detectTrigger(
        "Let me add more context about the requirements",
        "assumptions"
      );
      expect(trigger).toBe("plan");
    });

    it("should NOT detect prompt trigger in implementation stage", () => {
      const trigger = stateMachine.detectTrigger(
        "Just a regular message",
        "implementation"
      );
      expect(trigger).toBe("none");
    });

    it("should NOT detect prompt trigger in init stage", () => {
      const trigger = stateMachine.detectTrigger(
        "Hello",
        "init"
      );
      expect(trigger).toBe("initialize");
    });

    it("should prioritize explicit commands over prompt trigger in chat stage", () => {
      const trigger = stateMachine.detectTrigger(
        "move to assumptions",
        "chat"
      );
      expect(trigger).toBe("move_to_assumptions");
    });

    it("should prioritize explicit commands over prompt trigger in assumptions stage", () => {
      const trigger = stateMachine.detectTrigger(
        "move to implementation",
        "assumptions"
      );
      expect(trigger).toBe("move_to_implementation");
    });

    it("should prioritize verbose_info command over prompt trigger", () => {
      const trigger = stateMachine.detectTrigger(
        "@cmd:verbose",
        "chat"
      );
      expect(trigger).toBe("verbose_info");
    });
  });

  describe("determineNextStage() with prompt trigger", () => {
    it("should stay in chat stage when prompt trigger is detected", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "chat",
        "Can you help me understand the architecture?"
      );
      expect(nextStage).toBe("chat");
    });

    it("should stay in assumptions stage when prompt trigger is detected", async () => {
      const nextStage = await stateMachine.determineNextStage(
        "assumptions",
        "I need to add another requirement to the plan"
      );
      expect(nextStage).toBe("assumptions");
    });

    it("should execute restate action in chat stage", async () => {
      const consoleSpy = jest.spyOn(console, "log");
      await stateMachine.determineNextStage(
        "chat",
        "What are the main components?"
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Action] restate")
      );
      consoleSpy.mockRestore();
    });

    it("should execute generate_or_update_plan action in assumptions stage", async () => {
      const consoleSpy = jest.spyOn(console, "log");
      await stateMachine.determineNextStage(
        "assumptions",
        "Let's add error handling to the plan"
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Action] generate_or_update_plan")
      );
      consoleSpy.mockRestore();
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
