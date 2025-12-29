import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { HarmonyResponse } from "./harmonyClient";

export interface WebviewMessage {
    command: string;
    text?: string;
    context?: string;
    reasoning?: string;
    final?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: { rulesCount?: number; mcpToolsCount?: number; files?: string[] };
    verboseInfo?: {
        stage?: 'chat' | 'assumptions' | 'implementation';
        stageTransition?: {
            from: 'chat' | 'assumptions' | 'implementation';
            to: 'chat' | 'assumptions' | 'implementation';
        };
        step?: number;
        maxSteps?: number;
        isComplete?: boolean;
        toolCalls?: Array<{
            name: string;
            stage: 'chat' | 'assumptions' | 'implementation';
            success: boolean;
            error?: string;
        }>;
    };
}

export class WebviewManager {
    private view: vscode.WebviewView | undefined;
    private messageHandlerDisposable: vscode.Disposable | undefined;
    private messageHandlers: Map<
        string,
        (message: WebviewMessage) => Promise<void> | void
    > = new Map();
    private onViewDisposeCallback: (() => void) | undefined;

    constructor(private context: vscode.ExtensionContext) { }

    setOnViewDispose(callback: () => void): void {
        this.onViewDisposeCallback = callback;
    }

    // Alias for backward compatibility
    setOnPanelDispose(callback: () => void): void {
        this.setOnViewDispose(callback);
    }

    registerMessageHandler(
        command: string,
        handler: (message: WebviewMessage) => Promise<void> | void
    ): void {
        this.messageHandlers.set(command, handler);
    }

    async openChat(): Promise<void> {
        console.log(`[DEBUG] openChat called`);

        // If view exists, show it
        if (this.view) {
            console.log(`[DEBUG] View exists, showing...`);
            this.view.show(true); // Show and focus the view
        } else {
            // The view will be created by the provider when the sidebar is opened
            // We can try to reveal the Harmony sidebar container
            await vscode.commands.executeCommand('workbench.view.extension.harmony');
            console.log(`[DEBUG] View will be created by provider when sidebar is opened`);
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void {
        console.log(`[DEBUG] Resolving webview view...`);
        
        this.view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
            ]
        };

        console.log(`[DEBUG] Setting webview HTML...`);
        webviewView.webview.html = this.getWebviewContent();

        webviewView.onDidDispose(() => {
            console.log(`[DEBUG] View disposed`);
            this.view = undefined;
            if (this.messageHandlerDisposable) {
                this.messageHandlerDisposable.dispose();
                this.messageHandlerDisposable = undefined;
            }
            // Call the dispose callback if registered
            if (this.onViewDisposeCallback) {
                this.onViewDisposeCallback();
            }
        });

        this.setupMessageHandler();
    }

    private setupMessageHandler(): void {
        if (!this.view) {
            console.error(`[DEBUG] Cannot setup message handler - view is undefined`);
            return;
        }

        // Dispose previous handler if it exists
        if (this.messageHandlerDisposable) {
            this.messageHandlerDisposable.dispose();
        }

        console.log(`[DEBUG] Setting up message handler...`);
        this.messageHandlerDisposable = this.view.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                console.log(`[DEBUG] Webview message received:`, message);

                if (!message || !message.command) {
                    console.error(`[DEBUG] Invalid message received:`, message);
                    return;
                }

                try {
                    const handler = this.messageHandlers.get(message.command);
                    if (handler) {
                        await handler(message);
                    } else {
                        console.warn(`[DEBUG] Unknown command:`, message.command);
                    }
                } catch (error: any) {
                    console.error(`[DEBUG] Error handling message:`, error);
                    if (this.view) {
                        this.view.webview.postMessage({
                            command: "receiveMessage",
                            text: `❌ Error processing request: ${error.message}`,
                        });
                    }
                }
            }
        );
    }

    async sendMessage(response: HarmonyResponse): Promise<void> {
        if (!this.view) {
            console.error(`[DEBUG] View is undefined!`);
            return;
        }

        const content = response.content || "No response received from the model.";
        const reasoning = response.reasoning;
        const verboseInfo = response.verboseInfo;
        const final = response.final;

        console.log(`[DEBUG] Posting message to webview`);
        this.view.webview.postMessage({
            command: "receiveMessage",
            text: content,
            reasoning: reasoning,
            verboseInfo: verboseInfo,
            final: final,
        });
        console.log(`[DEBUG] Message posted successfully`);
    }

    async sendCodeContext(context: string): Promise<void> {
        if (!this.view) {
            return;
        }

        this.view.webview.postMessage({
            command: "updateContext",
            context: context,
        });
    }

    async sendFileList(files: Array<{ label: string; path: string }>): Promise<void> {
        if (!this.view) {
            return;
        }

        this.view.webview.postMessage({
            command: "showFileAutocomplete",
            files: files,
        });
    }

    async insertTextIntoInput(text: string): Promise<boolean> {
        if (!this.view) {
            console.warn('[WebviewManager] Cannot insert text: view is closed');
            return false;
        }

        try {
            this.view.webview.postMessage({
                command: "insertText",
                text: text
            });
            return true;
        } catch (error) {
            console.error('[WebviewManager] Error inserting text:', error);
            return false;
        }
    }

    async updateContextSummary(contextSummary: { rulesCount?: number; mcpToolsCount?: number; files?: string[] }): Promise<void> {
        if (!this.view) {
            return;
        }

        this.view.webview.postMessage({
            command: "updateContextSummary",
            contextSummary: contextSummary,
        });
    }

    private getWebviewContent(): string {
        if (!this.view) {
            return '';
        }

        // Get URIs for webview resources
        const scriptUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js')
        );
        const stylesUri = this.view.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'styles.css')
        );

        // Read HTML template
        const htmlTemplatePath = path.join(this.context.extensionPath, 'src', 'webview', 'index.html');
        let html = '';
        try {
            html = fs.readFileSync(htmlTemplatePath, 'utf8');
        } catch (error) {
            console.error('[WebviewManager] Error reading HTML template:', error);
            // Fallback HTML if template file is not found
            html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Harmony</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
    <div class="chat-container">
        <div id="messages" class="messages"></div>
        <div class="input-container">
            <div class="shortcut-hint" id="shortcutHint">Ctrl+F to insert file</div>
            <textarea id="messageInput" placeholder="Type your message... Use @file to include file context..." autofocus rows="3"></textarea>
            <button id="sendButton">Send</button>
            <button id="contextButton" title="Send current file context">📄</button>
            <button id="fileButton" title="Insert file reference">📁</button>
            <div id="autocompleteDropdown" class="autocomplete-dropdown"></div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
        }

        // Replace placeholders in template
        html = html.replace('{{stylesUri}}', stylesUri.toString());
        html = html.replace('{{scriptUri}}', scriptUri.toString());

        return html;
    }

    dispose(): void {
        // WebviewView doesn't need explicit disposal, it's managed by VS Code
        if (this.messageHandlerDisposable) {
            this.messageHandlerDisposable.dispose();
            this.messageHandlerDisposable = undefined;
        }
        this.view = undefined;
    }
}
