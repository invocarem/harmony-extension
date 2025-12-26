import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { HarmonyResponse } from "./harmonyClient";

export interface WebviewMessage {
    command: string;
    text?: string;
    context?: string;
    reasoning?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: { rulesCount?: number; mcpToolsCount?: number; files?: string[] };
}

export class WebviewManager {
    private panel: vscode.WebviewPanel | undefined;
    private messageHandlerDisposable: vscode.Disposable | undefined;
    private messageHandlers: Map<
        string,
        (message: WebviewMessage) => Promise<void> | void
    > = new Map();
    private onPanelDisposeCallback: (() => void) | undefined;

    constructor(private context: vscode.ExtensionContext) { }

    setOnPanelDispose(callback: () => void): void {
        this.onPanelDisposeCallback = callback;
    }

    registerMessageHandler(
        command: string,
        handler: (message: WebviewMessage) => Promise<void> | void
    ): void {
        this.messageHandlers.set(command, handler);
    }

    async openChat(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Two): Promise<void> {
        console.log(`[DEBUG] openChat called with viewColumn: ${viewColumn}`);

        if (this.panel) {
            console.log(`[DEBUG] Panel already exists, revealing...`);
            this.panel.reveal(viewColumn); // Reveal in specified column
            return;
        }

        console.log(`[DEBUG] Creating new panel...`);
        this.panel = vscode.window.createWebviewPanel(
            "harmonyChat",
            "Harmony",
            viewColumn, // Use the specified column
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
                ]
            }
        );

        console.log(`[DEBUG] Setting webview HTML...`);
        this.panel.webview.html = this.getWebviewContent();

        this.panel.onDidDispose(() => {
            console.log(`[DEBUG] Panel disposed`);
            this.panel = undefined;
            if (this.messageHandlerDisposable) {
                this.messageHandlerDisposable.dispose();
                this.messageHandlerDisposable = undefined;
            }
            // Call the dispose callback if registered
            if (this.onPanelDisposeCallback) {
                this.onPanelDisposeCallback();
            }
        });

        this.setupMessageHandler();
    }

    private setupMessageHandler(): void {
        if (!this.panel) {
            console.error(`[DEBUG] Cannot setup message handler - panel is undefined`);
            return;
        }

        // Dispose previous handler if it exists
        if (this.messageHandlerDisposable) {
            this.messageHandlerDisposable.dispose();
        }

        console.log(`[DEBUG] Setting up message handler...`);
        this.messageHandlerDisposable = this.panel.webview.onDidReceiveMessage(
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
                    if (this.panel) {
                        this.panel.webview.postMessage({
                            command: "receiveMessage",
                            text: `❌ Error processing request: ${error.message}`,
                        });
                    }
                }
            }
        );
    }

    async sendMessage(response: HarmonyResponse): Promise<void> {
        if (!this.panel) {
            console.error(`[DEBUG] Panel is undefined!`);
            return;
        }

        const content = response.content || "No response received from the model.";
        const reasoning = response.reasoning;

        console.log(`[DEBUG] Posting message to webview`);
        this.panel.webview.postMessage({
            command: "receiveMessage",
            text: content,
            reasoning: reasoning,
        });
        console.log(`[DEBUG] Message posted successfully`);
    }

    async sendCodeContext(context: string): Promise<void> {
        if (!this.panel) {
            return;
        }

        this.panel.webview.postMessage({
            command: "updateContext",
            context: context,
        });
    }

    async sendFileList(files: Array<{ label: string; path: string }>): Promise<void> {
        if (!this.panel) {
            return;
        }

        this.panel.webview.postMessage({
            command: "showFileAutocomplete",
            files: files,
        });
    }

    async insertTextIntoInput(text: string): Promise<boolean> {
        if (!this.panel) {
            console.warn('[WebviewManager] Cannot insert text: panel is closed');
            return false;
        }

        try {
            this.panel.webview.postMessage({
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
        if (!this.panel) {
            return;
        }

        this.panel.webview.postMessage({
            command: "updateContextSummary",
            contextSummary: contextSummary,
        });
    }

    private getWebviewContent(): string {
        if (!this.panel) {
            return '';
        }

        // Get URIs for webview resources
        const scriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js')
        );
        const stylesUri = this.panel.webview.asWebviewUri(
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
        this.panel?.dispose();
    }
}
