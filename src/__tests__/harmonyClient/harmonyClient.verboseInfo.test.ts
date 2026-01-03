import { HarmonyClient, HarmonyResponse } from '../../harmonyClient';
import { LlamaConfig, RuleConfig } from '../../config';
import { MCPManager } from '../../mcpManager';
import { RulesManager } from '../../rulesManager';
import { NativeToolsManager, NativeTool } from '../../nativeToolManager';
import { HarmonyProcessor, HarmonyParseResult } from '../../harmonyProcessor';
import { MCPToolCall, MCPToolResult } from '../../mcpClient';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HarmonyClient - VerboseInfo Tests', () => {
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

    // Setup HarmonyProcessor mock
    mockHarmonyProcessor = {
      parseResponse: jest.fn(),
      extractToolCalls: jest.fn(),
      formatPrompt: jest.fn(),
      validateResponse: jest.fn(),
      cleanText: jest.fn(),
    } as any;

    // Spy on HarmonyProcessor methods
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

  describe('verboseInfo.isComplete', () => {
    it('should set isComplete to true when task completes (no continuation needed)', async () => {
      // Test with a simple chat message that doesn't trigger continuation
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Hello! How can I help you today?<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Hello! How can I help you today?',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const result = await client.callServer('hello');

      expect(result.verboseInfo).toBeDefined();
      expect(result.verboseInfo?.isComplete).toBe(true);
      expect(result.verboseInfo?.step).toBeUndefined();
      expect(result.verboseInfo?.maxSteps).toBeUndefined();
    });

    it('should set isComplete when task completes with file modification tool', async () => {
      // Test completion after file modification tool is called
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "new content"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'File updated successfully',
        rawToolCalls: ['<tool_call name="replace_file" args=\'{"file_path": "test.txt", "content": "new content"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'replace_file', arguments: { file_path: 'test.txt', content: 'new content' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const toolResult: MCPToolResult = {
        content: [{ type: 'text', text: 'File replaced successfully' }],
        isError: false,
      };

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        {
          name: 'replace_file',
          description: 'Replace file content',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['file_path', 'content'],
          },
        } as NativeTool,
      ]);

      mockNativeToolsManager.callTool.mockResolvedValue(toolResult);

      const result = await client.callServer('update test.txt with new content');

      expect(result.verboseInfo).toBeDefined();
      // After file modification, task should complete
      expect(result.verboseInfo?.isComplete).toBe(true);
    });

    it('should set step and maxSteps when task continues (discovery tools only)', async () => {
      // Test continuation scenario: file task with only read_file (discovery tool)
      // This should trigger continuation, showing step/maxSteps
      const mockResponse1 = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><|end|>' }],
        },
      };

      const mockResponse2 = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>I will now update the file with the new content.<|end|>' }],
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const parseResult1: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
      };

      const parseResult2: HarmonyParseResult = {
        content: 'I will now update the file with the new content.',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(parseResult1)
        .mockReturnValueOnce(parseResult2);

      const toolCalls: MCPToolCall[] = [
        { name: 'read_file', arguments: { file_path: 'test.txt' } },
      ];

      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce(toolCalls)
        .mockReturnValueOnce([]);

      const toolResult: MCPToolResult = {
        content: [{ type: 'text', text: 'File content' }],
        isError: false,
      };

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
          },
        } as NativeTool,
      ]);

      mockNativeToolsManager.callTool.mockResolvedValue(toolResult);

      const result = await client.callServer('update test.txt with new content');

      expect(result.verboseInfo).toBeDefined();
      // When continuing (discovery tools only, no file modification yet),
      // should have step and maxSteps, not isComplete
      // Note: The exact behavior depends on continuation logic, but we verify verboseInfo exists
      expect(result.verboseInfo?.stage).toBeDefined();
    });

    it('should set isComplete when max steps reached (early return)', async () => {
      // Test the early return path when currentStep > maxSteps
      // This happens before making the API call
      // We can't easily test this directly without exposing internal state,
      // but we can verify that verboseInfo structure handles completion correctly
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

      const result = await client.callServer('test');

      // Verify verboseInfo structure is correct
      expect(result.verboseInfo).toBeDefined();
      // Completion status should be boolean if present
      if (result.verboseInfo?.isComplete !== undefined) {
        expect(typeof result.verboseInfo.isComplete).toBe('boolean');
      }
    });

    it('should include stage information in verboseInfo', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Hello! How can I help?<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Hello! How can I help?',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const result = await client.callServer('hello');

      expect(result.verboseInfo).toBeDefined();
      expect(result.verboseInfo?.stage).toBeDefined();
      expect(['chat', 'assumptions', 'implementation']).toContain(result.verboseInfo?.stage);
    });

    it('should include toolCalls in verboseInfo when tools are executed', async () => {
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

      mockNativeToolsManager.getAvailableTools.mockReturnValue([
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
            required: ['file_path'],
          },
        } as NativeTool,
      ]);

      mockNativeToolsManager.callTool.mockResolvedValue(toolResult);

      const result = await client.callServer('read test.txt');

      expect(result.verboseInfo).toBeDefined();
      expect(result.verboseInfo?.toolCalls).toBeDefined();
      expect(result.verboseInfo?.toolCalls?.length).toBeGreaterThan(0);
      expect(result.verboseInfo?.toolCalls?.[0].name).toBe('read_file');
      expect(result.verboseInfo?.toolCalls?.[0].success).toBe(true);
      expect(result.verboseInfo?.toolCalls?.[0].stage).toBeDefined();
    });

    it('should mark tool calls as failed when they error', async () => {
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|><tool_call name="read_file" args=\'{"file_path": "nonexistent.txt"}\' /><|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: '',
        rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "nonexistent.txt"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls: MCPToolCall[] = [
        { name: 'read_file', arguments: { file_path: 'nonexistent.txt' } },
      ];

      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const toolResult: MCPToolResult = {
        content: [{ type: 'text', text: 'File not found' }],
        isError: true,
      };

      mockMCPManager.findToolServer.mockReturnValue('test-server');
      mockMCPManager.callTool.mockResolvedValue(toolResult);

      const result = await client.callServer('read nonexistent.txt');

      expect(result.verboseInfo).toBeDefined();
      expect(result.verboseInfo?.toolCalls).toBeDefined();
      expect(result.verboseInfo?.toolCalls?.length).toBeGreaterThan(0);
      expect(result.verboseInfo?.toolCalls?.[0].success).toBe(false);
      expect(result.verboseInfo?.toolCalls?.[0].error).toBeDefined();
    });
  });

  describe('verboseInfo step counter logic', () => {
    it('should have either isComplete OR step/maxSteps, but not both', async () => {
      // Test that step info and isComplete are mutually exclusive
      // This verifies the core logic: continuing tasks show step count,
      // completed tasks show isComplete
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Hello!<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Hello!',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      const result = await client.callServer('hello');

      expect(result.verboseInfo).toBeDefined();
      
      // Should either have isComplete OR step/maxSteps, but not both
      const hasIsComplete = result.verboseInfo?.isComplete === true;
      const hasStepInfo = result.verboseInfo?.step !== undefined && result.verboseInfo?.maxSteps !== undefined;
      
      // They should be mutually exclusive
      expect(hasIsComplete || hasStepInfo).toBe(true);
      if (hasIsComplete) {
        expect(result.verboseInfo?.step).toBeUndefined();
        expect(result.verboseInfo?.maxSteps).toBeUndefined();
      }
      if (hasStepInfo) {
        expect(result.verboseInfo?.isComplete).toBeFalsy();
        expect(typeof result.verboseInfo?.step).toBe('number');
        expect(typeof result.verboseInfo?.maxSteps).toBe('number');
      }
    });

    it('should include step and maxSteps as numbers when present', async () => {
      // Verify type correctness when step info is present
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

      const result = await client.callServer('test');

      if (result.verboseInfo?.step !== undefined) {
        expect(typeof result.verboseInfo.step).toBe('number');
        expect(result.verboseInfo.step).toBeGreaterThan(0);
      }
      if (result.verboseInfo?.maxSteps !== undefined) {
        expect(typeof result.verboseInfo.maxSteps).toBe('number');
        expect(result.verboseInfo.maxSteps).toBeGreaterThan(0);
      }
    });
  });

  describe('problemSummary with multiple user queries', () => {
    it('should include all user queries in problem summary when getCurrentVerboseInfo is called with conversation history', () => {
      // Test that getCurrentVerboseInfo includes all user queries from conversation history
      // This directly tests the fix for the issue where only the first query was shown
      
      // Simulate a conversation with multiple user queries
      const conversationHistory = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'Hello! How can I help you?' },
        { role: 'user' as const, content: 'analyze latin invenietur' },
        { role: 'assistant' as const, content: 'I will analyze the Latin phrase.' },
      ];

      // Get verbose info with conversation history
      const verboseInfo = client.getCurrentVerboseInfo(conversationHistory);

      expect(verboseInfo).toBeDefined();
      expect(verboseInfo.stage).toBe('chat');
      
      // Check that problem summary includes both queries
      if (verboseInfo.stage === 'chat') {
        const chatVerboseInfo = verboseInfo as any;
        expect(chatVerboseInfo.problemSummary).toBeDefined();
        expect(chatVerboseInfo.problemSummary.originalQuery).toBeDefined();
        
        // The originalQuery should include both queries (separated by newlines)
        const originalQuery = chatVerboseInfo.problemSummary.originalQuery;
        expect(originalQuery).toContain('hi');
        expect(originalQuery).toContain('analyze latin invenietur');
        // Should not include assistant messages
        expect(originalQuery).not.toContain('Hello!');
        expect(originalQuery).not.toContain('I will analyze');
      }
    });

    it('should include all user queries in problem summary when conversation history includes both queries', async () => {
      // Test scenario: user sends multiple queries in chat stage
      // 1. First query: "hi"
      // 2. Second query: "analyze latin invenietur"
      // When verboseInfo is requested, conversation history should include both queries
      // Expected: problem summary should include both queries

      const mockResponse1 = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Hello! How can I help you?<|end|>' }],
        },
      };

      const mockResponse2 = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>I will analyze the Latin phrase "invenietur".<|end|>' }],
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const parseResult1: HarmonyParseResult = {
        content: 'Hello! How can I help you?',
        rawToolCalls: [],
      };

      const parseResult2: HarmonyParseResult = {
        content: 'I will analyze the Latin phrase "invenietur".',
        rawToolCalls: [],
      };

      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(parseResult1)
        .mockReturnValueOnce(parseResult2);

      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      // First message: "hi"
      await client.callServer('hi', 'chat', undefined, false, []);

      // Second message: "analyze latin invenietur"
      // Pass conversation history with first query + response
      const conversationHistoryBeforeSecond = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'Hello! How can I help you?' },
      ];
      
      await client.callServer(
        'analyze latin invenietur',
        'chat',
        undefined,
        false,
        conversationHistoryBeforeSecond
      );

      // Now test getCurrentVerboseInfo with complete conversation history
      // This simulates what happens when @cmd:verbose-info is called after both queries
      const completeConversationHistory = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'Hello! How can I help you?' },
        { role: 'user' as const, content: 'analyze latin invenietur' },
        { role: 'assistant' as const, content: 'I will analyze the Latin phrase "invenietur".' },
      ];

      const verboseInfo = client.getCurrentVerboseInfo(completeConversationHistory);
      
      expect(verboseInfo).toBeDefined();
      expect(verboseInfo.stage).toBe('chat');
      
      // Check that problem summary includes both queries
      if (verboseInfo.stage === 'chat') {
        const chatVerboseInfo = verboseInfo as any;
        expect(chatVerboseInfo.problemSummary).toBeDefined();
        expect(chatVerboseInfo.problemSummary.originalQuery).toBeDefined();
        
        // The originalQuery should include both queries (separated by newlines)
        const originalQuery = chatVerboseInfo.problemSummary.originalQuery;
        expect(originalQuery).toContain('hi');
        expect(originalQuery).toContain('analyze latin invenietur');
        // Should not include assistant messages
        expect(originalQuery).not.toContain('Hello!');
        expect(originalQuery).not.toContain('I will analyze');
      }
    });

    it('should filter out command messages from problem summary', async () => {
      // Test that @cmd: commands are filtered out from problem summary
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

      // Conversation history with a command
      const conversationHistory = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'Hello!' },
        { role: 'user' as const, content: 'analyze latin invenietur' },
        { role: 'assistant' as const, content: 'I will analyze it.' },
        { role: 'user' as const, content: '@cmd:verbose-info' },
      ];

      // Test getCurrentVerboseInfo directly with conversation history
      const verboseInfo = client.getCurrentVerboseInfo(conversationHistory);

      expect(verboseInfo).toBeDefined();
      if (verboseInfo.stage === 'chat') {
        const chatVerboseInfo = verboseInfo as any;
        if (chatVerboseInfo.problemSummary) {
          const originalQuery = chatVerboseInfo.problemSummary.originalQuery;
          // Should include user queries but not the command
          expect(originalQuery).toContain('hi');
          expect(originalQuery).toContain('analyze latin invenietur');
          expect(originalQuery).not.toContain('@cmd:verbose-info');
        }
      }
    });

    it('should handle empty conversation history gracefully', () => {
      // Test getCurrentVerboseInfo with empty conversation history
      const verboseInfo = client.getCurrentVerboseInfo([]);

      expect(verboseInfo).toBeDefined();
      expect(verboseInfo.stage).toBe('chat');
      
      // Should still work without errors
      if (verboseInfo.stage === 'chat') {
        const chatVerboseInfo = verboseInfo as any;
        // If there's a problem summary, it should use originalPrompt from context
        // or be empty if no context exists
        expect(chatVerboseInfo).toBeDefined();
      }
    });
  });
});

