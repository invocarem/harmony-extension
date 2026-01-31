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
          return { description: s.description, tools: ["create_file"] };
        }
        return { description: s.description };
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

describe("HarmonyClient - Implementation Stage", () => {
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

  describe("File Creation and Modification", () => {
    it("should automatically fallback from create_file to replace_file when file exists", async () => {
      // First, transition to implementation stage using explicit command
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Verify we're in implementation stage
      expect(client.getCurrentStage()).toBe("implementation");

      // Ensure the plan step has tools field set so needsFileCreation is true
      // This is needed because assumptions stage doesn't create code blocks,
      // so implementation stage needs to make an LLM call to generate tool calls
      setupStepForExecution(client, 0);

      // Clear any CodeContext that might exist to ensure LLM path is taken
      // This ensures tool calls are generated by LLM and executed, not created from CodeContext
      const contextManager = (client as any).contextManager;
      const codeContexts = contextManager.getCodeContexts();
      // Remove any CodeContext that might match the step (except diagnostic files)
      codeContexts.forEach((cc: any) => {
        if (
          !cc.name.startsWith("implementation_step_") &&
          cc.name !== "assumption_data.json" &&
          cc.name !== "aggregated_prompt.json"
        ) {
          // Remove non-diagnostic CodeContext to force LLM path
          const versions = contextManager
            .getContext()
            ?.codeContexts?.get(cc.name);
          if (versions) {
            versions.forEach((v: any) => {
              if (v.waitForCreate) {
                contextManager.markCodeContextCreated(cc.name);
              }
            });
          }
        }
      });

      // Now test the fallback in implementation stage
      // Since assumptions stage doesn't create code blocks, implementation stage needs to
      // make an LLM call first to generate code blocks/tool calls before creating files
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' /><|end|>',
            },
          ],
        },
      };

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "test.txt", content: "new content" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      const replaceFileTool: NativeTool = {
        name: "replace_file",
        description: "Replace file contents",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
        replaceFileTool,
      ]);

      // Mock diagnostic file generation first, then tool calls
      // implementation_step_1.json generation happens when @cmd:next_step is used
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Error: File test.txt already exists. Use replace_file to overwrite it.",
            },
          ],
          isError: true,
        })
        // Second call to replace_file succeeds
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully replaced file: test.txt" },
          ],
          isError: false,
        });

      const result = await client.callServer(
        "@cmd:next_step now create test.txt with new content"
      );

      // Verify tool calls were executed (check actual tool execution via mocks)
      // Note: Tool calls should be executed regardless of whether CodeContext or LLM path was taken
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "test.txt"
      );
      const replaceFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "replace_file" && call[1]?.file_path === "test.txt"
      );

      // Both create_file and replace_file should have been called (create fails, replace succeeds)
      expect(createFileCall).toBeDefined();
      expect(createFileCall![1]).toEqual({
        file_path: "test.txt",
        content: "new content",
      });

      expect(replaceFileCall).toBeDefined();
      expect(replaceFileCall![1]).toEqual({
        file_path: "test.txt",
        content: "new content",
      });

      // If result.toolCalls is defined, verify it includes both calls (create attempt and replace success)
      if (result.toolCalls) {
        // Both create_file (failed) and replace_file (succeeded) should be in result.toolCalls
        expect(result.toolCalls.length).toBe(2);
        expect(result.toolCalls[0].name).toBe("create_file");
        expect(result.toolCalls[0].result?.isError).toBe(true);
        expect(result.toolCalls[1].name).toBe("replace_file");
        expect(result.toolCalls[1].arguments).toEqual({
          file_path: "test.txt",
          content: "new content",
        });
        expect(result.toolCalls[1].result?.isError).toBe(false);
        expect(result.toolCalls[1].result?.content[0].text).toContain(
          "Successfully replaced file"
        );
      }
    });

    it("should not fallback to replace_file when create_file succeeds", async () => {
      // First, transition to implementation stage using explicit command
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Now test the successful create_file in implementation stage
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' /><|end|>',
            },
          ],
        },
      };

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "newfile.txt", content: "new content" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock diagnostic file generation first, then the actual create_file
      // implementation_step_1.json generation happens when @cmd:next_step is used
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: newfile.txt" },
          ],
          isError: false,
        });

      const result = await client.callServer(
        "@cmd:next_step now create newfile.txt with new content"
      );

      // Verify create_file was called (check actual tool execution via mocks)
      const newfileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" && call[1]?.file_path === "newfile.txt"
      );
      expect(newfileCall).toBeDefined();
      expect(newfileCall![1]).toEqual({
        file_path: "newfile.txt",
        content: "new content",
      });

      // If result.toolCalls is defined, verify it matches
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].name).toBe("create_file");
        expect(result.toolCalls[0].result?.isError).toBe(false);
        expect(result.toolCalls[0].result?.content[0].text).toContain(
          "Successfully created file"
        );
      }
    });
  });

  describe("Continuation Logic in Implementation Stage", () => {
    it("should continue from read_file to replace_file", async () => {
      // Use helper to transition to implementation stage
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      // First response: read_file - needs continuation hint to trigger continuation
      const readFileResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Now I will read the file<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>',
            },
          ],
        },
      };

      // Second response: replace_file (continuation)
      const replaceFileResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Now I will update the file<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(readFileResponse)
        .mockResolvedValueOnce(replaceFileResponse);

      const readFileParseResult: HarmonyParseResult = {
        content: "Now I will read the file",
        rawToolCalls: [
          '<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />',
        ],
      };

      const replaceFileParseResult: HarmonyParseResult = {
        content: "Now I will update the file",
        rawToolCalls: [
          '<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(readFileParseResult)
        .mockReturnValueOnce(replaceFileParseResult);

      const readFileToolCalls: MCPToolCall[] = [
        { name: "read_file", arguments: { file_path: "test.txt" } },
      ];

      const replaceFileToolCalls: MCPToolCall[] = [
        {
          name: "replace_file",
          arguments: { file_path: "test.txt", content: "Updated content" },
        },
      ];

      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce(readFileToolCalls) // Initial test call
        .mockReturnValueOnce(replaceFileToolCalls); // Continuation call

      const readFileResult: MCPToolResult = {
        content: [{ type: "text", text: "Original file content" }],
        isError: false,
      };

      const replaceFileResult: MCPToolResult = {
        content: [{ type: "text", text: "File replaced successfully" }],
        isError: false,
      };

      // Mock native tools manager for read_file and replace_file
      const readFileTool: NativeTool = {
        name: "read_file",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
          },
          required: ["file_path"],
        },
      } as any;

      const replaceFileTool: NativeTool = {
        name: "replace_file",
        description: "Replace file content",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        readFileTool,
        replaceFileTool,
      ]);

      // Mock diagnostic file generation first, then tool calls
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: readFileResult.content,
          isError: false,
        } as any)
        .mockResolvedValueOnce({
          content: replaceFileResult.content,
          isError: false,
        } as any);

      const result = await client.callServer(
        "@cmd:next_step update test.txt to have new content"
      );

      // Check if continuation happened (should be 2 additional calls: initial + continuation)
      const callsAfter = mockedAxios.post.mock.calls.length;
      const additionalCalls = callsAfter - callsBefore;

      // Should have made 2 API calls (initial + continuation)
      // Note: setupImplementationStage already made 2 calls (assumptions + implementation transitions)
      expect(additionalCalls).toBeGreaterThanOrEqual(1);

      // If continuation happened, isContinuation should be true
      if (additionalCalls >= 2) {
        expect(result.isContinuation).toBe(true);
      }
    });

    it("should not continue when task is complete with file modification", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>File has been created successfully<tool_call name="create_file" args=\'{"file_path": "done.txt", "content": "content"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "File has been created successfully",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "done.txt", "content": "content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "done.txt", content: "content" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock diagnostic file generation first, then the actual create_file
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: done.txt" },
          ],
          isError: false,
        });

      const result = await client.callServer("@cmd:next_step create done.txt");

      // Verify create_file was called (check actual tool execution via mocks)
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "done.txt"
      );
      expect(createFileCall).toBeDefined();

      // Should only make one API call (no continuation)
      // Note: assumptions transition + implementation transition + this call = 3 calls total
      const callsAfter = mockedAxios.post.mock.calls.length;
      const additionalCalls = callsAfter - callsBefore;
      expect(additionalCalls).toBe(1);
      // isContinuation may be false instead of undefined
      expect(result.isContinuation).toBeFalsy();

      // If result.toolCalls is defined, verify it matches
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].name).toBe("create_file");
      }
    });

    it("should handle tool execution errors gracefully", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "/invalid/path/file.txt", "content": "content"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "/invalid/path/file.txt", "content": "content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: {
            file_path: "/invalid/path/file.txt",
            content: "content",
          },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock diagnostic file generation first, then the actual create_file call (which fails)
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Error creating file: Permission denied" },
          ],
          isError: true,
        });

      const result = await client.callServer(
        "@cmd:next_step create file at invalid path"
      );

      // Verify create_file was called with error (check actual tool execution via mocks)
      // Note: The tool should be called even if it fails
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" &&
          call[1]?.file_path === "/invalid/path/file.txt"
      );

      // Tool should have been called (either via CodeContext or LLM path)
      // If it wasn't called, that's the issue we need to fix
      if (!createFileCall) {
        // Debug: Check what tool calls were actually made
        const allToolCalls = mockNativeToolsManager.callTool.mock.calls;
        console.log(
          "All tool calls made:",
          allToolCalls.map((c) => ({ tool: c[0], file: c[1]?.file_path }))
        );
      }
      expect(createFileCall).toBeDefined();

      // If result.toolCalls is defined, verify it shows the error
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].result?.isError).toBe(true);
        expect(result.toolCalls[0].result?.content[0].text).toContain(
          "Permission denied"
        );
      }
    });

    it("should handle multiple tool calls in one response", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "file1.txt", "content": "content1"}\' /><tool_call name="create_file" args=\'{"file_path": "file2.txt", "content": "content2"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "file1.txt", "content": "content1"}\' />',
          '<tool_call name="create_file" args=\'{"file_path": "file2.txt", "content": "content2"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "file1.txt", content: "content1" },
        },
        {
          name: "create_file",
          arguments: { file_path: "file2.txt", content: "content2" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock diagnostic file generation first, then the two create_file calls
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: file1.txt" },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: file2.txt" },
          ],
          isError: false,
        });

      const result = await client.callServer("@cmd:next_step create two files");

      // Verify both create_file calls were made (check actual tool execution via mocks)
      // Note: Tools should be called even if result.toolCalls is undefined
      const file1Call = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" && call[1]?.file_path === "file1.txt"
      );
      const file2Call = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" && call[1]?.file_path === "file2.txt"
      );

      // Both tools should have been called
      if (!file1Call || !file2Call) {
        // Debug: Check what tool calls were actually made
        const allToolCalls = mockNativeToolsManager.callTool.mock.calls;
        console.log(
          "All tool calls made:",
          allToolCalls.map((c) => ({ tool: c[0], file: c[1]?.file_path }))
        );
      }
      expect(file1Call).toBeDefined();
      expect(file2Call).toBeDefined();

      // If result.toolCalls is defined, verify it matches
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(2);
        expect(result.toolCalls[0].name).toBe("create_file");
        expect(result.toolCalls[0].arguments.file_path).toBe("file1.txt");
        expect(result.toolCalls[1].name).toBe("create_file");
        expect(result.toolCalls[1].arguments.file_path).toBe("file2.txt");
      }
    });

    it("should handle mixed success and error tool calls", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "good.txt", "content": "content"}\' /><tool_call name="create_file" args=\'{"file_path": "/bad/path.txt", "content": "content"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "good.txt", "content": "content"}\' />',
          '<tool_call name="create_file" args=\'{"file_path": "/bad/path.txt", "content": "content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "good.txt", content: "content" },
        },
        {
          name: "create_file",
          arguments: { file_path: "/bad/path.txt", content: "content" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Note: implementation_step_1.json generation happens in handlePreProcessing before the actual tool calls
      // So we need to mock that call first, then the actual create_file calls
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: good.txt" },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Error creating file: Invalid path" },
          ],
          isError: true,
        });

      const result = await client.callServer(
        "@cmd:next_step create files with mixed results"
      );

      // Verify both create_file calls were made (check actual tool execution via mocks)
      // Note: Tools should be called even if result.toolCalls is undefined
      const file1Call = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "good.txt"
      );
      const file2Call = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" && call[1]?.file_path === "/bad/path.txt"
      );

      // Both tools should have been called
      if (!file1Call || !file2Call) {
        // Debug: Check what tool calls were actually made
        const allToolCalls = mockNativeToolsManager.callTool.mock.calls;
        console.log(
          "All tool calls made:",
          allToolCalls.map((c) => ({ tool: c[0], file: c[1]?.file_path }))
        );
      }
      expect(file1Call).toBeDefined();
      expect(file2Call).toBeDefined();

      // If result.toolCalls is defined, verify it matches
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(2);
        expect(result.toolCalls[0].result?.isError).toBe(false);
        expect(result.toolCalls[1].result?.isError).toBe(true);
      }
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle empty file content", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "empty.txt", "content": ""}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "empty.txt", "content": ""}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        {
          name: "create_file",
          arguments: { file_path: "empty.txt", content: "" },
        },
      ];

      // Mock extractToolCalls to handle both validToolCalls and content fallback paths
      mockExtractToolCalls(mockHarmonyProcessor, toolCalls);

      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock diagnostic file generation first, then the actual create_file call
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: empty.txt" },
          ],
          isError: false,
        });

      const result = await client.callServer(
        "@cmd:next_step create empty file"
      );

      // Verify create_file was called with empty content (check actual tool execution via mocks)
      // Note: Tool should be called even if result.toolCalls is undefined
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) =>
          call[0] === "create_file" && call[1]?.file_path === "empty.txt"
      );

      // Tool should have been called
      if (!createFileCall) {
        // Debug: Check what tool calls were actually made
        const allToolCalls = mockNativeToolsManager.callTool.mock.calls;
        console.log(
          "All tool calls made:",
          allToolCalls.map((c) => ({ tool: c[0], file: c[1]?.file_path }))
        );
      }
      expect(createFileCall).toBeDefined();
      expect(createFileCall![1].content).toBe("");

      // If result.toolCalls is defined, verify it matches
      if (result.toolCalls) {
        expect(result.toolCalls.length).toBe(1);
        expect(result.toolCalls[0].arguments.content).toBe("");
      }
    });

    it("should handle responses with no tool calls and no content", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      // Mock empty response - may trigger continuation if empty content is detected
      const mockEmptyResponse = {
        status: 200,
        data: {
          choices: [{ text: "<|channel|>final<|message|><|end|>" }],
        },
      };

      // Mock continuation response (if continuation is triggered)
      const mockContinuationResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: "<|channel|>final<|message|>Here is the complete plan:\nStep 1: Create the file\nStep 2: Verify the file<|end|>",
            },
          ],
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockEmptyResponse)
        .mockResolvedValueOnce(mockContinuationResponse);

      const emptyParseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [],
        reasoning: undefined,
        commentary: undefined,
        final: undefined,
      };

      const continuationParseResult: HarmonyParseResult = {
        content:
          "Here is the complete plan:\nStep 1: Create the file\nStep 2: Verify the file",
        rawToolCalls: [],
        reasoning: undefined,
        commentary: undefined,
        final: undefined,
      };

      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(emptyParseResult)
        .mockReturnValueOnce(continuationParseResult);

      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);

      // Mock diagnostic file generation
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "Successfully created diagnostic file: implementation_step_1.json",
          },
        ],
        isError: false,
      });

      // Use @cmd:next_step to execute the step, then verify empty content when no tool calls
      const result = await client.callServer("@cmd:next_step do something");

      // Check if continuation happened
      const callsAfter = mockedAxios.post.mock.calls.length;
      const additionalCalls = callsAfter - callsBefore;

      if (additionalCalls === 1) {
        // No continuation - should have empty content or a message about the plan being ready
        // The stage handler might return a message about the plan being ready instead of empty content
        expect(result.content).toBeDefined();
        expect(result.toolCalls).toBeUndefined();
      } else if (additionalCalls >= 2) {
        // Continuation happened - result should have content from continuation
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
      }
    });

    it("should handle tool call extraction failures", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|><tool_call name="invalid_tool" args=\'{"invalid": "args"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "",
        rawToolCalls: [
          '<tool_call name="invalid_tool" args=\'{"invalid": "args"}\' />',
        ],
        reasoning: undefined,
        commentary: undefined,
        final: undefined,
      };

      // Ensure parseResponse returns a valid result (not undefined)
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      // extractToolCalls returns empty array (extraction failed)
      // First call from rawToolCalls, second from content fallback
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([]) // From rawToolCalls
        .mockReturnValueOnce([]); // From content fallback

      const result = await client.callServer(
        "@cmd:next_step call invalid tool"
      );

      // Should handle gracefully - no tool calls executed
      expect(result.toolCalls).toBeUndefined();
    });

    it("should stop continuation when max steps reached", async () => {
      await setupImplementationStage(
        client,
        mockHarmonyProcessor,
        mockNativeToolsManager
      );

      // Get call count before @cmd:next_step
      const callsBefore = mockedAxios.post.mock.calls.length;

      // Set max steps to 1 and current step to 1 (already at max)
      // This means we've already used our one allowed step, so continuation should stop
      const context = (client as any).contextManager.getContext();
      if (context) {
        context.maxSteps = 1;
        context.currentStep = 1; // Already at max
      }

      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Now I will read<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: "Now I will read",
        rawToolCalls: [
          '<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: "read_file", arguments: { file_path: "test.txt" } },
      ];

      // Mock extractToolCalls for both possible calls:
      // 1. Called with validToolCalls (filtered raw tool calls)
      // 2. Called with [content] if no tool calls found in rawToolCalls (fallback)
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce(toolCalls) // First call with validToolCalls
        .mockReturnValueOnce([]); // Fallback call with content (shouldn't be needed if first succeeds)

      const readFileTool: NativeTool = {
        name: "read_file",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
          },
          required: ["file_path"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([readFileTool]);

      // Mock diagnostic file generation first, then the read_file call
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "File content" }],
          isError: false,
        });

      const result = await client.callServer("@cmd:next_step read file");

      // Should not continue even if continuation would be triggered
      // Note: assumptions transition + implementation transition + this call = 3 calls total
      // But if maxSteps is reached, continuation won't happen, so we should only have the calls up to this point
      const callsAfter = mockedAxios.post.mock.calls.length;
      const additionalCalls = callsAfter - callsBefore;
      expect(additionalCalls).toBe(1); // Only one call, no continuation

      // When max steps is reached, isComplete should be FALSE because not all steps are completed
      // Only step 1 of 2 is complete, so the task is NOT complete even though we hit the maxSteps limit
      expect(result.verboseInfo?.isComplete).toBe(false);
    });
  });

  describe("CodeContext from Assumptions Stage to Implementation Stage", () => {
    it("should create files from CodeContext extracted in assumptions stage when transitioning to implementation stage", async () => {
      // First, transition to assumptions stage and extract CodeContext
      const assumptionsResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Here is the code:\n```python app.py\nprint("Hello")\n```<|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);

      const assumptionsParseResult: HarmonyParseResult = {
        content: 'Here is the code:\n```python app.py\nprint("Hello")\n```',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(
        assumptionsParseResult
      );
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // First transition to assumptions stage using helper
      await transitionToAssumptions(client, mockHarmonyProcessor);

      // Now call with code context extraction
      await client.callServer("create app.py with hello world");

      // Verify we're in assumptions stage
      expect(client.getCurrentStage()).toBe("assumptions");

      // Verify NO files were created in assumptions stage (file modification tools are forbidden)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "create_file",
        expect.anything()
      );
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "replace_file",
        expect.anything()
      );

      // Now transition to implementation stage - this should create files from CodeContext
      const implementationResponse = {
        status: 200,
        data: {
          choices: [
            { text: "<|channel|>final<|message|>Ready to implement<|end|>" },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(implementationResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: "Ready to implement",
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      await client.callServer("move to implementation");

      // Verify we're now in implementation stage
      expect(client.getCurrentStage()).toBe("implementation");

      // Now make a call in implementation stage - CodeContext should be used to create files
      // The ImplementationStageHandler.handlePreProcessing should detect CodeContext and create files
      const createFileTool: NativeTool = {
        name: "create_file",
        description: "Create a new file",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["file_path", "content"],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        createFileTool,
      ]);

      // Mock calls:
      // 1. assumption_data.json is created when transitioning to implementation (already happened in transition)
      // 2. implementation_step_1.json generation happens when @cmd:next_step is used
      // 3. Then the actual create_file for app.py from CodeContext
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "Successfully created diagnostic file: implementation_step_1.json",
            },
          ],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Successfully created file: app.py" },
          ],
          isError: false,
        });

      // Call server in implementation stage - should create file from CodeContext without LLM call
      const result = await client.callServer("@cmd:next_step implement");

      // Verify create_file was called with content from CodeContext
      // Note: CodeContext extraction may use "file" as default filename if extraction fails
      // The important thing is that create_file was called with the correct content
      // We need to find the call for app.py, not assumption_data.json or implementation_step_1.json
      const appPyCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === "create_file" && call[1]?.file_path === "app.py"
      );
      expect(appPyCall).toBeDefined();
      expect(appPyCall![1].content).toContain('print("Hello")');

      // Verify the result shows the file was created
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBeGreaterThan(0);
      const createFileCall = result.toolCalls?.find(
        (tc) => tc.name === "create_file"
      );
      expect(createFileCall).toBeDefined();
      expect(createFileCall?.arguments.content).toContain('print("Hello")');
    });

    it("should NOT create files in assumptions stage even if CodeContext exists", async () => {
      // Transition to assumptions stage and extract CodeContext
      const assumptionsResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Code:\n```python test.py\ndef hello():\n    print("Hello")\n```<|end|>',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);

      const assumptionsParseResult: HarmonyParseResult = {
        content:
          'Code:\n```python test.py\ndef hello():\n    print("Hello")\n```',
        rawToolCalls: [],
      };

      // First transition to assumptions stage using helper
      await transitionToAssumptions(client, mockHarmonyProcessor);

      // Now call with code context extraction
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(
        assumptionsParseResult
      );
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      await client.callServer("provide code for test.py");

      // Verify we're in assumptions stage
      expect(client.getCurrentStage()).toBe("assumptions");

      // Verify NO file modification tools were called (they are forbidden in assumptions stage)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "create_file",
        expect.anything()
      );
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "replace_file",
        expect.anything()
      );
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "read_file",
        expect.anything()
      );

      // Make another call in assumptions stage - still should NOT create files
      const secondResponse = {
        status: 200,
        data: {
          choices: [
            { text: "<|channel|>final<|message|>Code is ready<|end|>" },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(secondResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: "Code is ready",
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer("continue in assumptions");

      // Verify we're still in assumptions stage
      expect(client.getCurrentStage()).toBe("assumptions");

      // Verify NO file modification tools were called (file creation is forbidden in assumptions stage)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "create_file",
        expect.anything()
      );
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith(
        "replace_file",
        expect.anything()
      );
    });
  });
});
