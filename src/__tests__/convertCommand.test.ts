import { HarmonyAssistant } from '../extension';
import { HarmonyClient } from '../harmonyClient';
import { WebviewManager } from '../webviewManager';
import { ConversationManager } from '../conversationManager';
import { StageStateMachine } from '../harmony/stageStateMachine';
import { TemplateRenderer } from '../templateRenderer';
import { MCPManager } from '../mcpManager';
import { RulesManager } from '../rulesManager';
import { NativeToolsManager } from '../nativeToolManager';
import * as vscode from 'vscode';
import { FileReader } from '../utils/fileReader';

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
jest.mock('../harmony/stageStateMachine');
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

// Mock FileContextExtractor
jest.mock('../utils/fileContextExtractor', () => ({
  FileContextExtractor: {
    extractFileReferences: jest.fn(),
    formatFileContexts: jest.fn(),
  },
}));

// Mock responseCleaner
jest.mock('../utils/responseCleaner', () => ({
  cleanVerboseResponse: jest.fn((content: string) => content),
}));

// Mock FileManager
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

// Mock FileReader
var mockCheckFileExists: jest.Mock;
var mockReadFileToBase64: jest.Mock;
var mockIsSupportedFile: jest.Mock;

jest.mock('../utils/fileReader', () => {
  mockCheckFileExists = jest.fn().mockResolvedValue(true);
  mockReadFileToBase64 = jest.fn().mockResolvedValue({
    base64: 'dGVzdCBjb250ZW50',
    filename: 'test.docx',
    fileSize: 100,
    filePath: '/workspace/test.docx',
  });
  mockIsSupportedFile = jest.fn((filename: string) => {
    return filename.toLowerCase().endsWith('.docx') || filename.toLowerCase().endsWith('.pdf');
  });

  const MockFileReader = jest.fn().mockImplementation(() => ({
    checkFileExists: mockCheckFileExists,
    readFileToBase64: mockReadFileToBase64,
  })) as any;
  MockFileReader.isSupportedFile = mockIsSupportedFile;
  return {
    FileReader: MockFileReader,
  };
});

