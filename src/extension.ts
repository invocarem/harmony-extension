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
import { FileReader } from "./utils/fileReader";
import { cleanVerboseResponse } from "./utils/responseCleaner";
import { StageStateMachine, WorkflowStage } from "./harmony/stageStateMachine";
import {
  FileExtractionResult,
  VerboseInfoBuilder,
  VerboseInfoFormatter,
} from "./utils/verboseInfo";
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
  private fileReader: FileReader;
  private confirmationManager: ConfirmationManager;
  private lastActiveTextEditor: vscode.TextEditor | undefined;
  private editorChangeDisposable: vscode.Disposable | undefined;
  // Auto mode is now tracked via trigger detection in state machine, no flag needed

  constructor(context: vscode.ExtensionContext) {
    this.config = loadConfig();
    this.webviewManager = new WebviewManager(context);
    this.mcpManager = new MCPManager();
    this.rulesManager = new RulesManager();
    this.nativeToolsManager = new NativeToolsManager();
    this.conversationManager = new ConversationManager();
    this.stageStateMachine = new StageStateMachine();
    this.fileManager = new FileManager();
    this.fileReader = new FileReader();
    this.confirmationManager = new ConfirmationManager();
    this.harmonyClient = new HarmonyClient(
      this.config,
      this.mcpManager,
      this.rulesManager,
      this.nativeToolsManager
    );

    // Set up callback to send verboseInfo to webview before stage transitions
    this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
      await this.webviewManager.sendMessage({
        content: "", // Empty content for pre-transition verbose info
        verboseInfo: verboseInfo,
      });
    });

    // Set up callback to send intermediate responses during auto mode
    this.harmonyClient.setIntermediateResponseCallback(async (response) => {
      await this.webviewManager.sendMessage(response);
    });

    this.templateRenderer = new TemplateRenderer(
      context,
      this.config.harmonyMode
    );
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
      console.log(
        `[MCP] Initializing ${this.config.mcpServers.length} MCP server(s)`
      );
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
      console.log(
        `[Rules] Loading ${this.config.rulesPaths.length} rule file(s)`
      );
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
    const configWatcher = vscode.workspace.onDidChangeConfiguration(
      async (event) => {
        if (event.affectsConfiguration("harmony.mcpServers")) {
          console.log(
            "[MCP] MCP servers configuration changed, reinitializing..."
          );
          this.config = loadConfig();
          await this.initializeMCP();
        } else if (event.affectsConfiguration("harmony.rulesPaths")) {
          console.log(
            "[Rules] Rules paths configuration changed, reloading..."
          );
          this.config = loadConfig();
          await this.initializeRules();
          this.harmonyClient = new HarmonyClient(
            this.config,
            this.mcpManager,
            this.rulesManager,
            this.nativeToolsManager
          );
          this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
            await this.webviewManager.sendMessage({
              content: "",
              verboseInfo: verboseInfo,
            });
          });
          this.codeActions = new CodeActions(
            this.harmonyClient,
            this.templateRenderer
          );
        } else if (event.affectsConfiguration("harmony.harmonyMode")) {
          // Reload config and recreate components that depend on harmonyMode
          console.log(
            "[Harmony] Harmony mode configuration changed, reinitializing..."
          );
          this.config = loadConfig();
          this.templateRenderer = new TemplateRenderer(
            context,
            this.config.harmonyMode
          );
          this.harmonyClient = new HarmonyClient(
            this.config,
            this.mcpManager,
            this.rulesManager,
            this.nativeToolsManager
          );
          this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
            await this.webviewManager.sendMessage({
              content: "",
              verboseInfo: verboseInfo,
            });
          });
          this.codeActions = new CodeActions(
            this.harmonyClient,
            this.templateRenderer
          );
        } else if (event.affectsConfiguration("harmony")) {
          // Reload other config
          this.config = loadConfig();
          this.harmonyClient = new HarmonyClient(
            this.config,
            this.mcpManager,
            this.rulesManager,
            this.nativeToolsManager
          );
          this.harmonyClient.setVerboseInfoCallback(async (verboseInfo) => {
            await this.webviewManager.sendMessage({
              content: "",
              verboseInfo: verboseInfo,
            });
          });
          this.codeActions = new CodeActions(
            this.harmonyClient,
            this.templateRenderer
          );
        }
      }
    );
    context.subscriptions.push(configWatcher);
  }

  private setupWebviewHandlers(): void {
    // Test handler
    this.webviewManager.registerMessageHandler("test", (message) => {
      console.log(`[DEBUG] Received test message from webview:`, message.text);
      // Send a test response back
      this.webviewManager.sendMessage({
        content: "✅ All set! Feel free to start a conversation.",
      });
    });

    // Send message handler
    this.webviewManager.registerMessageHandler(
      "sendMessage",
      async (message) => {
        console.log(
          `[DEBUG] Handling sendMessage with text:`,
          message.text?.substring(0, 100)
        );

        // Extract file references to get file list
        const { fileContexts } =
          await FileContextExtractor.extractFileReferences(message.text || "");

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
          contextSummary.files = fileContexts.map((fc) => {
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
      }
    );

    // Get code context handler
    this.webviewManager.registerMessageHandler("getCodeContext", async () => {
      console.log(`[DEBUG] Handling getCodeContext`);
      await this.sendCodeContext();
    });

    // Request file list for autocomplete handler
    this.webviewManager.registerMessageHandler(
      "requestFileList",
      async (message: WebviewMessage) => {
        console.log(`[DEBUG] Handling requestFileList`);
        const searchTerm = (message as any).searchTerm || "";
        await this.sendFileList(searchTerm);
      }
    );

    // Insert file reference handler
    this.webviewManager.registerMessageHandler(
      "insertFileReference",
      async () => {
        console.log(`[DEBUG] Handling insertFileReference`);
        await this.showFilePicker();
      }
    );
  }

  public async openChat(): Promise<void> {
    // Track the last active text editor before opening the webview
    // This ensures we can still access the source file even when webview is active
    const currentEditor = vscode.window.activeTextEditor;
    if (
      currentEditor &&
      currentEditor.document.uri.scheme !== "vscode-webview"
    ) {
      this.lastActiveTextEditor = currentEditor;
    }

    // Dispose existing listener if any
    if (this.editorChangeDisposable) {
      this.editorChangeDisposable.dispose();
    }

    // Listen for editor changes to keep track of the last text editor
    this.editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        // Only update if it's a text editor (not the webview)
        if (editor && editor.document.uri.scheme !== "vscode-webview") {
          this.lastActiveTextEditor = editor;
        }
      }
    );

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
      // Auto-detect vague prompts in assumptions stage and convert to @cmd:plan
      // This must happen BEFORE command extraction to avoid adding to history
      const currentStageForVagueDetection =
        this.harmonyClient.getCurrentStage();
      if (currentStageForVagueDetection === "assumptions") {
        const vagueTriggers =
          /^(next|continue|go|proceed|okay|ok|yes|sure|alright|start)$/i;
        if (vagueTriggers.test(text.trim())) {
          console.log(
            `[Harmony] Auto-converting vague prompt "${text}" to @cmd:plan`
          );
          text = "@cmd:plan";
        }
      }

      // STEP 1: Extract @cmd: commands FIRST (before file extraction)
      const { command, cleanMessage: messageAfterCommand } =
        CommandExtractor.extractCommand(text);

      let commandHandled = false;
      let newStage: WorkflowStage | undefined;

      if (command) {
        console.log(`[CommandExtractor] Detected command: ${command.command}`);
        const commandResult = await this.handleCommand(
          command.command,
          messageAfterCommand
        );

        if (commandResult.handled) {
          commandHandled = true;
          newStage = commandResult.newStage;

          if (commandResult.shouldReturn) {
            // Command was handled and we should return early (e.g., error message)
            if (commandResult.message) {
              // Include stage information for stage transition messages
              const currentStage = this.harmonyClient.getCurrentStage();
              const contextManager = (this.harmonyClient as any).contextManager;
              const context = contextManager?.getContext?.();
              const displayStage = currentStage as
                | "chat"
                | "assumptions"
                | "implementation";
              await this.webviewManager.sendMessage({
                content: commandResult.message,
                verboseInfo: {
                  stage: displayStage,
                  hasPlan: context?.hasPlan || false,
                },
              });
            }
            return;
          }

          // Use cleaned message for remaining processing
          // Commands are now handled by state machine, so pass through the cleaned message
          if (commandResult.modifiedMessage !== undefined) {
            // Use modified message if provided (e.g., to preserve command for later processing)
            text = commandResult.modifiedMessage;
            console.log(
              `[CommandExtractor] Using modified message from command handler`
            );
          } else {
            text = messageAfterCommand;
          }

          // If stage was changed, log it
          if (newStage) {
            console.log(
              `[CommandExtractor] Command changed stage to: ${newStage}`
            );
          }
        }
      }

      // STEP 2: Continue with existing flow (FileContextExtractor, etc.)
      // Extract file references and clean the message (explicit @file syntax)
      const { cleanMessage, fileContexts } =
        await FileContextExtractor.extractFileReferences(text);

      let finalMessage = cleanMessage;
      let fileContextText = "";

      // Add explicit file contexts from @file syntax
      if (fileContexts.length > 0) {
        fileContextText = FileContextExtractor.formatFileContexts(fileContexts);
        console.log(
          `[Harmony] Added ${fileContexts.length} explicit file context(s) to message`
        );
      }

      // At chat stage, use FileManager to detect files from natural language queries
      // This supports problem restatement (first priority) by providing file context
      const currentStageForFileDetection = this.harmonyClient.getCurrentStage();
      let fileExtractionResult: FileExtractionResult | undefined;

      if (
        currentStageForFileDetection === "chat" ||
        !currentStageForFileDetection
      ) {
        try {
          // Detect files from the cleaned message (after @file extraction)
          const fileDetection = await this.fileManager.detectAndCollectFiles(
            cleanMessage,
            {
              includeContent: true,
              maxFiles: 5,
              confidenceThreshold: "medium",
              includeWorkspaceContext: false, // Don't include workspace context by default to keep prompt focused
            }
          );

          if (
            fileDetection.detectedFiles.length > 0 ||
            fileDetection.ambiguousMatches.length > 0
          ) {
            const detectedFileContext = this.fileManager.formatForChatPrompt(
              fileDetection,
              false
            );

            // Combine with explicit file contexts
            if (fileContextText) {
              fileContextText = fileContextText + "\n\n" + detectedFileContext;
            } else {
              fileContextText = detectedFileContext;
            }

            console.log(
              `[Harmony] FileManager detected ${fileDetection.detectedFiles.length} file(s) and ${fileDetection.ambiguousMatches.length} ambiguous match(es)`
            );
          }

          // Build file extraction result for verbose info
          fileExtractionResult = {
            explicitFiles: fileContexts
              .filter(
                (fc) =>
                  fc.type === "file" ||
                  fc.type === "directory" ||
                  fc.type === "selection"
              )
              .map((fc) => ({
                path: fc.path,
                type: (fc.type === "selection" ? "file" : fc.type) as
                  | "file"
                  | "directory",
                extractedAt: Date.now(),
              })),
            detectedFiles: fileDetection.detectedFiles
              .filter((f) => f.type === "file" || f.type === "directory")
              .map((f) => ({
                path: f.path,
                type: f.type as "file" | "directory",
                confidence: f.confidence,
                extractedAt: Date.now(),
              })),
            ambiguousMatches: fileDetection.ambiguousMatches.map((m) => ({
              path: m.path,
              reason: `Confidence: ${m.confidence}`,
            })),
          };
        } catch (error: any) {
          // Log but don't fail if FileManager encounters an error
          console.warn(`[Harmony] FileManager error: ${error.message}`);
          // Still include explicit files if available
          if (fileContexts.length > 0) {
            fileExtractionResult = {
              explicitFiles: fileContexts
                .filter(
                  (fc) =>
                    fc.type === "file" ||
                    fc.type === "directory" ||
                    fc.type === "selection"
                )
                .map((fc) => ({
                  path: fc.path,
                  type: (fc.type === "selection" ? "file" : fc.type) as
                    | "file"
                    | "directory",
                  extractedAt: Date.now(),
                })),
            };
          }
        }
      } else if (fileContexts.length > 1) {
        // For non-chat stages, still track explicit files
        fileExtractionResult = {
          explicitFiles: fileContexts
            .filter(
              (fc) =>
                fc.type === "file" ||
                fc.type === "directory" ||
                fc.type === "selection"
            )
            .map((fc) => ({
              path: fc.path,
              type: (fc.type === "selection" ? "file" : fc.type) as
                | "file"
                | "directory",
              extractedAt: Date.now(),
            })),
        };
      }

      // Add file context to the message if any was found
      if (fileContextText) {
        finalMessage =
          fileContextText + "\n\n" + "USER REQUEST:\n" + finalMessage;
      }

      // Add user message to history if it's not a command
      // Commands like @cmd:plan should not be added to conversation history
      if (!commandHandled) {
        const userMessage: ChatMessage = {
          role: "user",
          content: text, // Store original message with @file references
        };
        this.conversationManager.addMessage(userMessage);
      } else {
        console.log(
          `[Harmony] Command detected - not adding to conversation history: "${text.substring(0, 50)}..."`
        );
      }

      console.log(
        `[DEBUG] Calling Harmony server with ${this.conversationManager.getLength()} messages in history...`
      );

      // Select template based on current stage
      // First try to get stage from existing context, otherwise detect from prompt
      let currentStage = this.harmonyClient.getCurrentStage();
      const initialStage = currentStage;

      // Track queries in ChatManager when in chat stage
      // This ensures all queries are properly tracked
      const chatManager = this.harmonyClient.getChatManager();
      if (currentStage === "chat" || !currentStage) {
        // Initialize ChatManager if not already initialized (for chat stage)
        // Only initialize if it doesn't already have content to avoid losing existing queries/files
        if (!currentStage && !chatManager.hasContent()) {
          chatManager.initialize();
        }

        // Add query with file extraction handled by ChatManager
        chatManager.addQueryWithFiles(
          cleanMessage,
          fileContexts,
          fileExtractionResult
        );
        console.log(
          `[ChatManager] Tracked query in ${currentStage || "chat"} stage: "${cleanMessage.substring(0, 50)}..."`
        );
      }

      // If command changed the stage, use that and prepend natural language equivalent for stageDetector
      if (commandHandled && newStage) {
        currentStage = newStage;
        console.log(
          `[Harmony] Using stage from @cmd: command: ${currentStage}`
        );

        // Prepend natural language equivalent so harmonyClient's stageDetector can detect it
        // This ensures the stage is properly updated in the context manager
        const stageCommandMap: Record<string, string> = {
          assumptions: "move to assumptions",
          implementation: "move to implementation",
          chat: "move to chat",
        };
        const naturalLanguageCommand = stageCommandMap[newStage];
        if (naturalLanguageCommand && finalMessage.trim()) {
          // If there's remaining message, prepend the command
          finalMessage = `${naturalLanguageCommand} ${finalMessage}`;
        } else if (naturalLanguageCommand) {
          // If no remaining message, just use the command
          finalMessage = naturalLanguageCommand;
        }
        console.log(
          `[Harmony] Prepended natural language command "${naturalLanguageCommand}" for stageDetector`
        );
      } else {
        // Check if prompt indicates a stage transition (e.g., "move to implementation")
        // This must be done BEFORE template selection to use the correct template
        // (fallback to regex detection for backward compatibility)
        const history = this.conversationManager.getHistoryForTemplate();
        if (currentStage !== "chat") {
          // If we have a context, check for stage transitions from the current stage
          const detectedStage = await this.stageStateMachine.determineNextStage(
            currentStage,
            finalMessage,
            history,
            this.confirmationManager,
            undefined,
            undefined,
            chatManager
          );
          if (detectedStage && detectedStage !== currentStage) {
            console.log(
              `[Harmony] Stage transition detected in extension (regex fallback): ${currentStage} -> ${detectedStage}`
            );
            // Clear confirmation after successful transition
            this.confirmationManager.clear();
            currentStage = detectedStage;
          }
        } else {
          // If no context exists or we're in chat, detect stage from prompt
          const detectedStage = await this.stageStateMachine.determineNextStage(
            "chat",
            finalMessage,
            history,
            this.confirmationManager,
            undefined,
            undefined,
            chatManager
          );
          if (detectedStage && detectedStage !== currentStage) {
            // Clear confirmation after successful transition
            this.confirmationManager.clear();
            currentStage = detectedStage;
          } else {
            currentStage = detectedStage || "chat";
          }
        }
      }

      const shouldActivateFirstPrinciples =
        this.harmonyClient.shouldActivateFirstPrinciples(finalMessage) ||
        this.config.firstPrinciplesMode === true;
      const wasFirstPrinciplesActive =
        this.harmonyClient.isFirstPrinciplesMode();
      const supportsFirstPrinciples = currentStage === "chat";
      const leftChatStage = initialStage === "chat" && currentStage !== "chat";

      if (
        supportsFirstPrinciples &&
        shouldActivateFirstPrinciples &&
        !wasFirstPrinciplesActive
      ) {
        this.harmonyClient.setFirstPrinciplesMode(true);
        const reason = this.config.firstPrinciplesMode
          ? "config setting"
          : "user trigger";
        console.log(`[Harmony] First-principles mode activated (${reason})`);
      }

      if (
        leftChatStage ||
        (!supportsFirstPrinciples && wasFirstPrinciplesActive)
      ) {
        this.harmonyClient.setFirstPrinciplesMode(false);
        console.log(
          `[Harmony] First-principles mode deactivated (stage change to ${currentStage})`
        );
      }

      const firstPrinciplesActive = this.harmonyClient.isFirstPrinciplesMode();

      let templateName: string;
      switch (currentStage) {
        case "chat":
          templateName = "chat";
          if (firstPrinciplesActive) {
            console.log(`[Harmony] First-principles mode active in chat stage`);
          }
          break;
        case "simple":
          templateName = "simple";
          break;
        case "assumptions":
          templateName = "assumptions";
          break;
        case "implementation":
          templateName = "implementation";
          break;
        default:
          templateName = "chat";
          break;
      }

      console.log(
        `[Harmony] Using template: ${templateName}.j2 for stage: ${currentStage}`
      );

      // For stage transitions, pass full history (including current message) so fallback logic can capture all queries
      // Otherwise use getHistoryForTemplate() to exclude current message for template rendering
      const fullHistory = this.conversationManager.getHistory();
      const historyForTemplate =
        this.conversationManager.getHistoryForTemplate();

      const response = await this.harmonyClient.callServer(
        finalMessage, // Use message with file context
        templateName,
        (name, ctx) =>
          this.templateRenderer.applyTemplate(name, ctx, historyForTemplate),
        false,
        fullHistory, // Pass full history so fallback logic can capture all queries including current one
        fileExtractionResult // Pass file extraction results for verbose info
      );

      console.log(
        `[Harmony] Sending response to webview. Content length: ${response.content?.length || 0}`
      );

      // Clean verbose responses to improve readability (apply cleaning even in verbose mode)
      const cleanedContent = cleanVerboseResponse(response.content || "");
      const cleanedResponse = {
        ...response,
        content: cleanedContent,
      };

      // Add assistant response to history (use cleaned content for display)
      this.conversationManager.addMessage({
        role: "assistant",
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

      // Process response and update problems in ChatManager if in chat stage
      if (currentStage === "chat" && cleanedContent) {
        chatManager.processResponse(
          cleanedContent,
          cleanMessage,
          response.toolCalls
        );
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
   * Get MCP tool name for conversion based on source and target types
   * @param sourceType - Source file type (e.g., "docx", "pdf")
   * @param targetType - Target format type (e.g., "markdown", "html")
   * @returns MCP tool name or null if not supported
   */
  private getConversionToolName(
    sourceType: string,
    targetType: string
  ): string | null {
    const source = sourceType.toLowerCase();
    const target = targetType.toLowerCase();

    // Map source/target combinations to MCP tool names
    if (source === "docx" && target === "markdown") {
      return "convert_docx_to_markdown";
    }
    if (source === "pdf" && target === "markdown") {
      return "extract_pdf_text";
    }
    // Add more mappings as MCP tools become available
    // if (source === 'docx' && target === 'html') {
    //   return 'convert_docx_to_html';
    // }

    return null;
  }

  /**
   * Execute file conversion
   * @param filename - The filename to convert (e.g., "bliu.docx")
   * @param targetType - Target format type (e.g., "markdown", defaults to "markdown")
   * @returns Result message to display
   */
  private async executeConversion(
    filename: string,
    targetType: string = "markdown"
  ): Promise<{ message: string }> {
    console.log(`[Conversion] Converting file: ${filename} to ${targetType}`);

    try {
      // Check if file is supported
      if (!FileReader.isSupportedFile(filename)) {
        return {
          message: `❌ Error: File "${filename}" is not supported. Only .docx and .pdf files are supported.`,
        };
      }

      // Determine source type from file extension
      const sourceType = filename.toLowerCase().endsWith(".docx")
        ? "docx"
        : "pdf";

      // Get MCP tool name for this conversion
      const toolName = this.getConversionToolName(sourceType, targetType);
      if (!toolName) {
        return {
          message: `❌ Error: Conversion from ${sourceType} to ${targetType} is not supported. Supported conversions: docx→markdown, pdf→markdown.`,
        };
      }

      const serverName = this.mcpManager.findToolServer(toolName);

      if (!serverName) {
        return {
          message: `❌ Error: MCP tool "${toolName}" not available. File conversion requires a configured MCP server with this tool.`,
        };
      }

      // Read file to base64
      const fileResult = await this.fileReader.readFileToBase64(filename);

      // Call MCP tool
      const mcpResult = await this.mcpManager.callTool(serverName, toolName, {
        content_base64: fileResult.base64,
        filename: fileResult.filename,
        file_size: fileResult.fileSize,
      });

      if (mcpResult.isError) {
        const errorText = mcpResult.content?.[0]?.text || "Unknown error";
        return {
          message: `❌ Error converting file: ${errorText}`,
        };
      }

      // Parse result (MCP tools return JSON strings)
      let resultData: any;
      try {
        const resultText = mcpResult.content?.[0]?.text || "{}";
        resultData = JSON.parse(resultText);
      } catch (parseError) {
        // If parsing fails, use the raw text
        resultData = { markdown: mcpResult.content?.[0]?.text || "" };
      }

      // Format and return result
      // Handle different target types in the response
      let content: string | undefined;
      if (targetType === "markdown") {
        content = resultData.markdown || resultData.content;
      } else {
        // For other target types, try common field names
        content =
          resultData.content || resultData[targetType] || resultData.markdown;
      }

      if (resultData.success && content) {
        return {
          message:
            `✅ Successfully converted "${fileResult.filename}" to ${targetType}:\n\n` +
            `---\n\n` +
            content,
        };
      } else if (resultData.error) {
        return {
          message: `❌ Error converting file: ${resultData.error}`,
        };
      } else {
        return {
          message: `⚠️ Conversion completed but no ${targetType} content was returned.`,
        };
      }
    } catch (error: any) {
      console.error(`[Conversion] Error converting file:`, error);
      return {
        message: `❌ Error: ${error.message}`,
      };
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
    modifiedMessage?: string; // Modified message to use for continued processing
  }> {
    const commandLower = command.toLowerCase().trim();

    switch (commandLower) {
      case "move_to_implementation": {
        const currentStage = this.harmonyClient.getCurrentStage();
        // Validate transition using state machine table
        if (
          !this.stageStateMachine.canTransition(currentStage, "implementation")
        ) {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to implementation stage from ${currentStage}. Valid transitions: ${currentStage === "chat" ? "chat -> assumptions" : currentStage === "assumptions" ? "assumptions -> implementation" : "N/A"}`,
          };
        }

        // Execute transition directly - no LLM call needed
        const transitionHandler = (this.harmonyClient as any).stageStateMachine
          .transitionHandler;
        const contextManager = (this.harmonyClient as any).contextManager;

        // Execute transition side effects based on current stage
        if (currentStage === "assumptions") {
          await transitionHandler.handleAssumptionsToImplementationTransition(
            "move to implementation",
            this.nativeToolsManager
          );
        }

        // Validate implementation has a plan
        await transitionHandler.validateImplementationTransition();

        // Update stage in context
        contextManager.updateStage("implementation", "move to implementation");

        return {
          handled: true,
          shouldReturn: true,
          message: `✓ Transitioned to implementation stage`,
        };
      }

      case "move_to_assumptions": {
        const currentStage = this.harmonyClient.getCurrentStage();
        const transitionHandler = (this.harmonyClient as any).stageStateMachine
          .transitionHandler;
        const contextManager = (this.harmonyClient as any).contextManager;
        const conversationHistory = this.conversationManager.getHistory();
        const chatManager = (this.harmonyClient as any).chatManager;

        // Use state machine to determine if transition should happen
        // This respects hasUnansweredProblems() check
        const nextStage = await this.stageStateMachine.determineNextStage(
          currentStage,
          "@cmd:move_to_assumptions",
          conversationHistory,
          undefined,
          transitionHandler,
          this.nativeToolsManager,
          chatManager
        );

        // Check if state machine blocked the transition
        if (nextStage === currentStage) {
          return {
            handled: true,
            shouldReturn: true,
            message: `⚠️ Cannot transition to assumptions stage - no problems to work on. Please ask a question or describe what you need first.`,
          };
        }

        if (nextStage !== "assumptions") {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to assumptions stage from ${currentStage}. Valid transitions: ${currentStage === "chat" ? "chat -> assumptions" : currentStage === "implementation" ? "implementation -> assumptions" : "N/A"}`,
          };
        }

        // Execute transition side effects based on current stage
        if (currentStage === "chat") {
          await transitionHandler.handleChatToAssumptionsTransition(
            "move to assumptions",
            conversationHistory,
            this.nativeToolsManager
          );
        }

        // Update stage in context
        contextManager.updateStage("assumptions", "move to assumptions");

        return {
          handled: true,
          shouldReturn: true,
          message: `✓ Transitioned to assumptions stage`,
        };
      }

      case "plan": {
        // @cmd:plan - Create or update implementation plan (assumptions stage only)
        // This command triggers plan generation without adding user message to history
        const currentStage = this.harmonyClient.getCurrentStage();

        if (currentStage !== "assumptions") {
          return {
            handled: true,
            shouldReturn: true,
            message: `❌ @cmd:plan can only be used in assumptions stage. Current stage: ${currentStage}`,
          };
        }

        // Mark that the user explicitly requested plan creation/update
        const contextManager = (this.harmonyClient as any).contextManager;
        contextManager.markPlanUpdatedByUser();

        // Replace the cleaned message with system instruction that won't be counted as a user request
        // This instructs the LLM to analyze EXISTING requests, not add a new request
        return {
          handled: true,
          shouldReturn: false,
          modifiedMessage:
            "SYSTEM INSTRUCTION: Analyze all user requests from the conversation history above and create a numbered implementation plan. Do NOT treat this instruction as a user request to be included in the plan.",
        };
      }

      case "move_to_chat": {
        const currentStage = this.harmonyClient.getCurrentStage();
        // Validate transition using state machine table
        if (!this.stageStateMachine.canTransition(currentStage, "chat")) {
          return {
            handled: true,
            shouldReturn: true,
            message: `Cannot transition to chat stage from ${currentStage}. Valid transitions: ${currentStage === "assumptions" ? "assumptions -> chat" : currentStage === "implementation" ? "implementation -> chat" : "N/A"}`,
          };
        }

        // Execute transition directly - no LLM call needed
        const contextManager = (this.harmonyClient as any).contextManager;
        const chatManager = this.harmonyClient.getChatManager();

        // Initialize chat manager if not already initialized
        if (!chatManager.hasContent()) {
          chatManager.initialize();
        }

        // Update stage in context
        contextManager.updateStage("chat", "move to chat");

        return {
          handled: true,
          shouldReturn: true,
          message: `✓ Transitioned to chat stage`,
        };
      }

      // step, auto, and verbose_info are now handled by state machine as events
      // They are detected by StageStateMachine.detectTrigger() and handled in stage handlers
      // Mark as handled=true to prevent adding to conversation history (these are system commands, not user requests)
      case "step":
      case "auto":
      case "verbose":
      case "verbose_info":
      case "verbose-info":
        // These commands are passed through to the state machine as triggers
        // They will be detected by StageStateMachine.detectTrigger() and handled in stage handlers
        // Return handled=true to prevent these system commands from being added to conversation history
        // This ensures the LLM doesn't misinterpret them as user requests
        // IMPORTANT: Preserve the original command by returning the full original text in modifiedMessage
        // This allows detectTrigger() to properly detect the verbose_info/step/auto triggers
        // instead of defaulting to "prompt" or "plan"
        return {
          handled: true,
          shouldReturn: false,
          modifiedMessage: remainingMessage
            ? `@cmd:${command} ${remainingMessage}`.trim()
            : `@cmd:${command}`,
        };

      case "convert": {
        // Convert DOCX/PDF file to markdown
        // Flow: chat (verify file, create plan) -> assumptions (pass through) -> implementation (execute)
        const currentStage = this.harmonyClient.getCurrentStage();

        // Parse: @cmd:convert filename.docx [targetType]
        // Example: @cmd:convert file.docx markdown
        // Example: @cmd:convert file.docx (defaults to markdown)
        const trimmed = remainingMessage.trim();

        // Match filename (with extension) and optional target type
        // Pattern: filename.ext [targetType]
        const match = trimmed.match(
          /^([\w.-\/\\]+\.(?:docx|pdf))(?:\s+(\w+))?$/i
        );
        if (!match) {
          return {
            handled: true,
            shouldReturn: true,
            message:
              "Usage: @cmd:convert filename.docx [targetType]\nExample: @cmd:convert file.docx markdown\n(If targetType is omitted, defaults to markdown)",
          };
        }

        const filename = match[1];
        const targetType = (match[2] || "markdown").toLowerCase();

        // Chat stage: Verify file exists and create default plan
        if (currentStage === "chat") {
          // Verify file exists using FileReader (lightweight check without reading file content)
          const fileExists = await this.fileReader.checkFileExists(filename);
          if (!fileExists) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: File "${filename}" not found. Please check the file path.`,
            };
          }

          // Check if conversion is supported
          if (!FileReader.isSupportedFile(filename)) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: File "${filename}" is not supported. Only .docx and .pdf files are supported.`,
            };
          }

          // Check if MCP tool is available
          const sourceType = filename.toLowerCase().endsWith(".docx")
            ? "docx"
            : "pdf";
          const toolName = this.getConversionToolName(sourceType, targetType);
          if (!toolName) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: Conversion from ${sourceType} to ${targetType} is not supported.`,
            };
          }

          const serverName = this.mcpManager.findToolServer(toolName);
          if (!serverName) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: MCP tool "${toolName}" not available. File conversion requires a configured MCP server with this tool.`,
            };
          }

          // Create default plan automatically
          // The plan will be created by the assumptions stage handler when it processes the message
          // Transition to assumptions stage with the convert command preserved
          if (
            !this.stageStateMachine.canTransition(currentStage, "assumptions")
          ) {
            return {
              handled: true,
              shouldReturn: true,
              message: `Cannot transition to assumptions stage from ${currentStage}`,
            };
          }

          // Preserve convert command for assumptions stage (which will pass through to implementation)
          const convertCommand = `@cmd:convert ${trimmed}`;
          return {
            handled: true,
            shouldReturn: false,
            newStage: "assumptions",
            modifiedMessage: convertCommand, // Preserve command for processing in assumptions stage
          };
        }

        // Assumptions stage: Detect command, verify MCP tool, transform message for LLM
        if (currentStage === "assumptions") {
          // Verify MCP tool is still available (safety check)
          const sourceType = filename.toLowerCase().endsWith(".docx")
            ? "docx"
            : "pdf";
          const toolName = this.getConversionToolName(sourceType, targetType);
          if (!toolName) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: Conversion from ${sourceType} to ${targetType} is not supported.`,
            };
          }

          const serverName = this.mcpManager.findToolServer(toolName);
          if (!serverName) {
            return {
              handled: true,
              shouldReturn: true,
              message: `❌ Error: MCP tool "${toolName}" not available. File conversion requires a configured MCP server with this tool.`,
            };
          }

          // Transform command to natural language for LLM
          // Remove @cmd:convert syntax and convert to natural language
          const naturalLanguageMessage = `Convert ${filename} to ${targetType} format`;

          return {
            handled: true,
            shouldReturn: false,
            modifiedMessage: naturalLanguageMessage, // Use natural language for assumptions stage planning
          };
        }

        // Implementation stage: Execute conversion
        if (currentStage === "implementation") {
          const result = await this.executeConversion(filename, targetType);
          return {
            handled: true,
            shouldReturn: true,
            message: result.message,
          };
        }

        // Unknown stage - try to transition to implementation
        if (
          this.stageStateMachine.canTransition(currentStage, "implementation")
        ) {
          const result = await this.executeConversion(filename, targetType);
          return {
            handled: true,
            shouldReturn: true,
            newStage: "implementation",
            message: result.message,
          };
        }

        return {
          handled: true,
          shouldReturn: true,
          message: `Cannot transition to implementation stage from ${currentStage}`,
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
  private async sendFileList(searchTerm: string = ""): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
      }

      // Get files from workspace (excluding large directories)
      const excludePatterns = [
        "**/node_modules/**",
        "**/.harmony/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.build/**",
        "**/out/**",
        "**/output/**",
        "**/.next/**",
        "**/target/**",
        "**/*.min.*",
        "**/*.bundle.*",
        "**/.cache/**",
        "**/coverage/**",
      ].join(",");
      const files = await vscode.workspace.findFiles("**/*", excludePatterns);

      // Format files for display
      let fileItems = files
        .map((file) => ({
          label: vscode.workspace.asRelativePath(file),
          path: vscode.workspace.asRelativePath(file),
        }))
        .filter((file) => {
          // Explicitly filter out .build folder and any files inside it
          const normalizedPath = file.path.replace(/\\/g, "/");
          return (
            !normalizedPath.includes("/.build/") &&
            !normalizedPath.startsWith(".build/")
          );
        });

      // Filter files based on search term (exact substring match)
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        fileItems = fileItems.filter((file) => {
          const fileName = file.label.toLowerCase();
          // Only match if the filename contains the exact search term as a substring
          return fileName.includes(searchLower);
        });
      }

      // Limit to 50 for performance
      fileItems = fileItems.slice(0, 50);

      console.log(
        `[Harmony] Sending ${fileItems.length} files for autocomplete${searchTerm ? ` (filtered by "${searchTerm}")` : ""}`
      );
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
        vscode.window.showWarningMessage("No workspace folder open");
        return;
      }

      // Open quick pick to select a file
      //const excludePatterns = '**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.min.*,**/*.bundle.*';

      const excludePatterns = [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.build/**",
        "**/out/**",
        "**/output/**",
        "**/.next/**",
        "**/target/**",
        "**/*.min.*",
        "**/*.bundle.*",
        "**/.cache/**",
        "**/coverage/**",
        "**/.vscode-test/**",
        "**/.harmony/**",
      ].join(",");

      const files = await vscode.workspace.findFiles("**/*", excludePatterns);

      const items = files
        .map((file) => ({
          label: vscode.workspace.asRelativePath(file),
          description: "",
          detail: file.fsPath,
          filePath: vscode.workspace.asRelativePath(file),
        }))
        .filter((item) => {
          // Explicitly filter out .build folder and any files inside it
          const normalizedPath = item.filePath.replace(/\\/g, "/");
          return (
            !normalizedPath.includes("/.build/") &&
            !normalizedPath.startsWith(".build/")
          );
        });

      // Sort alphabetically
      items.sort((a, b) => a.label.localeCompare(b.label));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a file to reference",
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false,
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
    // Auto mode is now tracked via trigger detection, no flag to clear
    console.log(`[Harmony] Conversation history and confirmations cleared`);
  }

  private async sendCodeContext(): Promise<void> {
    // Try to get the active editor first
    let editor = vscode.window.activeTextEditor;

    // If active editor is null or is the webview, use the last tracked text editor
    if (!editor || editor.document.uri.scheme === "vscode-webview") {
      editor = this.lastActiveTextEditor;
    }

    // If still no editor, try to get the first visible text editor
    if (!editor && vscode.window.visibleTextEditors.length > 0) {
      // Find the first editor that's not a webview
      editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme !== "vscode-webview"
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
      vscode.window.showWarningMessage(
        "No active file found. Please open a file in the editor first."
      );
    }
  }

  public async explainCode(): Promise<void> {
    await this.codeActions.explainCode();
  }

  /**
   * Read a file using the native tools manager
   */
  public async readFile(filePath: string): Promise<NativeToolResult> {
    return await this.nativeToolsManager.callTool("read_file", {
      file_path: filePath,
    });
  }

  async testReadFile(): Promise<void> {
    const testPath = "README.md"; // Common file in workspace root
    const result = await this.readFile(testPath);
    console.log(
      `Test read ${testPath}:`,
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
      assistant
        .getWebviewManager()
        .resolveWebviewView(webviewView, _context, _token);
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "harmonyChat",
      webviewViewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
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
      vscode.window.showInformationMessage("Conversation history cleared");
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
