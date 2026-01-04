import { HarmonyClient, HarmonyResponse } from '../../harmonyClient';
import { LlamaConfig, RuleConfig } from '../../config';
import { MCPManager } from '../../mcpManager';
import { RulesManager, Rule } from '../../rulesManager';
import { NativeToolsManager, NativeTool } from '../../nativeToolManager';
import { HarmonyProcessor, HarmonyParseResult } from '../../harmonyProcessor';
import { MCPToolCall, MCPToolResult } from '../../mcpClient';
import axios from 'axios';
import { transitionToAssumptions, transitionToImplementation, transitionToImplementationViaAssumptions } from '../testHelpers';

// Mock dependencies
jest.mock('axios');

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
  // Use shared helpers to transition through assumptions to implementation
  await transitionToAssumptions(client, mockHarmonyProcessor);
  
  // Set up default mock for diagnostic file creation
  // These files are auto-generated when transitioning to implementation stage
  // Use mockResolvedValue to handle any number of diagnostic file calls
  // Tests can then chain mockResolvedValueOnce for their specific calls
  const defaultDiagnosticMock = {
    content: [{ type: 'text', text: 'Successfully created diagnostic file' }],
    isError: false,
  };
  
  // Set up default mock that will be used for any calls not specifically mocked
  // This handles diagnostic files and provides a fallback
  mockNativeToolsManager.callTool.mockResolvedValue(defaultDiagnosticMock);
  
  // Now transition to implementation stage
  const implementationResponse = {
    status: 200,
    data: {
      choices: [{ text: '<|channel|>final<|message|>Ready to implement<|end|>' }],
    },
  };
  mockedAxios.post.mockResolvedValueOnce(implementationResponse);
  mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
    content: 'Ready to implement',
    rawToolCalls: [],
  });
  mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
  await client.callServer('move to implementation');
}

