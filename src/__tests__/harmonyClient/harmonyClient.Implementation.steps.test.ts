import { HarmonyClient, HarmonyResponse } from "../../harmonyClient";
import { LlamaConfig, RuleConfig } from "../../config";
import { MCPManager } from "../../mcpManager";
import { RulesManager, Rule } from "../../rulesManager";
import { NativeToolsManager, NativeTool } from "../../nativeToolManager";
import { HarmonyProcessor, HarmonyParseResult } from "../../harmonyProcessor";
import { MCPToolCall, MCPToolResult } from "../../mcpClient";
import axios from "axios";
import {
  transitionToAssumptions,
  transitionToImplementation,
  transitionToImplementationViaAssumptions,
} from "../testHelpers";

// Mock dependencies
jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Helper function to transition to implementation stage
 * Note: This should be called at the start of each test that needs implementation stage
 * Uses the shared testHelpers for consistency
 */
async function setupImplementationStage(
  client: HarmonyClient,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>,
  mockNativeToolsManager: jest.Mocked<NativeToolsManager>
): Promise<void> {
  // Set up default mock for diagnostic file creation during transition
  // aggregated_prompt.json is auto-generated when transitioning to assumptions stage
  // assumption_data.json is auto-generated when transitioning to implementation stage
  const defaultDiagnosticMock = {
    content: [{ type: "text", text: "Successfully created diagnostic file" }],
    isError: false,
  };

  // Set up default mock for diagnostic files created during transition
  mockNativeToolsManager.callTool.mockResolvedValue(defaultDiagnosticMock);

  // Use shared helpers to transition through assumptions to implementation
  await transitionToAssumptions(client, mockHarmonyProcessor);

  // Now transition to implementation stage using the helper
  // This helper properly mocks the assumptions stage LLM call that happens
  // when "move to implementation" is called
  await transitionToImplementation(client, mockHarmonyProcessor);

  // After transition, completely reset ALL mocks so tests start fresh
  // This ensures any previous mock setups don't interfere
  mockedAxios.post.mockReset();
  mockHarmonyProcessor.parseResponse.mockReset();
  mockHarmonyProcessor.extractToolCalls.mockReset();
  mockNativeToolsManager.callTool.mockReset();
}

/**
 * Helper function to ensure a step is ready for execution
 * Sets up the step with tools field and ensures it's pending
 */
function setupStepForExecution(
  client: HarmonyClient,
  stepIndex: number = 0
): void {
  const progressPlanManager = client.getProgressPlanManager();
  const context = (client as any).contextManager?.getContext();
  const taskId = context?.progressPlan?.taskId;
  if (taskId) {
    const plan = progressPlanManager.getPlan(taskId);
    if (plan && plan.steps.length > stepIndex) {
      // Update the step to include tools field and ensure it's pending
      const updatedSteps = plan.steps.map((s, idx) => {
        if (idx === stepIndex) {
          return { goal: s.goal, tools: ["create_file"] };
        }
        return { goal: s.goal };
      });
      progressPlanManager.updatePlanSteps(taskId, updatedSteps, false); // Don't preserve status - start fresh

      // Ensure ImplementationManager is aware of the updated plan
      const implementationManager = (client as any).implementationManager;
      implementationManager.clear();
      implementationManager.initialize(taskId);

      // Explicitly set the first step to pending to ensure it's ready for @cmd:next_step
      // This is important because updatePlanSteps might not reset status correctly
      const updatedPlan = progressPlanManager.getPlan(taskId);
      if (updatedPlan && updatedPlan.steps.length > stepIndex) {
        progressPlanManager.updateStepStatus(taskId, stepIndex + 1, "pending");
      }
    }
  }
}

/**
 * Helper function to mock extractToolCalls to return tool calls when called with content containing tool_call patterns
 * This handles both the validToolCalls path and the content fallback path
 * Updates the HarmonyProcessor.prototype spy which is used by all instances created in the client
 */
