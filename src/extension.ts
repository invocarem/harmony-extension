import * as vscode from "vscode";
import * as path from "path";
import { loadConfig, LlamaConfig } from "./config";
import { LlamaClient } from "./llamaClient";
import { TemplateRenderer } from "./templateRenderer";
import { WebviewManager, WebviewMessage } from "./webviewManager";
import { CodeActions } from "./codeActions";
import { MCPManager } from "./mcpManager";
import { RulesManager } from "./rulesManager";

export class HarmonyAssistant {
  private webviewManager: WebviewManager;
  private llamaClient: LlamaClient;
  private templateRenderer: TemplateRenderer;
  private codeActions: CodeActions;
  private config: LlamaConfig;
  private mcpManager: MCPManager;
  private rulesManager: RulesManager;

  constructor(context: vscode.ExtensionContext) {
    this.config = loadConfig();
    this.webviewManager = new WebviewManager(context);
    this.mcpManager = new MCPManager();
    this.rulesManager = new RulesManager();
    this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager);
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
        this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager);
        this.codeActions = new CodeActions(
          this.llamaClient,
          this.templateRenderer
        );
      } else if (event.affectsConfiguration("harmony")) {
        // Reload other config
        this.config = loadConfig();
        this.llamaClient = new LlamaClient(this.config, this.mcpManager, this.rulesManager);
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

    try {
      console.log(`[DEBUG] Calling Harmony server...`);
      const response = await this.llamaClient.callServer(
        text,
        "chat",
        (name, ctx) => this.templateRenderer.applyTemplate(name, ctx)
      );
      console.log(
        `[Harmony] Sending response to webview. Content length: ${response.content?.length || 0}`
      );

      await this.webviewManager.sendMessage(response);
    } catch (error: any) {
      console.error(`[Harmony] Error in handleChatMessage:`, error);

      await this.webviewManager.sendMessage({
        content: `❌ Error: ${error.message}`,
      });
    }
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

  public async testFormat(): Promise<void> {
    // Test with Harmony tokens AND markdown
    const testResponse = `<|thinking|>Let me think about this response carefully...<|end|><|assistant|>final<|message|>Hello! 👋 I'm here to help you with any coding questions you have<|end|>assistant<|eoa|><|assistant|>final<|message|>**Hi!** How can I assist you today?

## Example Code
Here's some \`code\`:
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`

**Key Points:**
1. This is a list item
2. Another item

<|eoa|>`;

    console.log("[Test] =========== RAW RESPONSE ===========");
    console.log(testResponse);
    console.log("[Test] =========== CLEANED RESPONSE ===========");
    const cleaned = this.llamaClient.cleanHarmonyResponse(testResponse);
    console.log(cleaned);

    vscode.window.showInformationMessage(
      `Test cleaned: ${cleaned.content.substring(0, 80)}...${
        cleaned.reasoning
          ? ` (Reasoning: ${cleaned.reasoning.substring(0, 40)}...)`
          : ""
      }`
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
      assistant.testFormat();
    }),
    assistant
  );
}

export function deactivate() {
  // Cleanup if needed
}
