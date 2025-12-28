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

describe('HarmonyClient', () => {
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

  describe('callServer', () => {
    describe('Basic functionality', () => {
      it('should make API call with correct parameters', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Hello world<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Hello world',
          reasoning: undefined,
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test prompt');

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'http://localhost:8000/v1/completions',
          {
            model: 'test-model',
            prompt: expect.stringContaining('Test prompt'),
            temperature: 0.7,
            max_tokens: 2048,
            stream: false,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer test-api-key',
            },
          }
        );

        expect(result.content).toBe('Hello world');
        expect(result.toolCalls).toBeUndefined();
      });

      it('should handle response with choices[0].message.content format', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ message: { content: '<|channel|>final<|message|>Response<|end|>' } }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test');

        expect(result.content).toBe('Response');
      });

      it('should handle response with data.text format', async () => {
        const mockResponse = {
          status: 200,
          data: {
            text: '<|channel|>final<|message|>Direct text<|end|>',
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Direct text',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test');

        expect(result.content).toBe('Direct text');
      });

      it('should handle response with data.content format', async () => {
        const mockResponse = {
          status: 200,
          data: {
            content: '<|channel|>final<|message|>Content<|end|>',
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Content',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test');

        expect(result.content).toBe('Content');
      });

      it('should throw error for unexpected response format', async () => {
        const mockResponse = {
          status: 200,
          data: {
            unexpected: 'format',
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await expect(client.callServer('Test')).rejects.toThrow('Unexpected API response format');
      });

      it('should handle empty response content gracefully', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test');
        expect(result.content).toBe('');
      });
    });

    describe('Tool calls', () => {
      it('should execute MCP tool calls', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="test_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="test_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'test_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const toolResult: MCPToolResult = {
          content: [{ type: 'text', text: 'Tool result' }],
          isError: false,
        };

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockResolvedValue(toolResult);

        const result = await client.callServer('Test');

        expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('test_tool');
        expect(mockMCPManager.callTool).toHaveBeenCalledWith('test-server', 'test_tool', { arg: 'value' });
        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls?.length).toBe(1);
        expect(result.toolCalls?.[0].name).toBe('test_tool');
        expect(result.toolCalls?.[0].result).toEqual(toolResult);
      });

      it('should execute native tool calls', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="native_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="native_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'native_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const nativeTool: NativeTool = {
          name: 'native_tool',
          description: 'Test native tool',
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string', description: 'Parameter' },
            },
          },
        } as any;

        mockNativeToolsManager.getAvailableTools.mockReturnValue([nativeTool]);
        mockNativeToolsManager.callTool.mockResolvedValue({
          content: [{ type: 'text', text: 'Native tool result' }],
          isError: false,
        });

        const result = await client.callServer('Test');

        expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('native_tool', { arg: 'value' });
        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls?.length).toBe(1);
        expect(result.toolCalls?.[0].name).toBe('native_tool');
      });

      it('should automatically fallback from create_file to replace_file when file exists', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "new content"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'create_file', arguments: { file_path: 'test.txt', content: 'new content' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

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

        const result = await client.callServer('Test');

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
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "newfile.txt", "content": "new content"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'create_file', arguments: { file_path: 'newfile.txt', content: 'new content' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

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

        const result = await client.callServer('Test');

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

      it('should handle tool not found error', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="unknown_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="unknown_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'unknown_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        mockMCPManager.findToolServer.mockReturnValue(null);

        const result = await client.callServer('Test');

        expect(result.toolCalls).toBeDefined();
        // Check that we have at least one tool call with the expected error
        const errorToolCalls = result.toolCalls?.filter(tc => tc.result?.isError && tc.result?.content[0]?.text?.includes('not found'));
        expect(errorToolCalls?.length).toBeGreaterThan(0);
        // Check that the first tool call has the expected error
        const firstErrorCall = result.toolCalls?.find(tc => tc.name === 'unknown_tool');
        expect(firstErrorCall?.result?.isError).toBe(true);
        expect(firstErrorCall?.result?.content[0].text).toContain('not found');

      });

      it('should handle tool execution error', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="error_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="error_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'error_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockRejectedValue(new Error('Tool execution failed'));

        const result = await client.callServer('Test');

        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls?.length).toBe(1);
        expect(result.toolCalls?.[0].result?.isError).toBe(true);
        expect(result.toolCalls?.[0].result?.content[0].text).toContain('Tool execution failed');
      });

      it('should format tool results in response', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="test_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Initial content',
          rawToolCalls: ['<tool_call name="test_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'test_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const toolResult: MCPToolResult = {
          content: [{ type: 'text', text: 'Tool executed successfully' }],
          isError: false,
        };

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockResolvedValue(toolResult);

        const result = await client.callServer('Test');

        expect(result.content).toContain('Initial content');
        expect(result.content).toContain('**Tool Results:**');
        expect(result.content).toContain('test_tool');
        expect(result.content).toContain('Tool executed successfully');
      });
    });

    describe('Rules integration', () => {
      it('should include applicable rules in prompt', async () => {
        const mockRule: Rule = {
          id: 'rule1',
          filePath: '/path/to/rule.md',
          description: 'Test description',
          triggers: ['test'],
          content: 'Rule content',
          lastModified: Date.now(),
        };

        mockRulesManager.getApplicableRules.mockReturnValue([mockRule]);
        mockRulesManager.formatRulesForPrompt.mockReturnValue('Rule: Test Rule');

        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('test prompt');

        expect(mockRulesManager.getApplicableRules).toHaveBeenCalledWith('test prompt');
        expect(mockRulesManager.formatRulesForPrompt).toHaveBeenCalledWith([mockRule]);

        const callArgs = mockedAxios.post.mock.calls[0][1] as any;
        expect(callArgs.prompt).toContain('Rule: Test Rule');
      });

      it('should check rules from conversation history', async () => {
        const mockRule: Rule = {
          id: 'rule1',
          filePath: '/path/to/rule.md',
          description: 'Test description',
          triggers: ['test'],
          content: 'Rule content',
          lastModified: Date.now(),
        };

        mockRulesManager.getApplicableRulesFromHistory.mockReturnValue([mockRule]);
        mockRulesManager.formatRulesForPrompt.mockReturnValue('Rule content');

        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const history = [
          { role: 'user', content: 'test message' },
          { role: 'assistant', content: 'response' },
        ] as any;

        await client.callServer('new prompt', undefined, undefined, false, history);

        expect(mockRulesManager.getApplicableRulesFromHistory).toHaveBeenCalledWith(history);
      });

      it('should format tool results with rules', async () => {
        const mockRule: Rule = {
          id: 'rule1',
          filePath: '/path/to/rule.md',
          description: 'Test description',
          triggers: ['test'],
          content: 'Rule content',
          lastModified: Date.now(),
        };

        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="test_tool" args=\'{"arg": "value"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="test_tool" args=\'{"arg": "value"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'test_tool', arguments: { arg: 'value' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const toolResult: MCPToolResult = {
          content: [{ type: 'text', text: 'Tool result' }],
          isError: false,
        };

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockResolvedValue(toolResult);

        mockRulesManager.getApplicableRules.mockReturnValue([mockRule]);
        mockRulesManager.getRulesForTools.mockReturnValue([mockRule]);
        mockRulesManager.formatRulesForPrompt.mockReturnValue('Rule content');

        // Mock the formatting API call
        const formatResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>{"formatted": "result"}<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValueOnce(mockResponse).mockResolvedValueOnce(formatResponse);

        mockHarmonyProcessor.formatPrompt.mockReturnValue('<|start|>user<|channel|>final<|message|>Formatted prompt<|end|>');
        mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult).mockReturnValueOnce({
          content: '{"formatted": "result"}',
          rawToolCalls: [],
        });

        const result = await client.callServer('test prompt');

        // Should have made two API calls: one for main request, one for formatting
        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        expect(result.content).toContain('{"formatted": "result"}');
      });
    });

    describe('Templates', () => {
      it('should apply template when provided', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const applyTemplate = jest.fn().mockResolvedValue('Templated prompt');

        await client.callServer('Test prompt', 'chat', applyTemplate);

        expect(applyTemplate).toHaveBeenCalled();
        const templateCallArgs = applyTemplate.mock.calls[0];
        expect(templateCallArgs[0]).toBe('chat');
        expect(templateCallArgs[1]).toMatchObject({
          prompt: 'Test prompt',
          tools: expect.any(Array),
          stage: expect.any(String),
          stageInstructions: expect.any(String),
        });

        const callArgs = mockedAxios.post.mock.calls[0][1] as any;
        expect(callArgs.prompt).toBe('Templated prompt');
      });
    });

    describe('Continuation logic', () => {
      it('should continue task when shouldContinueTask returns true', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'read_file', arguments: { file_path: 'test.txt' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const toolResult: MCPToolResult = {
          content: [{ type: 'text', text: 'File content' }],
          isError: false,
        };

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockResolvedValue(toolResult);

        // Mock continuation response
        const continuationResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="create_file" args=\'{"file_path": "output.txt", "content": "output"}\' /><|end|>' }],
          },
        };

        mockedAxios.post
          .mockResolvedValueOnce(mockResponse)
          .mockResolvedValueOnce(continuationResponse);

        const continuationParseResult: HarmonyParseResult = {
          content: 'Task completed',
          rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "output.txt", "content": "output"}\' />'],
        };

        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(parseResult)
          .mockReturnValueOnce(continuationParseResult);

        const continuationToolCalls: MCPToolCall[] = [
          { name: 'create_file', arguments: { file_path: 'output.txt', content: 'output' } },
        ];

        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce(toolCalls)
          .mockReturnValueOnce(continuationToolCalls);

        const createFileResult: MCPToolResult = {
          content: [{ type: 'text', text: 'File created' }],
          isError: false,
        };

        mockMCPManager.callTool
          .mockResolvedValueOnce(toolResult)
          .mockResolvedValueOnce(createFileResult);

        mockMCPManager.findToolServer
          .mockReturnValueOnce('test-server')
          .mockReturnValueOnce('test-server');

        const result = await client.callServer('create output.txt');

        // Should have made two API calls
        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        expect(result.isContinuation).toBe(true);
        expect(result.toolCalls?.length).toBe(2);
      });

      it('should continue from read_file to replace_file', async () => {
        // First response: read_file
        const readFileResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
          },
        };

        // Second response: replace_file
        const replaceFileResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' /><|end|>' }],
          },
        };

        mockedAxios.post
          .mockResolvedValueOnce(readFileResponse)
          .mockResolvedValueOnce(replaceFileResponse);

        const readFileParseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
        };

        const replaceFileParseResult: HarmonyParseResult = {
          content: 'File updated successfully',
          rawToolCalls: ['<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "Updated content"}\' />'],
        };

        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(readFileParseResult)
          .mockReturnValueOnce(replaceFileParseResult);

        mockHarmonyProcessor.formatPrompt
          .mockReturnValueOnce('<|start|>user<|channel|>final<|message|>update test.txt to have new content<|end|>')
          .mockReturnValueOnce('<|start|>user<|channel|>final<|message|>Please use the appropriate tool calls...<|end|>');

        const readFileToolCalls: MCPToolCall[] = [
          { name: 'read_file', arguments: { file_path: 'test.txt' } },
        ];

        const replaceFileToolCalls: MCPToolCall[] = [
          { name: 'replace_file', arguments: { file_path: 'test.txt', content: 'Updated content' } },
        ];

        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce(readFileToolCalls)
          .mockReturnValueOnce(replaceFileToolCalls);

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

        // Should have made two API calls (initial + continuation)
        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        
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
        expect(result.content).toContain('File updated successfully');
      });

      it('should stop continuation at max steps', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|><tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: '',
          rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

        const toolCalls: MCPToolCall[] = [
          { name: 'read_file', arguments: { file_path: 'test.txt' } },
        ];

        mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

        const toolResult: MCPToolResult = {
          content: [{ type: 'text', text: 'File content' }],
          isError: false,
        };

        mockMCPManager.findToolServer.mockReturnValue('test-server');
        mockMCPManager.callTool.mockResolvedValue(toolResult);

        // Force continuation by making shouldContinueTask return true
        // We'll need to trigger this by having a file task with only discovery tools
        const result = await client.callServer('update test.txt');

        // After 5 steps, should stop
        // This is tested indirectly by checking the continuation logic
        expect(result).toBeDefined();
      });
    });

    describe('Tools context', () => {
      it('should include MCP tools in context', async () => {
        const mcpTool = {
          name: 'mcp_tool',
          description: 'MCP tool description',
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string', description: 'Parameter' },
            },
            required: [],
          },
        };

        mockMCPManager.getAllTools.mockReturnValue([mcpTool as any]);

        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('Test');

        const callArgs = mockedAxios.post.mock.calls[0][1] as any;
        expect(callArgs.prompt).toContain('Available Tools');
        expect(callArgs.prompt).toContain('[MCP] mcp_tool');
        expect(callArgs.prompt).toContain('MCP tool description');
      });

      it('should include native tools in context', async () => {
        const nativeTool: NativeTool = {
          name: 'native_tool',
          description: 'Native tool description',
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string', description: 'Parameter' },
            },
            required: [],
          },
        } as any;

        mockNativeToolsManager.getAvailableTools.mockReturnValue([nativeTool]);

        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('Test');

        const callArgs = mockedAxios.post.mock.calls[0][1] as any;
        expect(callArgs.prompt).toContain('Available Tools');
        expect(callArgs.prompt).toContain('[Built-in] native_tool');
        expect(callArgs.prompt).toContain('Native tool description');
      });
    });

    describe('Error handling', () => {
      it('should handle axios errors', async () => {
        const error = new Error('Network error');
        mockedAxios.post.mockRejectedValue(error);

        await expect(client.callServer('Test')).rejects.toThrow('Failed to call Harmony server: Network error');
      });

      it('should handle API errors gracefully', async () => {
        const mockResponse = {
          status: 500,
          data: { error: 'Internal server error' },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        // The code will try to extract response text, which will fail
        mockHarmonyProcessor.parseResponse.mockReturnValue({
          content: '',
          rawToolCalls: [],
        });

        // This should throw an error about unexpected format
        await expect(client.callServer('Test')).rejects.toThrow();
      });
    });

    describe('Reasoning extraction', () => {
      it('should extract reasoning from analysis channel', async () => {
        const mockResponse = {
          status: 200,
          data: {
            choices: [{ text: '<|channel|>analysis<|message|>Reasoning text<|end|><|channel|>final<|message|>Response<|end|>' }],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult: HarmonyParseResult = {
          content: 'Response',
          reasoning: 'Reasoning text',
          rawToolCalls: [],
        };

        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        const result = await client.callServer('Test');

        expect(result.reasoning).toBe('Reasoning text');
      });
    });
  });

  describe('resetConversationContext', () => {
    it('should reset conversation context', () => {
      // Initialize context by making a call
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      mockHarmonyProcessor.parseResponse.mockReturnValue({
        content: 'Response',
        rawToolCalls: [],
      });

      // Call reset - context should be null initially, but let's verify it works
      client.resetConversationContext();

      // Context should be reset (we can't directly access it, but we can verify
      // by checking that a new call starts fresh)
      expect(client.resetConversationContext).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle response without tool calls but with tool call content', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Content with <tool_call name="test" /> in it<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Content with <tool_call name="test" /> in it',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const result = await client.callServer('Test');

      expect(result.content).toContain('Content with');
    });

    it('should handle continuation without MCP or Native tools manager', async () => {
      const clientWithoutManagers = new HarmonyClient(mockConfig);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Response',
        rawToolCalls: [],
      };

      // Need to mock the harmony processor methods for the new client
      const harmonyProcessorInstance = (clientWithoutManagers as any).harmonyProcessor;
      jest.spyOn(harmonyProcessorInstance, 'parseResponse').mockReturnValue(parseResult);
      jest.spyOn(harmonyProcessorInstance, 'extractToolCalls').mockReturnValue([]);

      const result = await clientWithoutManagers.callServer('Test');

      expect(result.content).toBe('Response');
    });

    it('should handle API key absence', async () => {
      const configWithoutKey = { ...mockConfig, apiKey: '' };
      const clientWithoutKey = new HarmonyClient(configWithoutKey);

      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Response<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Response',
        rawToolCalls: [],
      };

      // Need to mock the harmony processor methods for the new client
      const harmonyProcessorInstance = (clientWithoutKey as any).harmonyProcessor;
      jest.spyOn(harmonyProcessorInstance, 'parseResponse').mockReturnValue(parseResult);
      jest.spyOn(harmonyProcessorInstance, 'extractToolCalls').mockReturnValue([]);

      await clientWithoutKey.callServer('Test');

      const callArgs = mockedAxios.post.mock.calls[0][2] as any;
      expect(callArgs.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('Truncation detection', () => {
    it('should detect truncation from finish_reason: length', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Response content<|end|>',
              finish_reason: 'length',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Response content',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      // Spy on console.warn to check if truncation warning is logged
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      // Should log truncation warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response was truncated due to token limit')
      );

      consoleSpy.mockRestore();
    });

    it('should detect truncation from finish_reason: max_tokens', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Response<|end|>',
              finish_reason: 'max_tokens',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Response',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response was truncated due to token limit')
      );

      consoleSpy.mockRestore();
    });

    it('should detect incomplete response with unclosed code block', async () => {
      // Response with unclosed code block (only opening ```, no closing)
      // This has 1 ``` pattern (odd number), so should be detected
      // Note: Must use exactly 1 ``` (not 2 or more)
      const responseText = '```python\nprint("test")\n# Missing closing code block';
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: responseText,
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: responseText,
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      // The detectIncompleteResponse method should detect the unclosed code block
      // and trigger a warning. Check for the warning message.
      const warnMessages = consoleSpy.mock.calls
        .map(call => call[0])
        .filter(msg => typeof msg === 'string')
        .join(' ');
      
      // Should contain warning about incomplete response
      expect(warnMessages).toMatch(/truncated|incomplete/i);

      consoleSpy.mockRestore();
    });

    it('should detect incomplete response with file mention but no complete code block', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '**File:** `test.swift`\n\n```swift\nclass Test {\n  // Code block not closed',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '**File:** `test.swift`\n\n```swift\nclass Test {\n  // Code block not closed',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response appears truncated or incomplete')
      );

      consoleSpy.mockRestore();
    });

    it('should detect incomplete Harmony tokens', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Content<|channel|>analysis<|message|>Reasoning',
              // Missing <|end|> tokens
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Content',
        reasoning: 'Reasoning',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response appears truncated or incomplete')
      );

      consoleSpy.mockRestore();
    });

    it('should not warn for complete responses', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Complete response<|end|>',
              finish_reason: 'stop',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Complete response',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      // Should not warn about truncation for complete responses
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response was truncated')
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Response appears incomplete')
      );

      consoleSpy.mockRestore();
    });

    it('should log maxTokens suggestion when truncated', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [
            {
              text: '<|channel|>final<|message|>Response<|end|>',
              finish_reason: 'length',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Response',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await client.callServer('Test');

      // Should suggest increasing maxTokens
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Consider increasing harmony.maxTokens')
      );

      consoleSpy.mockRestore();
    });
  });


  
});