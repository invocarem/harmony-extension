import { StageDetector } from '../harmony/stageDetector';
import { StageStateMachine } from '../harmony/stageStateMachine';
import { ConversationContextManager } from '../harmony/conversationContext';
import { HarmonyAssistant } from '../extension';
import { HarmonyClient } from '../harmonyClient';
import { WebviewManager } from '../webviewManager';
import { ConversationManager } from '../conversationManager';
import { StageStateMachine as StageStateMachineType } from '../harmony/stageStateMachine';
import { FileContextExtractor } from '../utils/fileContextExtractor';
import { TemplateRenderer } from '../templateRenderer';
import { MCPManager } from '../mcpManager';
import { RulesManager } from '../rulesManager';
import { NativeToolsManager } from '../nativeToolManager';
import * as vscode from 'vscode';

// Mock VSCode
jest.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showQuickPick: jest.fn(),
    onDidChangeActiveTextEditor: jest.fn(() => ({
      dispose: jest.fn(),
    })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    findFiles: jest.fn(),
    asRelativePath: jest.fn((path: string) => path),
    onDidChangeConfiguration: jest.fn(() => ({
      dispose: jest.fn(),
    })),
  },
  commands: {
    registerCommand: jest.fn(),
  },
  WebviewView: jest.fn(),
  ViewColumn: {
    Beside: 2,
  },
  ProgressLocation: {
    Notification: 1,
  },
  CancellationToken: {},
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3,
  },
}));

// Mock dependencies
jest.mock('../harmonyClient');
jest.mock('../webviewManager');
jest.mock('../conversationManager');
jest.mock('../templateRenderer');
jest.mock('../mcpManager');
jest.mock('../rulesManager');
jest.mock('../nativeToolManager');
jest.mock('../config', () => ({
  loadConfig: jest.fn(() => ({
    serverUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 2048,
    mcpServers: [],
    rulesPaths: [],
    harmonyMode: true,
    verbose: false,
  })),
}));

jest.mock('../utils/fileContextExtractor', () => ({
  FileContextExtractor: {
    extractFileReferences: jest.fn(),
    formatFileContexts: jest.fn(),
  },
}));

jest.mock('../utils/responseCleaner', () => ({
  cleanVerboseResponse: jest.fn((content: string) => content),
}));

jest.mock('../utils/fileManager', () => ({
  FileManager: jest.fn().mockImplementation(() => ({
    detectAndCollectFiles: jest.fn().mockResolvedValue({
      detectedFiles: [],
      ambiguousMatches: [],
      diagnostics: {
        queryTokens: [],
        searchPatterns: [],
        searchResults: [],
        processingTime: 0,
      },
    }),
    formatForChatPrompt: jest.fn().mockReturnValue(''),
  })),
}));

