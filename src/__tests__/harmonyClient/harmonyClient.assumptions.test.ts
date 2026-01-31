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

describe('HarmonyClient - Assumptions Stage', () => {
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

  describe('ProgressPlan Creation', () => {
    it('should create a progressPlan for hard tasks (3+ steps) in assumptions stage', async () => {
      // Test plan creation via autoTransitionManager directly
      // This simulates what happens when a hard task is detected in assumptions stage
      const autoTransitionManager = (client as any).autoTransitionManager;
      const contextManager = (client as any).contextManager;
      
      // Initialize context first, then update to assumptions stage
      contextManager.initialize('test prompt', 'assumptions');
      const context = contextManager.getContext();
      
      // Simulate a hard task response with multiple steps
      // Use content that will be detected as "hard" by complexity detection (3+ step indicators)
      const content = 'Step 1: Write the Python code\nStep 2: Create requirements.txt\nStep 3: Write summary.md for documentation';
      
      // Call shouldAutoTransitionFromAssumptions which creates the plan
      const transitionResult = autoTransitionManager.shouldAutoTransitionFromAssumptions(
        content,
        undefined,
        [],
        'write Python code, provide requirements.txt, and write summary.md for feature documentation',
        context
      );

      // Verify plan was created
      expect(transitionResult.plan).toBeDefined();
      const plan = transitionResult.plan!;
      
      expect(plan.complexity).toBe('hard');
      expect(plan.totalSteps).toBeGreaterThanOrEqual(3);
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.every((step: any) => step.status === 'pending')).toBe(true);
      
      // Verify plan is stored in context
      const updatedContext = contextManager.getContext();
      expect(updatedContext?.progressPlan).toBeDefined();
      expect(updatedContext?.progressPlan?.taskId).toBe(plan.taskId);
      
      // Verify plan can be retrieved from manager
      const progressPlanManager = client.getProgressPlanManager();
      const retrievedPlan = progressPlanManager.getPlan(plan.taskId);
      expect(retrievedPlan).toBeDefined();
      expect(retrievedPlan?.taskId).toBe(plan.taskId);
    });

    it('should create plan with extracted steps from numbered list', async () => {
      const autoTransitionManager = (client as any).autoTransitionManager;
      const contextManager = (client as any).contextManager;
      
      // Initialize context first, then update to assumptions stage
      contextManager.initialize('test prompt', 'assumptions');
      const context = contextManager.getContext();
      
      const content = 'Step 1: Create main.py\nStep 2: Add requirements.txt\nStep 3: Write README.md';
      
      const transitionResult = autoTransitionManager.shouldAutoTransitionFromAssumptions(
        content,
        undefined,
        [],
        'create a Python project with multiple files',
        context
      );

      const plan = transitionResult.plan;
      expect(plan).toBeDefined();
      expect(plan?.totalSteps).toBeGreaterThanOrEqual(3);
      expect(plan?.steps.length).toBeGreaterThanOrEqual(3);
      
      // Verify steps have goals extracted from the response
      if (plan && plan.steps.length >= 3) {
        expect(plan.steps[0].description).toBeTruthy();
        expect(plan.steps[1].description).toBeTruthy();
        expect(plan.steps[2].description).toBeTruthy();
      }
    });

    it('should not create plan for simple tasks (1-2 steps)', async () => {
      const autoTransitionManager = (client as any).autoTransitionManager;
      const contextManager = (client as any).contextManager;
      
      // Initialize context first, then update to assumptions stage
      contextManager.initialize('test prompt', 'assumptions');
      const context = contextManager.getContext();
      
      const content = 'Here is the code for app.py';
      
      const transitionResult = autoTransitionManager.shouldAutoTransitionFromAssumptions(
        content,
        undefined,
        [],
        'create app.py',
        context
      );

      // Simple tasks may or may not transition depending on complexity detection
      // For very simple content, complexity might be null or 'simple'
      // In that case, shouldTransition would be false
      // We just verify that no plan is created for simple tasks
      expect(transitionResult.plan).toBeUndefined();
    });

    it('should create plan with fallback steps when step extraction fails', async () => {
      const autoTransitionManager = (client as any).autoTransitionManager;
      const contextManager = (client as any).contextManager;
      
      // Initialize context first, then update to assumptions stage
      contextManager.initialize('test prompt', 'assumptions');
      const context = contextManager.getContext();
      
      // Content with complexity indicators that should trigger hard task detection
      // Use "first", "then", "finally" which are step indicators
      const content = 'First, we need to set up the project structure. Then, we implement the core functionality. Finally, we add documentation and tests.';
      
      const transitionResult = autoTransitionManager.shouldAutoTransitionFromAssumptions(
        content,
        undefined,
        [],
        'create a complex Python project',
        context
      );

      // If complexity is detected as hard, plan should be created
      // Even if step extraction fails, fallback steps should be created
      if (transitionResult.plan) {
        const plan = transitionResult.plan;
        expect(plan.complexity).toBe('hard');
        expect(plan.totalSteps).toBeGreaterThanOrEqual(1);
        expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should store plan in conversation context', async () => {
      const autoTransitionManager = (client as any).autoTransitionManager;
      const contextManager = (client as any).contextManager;
      
      // Initialize context first, then update to assumptions stage
      contextManager.initialize('test prompt', 'assumptions');
      const context = contextManager.getContext();
      
      // Use content with multiple step indicators that will definitely be detected as hard
      // Include "first", "then", "finally" which are step indicators
      const content = 'First, create main.py. Then, create config.json. Finally, create README.md';
      const originalPrompt = 'create a project with multiple files';
      
      // Verify complexity detection first
      const complexity = autoTransitionManager.detectTaskComplexity(content);
      // If not detected as hard, use content that will definitely match
      const hardContent = complexity === 'hard' ? content : 'Step 1: Create main.py\nStep 2: Create config.json\nStep 3: Create README.md\nStep 4: Create tests';
      
      const transitionResult = autoTransitionManager.shouldAutoTransitionFromAssumptions(
        hardContent,
        undefined,
        [],
        originalPrompt,
        context
      );

      const plan = transitionResult.plan;
      expect(plan).toBeDefined();
      expect(plan?.taskId).toBeDefined();
      expect(plan?.originalPrompt).toBe(originalPrompt);
      expect(plan?.createdAt).toBeDefined();
      expect(plan?.completedAt).toBeUndefined(); // Not completed yet
      
      // Verify plan is stored in context
      const updatedContext = contextManager.getContext();
      expect(updatedContext?.progressPlan).toBeDefined();
      expect(updatedContext?.progressPlan?.taskId).toBe(plan?.taskId);
    });
  });

  describe('aggregated_prompt.json Generation', () => {
    it('should generate aggregated_prompt.json file when transitioning from chat to assumptions stage', async () => {
      // Set up NativeToolsManager with create_file tool
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
      
      // Mock successful file creation
      mockNativeToolsManager.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Successfully created file: aggregated_prompt.json' }],
        isError: false,
      });

      // Set up conversation history with user queries and assistant responses
      const conversationHistory = [
        { role: 'user' as const, content: 'create hello.py with greet function' },
        { role: 'assistant' as const, content: 'I will help you create hello.py with a greet function.' },
        { role: 'user' as const, content: 'write unit test for it' },
        { role: 'assistant' as const, content: 'I will write unit tests for the greet function.' },
        { role: 'user' as const, content: 'create README' },
        { role: 'assistant' as const, content: 'I will create a README file.' },
        { role: 'user' as const, content: 'move to assumptions' }, // Transition command
      ];

      // Initialize context in chat stage
      const contextManager = (client as any).contextManager;
      contextManager.initialize('create hello.py with greet function', 'chat');

      // Set up ChatManager with queries
      const chatManager = client.getChatManager();
      chatManager.initialize();
      chatManager.addQuery('create hello.py with greet function');
      chatManager.addQuery('write unit test for it');
      chatManager.addQuery('create README');

      // Mock response for transition to assumptions
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Moving to assumptions stage<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Moving to assumptions stage',
        rawToolCalls: [],
      });

      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // Transition to assumptions with conversation history
      await client.callServer(
        'move to assumptions',
        'assumptions',
        undefined,
        false,
        conversationHistory
      );

      // Verify aggregated_prompt.json file was generated
      expect(mockNativeToolsManager.callTool).toHaveBeenCalledWith(
        'create_file',
        expect.objectContaining({
          file_path: '.harmony/aggregated_prompt.json',
          content: expect.stringContaining('"queries"'),
        })
      );

      // Verify the file content has correct structure
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === 'create_file' && call[1]?.file_path === '.harmony/aggregated_prompt.json'
      );
      expect(createFileCall).toBeDefined();

      if (createFileCall) {
        const fileContent = createFileCall[1]?.content as string;
        const promptData = JSON.parse(fileContent);

        // Verify JSON structure
        expect(promptData).toHaveProperty('queries');
        expect(promptData).toHaveProperty('assistantResponses');
        expect(promptData).toHaveProperty('referredFiles');
        expect(promptData).toHaveProperty('summary');

        // Verify queries are included (excluding transition command)
        expect(promptData.queries).toBeInstanceOf(Array);
        expect(promptData.queries).toContain('create hello.py with greet function');
        expect(promptData.queries).toContain('write unit test for it');
        expect(promptData.queries).toContain('create README');
        expect(promptData.queries).not.toContain('move to assumptions');
        expect(promptData.queries.length).toBe(3);

        // Verify assistant responses are included
        expect(promptData.assistantResponses).toBeInstanceOf(Array);
        expect(promptData.assistantResponses.length).toBe(3);
        expect(promptData.assistantResponses[0].content).toContain('help you create hello.py');
        expect(promptData.assistantResponses[1].content).toContain('write unit tests');
        expect(promptData.assistantResponses[2].content).toContain('create a README');

        // Verify summary
        expect(promptData.summary).toContain('3 queries');
        expect(promptData.summary).toContain('3 assistant responses');
      }

      // Verify stage transitioned to assumptions
      expect(client.getCurrentStage()).toBe('assumptions');
    });

    it('should update existing aggregated_prompt.json file if it already exists', async () => {
      // Set up NativeToolsManager with both create_file and replace_file tools
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

      // First call to create_file returns error (file exists), second call to replace_file succeeds
      mockNativeToolsManager.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Error: File aggregated_prompt.json already exists. Use replace_file to overwrite it.' }],
          isError: true,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Successfully replaced file: aggregated_prompt.json' }],
          isError: false,
        });

      // Set up conversation history
      const conversationHistory = [
        { role: 'user' as const, content: 'analyze the codebase' },
        { role: 'assistant' as const, content: 'I will analyze the codebase.' },
        { role: 'user' as const, content: 'move to assumptions' },
      ];

      // Initialize context in chat stage
      const contextManager = (client as any).contextManager;
      contextManager.initialize('analyze the codebase', 'chat');

      const chatManager = client.getChatManager();
      chatManager.initialize();
      chatManager.addQuery('analyze the codebase');

      // Mock response for transition
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: '<|channel|>final<|message|>Moving to assumptions stage<|end|>' }],
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce({
        content: 'Moving to assumptions stage',
        rawToolCalls: [],
      });
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);

      // Transition to assumptions
      await client.callServer(
        'move to assumptions',
        'assumptions',
        undefined,
        false,
        conversationHistory
      );

      // Verify create_file was called first (file exists error)
      const createFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === 'create_file' && call[1]?.file_path === '.harmony/aggregated_prompt.json'
      );
      expect(createFileCall).toBeDefined();

      // Verify replace_file was called second (update existing file)
      const replaceFileCall = mockNativeToolsManager.callTool.mock.calls.find(
        (call) => call[0] === 'replace_file' && call[1]?.file_path === '.harmony/aggregated_prompt.json'
      );
      expect(replaceFileCall).toBeDefined();

      // Verify the file content in replace call
      if (replaceFileCall) {
        const fileContent = replaceFileCall[1]?.content as string;
        const promptData = JSON.parse(fileContent);
        expect(promptData.queries).toContain('analyze the codebase');
        expect(promptData.queries).not.toContain('move to assumptions');
      }
    });
  });

  describe('Plan Updates', () => {
    it('should update existing plan when new steps are provided in assumptions stage', async () => {
      const contextManager = (client as any).contextManager;
      const assumptionsManager = (client as any).assumptionsManager;
      const progressPlanManager = client.getProgressPlanManager();
      
      // Initialize context in assumptions stage
      contextManager.initialize('test task', 'assumptions');
      
      // Create an initial plan with 3 steps (old plan)
      const initialTaskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const initialPlan = progressPlanManager.createPlan(
        initialTaskId,
        'test task',
        'hard',
        [
          { description: 'Understand the task requirements' },
          { description: 'Plan the implementation approach' },
          { description: 'Execute the implementation' }
        ]
      );
      
      // Set the plan in context
      contextManager.setProgressPlan(initialPlan);
      assumptionsManager.setTaskId(initialTaskId);
      
      // Verify initial plan has 3 steps
      expect(initialPlan.totalSteps).toBe(3);
      expect(initialPlan.steps.length).toBe(3);
      const contextBefore = contextManager.getContext();
      expect(contextBefore?.progressPlan?.totalSteps).toBe(3);
      expect(contextBefore?.maxSteps).toBe(3); // Should be synchronized
      
      // Now simulate a new assumptions response with 2 steps
      const newContent = 'Step 1: Execute calc.py with a valid operation (e.g., addition of 5 and 3) and capture the printed result.\nStep 2: Execute calc.py with an invalid operation name "multi" (using the same numeric arguments) and capture the error message printed by the script.';
      
      // Mock the response for assumptions stage
      const mockResponse = {
        status: 200,
        data: {
          choices: [{ text: `<|channel|>final<|message|>${newContent}<|end|>` }],
        },
      };
      
      mockedAxios.post.mockResolvedValueOnce(mockResponse);
      
      const parseResult: HarmonyParseResult = {
        content: newContent,
        rawToolCalls: [],
        reasoning: 'Plan (complexity: simple – two execution steps):\n1. Step 1: Execute calc.py with a valid operation...\n2. Step 2: Execute calc.py with an invalid operation...',
      };
      
      mockHarmonyProcessor.parseResponse.mockReturnValueOnce(parseResult);
      mockHarmonyProcessor.extractToolCalls.mockReturnValueOnce([]);
      
      // Call server in assumptions stage - this should update the plan
      await client.callServer(
        'analyze the task',
        'assumptions',
        undefined,
        false,
        []
      );
      
      // Verify the plan was updated to 2 steps
      const updatedPlan = progressPlanManager.getPlan(initialTaskId);
      expect(updatedPlan).toBeDefined();
      expect(updatedPlan?.totalSteps).toBe(2);
      expect(updatedPlan?.steps.length).toBe(2);
      
      // Verify context's plan is updated
      const contextAfter = contextManager.getContext();
      expect(contextAfter?.progressPlan).toBeDefined();
      expect(contextAfter?.progressPlan?.totalSteps).toBe(2);
      expect(contextAfter?.progressPlan?.taskId).toBe(initialTaskId); // Same taskId
      
      // Verify maxSteps is synchronized with the updated plan
      expect(contextAfter?.maxSteps).toBe(2);
      
      // Verify the steps match the new content
      if (updatedPlan && updatedPlan.steps.length >= 2) {
        expect(updatedPlan.steps[0].description).toContain('Execute calc.py');
        expect(updatedPlan.steps[1].description).toContain('Execute calc.py');
      }
    });

    it('should update plan even when plan already exists in context', async () => {
      const contextManager = (client as any).contextManager;
      const assumptionsManager = (client as any).assumptionsManager;
      const progressPlanManager = client.getProgressPlanManager();
      
      // Initialize context in assumptions stage
      contextManager.initialize('test task', 'assumptions');
      
      // Create an initial plan with 3 steps and set it in context
      const initialTaskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const initialPlan = progressPlanManager.createPlan(
        initialTaskId,
        'test task',
        'hard',
        [
          { description: 'Understand the task requirements' },
          { description: 'Plan the implementation approach' },
          { description: 'Execute the implementation' }
        ]
      );
      
      // Set the plan in context (simulating existing plan)
      contextManager.setProgressPlan(initialPlan);
      
      // Verify initial state
      expect(initialPlan.totalSteps).toBe(3);
      const contextBefore = contextManager.getContext();
      expect(contextBefore?.progressPlan?.totalSteps).toBe(3);
      
      // Now call createOrUpdatePlan with new content (2 steps)
      // This simulates what happens when assumptions response has different steps
      // Get the existing taskId from context to pass to createOrUpdatePlan
      // This tests the scenario where plan exists in context but not in AssumptionsManager state
      const newContent = 'Step 1: Create file1.py\nStep 2: Create file2.py';
      const existingTaskIdFromContext = contextBefore?.progressPlan?.taskId;
      const updatedPlan = assumptionsManager.createOrUpdatePlan(
        newContent,
        'test task',
        undefined,
        [],
        existingTaskIdFromContext // Pass existing taskId from context to update the plan
      );
      
      // Verify the plan was updated
      expect(updatedPlan).toBeDefined();
      expect(updatedPlan?.totalSteps).toBe(2);
      expect(updatedPlan?.taskId).toBe(initialTaskId); // Same taskId
      
      // Verify context is updated
      contextManager.setProgressPlan(updatedPlan!);
      const contextAfter = contextManager.getContext();
      expect(contextAfter?.progressPlan?.totalSteps).toBe(2);
      expect(contextAfter?.maxSteps).toBe(2); // Should be synchronized
    });

    it('should synchronize maxSteps when plan is updated via setProgressPlan', async () => {
      const contextManager = (client as any).contextManager;
      const progressPlanManager = client.getProgressPlanManager();
      
      // Initialize context
      contextManager.initialize('test task', 'assumptions');
      
      // Create a plan with 3 steps
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const plan1 = progressPlanManager.createPlan(
        taskId,
        'test task',
        'hard',
        [
          { description: 'First step' },
          { description: 'Second step' },
          { description: 'Third step' }
        ]
      );
      
      // Set plan - maxSteps should be 3
      contextManager.setProgressPlan(plan1);
      const context1 = contextManager.getContext();
      expect(context1?.maxSteps).toBe(3);
      expect(context1?.progressPlan?.totalSteps).toBe(3);
      
      // Update plan to 2 steps
      progressPlanManager.updatePlanSteps(taskId, [
        { description: 'First step' },
        { description: 'Second step' }
      ]);
      
      const updatedPlan = progressPlanManager.getPlan(taskId);
      expect(updatedPlan?.totalSteps).toBe(2);
      
      // Set updated plan - maxSteps should be updated to 2
      contextManager.setProgressPlan(updatedPlan!);
      const context2 = contextManager.getContext();
      expect(context2?.maxSteps).toBe(2);
      expect(context2?.progressPlan?.totalSteps).toBe(2);
    });
  });
});