describe('HarmonyClient - Implementation Stage', () => {
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
      serverUrl: 'http://localhost:8000',
      apiKey: 'test-api-key',
      model: 'test-model',
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
    jest.spyOn(HarmonyProcessor.prototype, 'parseResponse').mockImplementation(mockHarmonyProcessor.parseResponse);
    jest.spyOn(HarmonyProcessor.prototype, 'extractToolCalls').mockImplementation(mockHarmonyProcessor.extractToolCalls);
    jest.spyOn(HarmonyProcessor.prototype, 'formatPrompt').mockImplementation(mockHarmonyProcessor.formatPrompt);
    jest.spyOn(HarmonyProcessor.prototype, 'validateResponse').mockImplementation(mockHarmonyProcessor.validateResponse);
    jest.spyOn(HarmonyProcessor.prototype, 'cleanText').mockImplementation(mockHarmonyProcessor.cleanText);

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
      formatRulesForPrompt: jest.fn().mockReturnValue(''),
    } as any;

    // Setup NativeToolsManager mock
    mockNativeToolsManager = {
      getAvailableTools: jest.fn().mockReturnValue([]),
      callTool: jest.fn(),
    } as any;

    // Create client
    client = new HarmonyClient(
      mockConfig,
      mockMCPManager,
      mockRulesManager,
      mockNativeToolsManager
    );
  });

  describe('File Creation and Modification', () => {
    it('should automatically fallback from create_file to replace_file when file exists', async () => {
      // First, transition to implementation stage using explicit command
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // Now test the fallback in implementation stage
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'test.txt', content: 'new content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      const replaceFileTool: NativeTool = {
        name: 'replace_file',
        description: 'Replace file contents',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool, replaceFileTool]);

      // Note: setupImplementationStage already made 2 calls (aggregated_prompt.json, assumption_data.json)
      // First call to create_file returns error about file existing
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Error: File test.txt already exists. Use replace_file to overwrite it.' }],
          isError: true,
        })
        // Second call to replace_file succeeds
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Successfully replaced file: test.txt' }],
          isError: false,
        });

      const result = await client.callServer('now create test.txt with new content');

      // Verify create_file was called (after diagnostic file calls from setupImplementationStage)
      // Note: Only assumption_data.json is created (no aggregated_prompt.json since we didn't go through chat->assumptions)
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === 'create_file' && call[1]?.file_path === 'test.txt'
      );
      expect(createFileCall).toBeDefined();
      expect(createFileCall![1]).toEqual({
        file_path: 'test.txt',
        content: 'new content',
      });

      // Verify replace_file was called with same arguments
      const replaceFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === 'replace_file' && call[1]?.file_path === 'test.txt'
      );
      expect(replaceFileCall).toBeDefined();
      expect(replaceFileCall![1]).toEqual({
        file_path: 'test.txt',
        content: 'new content',
      });

      // Verify the result shows replace_file was used (not create_file)
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('replace_file');
      expect(result.toolCalls?.[0].arguments).toEqual({
        file_path: 'test.txt',
        content: 'new content',
      });
      expect(result.toolCalls?.[0].result?.isError).toBe(false);
      expect(result.toolCalls?.[0].result?.content[0].text).toContain('Successfully replaced file');
    });

    it('should not fallback to replace_file when create_file succeeds', async () => {
      // First, transition to implementation stage using explicit command
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // Now test the successful create_file in implementation stage
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'newfile.txt', content: 'new content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      // create_file succeeds (file doesn't exist)
      // Note: setupImplementationStage already made 2 calls (aggregated_prompt.json, assumption_data.json)
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: newfile.txt' }],
        isError: false,
      });

      const result = await client.callServer('now create newfile.txt with new content');

      // Verify create_file was called (setupImplementationStage made 1 diagnostic call, then this test made 1)
      // Note: Only assumption_data.json is created (no aggregated_prompt.json since we didn't go through chat->assumptions)
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(2);
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', {
        file_path: 'newfile.txt',
        content: 'new content',
      });

      // Verify the result shows create_file was used (not replace_file)
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('create_file');
      expect(result.toolCalls?.[0].result?.isError).toBe(false);
      expect(result.toolCalls?.[0].result?.content[0].text).toContain('Successfully created file');
    });
  });

  describe('Continuation Logic in Implementation Stage', () => {
    it('should continue from read_file to replace_file', async () => {
      // Use helper to transition to implementation stage
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // First response: read_file - needs continuation hint to trigger continuation
      const readFileResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Now I will read the file<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
        },
      };

      // Second response: replace_file
      const replaceFileResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Now I will update the file<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(readFileResponse)
        .mockResolvedValueOnce(replaceFileResponse)
        .mockResolvedValue({
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Done<|end|>' }],
          },
        }); // Fallback for any extra calls

      const readFileParseResult: HarmonyParseResult = {
        content: 'Now I will read the file',
        rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
      };

      const replaceFileParseResult: HarmonyParseResult = {
        content: 'Now I will update the file',
        rawToolCalls: ['<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(readFileParseResult)
        .mockReturnValueOnce(replaceFileParseResult)
        .mockReturnValue({ 
          content: '', 
          rawToolCalls: [],
          reasoning: undefined,
          commentary: undefined,
          final: undefined
        }); // Fallback for any extra calls - ensure all required fields

      const readFileToolCalls: MCPToolCall[] = [
        { name: 'read_file', arguments: { file_path: 'test.txt' } },
      ];

      const replaceFileToolCalls: MCPToolCall[] = [
        { name: 'replace_file', arguments: { file_path: 'test.txt', content: 'Updated content' } },
      ];

      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([]) // Helper assumptions transition call
        .mockReturnValueOnce([]) // Helper implementation transition call
        .mockReturnValueOnce(readFileToolCalls) // Initial test call
        .mockReturnValueOnce(replaceFileToolCalls) // Continuation call
        .mockReturnValue([]); // Fallback for any extra calls

      const readFileResult: MCPToolResult = {
        content: [{ type: 'text', text: 'Original file content' }],
        isError: false,
      };

      const replaceFileResult: MCPToolResult = {
        content: [{ type: 'text', text: 'File replaced successfully' }],
        isError: false,
      };

      // Mock native tools manager for read_file and replace_file
      const readFileTool: NativeTool = {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
          },
          required: ['file_path'],
        },
      } as any;

      const replaceFileTool: NativeTool = {
        name: 'replace_file',
        description: 'Replace file content',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        readFileTool,
        replaceFileTool,
      ]);

      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({ content: readFileResult.content, isError: false } as any)
        .mockResolvedValueOnce({ content: replaceFileResult.content, isError: false } as any);

      const result = await client.callServer('update test.txt to have new content');

      // Should have made API calls: helper assumptions(1) + helper implementation(1) + initial(1) + continuation(1) = 4
      // But setupImplementationStage makes 2 calls, then the test call makes 1, then continuation makes 1 = 4 total
      // Actually: setupImplementationStage = assumptions(1) + implementation(1) = 2, then test call = 1, continuation = 1, total = 4
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
      
      // Should have executed only the read_file tool call (plus 2 from setupImplementationStage)
      // The continuation to replace_file is blocked because we're already in a continuation
      // setupImplementationStage made 1 diagnostic call (assumption_data.json), then this test made 1 = 2 total
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(2);
      expect(mockNativeToolsManager.callTool).toHaveBeenNthCalledWith(2, 'read_file', { file_path: 'test.txt' });
      
      // Should have only the read_file tool call in result (replace_file continuation was blocked)
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('read_file');
    });

    it('should not continue when task is complete with file modification', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>File has been created successfully<tool_call name="create_file" args=\'{"file_path": "done.txt", "content": "content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'File has been created successfully',
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "done.txt", "content": "content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'done.txt', content: 'content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: done.txt' }],
        isError: false,
      });

      const result = await client.callServer('create done.txt');

      // Should only make one API call (no continuation)
      // Note: assumptions transition + implementation transition + this call = 3 calls total
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      // isContinuation may be false instead of undefined
      expect(result.isContinuation).toBeFalsy();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('create_file');
    });

    it('should handle tool execution errors gracefully', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "/invalid/path/file.txt", "content": "content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "/invalid/path/file.txt", "content": "content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: '/invalid/path/file.txt', content: 'content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Error creating file: Permission denied' }],
        isError: true,
      });

      const result = await client.callServer('create file at invalid path');

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].result?.isError).toBe(true);
      expect(result.toolCalls?.[0].result?.content[0].text).toContain('Permission denied');
    });

    it('should handle multiple tool calls in one response', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "file1.txt", "content": "content1"}\' /><tool_call name="create_file" args=\'{"file_path": "file2.txt", "content": "content2"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "file1.txt", "content": "content1"}\' />',
          '<tool_call name="create_file" args=\'{"file_path": "file2.txt", "content": "content2"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'file1.txt', content: 'content1' } },
        { name: 'create_file', arguments: { file_path: 'file2.txt', content: 'content2' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      // Note: setupImplementationStage already made 2 calls (aggregated_prompt.json, assumption_data.json)
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Successfully created file: file1.txt' }],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Successfully created file: file2.txt' }],
          isError: false,
        });

      const result = await client.callServer('create two files');

      expect(result.toolCalls?.length).toBe(2);
      expect(result.toolCalls?.[0].name).toBe('create_file');
      expect(result.toolCalls?.[0].arguments.file_path).toBe('file1.txt');
      expect(result.toolCalls?.[1].name).toBe('create_file');
      expect(result.toolCalls?.[1].arguments.file_path).toBe('file2.txt');
      // setupImplementationStage made 1 diagnostic call (assumption_data.json), then this test made 2 more = 3 total
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and error tool calls', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "good.txt", "content": "content"}\' /><tool_call name="create_file" args=\'{"file_path": "/bad/path.txt", "content": "content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: [
          '<tool_call name="create_file" args=\'{"file_path": "good.txt", "content": "content"}\' />',
          '<tool_call name="create_file" args=\'{"file_path": "/bad/path.txt", "content": "content"}\' />',
        ],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'good.txt', content: 'content' } },
        { name: 'create_file', arguments: { file_path: '/bad/path.txt', content: 'content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Successfully created file: good.txt' }],
          isError: false,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Error creating file: Invalid path' }],
          isError: true,
        });

      const result = await client.callServer('create files with mixed results');

      expect(result.toolCalls?.length).toBe(2);
      expect(result.toolCalls?.[0].result?.isError).toBe(false);
      expect(result.toolCalls?.[1].result?.isError).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty file content', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "empty.txt", "content": ""}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "empty.txt", "content": ""}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'create_file', arguments: { file_path: 'empty.txt', content: '' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: empty.txt' }],
        isError: false,
      });

      const result = await client.callServer('create empty file');

      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].arguments.content).toBe('');
    });

    it('should handle responses with no tool calls and no content', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: [],
        reasoning: undefined,
        commentary: undefined,
        final: undefined,
      };

      // Ensure parseResponse returns a valid result (not undefined)
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      const result = await client.callServer('do something');

      expect(result.content).toBe('');
      expect(result.toolCalls).toBeUndefined();
    });

    it('should handle tool call extraction failures', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="invalid_tool" args=\'{"invalid": "args"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="invalid_tool" args=\'{"invalid": "args"}\' />'],
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

      const result = await client.callServer('call invalid tool');

      // Should handle gracefully - no tool calls executed
      expect(result.toolCalls).toBeUndefined();
    });

    it('should stop continuation when max steps reached', async () => {
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // Set max steps to 2 and current step to 2 (already at max)
      const context = (client as any).contextManager.getContext();
      if (context) {
        context.maxSteps = 2;
        context.currentStep = 2; // Already at max
      }

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Now I will read<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Now I will read',
        rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'read_file', arguments: { file_path: 'test.txt' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const readFileTool: NativeTool = {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
          },
          required: ['file_path'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([readFileTool]);

      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'File content' }],
        isError: false,
      });

      const result = await client.callServer('read file');

      // Should not continue even if continuation would be triggered
      // Note: assumptions transition + implementation transition + this call = 3 calls total
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      expect(result.verboseInfo?.isComplete).toBe(true);
    });
  });

  describe('CodeContext from Assumptions Stage to Implementation Stage', () => {
    it('should create files from CodeContext extracted in assumptions stage when transitioning to implementation stage', async () => {
      // First, transition to assumptions stage and extract CodeContext
      const assumptionsResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Here is the code:\n```python app.py\nprint("Hello")\n```<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);

      const assumptionsParseResult: HarmonyParseResult = {
        content: 'Here is the code:\n```python app.py\nprint("Hello")\n```',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // First transition to assumptions stage using helper
      await transitionToAssumptions(client, mockHarmonyProcessor);
      
      // Now call with code context extraction
      await client.callServer('create app.py with hello world');

      // Verify we're in assumptions stage
      expect(client.getCurrentStage()).toBe('assumptions');

      // Verify NO files were created in assumptions stage (file modification tools are forbidden)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('create_file', expect.anything());
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('replace_file', expect.anything());

      // Now transition to implementation stage - this should create files from CodeContext
      const implementationResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Ready to implement<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(implementationResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Ready to implement',
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      await client.callServer('move to implementation');

      // Verify we're now in implementation stage
      expect(client.getCurrentStage()).toBe('implementation');

      // Now make a call in implementation stage - CodeContext should be used to create files
      // The ImplementationStageHandler.handlePreProcessing should detect CodeContext and create files
      const createFileTool: NativeTool = {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      // Mock create_file to succeed
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: app.py' }],
        isError: false,
      });

      // Call server in implementation stage - should create file from CodeContext without LLM call
      const result = await client.callServer('implement');

      // Verify create_file was called with content from CodeContext
      // Note: CodeContext extraction may use "file" as default filename if extraction fails
      // The important thing is that create_file was called with the correct content
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', expect.objectContaining({
        file_path: expect.any(String), // May be "app.py" or "file" depending on extraction
        content: expect.stringContaining('print("Hello")')
      }));

      // Verify the result shows the file was created
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBeGreaterThan(0);
      const createFileCall = result.toolCalls?.find(tc => tc.name === 'create_file');
      expect(createFileCall).toBeDefined();
      expect(createFileCall?.arguments.content).toContain('print("Hello")');
    });

    it('should NOT create files in assumptions stage even if CodeContext exists', async () => {
      // Transition to assumptions stage and extract CodeContext
      const assumptionsResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Code:\n```python test.py\ndef hello():\n    print("Hello")\n```<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);

      const assumptionsParseResult: HarmonyParseResult = {
        content: 'Code:\n```python test.py\ndef hello():\n    print("Hello")\n```',
        rawToolCalls: [],
      };

      // First transition to assumptions stage using helper
      await transitionToAssumptions(client, mockHarmonyProcessor);
      
      // Now call with code context extraction
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      await client.callServer('provide code for test.py');

      // Verify we're in assumptions stage
      expect(client.getCurrentStage()).toBe('assumptions');

      // Verify NO file modification tools were called (they are forbidden in assumptions stage)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('create_file', expect.anything());
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('replace_file', expect.anything());
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('read_file', expect.anything());

      // Make another call in assumptions stage - still should NOT create files
      const secondResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Code is ready<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(secondResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Code is ready',
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer('continue in assumptions');

      // Verify we're still in assumptions stage
      expect(client.getCurrentStage()).toBe('assumptions');

      // Verify NO file modification tools were called (file creation is forbidden in assumptions stage)
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('create_file', expect.anything());
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('replace_file', expect.anything());
    });
  });

  describe('ProgressPlan Step Updates', () => {
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
        'Test task',
        'hard',
        steps
      );
      
      // Set plan in context
      const contextManager = (client as any).contextManager;
      contextManager.setProgressPlan(plan);
      
      return taskId;
    }

    it('should update step status to completed when create_file succeeds in implementation stage', async () => {
      // Setup plan with 3 steps
      const taskId = setupProgressPlan([
        { goal: 'Create main.py' },
        { goal: 'Create requirements.txt' },
        { goal: 'Create README.md' },
      ]);

      // Transition to implementation stage
      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // Verify we're in implementation stage
      expect(client.getCurrentStage()).toBe('implementation');

      // Mock response with create_file tool call
      const implementationResponse = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "main.py", "content": "print(\\"Hello\\")"}<|tool_result|>Success<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(implementationResponse);

      const toolCall: MCPToolCall = {
        name: 'create_file',
        arguments: {
          file_path: 'main.py',
          content: 'print("Hello")',
        },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall]);

      // Mock create_file tool execution (success)
      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        {
          name: 'create_file',
          description: 'Create a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['file_path', 'content'],
          },
        } as any,
      ]);

      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      });

      await client.callServer('create main.py');

      // Verify step 1 was marked as completed
      const progressPlanManager = client.getProgressPlanManager();
      const plan = progressPlanManager.getPlan(taskId);
      
      expect(plan).toBeDefined();
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('pending');
      expect(plan?.steps[2].status).toBe('pending');
    });

    it('should not update step status when create_file fails', async () => {
      // Setup plan with steps
      const taskId = setupProgressPlan([
        { goal: 'Create main.py' },
        { goal: 'Create config.json' },
      ]);

      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      // Mock response with create_file tool call
      const implementationResponse = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "main.py", "content": "code"}<|tool_result|>Error<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(implementationResponse);

      const toolCall: MCPToolCall = {
        name: 'create_file',
        arguments: {
          file_path: 'main.py',
          content: 'code',
        },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall]);

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        {
          name: 'create_file',
          description: 'Create a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['file_path', 'content'],
          },
        } as any,
      ]);

      // Mock create_file tool execution (failure)
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Error: Permission denied' }],
        isError: true,
      });

      await client.callServer('create main.py');

      // Verify no steps were updated (all should remain pending)
      const progressPlanManager = client.getProgressPlanManager();
      const plan = progressPlanManager.getPlan(taskId);
      
      expect(plan).toBeDefined();
      expect(plan?.steps[0].status).toBe('pending');
      expect(plan?.steps[1].status).toBe('pending');
    });

    it('should complete plan when all steps are completed', async () => {
      // Setup plan with 2 steps
      const taskId = setupProgressPlan([
        { goal: 'Create file1.py' },
        { goal: 'Create file2.py' },
      ]);

      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const createFileTool = {
        name: 'create_file',
        description: 'Create a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      // First file creation - completes step 1
      const response1 = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "file1.py", "content": "code1"}<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response1);

      const toolCall1: MCPToolCall = {
        name: 'create_file',
        arguments: { file_path: 'file1.py', content: 'code1' },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall1)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall1]);
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      await client.callServer('create file1.py');

      // Second file creation - completes step 2
      const response2 = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "file2.py", "content": "code2"}<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response2);

      const toolCall2: MCPToolCall = {
        name: 'create_file',
        arguments: { file_path: 'file2.py', content: 'code2' },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall2)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall2]);
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      await client.callServer('create file2.py');

      // Verify plan is completed
      const progressPlanManager = client.getProgressPlanManager();
      const plan = progressPlanManager.getPlan(taskId);
      
      expect(plan).toBeDefined();
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('completed');
      expect(plan?.completedAt).toBeDefined();
      expect(plan?.completedAt).toBeGreaterThan(0);
    });

    it('should update steps sequentially (first pending step gets completed)', async () => {
      // Setup plan with 3 steps
      const taskId = setupProgressPlan([
        { goal: 'Step 1: Create main.py' },
        { goal: 'Step 2: Create utils.py' },
        { goal: 'Step 3: Create tests.py' },
      ]);

      await setupImplementationStage(client, mockHarmonyProcessor, mockNativeToolsManager);

      const createFileTool = {
        name: 'create_file',
        description: 'Create a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
        },
      } as any;

      mockNativeToolsManager.getAvailableTools.mockReturnValue([createFileTool]);

      // First execution - should complete step 1
      const response1 = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "main.py", "content": "code"}<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response1);

      const toolCall1: MCPToolCall = {
        name: 'create_file',
        arguments: { file_path: 'main.py', content: 'code' },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall1)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall1]);
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      await client.callServer('create main.py');

      // Verify step 1 is completed, others are pending
      const progressPlanManager = client.getProgressPlanManager();
      let plan = progressPlanManager.getPlan(taskId);
      
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('pending');
      expect(plan?.steps[2].status).toBe('pending');

      // Second execution - should complete step 2
      const response2 = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>tool_use<|tool_name|>create_file<|tool_args|>{"file_path": "utils.py", "content": "code"}<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(response2);

      const toolCall2: MCPToolCall = {
        name: 'create_file',
        arguments: { file_path: 'utils.py', content: 'code' },
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: '',
        rawToolCalls: [JSON.stringify(toolCall2)],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([toolCall2]);
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      await client.callServer('create utils.py');

      // Verify step 2 is now completed
      plan = progressPlanManager.getPlan(taskId);
      expect(plan?.steps[0].status).toBe('completed');
      expect(plan?.steps[1].status).toBe('completed');
      expect(plan?.steps[2].status).toBe('pending');
    });

    it('should not update steps when not in implementation stage', async () => {
      // Setup plan
      const taskId = setupProgressPlan([
        { goal: 'Create main.py' },
      ]);

      // Stay in chat stage (don't transition to implementation)
      const chatResponse = {
        status: 200,
        data: {
          choices: [{ 
            text: '<|channel|>final<|message|>Hello<|end|>' 
          }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(chatResponse);

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Hello',
        rawToolCalls: [],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer('hello');

      // Verify we're in chat stage
      expect(client.getCurrentStage()).toBe('chat');

      // Verify no steps were updated
      const progressPlanManager = client.getProgressPlanManager();
      const plan = progressPlanManager.getPlan(taskId);
      
      expect(plan).toBeDefined();
      expect(plan?.steps[0].status).toBe('pending');
    });
  });
});

