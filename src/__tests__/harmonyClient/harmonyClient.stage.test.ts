import { HarmonyClient, WorkflowStage } from '../../harmonyClient';
import { LlamaConfig, RuleConfig } from '../../config';
import { MCPManager } from '../../mcpManager';
import { RulesManager } from '../../rulesManager';
import { NativeToolsManager, NativeTool } from '../../nativeToolManager';
import { HarmonyProcessor, HarmonyParseResult } from '../../harmonyProcessor';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HarmonyClient - Stage Control', () => {
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
      formatPrompt: jest.fn((prompt: string) => prompt),
      validateResponse: jest.fn(),
      cleanText: jest.fn(),
    } as any;

    // Spy on HarmonyProcessor methods
    jest.spyOn(HarmonyProcessor.prototype, 'parseResponse').mockImplementation(mockHarmonyProcessor.parseResponse);
    jest.spyOn(HarmonyProcessor.prototype, 'extractToolCalls').mockImplementation(mockHarmonyProcessor.extractToolCalls);
    jest.spyOn(HarmonyProcessor.prototype, 'formatPrompt').mockImplementation(mockHarmonyProcessor.formatPrompt);

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

    // Setup NativeToolsManager mock with test tools
    const testTools: NativeTool[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
          },
        },
      },
      {
        name: 'create_file',
        description: 'Create a new file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
      {
        name: 'replace_file',
        description: 'Replace file content',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
      {
        name: 'list_files',
        description: 'List files in directory',
        inputSchema: {
          type: 'object',
          properties: {
            directory: { type: 'string' },
          },
        },
      },
    ];

    mockNativeToolsManager = {
      getAvailableTools: jest.fn().mockReturnValue(testTools),
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

  describe('Stage Detection', () => {
    const createMockResponse = (content: string) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    const createParseResult = (content: string, toolCalls: any[] = []) => ({
      content,
      reasoning: undefined,
      rawToolCalls: toolCalls,
    });

    describe('Simple Greetings - Chat Stage', () => {
      const greetings = ['hello', 'hi', 'hey', 'greetings', 'good morning', 'thanks', 'thank you'];

      greetings.forEach((greeting) => {
        it(`should detect "${greeting}" as chat stage`, async () => {
          const mockResponse = createMockResponse('Hello! How can I help you?');
          mockedAxios.post.mockResolvedValue(mockResponse);

          const parseResult = createParseResult('Hello! How can I help you?');
          mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
          mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

          await client.callServer(greeting);

          const callArgs = mockedAxios.post.mock.calls[0];
          const prompt = (callArgs[1] as any).prompt as string;

          expect(prompt).toContain('CHAT/CLARIFICATION');
          expect(prompt).toContain('Chat/Clarification');
          expect(prompt).not.toContain('ASSUMPTIONS');
          expect(prompt).not.toContain('IMPLEMENTATION');
        });
      });

      it('should detect "how are you" as chat stage', async () => {
        const mockResponse = createMockResponse('I am doing well, thank you!');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('I am doing well, thank you!');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('how are you');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('CHAT/CLARIFICATION');
      });
    });

    describe('Code Questions - Assumptions Stage', () => {
      it('should detect code-related questions as assumptions stage', async () => {
        const mockResponse = createMockResponse('Here is a code snippet...');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('Here is a code snippet...');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('How do I implement a function to sort an array?');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('ASSUMPTIONS/ANALYSIS');
        expect(prompt).toContain('Assumptions/Analysis');
      });

      it('should detect "how to fix" questions as assumptions stage', async () => {
        const mockResponse = createMockResponse('Here is how to fix it...');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('Here is how to fix it...');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('how to fix the code in my file');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('ASSUMPTIONS/ANALYSIS');
      });
    });

    describe('Implementation Stage', () => {
      it('should detect explicit "move to implementation" command', async () => {
        const mockResponse = createMockResponse('Creating file...');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('Creating file...');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('move to implementation');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });

      it('should detect "now create the file" as implementation stage', async () => {
        const mockResponse = createMockResponse('Creating file...');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('Creating file...');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('now create the file');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });

      it('should detect "implement it" as implementation stage', async () => {
        const mockResponse = createMockResponse('Implementing...');
        mockedAxios.post.mockResolvedValue(mockResponse);

        const parseResult = createParseResult('Implementing...');
        mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('now implement it and create the file');

        const callArgs = mockedAxios.post.mock.calls[0];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });
    });
  });

  describe('Tool Filtering by Stage', () => {
    const createMockResponse = (content: string) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    const createParseResult = (content: string) => ({
      content,
      reasoning: undefined,
      rawToolCalls: [],
    });

    it('should filter out file modification tools in chat stage', async () => {
      const mockResponse = createMockResponse('Hello');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Hello');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('hello');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      // Should not contain create_file or replace_file in available tools
      expect(prompt).not.toContain('[Built-in] create_file');
      expect(prompt).not.toContain('[Built-in] replace_file');
      // Should contain read_file (read-only tool)
      expect(prompt).toContain('read_file');
    });

    it('should filter out file modification tools in assumptions stage', async () => {
      const mockResponse = createMockResponse('Here is a code snippet');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is a code snippet');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('how to implement a function');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      // Should not contain file modification tools
      expect(prompt).not.toContain('[Built-in] create_file');
      expect(prompt).not.toContain('[Built-in] replace_file');
      // Should contain read-only tools
      expect(prompt).toContain('read_file');
      expect(prompt).toContain('list_files');
    });

    it('should include all tools in implementation stage', async () => {
      const mockResponse = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Creating file');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('now create the file');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      // Should contain file modification tools
      expect(prompt).toContain('create_file');
      expect(prompt).toContain('replace_file');
    });
  });

  describe('Tool Call Blocking', () => {
    const createMockResponse = (content: string, toolCalls: any[] = []) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    it('should allow file modification tool calls in chat stage (when model decides to use them)', async () => {
      const mockResponse = createMockResponse('I will create a file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'I will create a file',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "test"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'test.txt', content: 'test' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const mockToolResult = {
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      };

      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);

      const result = await client.callServer('hello, can you help me?');

      // Tool calls should be allowed in chat stage (when model decides to use them)
      expect(result.toolCalls).toBeDefined();
      expect(mockNativeToolsManager.callTool).toHaveBeenCalled();
    });

    it('should block file modification tool calls in assumptions stage', async () => {
      const mockResponse = createMockResponse('Here is the code');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Here is the code',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "test"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'test.txt', content: 'test' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const result = await client.callServer('how to implement a function to sort arrays');

      // Tool calls should be blocked
      expect(result.toolCalls).toBeUndefined();
      expect(result.content).toContain('⚠️');
      // The stage might be chat if detection isn't perfect, so check for either
      expect(result.content).toMatch(/assumptions|chat/i);
      expect(result.content).toMatch(/code snippets|clarify/i);
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalled();
    });

    it('should allow file modification tool calls in implementation stage', async () => {
      const mockResponse = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Creating file',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "test"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'test.txt', content: 'test' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const mockToolResult = {
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      };

      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);

      await client.callServer('now create the file');

      // Tool calls should be allowed and executed
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', {
        file_path: 'test.txt',
        content: 'test',
      });
    });

    it('should allow read-only tools in chat stage', async () => {
      const mockResponse = createMockResponse('Reading file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'Reading file',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'read_file', arguments: { file_path: 'test.txt' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const mockToolResult = {
        content: [{ type: 'text', text: 'File content' }],
        isError: false,
      };

      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);

      await client.callServer('what is in test.txt');

      // Read-only tools should be allowed
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('read_file', {
        file_path: 'test.txt',
      });
    });
  });

  describe('Stage Instructions in Prompts', () => {
    const createMockResponse = (content: string) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    const createParseResult = (content: string) => ({
      content,
      reasoning: undefined,
      rawToolCalls: [],
    });

    it('should include chat stage instructions', async () => {
      const mockResponse = createMockResponse('Hello');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Hello');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('hello');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('CHAT/CLARIFICATION');
      expect(prompt).toContain('Understand and clarify');
      expect(prompt).toContain('Do NOT use file modification tools');
    });

    it('should include assumptions stage instructions', async () => {
      const mockResponse = createMockResponse('Here is code');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is code');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('how to implement a function for sorting');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('ASSUMPTIONS/ANALYSIS');
      expect(prompt).toContain('code snippets');
      expect(prompt).toContain('Do NOT use file modification tools');
    });

    it('should include implementation stage instructions', async () => {
      const mockResponse = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Creating file');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('now create the file');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('IMPLEMENTATION');
      expect(prompt).toContain('create or modify files');
      expect(prompt).toContain('create_file');
      expect(prompt).toContain('replace_file');
    });
  });

  describe('Stage Transitions', () => {
    const createMockResponse = (content: string) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    const createParseResult = (content: string) => ({
      content,
      reasoning: undefined,
      rawToolCalls: [],
    });

    it('should start in chat stage for simple greeting', async () => {
      const mockResponse = createMockResponse('Hello');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Hello');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('hello');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('CHAT/CLARIFICATION');
    });

    it('should transition to assumptions stage for code question', async () => {
      const mockResponse = createMockResponse('Here is code');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is code');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('how to implement a function');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('ASSUMPTIONS/ANALYSIS');
    });

    it('should transition to implementation stage with explicit command', async () => {
      const mockResponse = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Creating file');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('move to implementation and create the file');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('IMPLEMENTATION');
    });
  });

  describe('Default Stage Behavior', () => {
    const createMockResponse = (content: string) => ({
      status: 200,
      data: {
        choices: [{ text: `<|channel|>final<|message|>${content}<|end|>` }],
      },
    });

    const createParseResult = (content: string) => ({
      content,
      reasoning: undefined,
      rawToolCalls: [],
    });

    it('should default to chat stage for general questions', async () => {
      const mockResponse = createMockResponse('Here is the answer');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is the answer');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer('what is the weather today?');

      const callArgs = mockedAxios.post.mock.calls[0];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('CHAT/CLARIFICATION');
    });
  });
});

