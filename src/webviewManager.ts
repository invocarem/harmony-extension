import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { HarmonyResponse } from "./harmonyClient";
import { VerboseInfoFormatter, withDisplayString } from "./utils/verboseInfo";

export interface WebviewMessage {
    command: string;
    text?: string;
    context?: string;
    reasoning?: string;
    commentary?: string;
    final?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: { rulesCount?: number; mcpToolsCount?: number; files?: string[] };
    verboseInfo?: any; // VerboseInfo type - using any for webview compatibility
    verboseInfoDisplay?: string; // Formatted string for simple display
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

        // Don't show default message if verboseInfo is present (e.g., for @cmd:verbose-info)
        const content = response.content || (response.verboseInfo ? "" : "No response received from the model.");
        const reasoning = response.reasoning;
        const commentary = response.commentary;
        const final = response.final;

        // Format verbose info for display if present
        let verboseInfoDisplay: string | undefined;
        if (response.verboseInfo) {
            try {
                // Use formatter to convert verboseInfo to display string
                verboseInfoDisplay = VerboseInfoFormatter.format(response.verboseInfo);
            } catch (error: any) {
                console.warn(`[WebviewManager] Error formatting verbose info:`, error);
                // Fallback: use JSON stringify
                verboseInfoDisplay = JSON.stringify(response.verboseInfo, null, 2);
            }
        }

        console.log(`[DEBUG] Posting message to webview`);
        this.view.webview.postMessage({
            command: "receiveMessage",
            text: content,
            reasoning: reasoning,
            commentary: commentary,
            verboseInfo: response.verboseInfo, // Send raw verboseInfo for webview to use
            verboseInfoDisplay: verboseInfoDisplay, // Send formatted string for simple display
            final: final,
        });
        console.log(`[DEBUG] Message posted successfully`);
    }

    sendStreamingUpdate(text: string): void {
        if (!this.view) {
            console.warn('[WebviewManager] Cannot send streaming update: view is undefined');
            return;
        }

        console.log(`[WebviewManager] Sending streaming update, text length: ${text.length}, First 50 chars: ${text.substring(0, 50)}`);
        console.log(`[WebviewManager] View exists: ${!!this.view}, Webview exists: ${!!this.view.webview}`);
        
        // Use non-awaited postMessage to avoid message batching
        // postMessage is synchronous, so no await needed
        try {
            this.view.webview.postMessage({
                command: "streamingUpdate",
                text: text,
            });
            console.log(`[WebviewManager] postMessage sent successfully`);
        } catch (error) {
            console.error(`[WebviewManager] Error sending postMessage:`, error);
        }
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
        const htmlTemplatePath = path.join(this.context.extensionPath, 'dist', 'webview', 'index.html');
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
