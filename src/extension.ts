import * as vscode from "vscode";
import * as path from "path";
import { loadConfig, LlamaConfig } from "./config";
import { HarmonyClient } from "./harmonyClient";
import { TemplateRenderer } from "./templateRenderer";
import { WebviewManager, WebviewMessage } from "./webviewManager";
import { CodeActions } from "./codeActions";
import { MCPManager } from "./mcpManager";
import { RulesManager } from "./rulesManager";
import { NativeToolsManager, NativeToolResult } from "./nativeToolManager";
import { ConversationManager, ChatMessage } from "./conversationManager";
import { FileContextExtractor } from "./utils/fileContextExtractor";
import { FileManager } from "./utils/fileManager";
import { cleanVerboseResponse } from "./utils/responseCleaner";
import { StageStateMachine, WorkflowStage } from "./harmony/stageStateMachine";
import { FileExtractionResult, VerboseInfoBuilder, VerboseInfoFormatter } from "./utils/verboseInfo";
import { CommandExtractor } from "./utils/commandExtractor";
import { ConfirmationManager } from "./harmony/confirmationManager";

export class HarmonyAssistant {
  private webviewManager: WebviewManager;
  private harmonyClient: HarmonyClient;
  private templateRenderer: TemplateRenderer;
  private codeActions: CodeActions;
  private config: LlamaConfig;
  private mcpManager: MCPManager;
  private rulesManager: RulesManager;
  private nativeToolsManager: NativeToolsManager;
  private conversationManager: ConversationManager;
  private stageStateMachine: StageStateMachine;
  private fileManager: FileManager;
  private confirmationManager: ConfirmationManager;
  private lastActiveTextEditor: vscode.TextEditor | undefined;
  private editorChangeDisposable: vscode.Disposable | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.config = loadConfig();
    this.webviewManager = new WebviewManager(context);
    this.mcpManager = new MCPManager();
    this.rulesManager = new RulesManager();
    this.nativeToolsManager = new NativeToolsManager();
    this.conversationManager = new ConversationManager();
    this.stageStateMachine = new StageStateMachine();
    this.fileManager = new FileManager();
    this.confirmationManager = new ConfirmationManager();
    this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
    
