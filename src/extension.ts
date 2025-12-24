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

  constructor(context: vscode.ExtensionContext) {
    this.config = loadConfig();
    this.webviewManager = new WebviewManager(context);
    this.mcpManager = new MCPManager();
    this.rulesManager = new RulesManager();
    this.nativeToolsManager = new NativeToolsManager();
    this.conversationManager = new ConversationManager();
    this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
    this.templateRenderer = new TemplateRenderer(context, this.config.harmonyMode);
    this.codeActions = new CodeActions(
      this.harmonyClient,
      this.templateRenderer
    );

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
        this.codeActions = new CodeActions(
          this.harmonyClient,
          this.templateRenderer
        );
      } else if (event.affectsConfiguration("harmony")) {
        // Reload other config
        this.config = loadConfig();
        this.harmonyClient = new HarmonyClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
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
        content: "✅ Webview communication test successful! You can now send messages.",
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
    this.webviewManager.registerMessageHandler("requestFileList", async () => {
      console.log(`[DEBUG] Handling requestFileList`);
      await this.sendFileList();
    });

    // Insert file reference handler
    this.webviewManager.registerMessageHandler("insertFileReference", async () => {
      console.log(`[DEBUG] Handling insertFileReference`);
      await this.showFilePicker();
    });
  }

  public async openChat(): Promise<void> {
    await this.webviewManager.openChat();
  }

  private async handleChatMessage(text: string): Promise<void> {
    console.log(
      `[DEBUG] handleChatMessage called with text:`,
      text?.substring(0, 100)
    );

    try {
      // Extract file references and clean the message
      const { cleanMessage, fileContexts } = await FileContextExtractor.extractFileReferences(text);
      
      let finalMessage = cleanMessage;
      let fileContextText = '';
      
      if (fileContexts.length > 0) {
        fileContextText = FileContextExtractor.formatFileContexts(fileContexts);
        console.log(`[Harmony] Added ${fileContexts.length} file context(s) to message`);
        
        // Add file context to the message
        finalMessage = fileContextText + '\n\n' + 'USER REQUEST:\n' + finalMessage;
      }

      // Add user message to history (store original message)
      const userMessage: ChatMessage = {
        role: 'user',
        content: text, // Store original message with @file references
      };
      this.conversationManager.addMessage(userMessage);

      console.log(`[DEBUG] Calling Harmony server with ${this.conversationManager.getLength()} messages in history...`);
      const response = await this.harmonyClient.callServer(
        finalMessage, // Use message with file context
        "chat",
        (name, ctx) => this.templateRenderer.applyTemplate(name, ctx, this.conversationManager.getHistoryForTemplate()),
        false,
        this.conversationManager.getHistoryForTemplate()
      );
      
      console.log(
        `[Harmony] Sending response to webview. Content length: ${response.content?.length || 0}`
      );

      // Add assistant response to history
      this.conversationManager.addMessage({
        role: 'assistant',
        content: response.content,
        reasoning: response.reasoning,
      });

      await this.webviewManager.sendMessage(response);
    } catch (error: any) {
      console.error(`[Harmony] Error in handleChatMessage:`, error);
      await this.webviewManager.sendMessage({
        content: `❌ Error: ${error.message}`,
      });
    }
  }

  /**
   * Send file list to webview for autocomplete
   */
  private async sendFileList(): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
      }

      // Get files from workspace (excluding large directories)
      const excludePatterns = '**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.min.*,**/*.bundle.*';
      const files = await vscode.workspace.findFiles('**/*', excludePatterns);
      
      // Format files for display (limit to 50 for performance)
      const fileItems = files.slice(0, 50).map(file => ({
        label: vscode.workspace.asRelativePath(file),
        path: vscode.workspace.asRelativePath(file)
      }));

      console.log(`[Harmony] Sending ${fileItems.length} files for autocomplete`);
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
        '**/.next/**',
        '**/target/**',
        '**/*.min.*',
        '**/*.bundle.*',
        '**/.cache/**',
        '**/coverage/**',
        '**/.vscode-test/**'
      ].join(',');
      

      const files = await vscode.workspace.findFiles('**/*', excludePatterns);
      
      const items = files.map(file => ({
        label: vscode.workspace.asRelativePath(file),
        description: '',
        detail: file.fsPath,
        filePath: vscode.workspace.asRelativePath(file)
      }));

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
    console.log(`[Harmony] Conversation history cleared`);
  }

  private async sendCodeContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
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
    }
  }

  public async explainCode(): Promise<void> {
    await this.codeActions.explainCode();
  }

  public async refactorCode(): Promise<void> {
    await this.codeActions.refactorCode();
  }

  public async generateCode(): Promise<void> {
    await this.codeActions.generateCode();
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
    this.webviewManager.dispose();
    this.mcpManager.dispose();
    this.rulesManager.dispose();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const assistant = new HarmonyAssistant(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("harmony.chat", () => {
      assistant.openChat();
    }),
    vscode.commands.registerCommand("harmony.explain", () => {
      assistant.explainCode();
    }),
    vscode.commands.registerCommand("harmony.refactor", () => {
      assistant.refactorCode();
    }),
    vscode.commands.registerCommand("harmony.generate", () => {
      assistant.generateCode();
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