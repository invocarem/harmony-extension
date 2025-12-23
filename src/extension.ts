import * as vscode from "vscode";
import * as path from "path";
import { loadConfig, LlamaConfig } from "./config";
import { LlamaClient } from "./llamaClient";
import { TemplateRenderer } from "./templateRenderer";
import { WebviewManager, WebviewMessage } from "./webviewManager";
import { CodeActions } from "./codeActions";
import { MCPManager } from "./mcpManager";
import { RulesManager } from "./rulesManager";
import { NativeToolsManager, NativeToolResult } from "./nativeToolManager";
import { ConversationManager, ChatMessage } from "./conversationManager";

export class HarmonyAssistant {
  private webviewManager: WebviewManager;
  private llamaClient: LlamaClient;
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
    this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
    this.templateRenderer = new TemplateRenderer(context);
    this.codeActions = new CodeActions(
      this.llamaClient,
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
        this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
        this.codeActions = new CodeActions(
          this.llamaClient,
          this.templateRenderer
        );
      } else if (event.affectsConfiguration("harmony")) {
        // Reload other config
        this.config = loadConfig();
        this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager, this.nativeToolsManager);
        this.codeActions = new CodeActions(
          this.llamaClient,
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
      await this.handleChatMessage(message.text || "");
    });

    // Get code context handler
    this.webviewManager.registerMessageHandler("getCodeContext", async () => {
      console.log(`[DEBUG] Handling getCodeContext`);
      await this.sendCodeContext();
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

    // Add user message to history
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
    };
    this.conversationManager.addMessage(userMessage);

    try {
      console.log(`[DEBUG] Calling Harmony server with ${this.conversationManager.getLength()} messages in history...`);
      const response = await this.llamaClient.callServer(
        text,
        "chat",
        (name, ctx) => this.templateRenderer.applyTemplate(name, ctx, this.conversationManager.getHistoryForTemplate()),
        false,
        this.conversationManager.getHistoryForTemplate() // Pass history for rule matching
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

      // Remove the user message from history since the request failed
      // (it was already added above, but we want to keep history consistent with successful requests only)
      this.conversationManager.removeMessage(userMessage);

      await this.webviewManager.sendMessage({
        content: `❌ Error: ${error.message}`,
      });
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
    assistant
  );
}

export function deactivate() {
  // Cleanup if needed
}
