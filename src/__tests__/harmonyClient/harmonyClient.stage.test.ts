import { HarmonyClient, WorkflowStage } from '../../harmonyClient';
import { LlamaConfig, RuleConfig } from '../../config';
import { MCPManager } from '../../mcpManager';
import { RulesManager } from '../../rulesManager';
import { NativeToolsManager, NativeTool } from '../../nativeToolManager';
import { HarmonyProcessor, HarmonyParseResult } from '../../harmonyProcessor';
import { ChatMessage } from '../../conversationManager';
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
        // First transition to assumptions stage (required per state machine)
        const mockResponse1 = createMockResponse('Here is the code...');
        // Mock for auto-transition continuation call (implementation stage)
        const mockAutoTransitionResponse = createMockResponse('Implementation response');
        mockedAxios.post
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockAutoTransitionResponse);
        const parseResult1 = createParseResult('Here is the code...');
        const autoTransitionParseResult = createParseResult('Implementation response');
        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(parseResult1)
          .mockReturnValueOnce(autoTransitionParseResult);
        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce([])
          .mockReturnValueOnce([]);
        
        await client.callServer('how to implement a function');

        // Now test "move to implementation" from assumptions stage
        const mockResponse2 = createMockResponse('Creating file...');
        mockedAxios.post.mockResolvedValueOnce(mockResponse2);
        const parseResult2 = createParseResult('Creating file...');
        mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('move to implementation');

        const callArgs = mockedAxios.post.mock.calls[1];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });

      it('should detect explicit "moveto implementation" command (without space)', async () => {
        // First transition to assumptions stage (required per state machine)
        const mockResponse1 = createMockResponse('Here is the code...');
        // Mock for auto-transition continuation call (implementation stage)
        const mockAutoTransitionResponse = createMockResponse('Implementation response');
        mockedAxios.post
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockAutoTransitionResponse);
        const parseResult1 = createParseResult('Here is the code...');
        const autoTransitionParseResult = createParseResult('Implementation response');
        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(parseResult1)
          .mockReturnValueOnce(autoTransitionParseResult);
        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce([])
          .mockReturnValueOnce([]);
        
        await client.callServer('how to implement a function');

        // Now test "moveto implementation" (without space) from assumptions stage
        const mockResponse2 = createMockResponse('Creating file...');
        mockedAxios.post.mockResolvedValueOnce(mockResponse2);
        const parseResult2 = createParseResult('Creating file...');
        mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('moveto implementation');

        const callArgs = mockedAxios.post.mock.calls[1];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });

      it('should detect "now create the file" as implementation stage', async () => {
        // First transition to assumptions stage (required per state machine)
        const mockResponse1 = createMockResponse('Here is the code...');
        // Mock for auto-transition continuation call (implementation stage)
        const mockAutoTransitionResponse = createMockResponse('Implementation response');
        mockedAxios.post
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockAutoTransitionResponse);
        const parseResult1 = createParseResult('Here is the code...');
        const autoTransitionParseResult = createParseResult('Implementation response');
        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(parseResult1)
          .mockReturnValueOnce(autoTransitionParseResult);
        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce([])
          .mockReturnValueOnce([]);
        
        await client.callServer('how to implement a function');

        // Now test "now create the file" from assumptions stage
        const mockResponse2 = createMockResponse('Creating file...');
        mockedAxios.post.mockResolvedValueOnce(mockResponse2);
        const parseResult2 = createParseResult('Creating file...');
        mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('now create the file');

        const callArgs = mockedAxios.post.mock.calls[1];
        const prompt = (callArgs[1] as any).prompt as string;

        expect(prompt).toContain('IMPLEMENTATION');
      });

      it('should detect "implement it" as implementation stage', async () => {
        // First transition to assumptions stage (required per state machine)
        const mockResponse1 = createMockResponse('Here is the code...');
        // Mock for auto-transition continuation call (implementation stage)
        const mockAutoTransitionResponse = createMockResponse('Implementation response');
        mockedAxios.post
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockAutoTransitionResponse);
        const parseResult1 = createParseResult('Here is the code...');
        const autoTransitionParseResult = createParseResult('Implementation response');
        mockHarmonyProcessor.parseResponse
          .mockReturnValueOnce(parseResult1)
          .mockReturnValueOnce(autoTransitionParseResult);
        mockHarmonyProcessor.extractToolCalls
          .mockReturnValueOnce([])
          .mockReturnValueOnce([]);
        
        await client.callServer('how to implement a function');

        // Now test "now implement it and create the file" from assumptions stage
        const mockResponse2 = createMockResponse('Implementing...');
        mockedAxios.post.mockResolvedValueOnce(mockResponse2);
        const parseResult2 = createParseResult('Implementing...');
        mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
        mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

        await client.callServer('now implement it and create the file');

        const callArgs = mockedAxios.post.mock.calls[1];
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

    it('should block file modification tool calls in chat stage', async () => {
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

      const result = await client.callServer('hello, can you help me?');

      // Tool calls should be BLOCKED in chat stage per state machine rules
      expect(result.toolCalls).toBeUndefined();
      expect(result.content).toContain('⚠️');
      expect(result.content).toMatch(/chat|clarification/i);
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalled();
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
      // The error message says "Analysis stage" (not "assumptions")
      expect(result.content).toMatch(/analysis|assumptions|chat/i);
      expect(result.content).toMatch(/code snippets|clarify/i);
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalled();
    });

    it('should allow file modification tool calls in implementation stage', async () => {
      // First transition to assumptions stage (required per state machine)
      const mockResponse1 = createMockResponse('Here is the code...');
      mockedAxios.post.mockResolvedValueOnce(mockResponse1);
      const parseResult1: HarmonyParseResult = {
        content: 'Here is the code...',
        reasoning: undefined,
        rawToolCalls: [],
      };
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult1);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      
      await client.callServer('how to implement a function');

      // Explicitly transition to implementation stage (auto-transition is disabled)
      const mockResponse2 = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValueOnce(mockResponse2);

      const parseResult2: HarmonyParseResult = {
        content: 'Creating file',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "test.txt", "content": "test"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'test.txt', content: 'test' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce(toolCalls);

      const mockToolResult = {
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      };

      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);

      // User must explicitly say "move to implementation" to transition
      await client.callServer('move to implementation');

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
      // First transition to assumptions stage (required per state machine)
      const mockResponse1 = createMockResponse('Here is the code...');
      // Mock for auto-transition continuation call (implementation stage)
      const mockAutoTransitionResponse = createMockResponse('Implementation response');
      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockAutoTransitionResponse);
      const parseResult1 = createParseResult('Here is the code...');
      const autoTransitionParseResult = createParseResult('Implementation response');
      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(parseResult1)
        .mockReturnValueOnce(autoTransitionParseResult);
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);
      
      await client.callServer('how to implement a function');

      // Now test implementation stage instructions
      const mockResponse2 = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValueOnce(mockResponse2);

      const parseResult2 = createParseResult('Creating file');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer('now create the file');

      const callArgs = mockedAxios.post.mock.calls[1];
      const prompt = (callArgs[1] as any).prompt as string;

      expect(prompt).toContain('IMPLEMENTATION');
      expect(prompt).toContain('create_file');
      expect(prompt).toContain('replace_file');
      expect(prompt).toMatch(/create.*file|modify.*file|create_file|replace_file/i);
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
      // First transition to assumptions stage (required per state machine)
      const mockResponse1 = createMockResponse('Here is the code...');
      // Mock for auto-transition continuation call (implementation stage)
      const mockAutoTransitionResponse = createMockResponse('Implementation response');
      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockAutoTransitionResponse);
      const parseResult1 = createParseResult('Here is the code...');
      const autoTransitionParseResult = createParseResult('Implementation response');
      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(parseResult1)
        .mockReturnValueOnce(autoTransitionParseResult);
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);
      
      await client.callServer('how to implement a function');

      // Now test transition to implementation stage
      const mockResponse2 = createMockResponse('Creating file');
      mockedAxios.post.mockResolvedValueOnce(mockResponse2);

      const parseResult2 = createParseResult('Creating file');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult2);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      await client.callServer('move to implementation and create the file');

      const callArgs = mockedAxios.post.mock.calls[1];
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

  describe('File Creation Request: "create a hello.py to greet Mary"', () => {
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

    it('should transition from chat to assumptions stage for file creation with extension', async () => {
      const prompt = 'create a hello.py to greet Mary';
      const mockResponse = createMockResponse('Here is the code for hello.py');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is the code for hello.py');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer(prompt);

      const callArgs = mockedAxios.post.mock.calls[0];
      const requestPrompt = (callArgs[1] as any).prompt as string;

      // Should transition to Assumptions stage (not Chat, because of file extension)
      expect(requestPrompt).toContain('ASSUMPTIONS/ANALYSIS');
      expect(requestPrompt).toContain('Assumptions/Analysis');
      expect(requestPrompt).not.toContain('CHAT/CLARIFICATION');
    });

    it('should filter out create_file tool in assumptions stage', async () => {
      const prompt = 'create a hello.py to greet Mary';
      const mockResponse = createMockResponse('Here is the code snippet');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is the code snippet');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer(prompt);

      const callArgs = mockedAxios.post.mock.calls[0];
      const requestPrompt = (callArgs[1] as any).prompt as string;

      // create_file should NOT be in available tools in Assumptions stage
      expect(requestPrompt).not.toContain('[Built-in] create_file');
      expect(requestPrompt).not.toContain('[Built-in] replace_file');
      // Read-only tools should still be available
      expect(requestPrompt).toContain('read_file');
      expect(requestPrompt).toContain('list_files');
    });

    it('should include plan/todo list creation instructions in assumptions stage', async () => {
      const prompt = 'create a hello.py to greet Mary';
      const mockResponse = createMockResponse('Here is the plan and code');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult = createParseResult('Here is the plan and code');
      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValue([]);

      await client.callServer(prompt);

      const callArgs = mockedAxios.post.mock.calls[0];
      const requestPrompt = (callArgs[1] as any).prompt as string;

      // Assumptions stage instructions should mention plan/todo list creation
      expect(requestPrompt).toContain('ASSUMPTIONS/ANALYSIS');
      expect(requestPrompt).toMatch(/plan|todo|break down|steps/i);
      expect(requestPrompt).toMatch(/code snippets/i);
    });

    it('should block create_file tool calls if attempted in assumptions stage', async () => {
      const prompt = 'create a hello.py to greet Mary';
      const mockResponse = createMockResponse('I will create the file');
      mockedAxios.post.mockResolvedValue(mockResponse);

      const parseResult: HarmonyParseResult = {
        content: 'I will create the file',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "hello.py", "content": "print(\\\"Hello, Mary!\\\")"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'hello.py', content: 'print("Hello, Mary!")' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const result = await client.callServer(prompt);

      // Tool calls should be blocked in Assumptions stage
      expect(result.toolCalls).toBeUndefined();
      expect(result.content).toContain('⚠️');
      expect(result.content).toMatch(/analysis|assumptions/i);
      expect(result.content).toMatch(/code snippets/i);
      // Tool should not be executed
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalled();
    });

    it('should provide helpful message when model only provides tool calls with no content in assumptions stage', async () => {
      const prompt = 'create a hello.py to greet Mary';
      const mockResponse = createMockResponse('');
      mockedAxios.post.mockResolvedValue(mockResponse);

      // Model only provided a tool call, no text content
      const parseResult: HarmonyParseResult = {
        content: '', // Empty content - model only provided tool call
        reasoning: undefined,
        rawToolCalls: ['{"name":"create_file","arguments":{"file_path":"hello.py","content":"print(\\\"Hello, Mary!\\\")"}}'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValue(parseResult);

      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'hello.py', content: 'print("Hello, Mary!")' } },
      ];
      mockHarmonyProcessor.extractToolCalls.mockReturnValue(toolCalls);

      const result = await client.callServer(prompt);

      // Even with empty content, should provide helpful message
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content).toContain('⚠️');
      expect(result.content).toMatch(/analysis|assumptions/i);
      expect(result.content).toMatch(/code snippets/i);
      expect(result.content).toMatch(/provide code snippets/i);
      // Tool calls should be blocked
      expect(result.toolCalls).toBeUndefined();
      // Tool should not be executed
      expect(mockNativeToolsManager.callTool).not.toHaveBeenCalled();
    });

    it('should allow create_file in implementation stage after transition', async () => {
      const prompt = 'create a hello.py to greet Mary';
      
      // First call: Assumptions stage - model provides code snippet
      const mockAssumptionsResponse = createMockResponse('Here is the code for hello.py:\n```python\nprint("Hello, Mary!")\n```');
      mockedAxios.post.mockResolvedValueOnce(mockAssumptionsResponse);

      const assumptionsParseResult = createParseResult('Here is the code for hello.py:\n```python\nprint("Hello, Mary!")\n```');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]); // No tool calls in assumptions stage

      await client.callServer(prompt);

      // Now explicitly transition to implementation stage (auto-transition is disabled)
      const mockImplementationResponse = createMockResponse('File created successfully');
      mockedAxios.post.mockResolvedValueOnce(mockImplementationResponse);

      const implementationParseResult: HarmonyParseResult = {
        content: 'File created successfully',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "hello.py", "content": "print(\\\"Hello, Mary!\\\")"}\' />'],
      };

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(implementationParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([
        { name: 'create_file', arguments: { file_path: 'hello.py', content: 'print("Hello, Mary!")' } },
      ]);

      const mockToolResult = {
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      };
      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);

      // User must explicitly say "move to implementation" to transition
      const result = await client.callServer('move to implementation');

      // Tool should be called in implementation stage
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', {
        file_path: 'hello.py',
        content: 'print("Hello, Mary!")',
      });
      
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBeGreaterThan(0);
    });

    it('should trigger continuation with code snippets when implementation stage has empty content', async () => {
      // Setup: Simulate a scenario where we're in implementation stage with empty content
      // This happens when the model doesn't generate tool calls or content
      // Expected flow: assumptions stage (code snippets) -> user says "move to implementation" -> implementation stage -> empty content -> continuation
      // Note: Auto-transition is disabled, so user must explicitly say "move to implementation"
      
      // First, transition to assumptions stage to get code snippets
      const assumptionsResponse = createMockResponse('Here is the code for hello.py:\n```python\nprint("Hello, Mary!")\n```');
      mockedAxios.post.mockResolvedValueOnce(assumptionsResponse);
      
      const assumptionsParseResult = createParseResult('Here is the code for hello.py:\n```python\nprint("Hello, Mary!")\n```');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      
      // Call to get into assumptions stage (no auto-transition)
      await client.callServer('create a hello.py to greet Mary');
      
      // Create conversation history with code snippets from assumptions stage
      const conversationHistory: ChatMessage[] = [
        { role: 'user', content: 'create a hello.py to greet Mary' },
        { role: 'assistant', content: 'Here is the code for hello.py:\n```python\nprint("Hello, Mary!")\n```' },
        { role: 'user', content: 'move to implementation' },
      ];
      
      // Mock the initial API call for the second callServer (transition to implementation) - returns empty content
      const mockEmptyResponse = createMockResponse('');
      
      const emptyParseResult: HarmonyParseResult = {
        content: '', // Empty content - no tool calls
        reasoning: undefined,
        rawToolCalls: [],
      };
      
      // Mock continuation response (should be triggered by our fix when empty content is detected)
      const mockContinuationResponse = createMockResponse('File created successfully');
      
      const continuationParseResult: HarmonyParseResult = {
        content: 'File created successfully',
        reasoning: undefined,
        rawToolCalls: ['<tool_call name="create_file" args=\'{"file_path": "hello.py", "content": "print(\\\"Hello, Mary!\\\")"}\' />'],
      };
      
      const toolCalls = [
        { name: 'create_file', arguments: { file_path: 'hello.py', content: 'print("Hello, Mary!")' } },
      ];
      
      // Set up mocks for the second callServer call and its continuation
      // The second callServer makes 1 API call (empty), then triggers continuation which makes another call
      mockedAxios.post
        .mockResolvedValueOnce(mockEmptyResponse) // Initial call for second callServer (implementation stage)
        .mockResolvedValueOnce(mockContinuationResponse); // Continuation call triggered by empty content
      
      mockHarmonyProcessor.parseResponse
        .mockReturnValueOnce(emptyParseResult) // Initial call parsing
        .mockReturnValueOnce(continuationParseResult); // Continuation call parsing
      
      mockHarmonyProcessor.extractToolCalls
        .mockReturnValueOnce([]) // Initial call - no tool calls
        .mockReturnValueOnce(toolCalls); // Continuation call - has tool calls
      
      const mockToolResult = {
        content: [{ type: 'text', text: 'File created successfully' }],
        isError: false,
      };
      mockNativeToolsManager.callTool.mockResolvedValue(mockToolResult);
      
      // Now call with "move to implementation" to transition to implementation stage
      // This will transition to implementation, make an API call that returns empty content,
      // and the fix should detect empty content, extract code snippets from history, and trigger continuation
      const result = await client.callServer('move to implementation', undefined, undefined, false, conversationHistory);
      
      // Should have triggered continuation (2 API calls: assumptions + implementation empty + continuation)
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      
      // Should have called the tool after continuation
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith('create_file', {
        file_path: 'hello.py',
        content: 'print("Hello, Mary!")',
      });
      
      // Result should have tool calls
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls?.length).toBeGreaterThan(0);
      expect(result.isContinuation).toBe(true);
    });

    it('should transition from assumptions to implementation when user says "moveto implementation" (without space) after "create a hello.py to greet mary"', async () => {
      // This test covers the exact bug scenario:
      // 1. User says "create a hello.py to greet mary" -> goes to assumptions stage
      // 2. User says "moveto implementation" (without space) -> should transition to implementation stage
      // The bug was that "moveto" (without space) wasn't recognized by the regex pattern
      
      const prompt1 = 'create a hello.py to greet mary';
      
      // First call: Assumptions stage response with code snippets
      const mockAssumptionsResponse = createMockResponse('Here is the plan:\n1. Create hello.py\n2. Add greet function\n3. Add main guard\n\nCode snippet:\n```python\n# hello.py\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nif __name__ == "__main__":\n    print(greet("Mary"))\n```');
      mockedAxios.post.mockResolvedValueOnce(mockAssumptionsResponse);
      
      const assumptionsParseResult = createParseResult('Here is the plan:\n1. Create hello.py\n2. Add greet function\n3. Add main guard\n\nCode snippet:\n```python\n# hello.py\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nif __name__ == "__main__":\n    print(greet("Mary"))\n```');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(assumptionsParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      
      await client.callServer(prompt1);
      
      // Verify first call was in assumptions stage
      const firstCallArgs = mockedAxios.post.mock.calls[0];
      const firstPrompt = (firstCallArgs[1] as any).prompt as string;
      expect(firstPrompt).toContain('ASSUMPTIONS/ANALYSIS');
      expect(firstPrompt).toContain('Assumptions/Analysis');
      
      // Second call: User says "moveto implementation" (without space) - this was the bug
      const prompt2 = 'moveto implementation';
      
      const mockImplementationResponse = createMockResponse('Creating hello.py...');
      mockedAxios.post.mockResolvedValueOnce(mockImplementationResponse);
      
      const implementationParseResult = createParseResult('Creating hello.py...');
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(implementationParseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      
      await client.callServer(prompt2);
      
      // Verify second call was in implementation stage (this is what the bug prevented)
      const secondCallArgs = mockedAxios.post.mock.calls[1];
      const secondPrompt = (secondCallArgs[1] as any).prompt as string;
      
      expect(secondPrompt).toContain('IMPLEMENTATION');
      expect(secondPrompt).not.toContain('ASSUMPTIONS/ANALYSIS');
      expect(secondPrompt).not.toContain('Assumptions/Analysis');
      
      // Verify that create_file tool is available in implementation stage
      expect(secondPrompt).toContain('[Built-in] create_file');
    });
  });
});