    // Set up callback to send verboseInfo to webview before stage transitions
    this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
      await this.webviewManager.sendMessage({
        content: '', // Empty content for pre-transition verbose info
        verboseInfo: verboseInfo
      });
    });
    
    this.templateRenderer = new TemplateRenderer(context, this.config.harmonyMode);
    this.codeActions = new CodeActions(
      this.harmonyClient,
      this.templateRenderer
    );

    // Clear conversation history when webview panel is disposed (chat window closed)
    this.webviewManager.setOnPanelDispose(() => {
      this.clearConversationHistory();
      // Dispose editor change listener
      if (this.editorChangeDisposable) {
        this.editorChangeDisposable.dispose();
        this.editorChangeDisposable = undefined;
      }
    });

    this.initializeMCP();
    this.initializeRules();
    this.setupWebviewHandlers();
    this.setupConfigWatcher(context);
  }

  private async initializeMCP(): Promise<void> {
    if (this.config.mcpServers.length > 0) {
      console.log(`[MCP] Initializing ${this.config.mcpServers.length} MCP server(s)`);
      try {
        await this.mcpManager.initializeServers(this.config.mcpServers);
        const tools = this.mcpManager.getAllTools();
        console.log(`[MCP] Initialized with ${tools.length} available tool(s)`);
      } catch (error) {
        console.error("[MCP] Failed to initialize MCP servers:", error);
      }
    }
  }

  private async initializeRules(): Promise<void> {
    if (this.config.rulesPaths.length > 0) {
      console.log(`[Rules] Loading ${this.config.rulesPaths.length} rule file(s)`);
      try {
        await this.rulesManager.loadRules(this.config.rulesPaths);
        const rules = this.rulesManager.getAllRules();
        console.log(`[Rules] Loaded ${rules.length} rule(s)`);
      } catch (error) {
        console.error("[Rules] Failed to initialize rules:", error);
      }
    }
  }

  private setupConfigWatcher(context: vscode.ExtensionContext): void {
    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("harmony.mcpServers")) {
        console.log("[MCP] MCP servers configuration changed, reinitializing...");
        this.config = loadConfig();
        await this.initializeMCP();
      } else if (event.affectsConfiguration("harmony.rulesPaths")) {
        console.log("[Rules] Rules paths configuration changed, reloading...");
        this.config = loadConfig();
        await this.initializeRules();
        this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
        this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
          await this.webviewManager.sendMessage({
            content: '',
            verboseInfo: verboseInfo
          });
        });
        this.codeActions = new CodeActions(
          this.harmonyClient,
          this.templateRenderer
        );
      } else if (event.affectsConfiguration("harmony.harmonyMode")) {
        // Reload config and recreate components that depend on harmonyMode
        console.log("[Harmony] Harmony mode configuration changed, reinitializing...");
        this.config = loadConfig();
        this.templateRenderer = new TemplateRenderer(context, this.config.harmonyMode);
        this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
        this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
          await this.webviewManager.sendMessage({
            content: '',
            verboseInfo: verboseInfo
          });
        });
        this.codeActions = new CodeActions(
          this.harmonyClient,
          this.templateRenderer
        );
      } else if (event.affectsConfiguration("harmony")) {
        // Reload other config
        this.config = loadConfig();
        this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
        this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
          await this.webviewManager.sendMessage({
            content: '',
            verboseInfo: verboseInfo
          });
        });
        this.codeActions = new CodeActions(
          this.harmonyClient,
          this.templateRenderer
        );
      }
    });
    context.subscriptions.push(configWatcher);
  }

  private setupWebviewHandlers(): void {
    // Test handler
    this.webviewManager.registerMessageHandler("test", (message) => {
      console.log(
        `[DEBUG] Received test message from webview:`,
        message.text
      );
      // Send a test response back
      this.webviewManager.sendMessage({
        content: "✅ All set! Feel free to start a conversation.",
      });
    });

    // Send message handler
    this.webviewManager.registerMessageHandler("sendMessage", async (message) => {
      console.log(
        `[DEBUG] Handling sendMessage with text:`,
        message.text?.substring(0, 100)
      );
      
      // Extract file references to get file list
      const { fileContexts } = await FileContextExtractor.extractFileReferences(message.text || "");
      
      // Enhance contextSummary with rules, MCP tools count, and files
      const contextSummary = message.contextSummary || {};
      
      // Get rules count
      const rules = this.rulesManager.getAllRules();
      contextSummary.rulesCount = rules.length;
      
      // Get MCP tools count
      const mcpTools = this.mcpManager.getAllTools();
      contextSummary.mcpToolsCount = mcpTools.length;
      
      // Add file paths (using relative paths for display)
      if (fileContexts.length > 0) {
        contextSummary.files = fileContexts.map(fc => {
          try {
            return vscode.workspace.asRelativePath(fc.path, false);
          } catch {
            return path.basename(fc.path);
          }
        });
      }
      
      // Send enhanced contextSummary back to webview
      await this.webviewManager.updateContextSummary(contextSummary);
      
      await this.handleChatMessage(message.text || "");
    });

    // Get code context handler
    this.webviewManager.registerMessageHandler("getCodeContext", async () => {
      console.log(`[DEBUG] Handling getCodeContext`);
      await this.sendCodeContext();
    });

    // Request file list for autocomplete handler
    this.webviewManager.registerMessageHandler("requestFileList", async (message: WebviewMessage) => {
      console.log(`[DEBUG] Handling requestFileList`);
      const searchTerm = (message as any).searchTerm || '';
      await this.sendFileList(searchTerm);
    });

    // Insert file reference handler
    this.webviewManager.registerMessageHandler("insertFileReference", async () => {
      console.log(`[DEBUG] Handling insertFileReference`);
      await this.showFilePicker();
    });
  }

  public async openChat(): Promise<void> {
    // Track the last active text editor before opening the webview
    // This ensures we can still access the source file even when webview is active
    const currentEditor = vscode.window.activeTextEditor;
    if (currentEditor && currentEditor.document.uri.scheme !== 'vscode-webview') {
      this.lastActiveTextEditor = currentEditor;
    }
    
    // Dispose existing listener if any
    if (this.editorChangeDisposable) {
      this.editorChangeDisposable.dispose();
    }
    
    // Listen for editor changes to keep track of the last text editor
    this.editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      // Only update if it's a text editor (not the webview)
      if (editor && editor.document.uri.scheme !== 'vscode-webview') {
        this.lastActiveTextEditor = editor;
      }
    });
    
    await this.webviewManager.openChat();
  }

  public getWebviewManager(): WebviewManager {
    return this.webviewManager;
  }

  private async handleChatMessage(text: string): Promise<void> {
    console.log(
      `[DEBUG] handleChatMessage called with text:`,
      text?.substring(0, 100)
    );

    try {
      // STEP 1: Extract @cmd: commands FIRST (before file extraction)
      const { command, cleanMessage: messageAfterCommand } = CommandExtractor.extractCommand(text);
      
      let commandHandled = false;
      let newStage: WorkflowStage | undefined;
      
      if (command) {
        console.log(`[CommandExtractor] Detected command: ${command.command}`);
        const commandResult = await this.handleCommand(command.command, messageAfterCommand);
        
        if (commandResult.handled) {
          commandHandled = true;
          newStage = commandResult.newStage;
          
          if (commandResult.shouldReturn) {
            // Command was handled and we should return early (e.g., error message)
            if (commandResult.message) {
              await this.webviewManager.sendMessage({
                content: commandResult.message,
              });
            }
            return;
          }
          
          // Use cleaned message for remaining processing
          // For next_step command, remaining text should be ignored (command is self-contained)
          if (command.command === 'next_step') {
            text = '';  // Empty message - ImplementationStageHandler will detect this as next_step request
            console.log(`[CommandExtractor] next_step command - ignoring remaining text, using empty prompt`);
          } else {
            text = messageAfterCommand;
          }
          
          // If stage was changed, log it
          if (newStage) {
            console.log(`[CommandExtractor] Command changed stage to: ${newStage}`);
          }
        }
      }
      
      // STEP 2: Continue with existing flow (FileContextExtractor, etc.)
      // Extract file references and clean the message (explicit @file syntax)
      const { cleanMessage, fileContexts } = await FileContextExtractor.extractFileReferences(text);
      
      let finalMessage = cleanMessage;
      let fileContextText = '';
      
      // Add explicit file contexts from @file syntax
      if (fileContexts.length > 0) {
        fileContextText = FileContextExtractor.formatFileContexts(fileContexts);
        console.log(`[Harmony] Added ${fileContexts.length} explicit file context(s) to message`);
      }

      // At chat stage, use FileManager to detect files from natural language queries
      // This supports problem restatement (first priority) by providing file context
      const currentStageForFileDetection = this.harmonyClient.getCurrentStage();
      let fileExtractionResult: FileExtractionResult | undefined;
      
      if (currentStageForFileDetection === 'chat' || !currentStageForFileDetection) {
        try {
          // Detect files from the cleaned message (after @file extraction)
          const fileDetection = await this.fileManager.detectAndCollectFiles(cleanMessage, {
            includeContent: true,
            maxFiles: 5,
            confidenceThreshold: 'medium',
            includeWorkspaceContext: false // Don't include workspace context by default to keep prompt focused
          });

          if (fileDetection.detectedFiles.length > 0 || fileDetection.ambiguousMatches.length > 0) {
            const detectedFileContext = this.fileManager.formatForChatPrompt(fileDetection, false);
            
            // Combine with explicit file contexts
            if (fileContextText) {
              fileContextText = fileContextText + '\n\n' + detectedFileContext;
            } else {
              fileContextText = detectedFileContext;
            }
            
            console.log(`[Harmony] FileManager detected ${fileDetection.detectedFiles.length} file(s) and ${fileDetection.ambiguousMatches.length} ambiguous match(es)`);
          }
          
          // Build file extraction result for verbose info
          fileExtractionResult = {
            explicitFiles: fileContexts
              .filter(fc => fc.type === 'file' || fc.type === 'directory' || fc.type === 'selection')
              .map(fc => ({
                path: fc.path,
                type: (fc.type === 'selection' ? 'file' : fc.type) as 'file' | 'directory',
                extractedAt: Date.now()
              })),
            detectedFiles: fileDetection.detectedFiles
              .filter(f => f.type === 'file' || f.type === 'directory')
              .map(f => ({
                path: f.path,
                type: f.type as 'file' | 'directory',
                confidence: f.confidence,
                extractedAt: Date.now()
              })),
            ambiguousMatches: fileDetection.ambiguousMatches.map(m => ({
              path: m.path,
              reason: `Confidence: ${m.confidence}`
            }))
          };
        } catch (error: any) {
          // Log but don't fail if FileManager encounters an error
          console.warn(`[Harmony] FileManager error: ${error.message}`);
          // Still include explicit files if available
          if (fileContexts.length > 0) {
            fileExtractionResult = {
              explicitFiles: fileContexts
                .filter(fc => fc.type === 'file' || fc.type === 'directory' || fc.type === 'selection')
                .map(fc => ({
                  path: fc.path,
                  type: (fc.type === 'selection' ? 'file' : fc.type) as 'file' | 'directory',
                  extractedAt: Date.now()
                }))
            };
          }
        }
      } else if (fileContexts.length > 1) {
        // For non-chat stages, still track explicit files
        fileExtractionResult = {
          explicitFiles: fileContexts
            .filter(fc => fc.type === 'file' || fc.type === 'directory' || fc.type === 'selection')
            .map(fc => ({
              path: fc.path,
              type: (fc.type === 'selection' ? 'file' : fc.type) as 'file' | 'directory',
              extractedAt: Date.now()
            }))
        };
      }
      
      // Add file context to the message if any was found
      if (fileContextText) {
        finalMessage = fileContextText + '\n\n' + 'USER REQUEST:\n' + finalMessage;
      }

      // Add user message to history (store original message)
      const userMessage: ChatMessage = {
        role: 'user',
        content: text, // Store original message with @file references
      };
      this.conversationManager.addMessage(userMessage);

      console.log(`[DEBUG] Calling Harmony server with ${this.conversationManager.getLength()} messages in history...`);
      
      // Select template based on current stage
      // First try to get stage from existing context, otherwise detect from prompt
      let currentStage = this.harmonyClient.getCurrentStage();
      
      // Track queries in ChatManager when in chat stage or init stage (init will transition to chat)
      // This ensures the first query is always tracked even if stage hasn't been updated yet
      const chatManager = this.harmonyClient.getChatManager();
      if (currentStage === 'chat' || currentStage === 'init' || !currentStage) {
        // Initialize ChatManager if not already initialized (for init stage)
        // Only initialize if it doesn't already have content to avoid losing existing queries/files
        if ((currentStage === 'init' || !currentStage) && !chatManager.hasContent()) {
          chatManager.initialize();
        }
        
        // Add query with file extraction handled by ChatManager
        chatManager.addQueryWithFiles(cleanMessage, fileContexts, fileExtractionResult);
        console.log(`[ChatManager] Tracked query in ${currentStage || 'init'} stage: "${cleanMessage.substring(0, 50)}..."`);
      }
      
      // If command changed the stage, use that and prepend natural language equivalent for stageDetector
      if (commandHandled && newStage) {
        currentStage = newStage;
        console.log(`[Harmony] Using stage from @cmd: command: ${currentStage}`);
        
        // Prepend natural language equivalent so harmonyClient's stageDetector can detect it
        // This ensures the stage is properly updated in the context manager
        const stageCommandMap: Record<string, string> = {
          'assumptions': 'move to assumptions',
          'implementation': 'move to implementation',
          'chat': 'move to chat'
        };
        const naturalLanguageCommand = stageCommandMap[newStage];
        if (naturalLanguageCommand && finalMessage.trim()) {
          // If there's remaining message, prepend the command
          finalMessage = `${naturalLanguageCommand} ${finalMessage}`;
        } else if (naturalLanguageCommand) {
          // If no remaining message, just use the command
          finalMessage = naturalLanguageCommand;
        }
        console.log(`[Harmony] Prepended natural language command "${naturalLanguageCommand}" for stageDetector`);
      } else {
        // Check if prompt indicates a stage transition (e.g., "move to implementation")
        // This must be done BEFORE template selection to use the correct template
        // (fallback to regex detection for backward compatibility)
        const history = this.conversationManager.getHistoryForTemplate();
        if (currentStage !== 'chat') {
          // If we have a context, check for stage transitions from the current stage
          const detectedStage = this.stageStateMachine.determineNextStage(
            currentStage,
            finalMessage,
            history,
            this.confirmationManager
          );
          if (detectedStage && detectedStage !== currentStage) {
            console.log(`[Harmony] Stage transition detected in extension (regex fallback): ${currentStage} -> ${detectedStage}`);
            // Clear confirmation after successful transition
            this.confirmationManager.clear();
            currentStage = detectedStage;
          }
        } else {
          // If no context exists or we're in chat, detect stage from prompt
          const detectedStage = this.stageStateMachine.determineNextStage(
            'chat',
            finalMessage,
            history,
            this.confirmationManager
          );
          if (detectedStage && detectedStage !== currentStage) {
            // Clear confirmation after successful transition
            this.confirmationManager.clear();
          }
          currentStage = detectedStage || 'chat';
        }
      }
      
      // Detect and activate first-principles mode if triggered
      // This should happen when entering assumptions stage or if already in assumptions stage
      if (currentStage === 'assumptions') {
        // Check if first-principles is triggered in the current message
        const shouldActivate = this.harmonyClient.shouldActivateFirstPrinciples(finalMessage);
        
        if (shouldActivate && !this.harmonyClient.isFirstPrinciplesMode()) {
          // Activate first-principles mode
          this.harmonyClient.setFirstPrinciplesMode(true);
          console.log(`[Harmony] First-principles mode activated`);
        }
      } else if (currentStage !== 'assumptions') {
        // Disable first-principles mode when leaving assumptions stage
        if (this.harmonyClient.isFirstPrinciplesMode()) {
          this.harmonyClient.setFirstPrinciplesMode(false);
          console.log(`[Harmony] First-principles mode deactivated (left assumptions stage)`);
        }
      }
      
      let templateName: string;
      switch (currentStage) {
        case 'assumptions':
          // Check if first-principles mode is active
          if (this.harmonyClient.isFirstPrinciplesMode()) {
            templateName = 'first-principles';
            console.log(`[Harmony] First-principles mode active in assumptions stage`);
          } else {
            templateName = 'assumptions';
          }
          break;
        case 'implementation':
          templateName = 'implementation';
          break;
        case 'chat':
        default:
          templateName = 'chat';
          break;
      }
      
      console.log(`[Harmony] Using template: ${templateName}.j2 for stage: ${currentStage}`);
      
      // For stage transitions, pass full history (including current message) so fallback logic can capture all queries
      // Otherwise use getHistoryForTemplate() to exclude current message for template rendering
      const fullHistory = this.conversationManager.getHistory();
      const historyForTemplate = this.conversationManager.getHistoryForTemplate();
      
      const response = await this.harmonyClient.callServer(
        finalMessage, // Use message with file context
        templateName,
        (name, ctx) => this.templateRenderer.applyTemplate(name, ctx, historyForTemplate),
        false,
        fullHistory, // Pass full history so fallback logic can capture all queries including current one
        fileExtractionResult // Pass file extraction results for verbose info
      );
      
      console.log(
        `[Harmony] Sending response to webview. Content length: ${response.content?.length || 0}`
      );

      // Clean verbose responses to improve readability (apply cleaning even in verbose mode)
      const cleanedContent = cleanVerboseResponse(response.content || '');
      const cleanedResponse = {
        ...response,
        content: cleanedContent
      };

      // Add assistant response to history (use cleaned content for display)
      this.conversationManager.addMessage({
        role: 'assistant',
        content: cleanedContent,
        reasoning: response.reasoning,
      });

      // Detect and store confirmation requests in assistant responses
      const conversationHistory = this.conversationManager.getHistory();
      this.confirmationManager.detectAndStoreConfirmation(
        cleanedContent,
        currentStage,
        conversationHistory
      );

      // Update problem summary in ChatManager if in chat stage
      if (currentStage === 'chat' && cleanedContent) {
        chatManager.updateProblemSummaryFromResponse(cleanedContent, cleanMessage);
      }

      await this.webviewManager.sendMessage(cleanedResponse);
    } catch (error: any) {
      console.error(`[Harmony] Error in handleChatMessage:`, error);
      await this.webviewManager.sendMessage({
        content: `❌ Error: ${error.message}`,
      });
    }
  }

  /**
   * Handle @cmd: commands
   * Returns whether command was handled and if processing should continue
   */
  private async handleCommand(
    command: string,
    remainingMessage: string
  ): Promise<{
    handled: boolean;
    shouldReturn: boolean;
    message?: string;
    newStage?: WorkflowStage;
  }> {
    const commandLower = command.toLowerCase().trim();

    switch (commandLower) {
      case 'move_to_implementation': {
        const currentStage = this.harmonyClient.getCurrentStage();
        // Validate transition
        if (!this.stageStateMachine.canTransition(currentStage, 'implementation')) {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to implementation stage from ${currentStage}. Valid transitions: ${currentStage === 'chat' ? 'chat -> assumptions' : currentStage === 'assumptions' ? 'assumptions -> implementation' : 'N/A'}`,
          };
        }
        return {
          handled: true,
          shouldReturn: false,
          newStage: 'implementation',
        };
      }

      case 'move_to_assumptions': {
        const currentStage = this.harmonyClient.getCurrentStage();
        // Validate transition
        if (!this.stageStateMachine.canTransition(currentStage, 'assumptions')) {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to assumptions stage from ${currentStage}. Valid transitions: ${currentStage === 'chat' ? 'chat -> assumptions' : currentStage === 'implementation' ? 'implementation -> assumptions' : 'N/A'}`,
          };
        }
        return {
          handled: true,
          shouldReturn: false,
          newStage: 'assumptions',
        };
      }

      case 'move_to_chat': {
        const currentStage = this.harmonyClient.getCurrentStage();
        // Validate transition
        if (!this.stageStateMachine.canTransition(currentStage, 'chat')) {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to chat stage from ${currentStage}. Valid transitions: ${currentStage === 'assumptions' ? 'assumptions -> chat' : currentStage === 'implementation' ? 'implementation -> chat' : 'N/A'}`,
          };
        }
        return {
          handled: true,
          shouldReturn: false,
          newStage: 'chat',
        };
      }

      case 'next_step': {
        // next_step command - handled in ImplementationStageHandler
        const currentStage = this.harmonyClient.getCurrentStage();
        if (currentStage !== 'implementation') {
          return {
            handled: true,
            shouldReturn: true,
            message: 'next_step command is only available in implementation stage',
          };
        }
        // For next_step, remaining text should be ignored (command is self-contained)
        // Return handled=true with special marker to replace message with empty string
        // The ImplementationStageHandler will detect empty prompt as next_step request
        return {
          handled: true,
          shouldReturn: false,
          // Don't change stage for next_step
        };
      }

      case 'verbose_info':
      case 'verbose-info': {
        // Get current verboseInfo and display it in webview
        // This will return minimal chat stage verboseInfo if no context exists
        // Pass conversation history so problem summary includes all user queries
        const conversationHistory = this.conversationManager.getHistory();
        const verboseInfo = this.harmonyClient.getCurrentVerboseInfo(conversationHistory);
        
        // Format verboseInfo as content text so it appears in the main message area
        // (in addition to the verbose info section)
        const formattedVerboseInfo = VerboseInfoFormatter.format(verboseInfo);
        
        // Send verboseInfo to webview with formatted content
        await this.webviewManager.sendMessage({
          content: formattedVerboseInfo,
          verboseInfo: verboseInfo,
        });
        
        return {
          handled: true,
          shouldReturn: true,
        };
      }

      default:
        // Unknown command - log warning but continue processing
        console.warn(`[CommandExtractor] Unknown command: ${command}`);
        return { handled: false, shouldReturn: false };
    }
  }

  /**
   * Send file list to webview for autocomplete
   */
  private async sendFileList(searchTerm: string = ''): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
      }

      // Get files from workspace (excluding large directories)
      const excludePatterns = [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.build/**',
        '**/out/**',
        '**/output/**',
        '**/.next/**',
        '**/target/**',
        '**/*.min.*',
        '**/*.bundle.*',
        '**/.cache/**',
        '**/coverage/**'
      ].join(',');
      const files = await vscode.workspace.findFiles('**/*', excludePatterns);
      
      // Format files for display
      let fileItems = files
        .map(file => ({
          label: vscode.workspace.asRelativePath(file),
          path: vscode.workspace.asRelativePath(file)
        }))
        .filter(file => {
          // Explicitly filter out .build folder and any files inside it
          const normalizedPath = file.path.replace(/\\/g, '/');
          return !normalizedPath.includes('/.build/') && !normalizedPath.startsWith('.build/');
        });

      // Filter files based on search term (exact substring match)
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        fileItems = fileItems.filter(file => {
          const fileName = file.label.toLowerCase();
          // Only match if the filename contains the exact search term as a substring
          return fileName.includes(searchLower);
        });
      }
      
      // Limit to 50 for performance
      fileItems = fileItems.slice(0, 50);

      console.log(`[Harmony] Sending ${fileItems.length} files for autocomplete${searchTerm ? ` (filtered by "${searchTerm}")` : ''}`);
      await this.webviewManager.sendFileList(fileItems);
    } catch (error) {
      console.error(`[Harmony] Error getting file list:`, error);
    }
  }

  /**
   * Show file picker for inserting file references
   */
  async showFilePicker(): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
      }

      // Open quick pick to select a file
      //const excludePatterns = '**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.min.*,**/*.bundle.*';

      const excludePatterns = [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.build/**',
        '**/out/**',
        '**/output/**',
        '**/.next/**',
        '**/target/**',
        '**/*.min.*',
        '**/*.bundle.*',
        '**/.cache/**',
        '**/coverage/**',
        '**/.vscode-test/**'
      ].join(',');
      

      const files = await vscode.workspace.findFiles('**/*', excludePatterns);
      
      const items = files
        .map(file => ({
          label: vscode.workspace.asRelativePath(file),
          description: '',
          detail: file.fsPath,
          filePath: vscode.workspace.asRelativePath(file)
        }))
        .filter(item => {
          // Explicitly filter out .build folder and any files inside it
          const normalizedPath = item.filePath.replace(/\\/g, '/');
          return !normalizedPath.includes('/.build/') && !normalizedPath.startsWith('.build/');
        });

      // Sort alphabetically
      items.sort((a, b) => a.label.localeCompare(b.label));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a file to reference',
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false
      });
      
      if (selected) {
        // Insert @file reference into webview input
        const reference = `@file:${selected.filePath}`;
        await this.webviewManager.insertTextIntoInput(reference);
        console.log(`[Harmony] Inserted file reference: ${selected.filePath}`);
      }
    } catch (error) {
      console.error(`[Harmony] Error showing file picker:`, error);
      vscode.window.showErrorMessage(`Failed to select file: ${error}`);
    }
  }

  /**
   * Clear conversation history
   */
  public clearConversationHistory(): void {
    this.conversationManager.clear();
    this.confirmationManager.clear();
    console.log(`[Harmony] Conversation history and confirmations cleared`);
  }

  private async sendCodeContext(): Promise<void> {
    // Try to get the active editor first
    let editor = vscode.window.activeTextEditor;
    
    // If active editor is null or is the webview, use the last tracked text editor
    if (!editor || editor.document.uri.scheme === 'vscode-webview') {
      editor = this.lastActiveTextEditor;
    }
    
    // If still no editor, try to get the first visible text editor
    if (!editor && vscode.window.visibleTextEditors.length > 0) {
      // Find the first editor that's not a webview
      editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.scheme !== 'vscode-webview'
      );
    }
    
    if (editor) {
      const document = editor.document;
      const selection = editor.selection;
      const selectedText = document.getText(selection);
      const language = document.languageId;
      const fileName = path.basename(document.fileName);

      let context = "";
      if (selectedText) {
        context = `File: ${fileName}\nLanguage: ${language}\nSelected Code:\n\`\`\`${language}\n${selectedText}\n\`\`\``;
      } else {
        const fullText = document.getText();
        context = `File: ${fileName}\nLanguage: ${language}\nFull Content:\n\`\`\`${language}\n${fullText}\n\`\`\``;
      }

      await this.webviewManager.sendCodeContext(context);
    } else {
      // Show a message if no editor is available
      vscode.window.showWarningMessage('No active file found. Please open a file in the editor first.');
    }
  }

  public async explainCode(): Promise<void> {
    await this.codeActions.explainCode();
  }


  /**
   * Read a file using the native tools manager
   */
  public async readFile(filePath: string): Promise<NativeToolResult> {
    return await this.nativeToolsManager.callTool("read_file", { file_path: filePath });
  }

  async testReadFile(): Promise<void> {
    const testPath = "README.md"; // Common file in workspace root
    const result = await this.readFile(testPath);
    console.log(`Test read ${testPath}:`, 
      result.isError ? "ERROR" : "SUCCESS",
      result.content[0]?.text?.substring(0, 100) + "..."
    );
  }

  public dispose(): void {
    if (this.editorChangeDisposable) {
      this.editorChangeDisposable.dispose();
      this.editorChangeDisposable = undefined;
    }
    this.webviewManager.dispose();
    this.mcpManager.dispose();
    this.rulesManager.dispose();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const assistant = new HarmonyAssistant(context);

  // Register webview view provider
  const webviewViewProvider = {
    resolveWebviewView: (
      webviewView: vscode.WebviewView,
      _context: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ) => {
      assistant.getWebviewManager().resolveWebviewView(webviewView, _context, _token);
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('harmonyChat', webviewViewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("harmony.chat", () => {
      assistant.openChat();
    }),
    vscode.commands.registerCommand("harmony.explain", () => {
      assistant.explainCode();
    }),
    vscode.commands.registerCommand("harmony.test", () => {
      assistant.testReadFile();
    }),
    vscode.commands.registerCommand("harmony.clearHistory", () => {
      assistant.clearConversationHistory();
      vscode.window.showInformationMessage('Conversation history cleared');
    }),
    // Add a command to insert file reference directly
    vscode.commands.registerCommand("harmony.insertFileReference", async () => {
      await assistant.showFilePicker();
    }),
    assistant
  );
}

export function deactivate() {
  // Cleanup if needed
}