describe('First Principles Thinking', () => {
  describe('StageDetector.detectFirstPrinciplesMode', () => {
    let stageDetector: StageDetector;
    let stageStateMachine: StageStateMachine;

    beforeEach(() => {
      stageStateMachine = new StageStateMachine();
      stageDetector = new StageDetector(stageStateMachine);
    });

    it('should detect @first-principles trigger', () => {
      expect(stageDetector.detectFirstPrinciplesMode('@first-principles analyze this')).toBe(true);
    });

    it('should detect @fpt trigger', () => {
      expect(stageDetector.detectFirstPrinciplesMode('@fpt help me')).toBe(true);
    });

    it('should detect @first-principles-thinking trigger', () => {
      expect(stageDetector.detectFirstPrinciplesMode('@first-principles-thinking')).toBe(true);
    });

    it('should detect "first principles thinking" phrase', () => {
      expect(stageDetector.detectFirstPrinciplesMode('Use first principles thinking')).toBe(true);
      expect(stageDetector.detectFirstPrinciplesMode('First principles thinking approach')).toBe(true);
    });

    it('should detect "break down to fundamentals" phrase', () => {
      expect(stageDetector.detectFirstPrinciplesMode('break down to fundamentals')).toBe(true);
      expect(stageDetector.detectFirstPrinciplesMode('Break down to fundamentals please')).toBe(true);
    });

    it('should detect "strip assumptions" phrase', () => {
      expect(stageDetector.detectFirstPrinciplesMode('strip assumptions')).toBe(true);
      expect(stageDetector.detectFirstPrinciplesMode('Strip assumptions from this')).toBe(true);
    });

    it('should detect "fundamental analysis" phrase', () => {
      expect(stageDetector.detectFirstPrinciplesMode('fundamental analysis')).toBe(true);
      expect(stageDetector.detectFirstPrinciplesMode('Do a fundamental analysis')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(stageDetector.detectFirstPrinciplesMode('@FIRST-PRINCIPLES')).toBe(true);
      expect(stageDetector.detectFirstPrinciplesMode('FIRST PRINCIPLES THINKING')).toBe(true);
    });

    it('should return false for normal messages', () => {
      expect(stageDetector.detectFirstPrinciplesMode('how do I create a file?')).toBe(false);
      expect(stageDetector.detectFirstPrinciplesMode('hello')).toBe(false);
      expect(stageDetector.detectFirstPrinciplesMode('implement this feature')).toBe(false);
    });
  });

  describe('ConversationContextManager - First Principles State', () => {
    let contextManager: ConversationContextManager;

    beforeEach(() => {
      contextManager = new ConversationContextManager();
      contextManager.initialize('test prompt', 'chat');
    });

    it('should initialize first-principles mode as disabled by default', () => {
      expect(contextManager.isFirstPrinciplesMode()).toBe(false);
      expect(contextManager.getFirstPrinciplesState()).toBeUndefined();
    });

    it('should enable first-principles mode', () => {
      contextManager.setFirstPrinciplesMode(true);
      
      expect(contextManager.isFirstPrinciplesMode()).toBe(true);
      const state = contextManager.getFirstPrinciplesState();
      expect(state).toBeDefined();
      expect(state?.questionsAsked).toBe(0);
      expect(state?.questionsRemaining).toBe(12);
      expect(state?.answers).toEqual({});
      expect(state?.synthesisGenerated).toBe(false);
    });

    it('should disable first-principles mode', () => {
      contextManager.setFirstPrinciplesMode(true);
      expect(contextManager.isFirstPrinciplesMode()).toBe(true);
      
      contextManager.setFirstPrinciplesMode(false);
      expect(contextManager.isFirstPrinciplesMode()).toBe(false);
      expect(contextManager.getFirstPrinciplesState()).toBeUndefined();
    });

    it('should record answers to questions', () => {
      contextManager.setFirstPrinciplesMode(true);
      
      contextManager.recordFirstPrinciplesAnswer(1, 'answer 1');
      contextManager.recordFirstPrinciplesAnswer(2, 'answer 2');
      
      const state = contextManager.getFirstPrinciplesState();
      expect(state?.answers[1]).toBe('answer 1');
      expect(state?.answers[2]).toBe('answer 2');
      expect(state?.questionsAsked).toBe(2);
      expect(state?.questionsRemaining).toBe(10);
    });

    it('should update questionsAsked to highest question number', () => {
      contextManager.setFirstPrinciplesMode(true);
      
      contextManager.recordFirstPrinciplesAnswer(5, 'answer 5');
      contextManager.recordFirstPrinciplesAnswer(3, 'answer 3');
      
      const state = contextManager.getFirstPrinciplesState();
      expect(state?.questionsAsked).toBe(5);
      expect(state?.questionsRemaining).toBe(7);
    });

    it('should mark synthesis as generated', () => {
      contextManager.setFirstPrinciplesMode(true);
      
      const synthesis = {
        coreTruths: ['Truth 1', 'Truth 2'],
        falseAssumptions: ['Assumption 1'],
        reconstruction: 'Reconstruction text',
        actionableInsights: ['Insight 1'],
      };
      
      contextManager.markSynthesisGenerated(synthesis);
      
      const state = contextManager.getFirstPrinciplesState();
      expect(state?.synthesisGenerated).toBe(true);
      expect(state?.synthesis).toEqual(synthesis);
    });

    it('should preserve state when disabling and re-enabling', () => {
      contextManager.setFirstPrinciplesMode(true);
      contextManager.recordFirstPrinciplesAnswer(1, 'answer 1');
      
      const synthesis = {
        coreTruths: ['Truth 1'],
        falseAssumptions: [],
        reconstruction: 'Reconstruction',
        actionableInsights: [],
      };
      contextManager.markSynthesisGenerated(synthesis);
      
      // Disable and re-enable
      contextManager.setFirstPrinciplesMode(false);
      contextManager.setFirstPrinciplesMode(true);
      
      // State should be reset (new session)
      const state = contextManager.getFirstPrinciplesState();
      expect(state?.questionsAsked).toBe(0);
      expect(state?.synthesisGenerated).toBe(false);
    });
  });

  describe('HarmonyAssistant - First Principles Integration', () => {
    let assistant: HarmonyAssistant;
    let mockContext: vscode.ExtensionContext;
    let mockHarmonyClient: jest.Mocked<HarmonyClient>;
    let mockWebviewManager: jest.Mocked<WebviewManager>;
    let mockConversationManager: jest.Mocked<ConversationManager>;
    let mockStageStateMachine: jest.Mocked<StageStateMachineType>;
    let mockTemplateRenderer: jest.Mocked<TemplateRenderer>;
    let mockMCPManager: jest.Mocked<MCPManager>;
    let mockRulesManager: jest.Mocked<RulesManager>;
    let mockNativeToolsManager: jest.Mocked<NativeToolsManager>;

    beforeEach(() => {
      jest.clearAllMocks();

      mockContext = {
        extensionPath: '/extension',
        subscriptions: [],
        workspaceState: {} as any,
        globalState: {} as any,
        secrets: {} as any,
        extensionUri: {} as any,
        extensionMode: 1,
        storagePath: '/storage',
        globalStoragePath: '/global-storage',
        logPath: '/log',
        extension: {} as any,
        environmentVariableCollection: {} as any,
        asAbsolutePath: jest.fn((path: string) => `/extension/${path}`),
        storageUri: {} as any,
        globalStorageUri: {} as any,
        extensionRuntime: {} as any,
      } as any;

      const mockChatManager = {
        addQuery: jest.fn(),
        addQueryWithFiles: jest.fn(),
        extractRelatedFiles: jest.fn().mockReturnValue([]),
        getAggregatedPrompt: jest.fn().mockReturnValue(''),
        updateProblemSummary: jest.fn(),
        updateProblemSummaryFromResponse: jest.fn(),
        hasContent: jest.fn().mockReturnValue(false),
        getAllQueries: jest.fn().mockReturnValue([]),
        getMeaningfulQueries: jest.fn().mockReturnValue([]),
        getAllRelatedFiles: jest.fn().mockReturnValue([]),
        getProblemSummary: jest.fn().mockReturnValue(undefined),
        clear: jest.fn(),
        initialize: jest.fn(),
        exportForTransition: jest.fn().mockReturnValue({
          queries: [],
          aggregatedPrompt: '',
          referredFiles: [],
        }),
        getState: jest.fn().mockReturnValue(null),
      };

      mockHarmonyClient = {
        getCurrentStage: jest.fn().mockReturnValue('chat'),
        getChatManager: jest.fn().mockReturnValue(mockChatManager),
        callServer: jest.fn().mockResolvedValue({
          content: 'Test response',
          reasoning: undefined,
          commentary: undefined,
          final: undefined,
          toolCalls: undefined,
          isContinuation: false,
          verboseInfo: {
            stage: 'chat',
          },
        }),
        shouldActivateFirstPrinciples: jest.fn().mockReturnValue(false),
        setFirstPrinciplesMode: jest.fn(),
        isFirstPrinciplesMode: jest.fn().mockReturnValue(false),
        getContext: jest.fn().mockReturnValue(null),
      } as any;

      mockWebviewManager = {
        openChat: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        sendFileList: jest.fn().mockResolvedValue(undefined),
        sendCodeContext: jest.fn().mockResolvedValue(undefined),
        insertTextIntoInput: jest.fn().mockResolvedValue(undefined),
        updateContextSummary: jest.fn().mockResolvedValue(undefined),
        registerMessageHandler: jest.fn(),
        setOnPanelDispose: jest.fn(),
        resolveWebviewView: jest.fn(),
        getWebviewManager: jest.fn(),
        dispose: jest.fn(),
      } as any;

      mockConversationManager = {
        addMessage: jest.fn(),
        getHistory: jest.fn().mockReturnValue([]),
        getHistoryForTemplate: jest.fn().mockReturnValue([]),
        getLength: jest.fn().mockReturnValue(0),
        clear: jest.fn(),
      } as any;

      mockStageStateMachine = {
        determineNextStage: jest.fn().mockReturnValue('chat'),
      } as any;

      mockTemplateRenderer = {
        applyTemplate: jest.fn().mockResolvedValue('rendered template'),
      } as any;

      mockMCPManager = {
        initializeServers: jest.fn().mockResolvedValue(undefined),
        getAllTools: jest.fn().mockReturnValue([]),
        dispose: jest.fn(),
      } as any;

      mockRulesManager = {
        loadRules: jest.fn().mockResolvedValue(undefined),
        getAllRules: jest.fn().mockReturnValue([]),
        dispose: jest.fn(),
      } as any;

      mockNativeToolsManager = {
        callTool: jest.fn(),
        getAvailableTools: jest.fn().mockReturnValue([]),
      } as any;

      (FileContextExtractor.extractFileReferences as jest.Mock).mockResolvedValue({
        cleanMessage: 'test message',
        fileContexts: [],
      });
      (FileContextExtractor.formatFileContexts as jest.Mock).mockReturnValue('');

      assistant = new HarmonyAssistant(mockContext);
      (assistant as any).harmonyClient = mockHarmonyClient;
      (assistant as any).webviewManager = mockWebviewManager;
      (assistant as any).conversationManager = mockConversationManager;
      (assistant as any).stageStateMachine = mockStageStateMachine;
      (assistant as any).templateRenderer = mockTemplateRenderer;
      (assistant as any).mcpManager = mockMCPManager;
      (assistant as any).rulesManager = mockRulesManager;
      (assistant as any).nativeToolsManager = mockNativeToolsManager;
    });

    describe('First Principles Mode Activation', () => {
      it('should activate first-principles mode when triggered in chat stage', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('chat');
        mockHarmonyClient.shouldActivateFirstPrinciples.mockReturnValue(true);
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(false);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('chat'));

        await assistant['handleChatMessage']('@first-principles analyze this');

        expect(mockHarmonyClient.shouldActivateFirstPrinciples).toHaveBeenCalled();
        expect(mockHarmonyClient.setFirstPrinciplesMode).toHaveBeenCalledWith(true);
      });

      it('should not activate if already active', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('assumptions');
        mockHarmonyClient.shouldActivateFirstPrinciples.mockReturnValue(true);
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(true);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('assumptions'));

        await assistant['handleChatMessage']('@first-principles analyze this');

        // Should check but not activate since already active
        expect(mockHarmonyClient.shouldActivateFirstPrinciples).toHaveBeenCalled();
        expect(mockHarmonyClient.setFirstPrinciplesMode).not.toHaveBeenCalledWith(true);
      });

      it('should not activate if not triggered', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('chat');
        mockHarmonyClient.shouldActivateFirstPrinciples.mockReturnValue(false);

        await assistant['handleChatMessage']('normal message');

        expect(mockHarmonyClient.setFirstPrinciplesMode).not.toHaveBeenCalled();
      });

      it('should deactivate first-principles mode when leaving chat stage', async () => {
        mockHarmonyClient.getCurrentStage
          .mockReturnValueOnce('chat')
          .mockReturnValue('assumptions');
        mockHarmonyClient.isFirstPrinciplesMode
          .mockReturnValueOnce(true)
          .mockReturnValue(true);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('assumptions'));

        await assistant['handleChatMessage']('move to assumptions');

        expect(mockHarmonyClient.setFirstPrinciplesMode).toHaveBeenCalledWith(false);
      });

      it('should not deactivate if not active', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('chat');
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(false);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('chat'));

        await assistant['handleChatMessage']('hello');

        // Should check but not deactivate since not active
        expect(mockHarmonyClient.isFirstPrinciplesMode).toHaveBeenCalled();
        expect(mockHarmonyClient.setFirstPrinciplesMode).not.toHaveBeenCalledWith(false);
      });
    });

    describe('Template Selection with First Principles', () => {
      it('should use assumptions template even if mode was active when entering assumptions stage', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('assumptions');
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(true);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('assumptions'));

        await assistant['handleChatMessage']('continue analysis');

        const callArgs = mockHarmonyClient.callServer.mock.calls[0];
        expect(callArgs[1]).toBe('assumptions');
      });

      it('should use assumptions template when mode is not active in assumptions stage', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('assumptions');
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(false);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('assumptions'));

        await assistant['handleChatMessage']('analyze this');

        const callArgs = mockHarmonyClient.callServer.mock.calls[0];
        expect(callArgs[1]).toBe('assumptions');
      });

      it('should use chat template when in chat stage regardless of first-principles mode', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('chat');
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(true);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('chat'));

        await assistant['handleChatMessage']('hello');

        const callArgs = mockHarmonyClient.callServer.mock.calls[0];
        expect(callArgs[1]).toBe('chat');
      });

      it('should use implementation template when in implementation stage', async () => {
        mockHarmonyClient.getCurrentStage.mockReturnValue('implementation');
        mockHarmonyClient.isFirstPrinciplesMode.mockReturnValue(true);
        mockStageStateMachine.determineNextStage.mockReturnValue(Promise.resolve('implementation'));

        await assistant['handleChatMessage']('create the file');

        const callArgs = mockHarmonyClient.callServer.mock.calls[0];
        expect(callArgs[1]).toBe('implementation');
      });
    });

    // No persistence tests in assumptions stage because first-principles is chat-only
  });
});