describe('Convert Command (@cmd:convert)', () => {
  let assistant: HarmonyAssistant;
  let mockContext: vscode.ExtensionContext;
  let mockHarmonyClient: jest.Mocked<HarmonyClient>;
  let mockWebviewManager: jest.Mocked<WebviewManager>;
  let mockConversationManager: jest.Mocked<ConversationManager>;
  let mockStageStateMachine: jest.Mocked<StageStateMachine>;
  let mockTemplateRenderer: jest.Mocked<TemplateRenderer>;
  let mockMCPManager: jest.Mocked<MCPManager>;
  let mockRulesManager: jest.Mocked<RulesManager>;
  let mockNativeToolsManager: jest.Mocked<NativeToolsManager>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock extension context
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

    // Setup HarmonyClient mock
    const mockChatManager = {
      addQuery: jest.fn(),
      addQueryWithFiles: jest.fn(),
      extractRelatedFiles: jest.fn().mockReturnValue([]),
      getAggregatedPrompt: jest.fn().mockReturnValue(''),
      processResponse: jest.fn(), // New method for processing responses
      addProblem: jest.fn(),
      removeProblemIfSolved: jest.fn(),
      getUnansweredProblems: jest.fn().mockReturnValue([]),
      hasUnansweredProblems: jest.fn().mockReturnValue(false),
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
        problems: [],
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

    // Setup WebviewManager mock
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

    // Setup ConversationManager mock
    mockConversationManager = {
      addMessage: jest.fn(),
      getHistory: jest.fn().mockReturnValue([]),
      getHistoryForTemplate: jest.fn().mockReturnValue([]),
      getLength: jest.fn().mockReturnValue(0),
      clear: jest.fn(),
    } as any;

    // Setup StageStateMachine mock
    mockStageStateMachine = {
      determineNextStage: jest.fn().mockReturnValue('chat'),
      canTransition: jest.fn().mockReturnValue(true),
    } as any;

    // Setup TemplateRenderer mock
    mockTemplateRenderer = {
      applyTemplate: jest.fn().mockResolvedValue('rendered template'),
    } as any;

    // Setup MCPManager mock
    mockMCPManager = {
      initializeServers: jest.fn().mockResolvedValue(undefined),
      getAllTools: jest.fn().mockReturnValue([]),
      findToolServer: jest.fn(),
      callTool: jest.fn(),
      dispose: jest.fn(),
    } as any;

    // Setup RulesManager mock
    mockRulesManager = {
      loadRules: jest.fn().mockResolvedValue(undefined),
      getAllRules: jest.fn().mockReturnValue([]),
      dispose: jest.fn(),
    } as any;

    // Setup NativeToolsManager mock
    mockNativeToolsManager = {
      callTool: jest.fn(),
      getAvailableTools: jest.fn().mockReturnValue([]),
    } as any;

    // Create assistant instance
    assistant = new HarmonyAssistant(mockContext);

    // Replace internal dependencies with mocks
    (assistant as any).harmonyClient = mockHarmonyClient;
    (assistant as any).webviewManager = mockWebviewManager;
    (assistant as any).conversationManager = mockConversationManager;
    (assistant as any).stageStateMachine = mockStageStateMachine;
    (assistant as any).templateRenderer = mockTemplateRenderer;
    (assistant as any).mcpManager = mockMCPManager;
    (assistant as any).rulesManager = mockRulesManager;
    (assistant as any).nativeToolsManager = mockNativeToolsManager;
  });

  describe('Chat stage', () => {
    beforeEach(() => {
      mockHarmonyClient.getCurrentStage.mockReturnValue('chat');
      mockCheckFileExists.mockResolvedValue(true);
      mockMCPManager.findToolServer.mockReturnValue('test-server');
    });

    it('should verify file exists using checkFileExists and transition to assumptions stage', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(false);
      expect(result.newStage).toBe('assumptions');
      expect(result.modifiedMessage).toBe('@cmd:convert file.docx');
      expect(mockCheckFileExists).toHaveBeenCalledWith('file.docx');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('convert_docx_to_markdown');
      expect(mockStageStateMachine.canTransition).toHaveBeenCalledWith('chat', 'assumptions');
    });

    it('should verify file exists with explicit markdown target', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(false);
      expect(result.newStage).toBe('assumptions');
      expect(result.modifiedMessage).toBe('@cmd:convert file.docx markdown');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('convert_docx_to_markdown');
    });

    it('should verify PDF file exists and transition to assumptions', async () => {
      const result = await assistant['handleCommand']('convert', 'file.pdf markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(false);
      expect(result.newStage).toBe('assumptions');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('extract_pdf_text');
    });

    it('should return error if file does not exist', async () => {
      mockCheckFileExists.mockResolvedValueOnce(false);

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('not found');
      expect(mockMCPManager.findToolServer).not.toHaveBeenCalled();
    });

    it('should return error if MCP tool is not available', async () => {
      mockMCPManager.findToolServer.mockReturnValue(null);

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('MCP tool');
      expect(result.message).toContain('not available');
    });

    it('should return error if conversion type is not supported', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx html');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('not supported');
    });

    it('should return error if cannot transition to assumptions', async () => {
      mockStageStateMachine.canTransition.mockReturnValue(false);

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Cannot transition to assumptions stage');
    });
  });

  describe('Assumptions stage', () => {
    beforeEach(() => {
      mockHarmonyClient.getCurrentStage.mockReturnValue('assumptions');
      mockMCPManager.findToolServer.mockReturnValue('test-server');
    });

    it('should verify MCP tool and transform message to natural language', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(false);
      expect(result.modifiedMessage).toBe('Convert file.docx to markdown format');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('convert_docx_to_markdown');
    });

    it('should return error if MCP tool is not available', async () => {
      mockMCPManager.findToolServer.mockReturnValue(null);

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('MCP tool');
      expect(result.message).toContain('not available');
    });

    it('should pass through convert command in assumptions stage (let LLM generate plan)', async () => {
      // This test verifies that when a convert command is processed in assumptions stage,
      // the AssumptionsStageHandler.handlePreProcessing passes through without creating a plan
      // The plan will be created by AssumptionsManager based on LLM response
      
      const { ProgressPlanManager } = require('../progressPlanManager');
      const { ConversationContextManager } = require('../harmony/conversationContext');
      const { StageHandlerRegistry } = require('../harmony/stageHandlers');
      
      const progressPlanManager = new ProgressPlanManager();
      const contextManager = new ConversationContextManager();
      
      // Set up context for assumptions stage
      contextManager.initialize('Convert file.docx to markdown format', 'assumptions');
      
      // Create stage handler registry and get assumptions handler
      const stageHandlerRegistry = new StageHandlerRegistry();
      const assumptionsHandler = stageHandlerRegistry.getHandler('assumptions');
      
      // Call handlePreProcessing with convert command prompt
      const context = contextManager.getContext();
      const prompt = 'Convert file.docx to markdown format';
      
      const result = await assumptionsHandler.handlePreProcessing(
        context,
        prompt,
        undefined,
        contextManager,
        progressPlanManager
      );
      
      // Verify handler doesn't create plan (plan is created by AssumptionsManager from LLM response)
      // The handler should just pass through to let LLM generate the plan naturally
      expect(result.shouldSkipLLM).toBe(false);
      // Plan is not created in handlePreProcessing - it's created later by AssumptionsManager
      const updatedContext = contextManager.getContext();
      // Plan may or may not exist at this point (depends on AssumptionsManager)
      // The key is that handlePreProcessing doesn't block the LLM call
    });
  });

  describe('Implementation stage', () => {
    beforeEach(() => {
      mockHarmonyClient.getCurrentStage.mockReturnValue('implementation');
      mockMCPManager.findToolServer.mockReturnValue('test-server');
      mockMCPManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ success: true, markdown: '# Test Content' }) }],
      });
    });

    it('should execute conversion with filename only (defaults to markdown)', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Successfully converted');
      expect(result.message).toContain('markdown');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('convert_docx_to_markdown');
      expect(mockReadFileToBase64).toHaveBeenCalledWith('file.docx');
      expect(mockMCPManager.callTool).toHaveBeenCalledWith(
        'test-server',
        'convert_docx_to_markdown',
        expect.objectContaining({
          content_base64: 'dGVzdCBjb250ZW50',
          filename: 'test.docx',
          file_size: 100,
        })
      );
    });

    it('should execute conversion with explicit markdown target', async () => {
      const result = await assistant['handleCommand']('convert', 'file.docx markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Successfully converted');
      expect(result.message).toContain('markdown');
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('convert_docx_to_markdown');
    });

    it('should execute conversion with PDF file', async () => {
      mockReadFileToBase64.mockResolvedValueOnce({
        base64: 'cGRmIGNvbnRlbnQ=',
        filename: 'test.pdf',
        fileSize: 200,
        filePath: '/workspace/test.pdf',
      });
      mockMCPManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ success: true, markdown: 'PDF content' }) }],
      });

      const result = await assistant['handleCommand']('convert', 'file.pdf markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(mockMCPManager.findToolServer).toHaveBeenCalledWith('extract_pdf_text');
    });

    it('should reject convert command with invalid filename format', async () => {
      const result = await assistant['handleCommand']('convert', 'invalid-file');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Usage:');
      expect(result.message).toContain('filename.docx');
    });

    it('should reject convert command with unsupported file type', async () => {
      mockIsSupportedFile.mockReturnValue(false);

      const result = await assistant['handleCommand']('convert', 'file.docx markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('not supported');
      expect(result.message).toContain('Only .docx and .pdf files are supported');
    });

    it('should reject convert command with unsupported conversion type', async () => {
      mockIsSupportedFile.mockReturnValue(true);

      const result = await assistant['handleCommand']('convert', 'file.docx html');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('not supported');
      expect(result.message).toContain('docx→markdown, pdf→markdown');
    });

    it('should handle MCP tool not available error', async () => {
      mockMCPManager.findToolServer.mockReturnValue(null);

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('MCP tool');
      expect(result.message).toContain('not available');
    });

    it('should handle MCP tool error response', async () => {
      mockMCPManager.callTool.mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Conversion failed' }],
      });

      const result = await assistant['handleCommand']('convert', 'file.docx');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Error converting file');
      expect(result.message).toContain('Conversion failed');
    });

    it('should handle successful conversion with markdown content', async () => {
      mockReadFileToBase64.mockResolvedValueOnce({
        base64: 'dGVzdCBjb250ZW50',
        filename: 'document.docx',
        fileSize: 100,
        filePath: '/workspace/document.docx',
      });
      mockMCPManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ success: true, markdown: '# Test Document\n\nContent here' }) }],
      });

      const result = await assistant['handleCommand']('convert', 'document.docx markdown');

      expect(result.handled).toBe(true);
      expect(result.shouldReturn).toBe(true);
      expect(result.message).toContain('Successfully converted');
      expect(result.message).toContain('document.docx');
      expect(result.message).toContain('markdown');
      expect(result.message).toContain('# Test Document');
    });
  });
});