function mockExtractToolCalls(
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>,
  toolCalls: MCPToolCall[]
): void {
  const implementation = (input: string | string[]) => {
    const text = Array.isArray(input) ? input.join("") : input;
    console.log(
      `[Test] mockExtractToolCalls called with text: "${text.substring(0, 100)}..."`
    );
    // If input contains tool_call pattern or any tool name, return tool calls
    if (
      text.includes("tool_call") ||
      text.includes("create_file") ||
      text.includes("replace_file") ||
      toolCalls.some((tc) => text.includes(tc.name))
    ) {
      console.log(
        `[Test] mockExtractToolCalls returning ${toolCalls.length} tool calls`
      );
      return toolCalls;
    }
    // Otherwise return empty (for validation checks or when no tool calls in input)
    console.log(
      `[Test] mockExtractToolCalls returning empty array (no matching pattern)`
    );
    return [];
  };

  // Apply the mock to the prototype - this is critical because the client creates actual HarmonyProcessor instances
  // and we need them to use our mock implementation
  (HarmonyProcessor.prototype.extractToolCalls as jest.Mock).mockImplementation(
    implementation
  );
}

describe("HarmonyClient - Implementation Stage: steps", () => {
  let client: HarmonyClient;
  let mockConfig: LlamaConfig;
  let mockMCPManager: jest.Mocked<MCPManager>;
  let mockRulesManager: jest.Mocked<RulesManager>;
  let mockNativeToolsManager: jest.Mocked<NativeToolsManager>;
  let mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup config
    mockConfig = {
      serverUrl: "http://localhost:8000",
      apiKey: "test-api-key",
      model: "test-model",
      temperature: 0.7,
      maxTokens: 2048,
      mcpServers: [],
      rulesPaths: [] as RuleConfig[],
      harmonyMode: true,
      verbose: false,
    };

    // Setup HarmonyProcessor mock - create a proper mock instance
    mockHarmonyProcessor = {
      parseResponse: jest.fn(),
      extractToolCalls: jest.fn(),
      formatPrompt: jest.fn(),
      validateResponse: jest.fn(),
      cleanText: jest.fn(),
    } as any;

    // Create a mock class instead of using jest.mock on the class itself
    jest
      .spyOn(HarmonyProcessor.prototype, "parseResponse")
      .mockImplementation(mockHarmonyProcessor.parseResponse);
    jest
      .spyOn(HarmonyProcessor.prototype, "extractToolCalls")
      .mockImplementation(mockHarmonyProcessor.extractToolCalls);
    jest
      .spyOn(HarmonyProcessor.prototype, "formatPrompt")
      .mockImplementation(mockHarmonyProcessor.formatPrompt);
    jest
      .spyOn(HarmonyProcessor.prototype, "validateResponse")
      .mockImplementation(mockHarmonyProcessor.validateResponse);
    jest
      .spyOn(HarmonyProcessor.prototype, "cleanText")
      .mockImplementation(mockHarmonyProcessor.cleanText);

    // Setup MCPManager mock
    mockMCPManager = {
      getAllTools: jest.fn().mockReturnValue([]),
      findToolServer: jest.fn(),
      callTool: jest.fn(),
    } as any;

    // Setup RulesManager mock
    mockRulesManager = {
      getApplicableRules: jest.fn().mockReturnValue([]),
      getApplicableRulesFromHistory: jest.fn().mockReturnValue([]),
      getRulesForTools: jest.fn().mockReturnValue([]),
      formatRulesForPrompt: jest.fn().mockReturnValue(""),
    } as any;

    // Setup NativeToolsManager mock
    mockNativeToolsManager = {
      getAvailableTools: jest.fn().mockReturnValue([]),
      callTool: jest.fn(),
    } as any;

    // Create client
    // NOTE: The new architecture uses ToolExecutor and ToolExecutionCoordinator
    // which are wired internally with the passed nativeToolsManager
    // The mocked nativeToolsManager.callTool will be called when tools are executed
    client = new HarmonyClient(
      mockConfig,
      mockMCPManager,
      mockRulesManager,
      mockNativeToolsManager
    );
  });

  describe("ProgressPlan Step Updates", () => {
    /**
     * Helper function to create a progressPlan and set it in context
     */
    function setupProgressPlan(
      steps: Array<{ goal: string; description?: string }>
    ): string {
      const progressPlanManager = client.getProgressPlanManager();
      const taskId = `test-task-${Date.now()}`;
      const plan = progressPlanManager.createPlan(
        taskId,
        "Test task",
        "hard",
        steps
      );

      // Set plan in context
      const contextManager = (client as any).contextManager;
      contextManager.setProgressPlan(plan);

      return taskId;
    }

    it("should generate implementation_step_N.json files for all steps", async () => {
      // Transition to implementation stage first
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get the taskId from ImplementationManager and update the plan with 3 steps
      const implementationManager = (client as any).implementationManager;
      const taskId = implementationManager.getTaskId();
      expect(taskId).toBeDefined();

      const progressPlanManager = client.getProgressPlanManager();
      progressPlanManager.updatePlanSteps(
        taskId!,
        [
          { goal: "Step 1: Create main.py" },
          { goal: "Step 2: Create utils.py" },
          { goal: "Step 3: Create tests.py" },
        ],
        false
      ); // Don't preserve status - start fresh

      // Reinitialize ImplementationManager to set step 1 to in_progress after updatePlanSteps
      implementationManager.clear();
      implementationManager.initialize(taskId!);

      const createFileTool = {
        name: "create_file",
        description: "Create a file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string" },
            content: { type: "string" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Track all step file generations
      const stepFileCalls: string[] = [];

      // First execution - should generate and complete step_1.json, then step 2 becomes pending
      const response1 = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "main.py", "content": "code"}<|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response1);

      const toolCall1: MCPToolCall = {
        name: "create_file",
        arguments: { file_path: "main.py", content: "code" },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: "",
        rawToolCalls: [JSON.stringify(toolCall1)],
      });

      // Mock extractToolCalls for both possible calls
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([toolCall1]) // First call with validToolCalls
        .mockReturnValueOnce([]); // Fallback call with content

      // Mock callTool to track step file generation
      mockNativeToolsManager.callTool.mockImplementation(
        (toolName: string, args: any) => {
          if (
            toolName === "create_file" &&
            args?.file_path?.startsWith("implementation_step_")
          ) {
            stepFileCalls.push(args.file_path);
            return Promise.resolve({
              content: [
                {
                  type: "text",
                  text: `Successfully created diagnostic file: ${args.file_path}`,
                },
              ],
              isError: false,
            });
          }
          if (toolName === "create_file" && args?.file_path === "main.py") {
            return Promise.resolve({
              content: [{ type: "text", text: "Success" }],
              isError: false,
            });
          }
          return Promise.resolve({
            content: [{ type: "text", text: "Success" }],
            isError: false,
          });
        }
      );

      await client.callServer("@cmd:next_step create main.py");

      // Verify create_file was called for main.py
      const mainPyCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "main.py"
      );

      // Verify step 1 is completed and step 2 is pending (not in_progress - waiting for next @cmd:next_step)
      let plan = progressPlanManager.getPlan(taskId!);

      if (mainPyCall) {
        expect(plan?.steps[0].status).toBe("completed");
        expect(plan?.steps[1].status).toBe("pending"); // Step 2 should be pending, not in_progress
        expect(plan?.steps[2].status).toBe("pending");
      }

      // Verify step_1.json was generated
      expect(stepFileCalls).toContain("implementation_step_1.json");

      // step_2.json should NOT have been generated yet
      expect(stepFileCalls).not.toContain("implementation_step_2.json");

      // Second execution - should generate and complete step_2.json, then step 3 becomes pending
      const response2 = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "utils.py", "content": "code"}<|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response2);

      const toolCall2: MCPToolCall = {
        name: "create_file",
        arguments: { file_path: "utils.py", content: "code" },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: "",
        rawToolCalls: [JSON.stringify(toolCall2)],
      });

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, [toolCall2]);

      // Advance to step 2 explicitly (since it's now pending, not in_progress)
      implementationManager.advanceToNextStep();

      await client.callServer("@cmd:next_step create utils.py");

      // Verify create_file was called for utils.py
      const utilsPyCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "utils.py"
      );

      // Verify step 2 is completed and step 3 is pending
      plan = progressPlanManager.getPlan(taskId!);
      expect(plan?.steps[0].status).toBe("completed");

      if (utilsPyCall) {
        expect(plan?.steps[1].status).toBe("completed");
        expect(plan?.steps[2].status).toBe("pending"); // Step 3 should be pending, not in_progress

        // Verify step_2.json was now generated
        expect(stepFileCalls).toContain("implementation_step_2.json");

        // step_3.json should NOT have been generated yet
        expect(stepFileCalls).not.toContain("implementation_step_3.json");

        // Verify step files were generated in order
        expect(stepFileCalls).toEqual([
          "implementation_step_1.json",
          "implementation_step_2.json",
        ]);
      }
    });
  });
});
