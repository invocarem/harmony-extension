import { HarmonyClient, HarmonyResponse } from '../../harmonyClient';
import { LlamaConfig, RuleConfig } from '../../config';
import { MCPManager } from '../../mcpManager';
import { RulesManager, Rule } from '../../rulesManager';
import { NativeToolsManager, NativeTool } from '../../nativeToolManager';
import { HarmonyProcessor, HarmonyParseResult } from '../../harmonyProcessor';
import { MCPToolCall, MCPToolResult } from '../../mcpClient';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Helper function to transition to implementation stage
 * Note: This should be called at the start of each test that needs implementation stage
 */
async function transitionToImplementation(
  client: HarmonyClient,
  mockedAxios: jest.Mocked<typeof axios>,
  mockHarmonyProcessor: jest.Mocked<HarmonyProcessor>
): Promise<void> {
  const transitionResponse = {
    status: 200,
    data: {
      choices: [{ text: '<|channel|>final<|message|>Ready to implement<|end|>' }],
    },
  };
  mockedAxios.post.mockResolvedValueOnce(transitionResponse);
  mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
    content: 'Ready to implement',
    rawToolCalls: [],
  });
  mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
  await client.callServer('moveto implementation');
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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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

      // Verify create_file was called first
      expect(mockNativeToolsManager.callTool).toHaveBeenNthCalledWith(1, 'create_file', {
        file_path: 'test.txt',
        content: 'new content',
      });

      // Verify replace_file was called second with same arguments
      expect(mockNativeToolsManager.callTool).toHaveBeenNthCalledWith(2, 'replace_file', {
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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: newfile.txt' }],
        isError: false,
      });

      const result = await client.callServer('now create newfile.txt with new content');

      // Verify create_file was called only once
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(1);
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
      // First, transition to implementation stage so replace_file is allowed
      const transitionResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Ready to implement<|end|>' }],
        },
      };
      mockedAxios.post.mockResolvedValueOnce(transitionResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Ready to implement',
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      await client.callServer('moveto implementation');

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
        .mockReturnValueOnce([]) // Transition call
        .mockReturnValueOnce(readFileToolCalls)
        .mockReturnValueOnce(replaceFileToolCalls)
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

      // Should have made three API calls (transition + initial + continuation)
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      
      // Should have executed both tool calls
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(2);
      expect(mockNativeToolsManager.callTool).toHaveBeenNthCalledWith(1, 'read_file', { file_path: 'test.txt' });
      expect(mockNativeToolsManager.callTool).toHaveBeenNthCalledWith(2, 'replace_file', { 
        file_path: 'test.txt', 
        content: 'Updated content' 
      });

      // Result should indicate continuation
      expect(result.isContinuation).toBe(true);
      
      // Should have both tool calls in result
      expect(result.toolCalls?.length).toBe(2);
      expect(result.toolCalls?.[0].name).toBe('read_file');
      expect(result.toolCalls?.[1].name).toBe('replace_file');
      
      // Content should include the final message
      expect(result.content).toContain('Now I will update the file');
    });

    it('should not continue when task is complete with file modification', async () => {
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      // Note: transition call + this call = 2 calls total
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      // isContinuation may be false instead of undefined
      expect(result.isContinuation).toBeFalsy();
      expect(result.toolCalls?.length).toBe(1);
      expect(result.toolCalls?.[0].name).toBe('create_file');
    });

    it('should handle tool execution errors gracefully', async () => {
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed success and error tool calls', async () => {
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      await transitionToImplementation(client, mockedAxios, mockHarmonyProcessor);

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
      // Note: transition call + this call = 2 calls total
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(result.verboseInfo?.isComplete).toBe(true);
    });
  });

  describe('CodeContext File Creation in Assumptions Stage', () => {
    it('should create files from CodeContext before LLM call in assumptions stage', async () => {
      // First transition to assumptions stage
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

      // First call to assumptions stage - this should extract CodeContext
      await client.callServer('create app.py with hello world');

      // Now make another call in assumptions stage - this should create the file
      const secondResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Code is ready<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(secondResponse);

      const secondParseResult: HarmonyParseResult = {
        content: 'Code is ready',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(secondParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // Mock read_file to return error (file doesn't exist)
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Error reading file app.py: ENOENT: no such file or directory' }],
        isError: true,
      });

      // Mock create_file to succeed
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Successfully created file: app.py' }],
        isError: false,
      });

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

      mockNativeToolsManager.getAvailableTools.mockReturnValue([readFileTool, createFileTool]);

      await client.callServer('continue in assumptions');

      // Verify that read_file was called to check if file exists (may be called with extracted filename or default)
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('read_file', expect.objectContaining({
        file_path: expect.any(String)
      }));
      // Verify that create_file was called to create the file
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', expect.objectContaining({
        file_path: expect.any(String),
        content: expect.stringContaining('print("Hello")')
      }));
    });

    it('should not create file if it already exists in assumptions stage', async () => {
      // Transition to assumptions and extract code
      const assumptionsResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Code:\n```python existing.py\nprint("Hello")\n```<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);

      const assumptionsParseResult: HarmonyParseResult = {
        content: 'Code:\n```python existing.py\nprint("Hello")\n```',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer('provide code for existing.py');

      // Second call - file already exists
      const secondResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Ready<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(secondResponse);

      const secondParseResult: HarmonyParseResult = {
        content: 'Ready',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(secondParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // Mock read_file to succeed (file exists)
      mockNativeToolsManager.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'print("Hello")' }],
        isError: false,
      });

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

      await client.callServer('continue');

      // Verify read_file was called to check existence (may be called with extracted filename or default)
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('read_file', expect.objectContaining({
        file_path: expect.any(String)
      }));
      // Verify create_file was NOT called
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalledWith('create_file', expect.anything());
    });
  });
});

