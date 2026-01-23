import { VerboseInfoManager } from "../harmony/verboseInfoManager";
import { ProgressPlanManager } from "../progressPlanManager";
import { ConversationContext } from "../harmony/conversationContext";
import { ChatMessage } from "../conversationManager";
import {
  FileExtractionResult,
  FileOperationResult,
  ChatVerboseInfo,
  AssumptionVerboseInfo,
  ImplementationVerboseInfo,
} from "../utils/verboseInfo";
import { MCPToolResult } from "../mcpClient";

describe("VerboseInfoManager", () => {
  let manager: VerboseInfoManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    progressPlanManager = new ProgressPlanManager();
    manager = new VerboseInfoManager(progressPlanManager);
  });

  describe("buildVerboseInfo", () => {
    describe("chat stage", () => {
      it("should build chat stage verboseInfo with minimal options", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("chat", context);

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).problemSummary?.originalQuery).toBe(
          "Test prompt"
        );
      });

      it("should build chat stage verboseInfo with file extraction", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const fileExtractionResult: FileExtractionResult = {
          explicitFiles: [
            { path: "test.ts", type: "file", extractedAt: Date.now() },
          ],
          detectedFiles: [
            {
              path: "detected.ts",
              type: "file",
              confidence: "high",
              extractedAt: Date.now(),
            },
          ],
        };

        const result = manager.buildVerboseInfo("chat", context, {
          fileExtractionResult,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).extractedFiles).toBeDefined();
        expect(
          (result as ChatVerboseInfo).extractedFiles?.explicitFiles
        ).toHaveLength(1);
        expect(
          (result as ChatVerboseInfo).extractedFiles?.detectedFiles
        ).toHaveLength(1);
      });

      it("should build chat stage verboseInfo with content and reasoning", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("chat", context, {
          content: "Response content",
          reasoning: "Reasoning text",
        });

        expect(result.stage).toBe("chat");
      });

      it("should build chat stage verboseInfo with tool calls", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const toolCallsForVerbose = [
          { name: "test_tool", stage: "chat" as const, success: true },
        ];

        const result = manager.buildVerboseInfo("chat", context, {
          toolCallsForVerbose,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).toolCalls).toHaveLength(1);
        expect((result as ChatVerboseInfo).toolCalls?.[0].name).toBe(
          "test_tool"
        );
      });

      it("should handle null context in chat stage", () => {
        const result = manager.buildVerboseInfo("chat", null);

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).problemSummary).toBeUndefined();
      });
    });

    describe("assumptions stage", () => {
      it("should build assumptions stage verboseInfo with minimal options", () => {
        const context: ConversationContext = {
          currentStage: "assumptions",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("assumptions", context);

        expect(result.stage).toBe("assumptions");
        expect(
          (result as AssumptionVerboseInfo).problemSummary?.originalQuery
        ).toBe("Test prompt");
      });

      it("should build assumptions stage verboseInfo with tool calls", () => {
        const context: ConversationContext = {
          currentStage: "assumptions",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const toolCallsForVerbose = [
          { name: "assumption_tool", stage: "assumptions" as const, success: true },
        ];

        const result = manager.buildVerboseInfo("assumptions", context, {
          toolCallsForVerbose,
        });

        expect(result.stage).toBe("assumptions");
        expect((result as AssumptionVerboseInfo).toolCalls).toHaveLength(1);
      });

      it("should build assumptions stage verboseInfo with conversation history", () => {
        const context: ConversationContext = {
          currentStage: "assumptions",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const conversationHistory: readonly ChatMessage[] = [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ];

        const result = manager.buildVerboseInfo("assumptions", context, {
          conversationHistory,
        });

        expect(result.stage).toBe("assumptions");
      });

      it("should handle null context in assumptions stage", () => {
        const result = manager.buildVerboseInfo("assumptions", null);

        expect(result.stage).toBe("assumptions");
        expect((result as AssumptionVerboseInfo).problemSummary).toBeUndefined();
      });
    });

    describe("implementation stage", () => {
      it("should build implementation stage verboseInfo with minimal options", () => {
        const context: ConversationContext = {
          currentStage: "implementation",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("implementation", context);

        expect(result.stage).toBe("implementation");
      });

      it("should build implementation stage verboseInfo with file operations", () => {
        const context: ConversationContext = {
          currentStage: "implementation",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const fileOperations: FileOperationResult = {
          created: [
            {
              path: "new.ts",
              source: "codeContext",
              createdAt: Date.now(),
            },
          ],
          updated: [
            {
              path: "existing.ts",
              source: "toolCall",
              updatedAt: Date.now(),
            },
          ],
        };

        const result = manager.buildVerboseInfo("implementation", context, {
          fileOperations,
        });

        expect(result.stage).toBe("implementation");
        expect(
          (result as ImplementationVerboseInfo).fileOperations
        ).toBeDefined();
        expect(
          (result as ImplementationVerboseInfo).fileOperations?.created
        ).toHaveLength(1);
        expect(
          (result as ImplementationVerboseInfo).fileOperations?.updated
        ).toHaveLength(1);
      });

      it("should build implementation stage verboseInfo with tool calls", () => {
        const context: ConversationContext = {
          currentStage: "implementation",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const toolCallsForVerbose = [
          {
            name: "create_file",
            stage: "implementation" as const,
            success: true,
            file: "test.ts",
          },
        ];

        const result = manager.buildVerboseInfo("implementation", context, {
          toolCallsForVerbose,
        });

        expect(result.stage).toBe("implementation");
        expect((result as ImplementationVerboseInfo).toolCalls).toHaveLength(1);
      });

      it("should use progressPlanManager for implementation stage", () => {
        const context: ConversationContext = {
          currentStage: "implementation",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        // Create a plan in the progress manager
        progressPlanManager.createPlan("test-task", "Test prompt", "simple", [
          { goal: "Step 1" },
          { goal: "Step 2" },
        ]);

        const result = manager.buildVerboseInfo("implementation", context);

        expect(result.stage).toBe("implementation");
        // VerboseInfoBuilder will use progressPlanManager internally
      });

      it("should wrap implementation verboseInfo with withToString", () => {
        const context: ConversationContext = {
          currentStage: "implementation",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("implementation", context);

        expect(result.stage).toBe("implementation");
        // Check that toString method exists (added by withToString)
        expect(typeof (result as any).toString).toBe("function");
      });

      it("should handle null context in implementation stage", () => {
        const result = manager.buildVerboseInfo("implementation", null);

        expect(result.stage).toBe("implementation");
      });
    });

    describe("tool calls mapping", () => {
      it("should map executedToolCalls to toolCallsForVerbose format", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const executedToolCalls = [
          {
            name: "test_tool",
            arguments: { arg1: "value1" },
          },
        ];

        const result = manager.buildVerboseInfo("chat", context, {
          executedToolCalls,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).toolCalls).toHaveLength(1);
        expect((result as ChatVerboseInfo).toolCalls?.[0].name).toBe(
          "test_tool"
        );
        expect((result as ChatVerboseInfo).toolCalls?.[0].success).toBe(true);
      });

      it("should mark tool call as failed when result has isError", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const mcpToolResult: MCPToolResult = {
          isError: true,
          content: [{ type: "text", text: "Tool execution failed" }],
        };

        const executedToolCalls = [
          {
            name: "failing_tool",
            arguments: { arg1: "value1" },
            result: mcpToolResult,
          },
        ];

        const result = manager.buildVerboseInfo("chat", context, {
          executedToolCalls,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).toolCalls).toHaveLength(1);
        expect((result as ChatVerboseInfo).toolCalls?.[0].success).toBe(false);
        expect((result as ChatVerboseInfo).toolCalls?.[0].error).toBe(
          "Tool execution failed"
        );
      });

      it("should handle error result without text content", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const mcpToolResult: MCPToolResult = {
          isError: true,
          content: [],
        };

        const executedToolCalls = [
          {
            name: "failing_tool",
            arguments: { arg1: "value1" },
            result: mcpToolResult,
          },
        ];

        const result = manager.buildVerboseInfo("chat", context, {
          executedToolCalls,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).toolCalls?.[0].success).toBe(false);
        expect((result as ChatVerboseInfo).toolCalls?.[0].error).toBe(
          "Unknown error"
        );
      });

      it("should prefer toolCallsForVerbose over executedToolCalls when both provided", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const toolCallsForVerbose = [
          { name: "preferred_tool", stage: "chat" as const, success: true },
        ];

        const executedToolCalls = [
          {
            name: "ignored_tool",
            arguments: { arg1: "value1" },
          },
        ];

        const result = manager.buildVerboseInfo("chat", context, {
          toolCallsForVerbose,
          executedToolCalls,
        });

        expect(result.stage).toBe("chat");
        expect((result as ChatVerboseInfo).toolCalls).toHaveLength(1);
        expect((result as ChatVerboseInfo).toolCalls?.[0].name).toBe(
          "preferred_tool"
        );
      });

      it("should handle empty executedToolCalls array", () => {
        const context: ConversationContext = {
          currentStage: "chat",
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.buildVerboseInfo("chat", context, {
          executedToolCalls: [],
        });

        expect(result.stage).toBe("chat");
        expect(
          (result as ChatVerboseInfo).toolCalls === undefined ||
            (result as ChatVerboseInfo).toolCalls?.length === 0
        ).toBe(true);
      });
    });
  });

  describe("getCurrentVerboseInfo", () => {
    it("should use context.currentStage when available", () => {
      const context: ConversationContext = {
        currentStage: "assumptions",
        originalPrompt: "Test prompt",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      const result = manager.getCurrentVerboseInfo(context);

      expect(result.stage).toBe("assumptions");
    });

    it("should default to chat stage when context is null", () => {
      const result = manager.getCurrentVerboseInfo(null);

      expect(result.stage).toBe("chat");
    });

    it("should default to chat stage when currentStage is missing", () => {
      const context: ConversationContext = {
        currentStage: undefined as any,
        originalPrompt: "Test prompt",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      const result = manager.getCurrentVerboseInfo(context);

      expect(result.stage).toBe("chat");
    });

    it("should pass conversationHistory to buildVerboseInfo", () => {
      const context: ConversationContext = {
        currentStage: "chat",
        originalPrompt: "Test prompt",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      const conversationHistory: readonly ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = manager.getCurrentVerboseInfo(context, conversationHistory);

      expect(result.stage).toBe("chat");
      // conversationHistory is passed internally to VerboseInfoBuilder
    });

    it("should work for all stage types", () => {
      const stages: Array<"chat" | "assumptions" | "implementation"> = [
        "chat",
        "assumptions",
        "implementation",
      ];

      stages.forEach((stage) => {
        const context: ConversationContext = {
          currentStage: stage,
          originalPrompt: "Test prompt",
          codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
        };

        const result = manager.getCurrentVerboseInfo(context);

        expect(result.stage).toBe(stage);
      });
    });
  });

  describe("integration", () => {
    it("should handle full workflow from chat to implementation", () => {
      // Chat stage
      let context: ConversationContext = {
        currentStage: "chat",
        originalPrompt: "Create a new feature",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      let result = manager.getCurrentVerboseInfo(context);
      expect(result.stage).toBe("chat");

      // Assumptions stage
      context = {
        ...context,
        currentStage: "assumptions",
      };

      result = manager.getCurrentVerboseInfo(context);
      expect(result.stage).toBe("assumptions");

      // Implementation stage with plan
      progressPlanManager.createPlan("feature-task", "Create a new feature", "simple", [
        { goal: "Create file" },
        { goal: "Add tests" },
      ]);

      context = {
        ...context,
        currentStage: "implementation",
      };

      result = manager.getCurrentVerboseInfo(context);
      expect(result.stage).toBe("implementation");
    });

    it("should handle complex options across stages", () => {
      const conversationHistory: readonly ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [{ path: "test.ts", type: "file", extractedAt: Date.now() }],
      };

      const fileOperations: FileOperationResult = {
        created: [
          {
            path: "new.ts",
            source: "codeContext",
            createdAt: Date.now(),
          },
        ],
      };

      const toolCallsForVerbose = [
        { name: "test_tool", stage: "chat" as const, success: true },
      ];

      // Chat stage with all options
      const chatContext: ConversationContext = {
        currentStage: "chat",
        originalPrompt: "Test",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      const chatResult = manager.buildVerboseInfo("chat", chatContext, {
        fileExtractionResult,
        toolCallsForVerbose,
        conversationHistory,
        content: "Response",
        reasoning: "Reasoning",
      });

      expect(chatResult.stage).toBe("chat");

      // Implementation stage with options
      const implContext: ConversationContext = {
        currentStage: "implementation",
        originalPrompt: "Test",
        codeContexts: new Map(),
          stageHistory: [],
          steps: [],
          maxSteps: 10,
          currentStep: 1,
      };

      const implResult = manager.buildVerboseInfo("implementation", implContext, {
        fileOperations,
        toolCallsForVerbose: [
          { name: "impl_tool", stage: "implementation" as const, success: true },
        ],
      });

      expect(implResult.stage).toBe("implementation");
    });
  });
});
