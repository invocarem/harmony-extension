import * as vscode from "vscode";
import * as path from "path";
import { LlamaResponse } from "./llamaClient";

const webviewStyles = `
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            line-height: 1.5;
        }
        .chat-container {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 40px);
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
            background: var(--vscode-input-background);
        }
        .message {
            margin: 15px 0;
            padding: 12px 15px;
            border-radius: 8px;
            max-width: 85%;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .user-message {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
            border-bottom-right-radius: 2px;
        }
        .assistant-message {
            background: var(--vscode-editor-inactiveSelectionBackground);
            margin-right: auto;
            white-space: pre-wrap;
            border-bottom-left-radius: 2px;
        }
        .reasoning-section {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            padding: 10px 15px;
            margin: 10px 0;
            border-radius: 4px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        .reasoning-header {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-editor-foreground);
            font-size: 0.95em;
        }
        .input-container {
            display: flex;
            gap: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-input-border);
        }
        input {
            flex: 1;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 14px;
        }
        button {
            padding: 12px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            transition: opacity 0.2s;
        }
        button:hover {
            opacity: 0.9;
        }
        button:active {
            opacity: 0.8;
        }
        .code-block {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            border-radius: 4px;
            padding: 0;
            margin: 15px 0;
            font-family: var(--vscode-editor-font-family);
            overflow: hidden;
        }
        .code-lang {
            background: var(--vscode-textBlockQuote-border);
            color: var(--vscode-editor-foreground);
            padding: 6px 12px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            border-bottom: 1px solid var(--vscode-input-border);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .code-block pre {
            margin: 0;
            padding: 12px;
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.4;
        }
        .code-block code {
            font-family: var(--vscode-editor-font-family);
        }
        h1, h2, h3, h4 {
            margin: 20px 0 10px 0;
            color: var(--vscode-editor-foreground);
            font-weight: 600;
        }
        h1 { font-size: 1.4em; }
        h2 { font-size: 1.3em; }
        h3 { font-size: 1.2em; }
        h4 { font-size: 1.1em; }
        ul, ol {
            margin: 10px 0;
            padding-left: 25px;
        }
        li {
            margin: 6px 0;
        }
        blockquote {
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            padding-left: 15px;
            margin: 15px 0;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        hr {
            border: none;
            border-top: 1px solid var(--vscode-input-border);
            margin: 20px 0;
        }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: underline;
        }
        a:hover {
            text-decoration: none;
        }
        code:not(.code-block code) {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        strong {
            font-weight: 600;
        }
        em {
            font-style: italic;
        }
        .message img {
            max-width: 100%;
            border-radius: 4px;
            margin: 5px 0;
        }
        .timestamp {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
            text-align: right;
        }
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-input-border);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .typing-indicator {
            display: flex;
            gap: 4px;
            padding: 8px 12px;
        }
        .typing-dot {
            width: 8px;
            height: 8px;
            background: var(--vscode-descriptionForeground);
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
            border: 1px solid var(--vscode-input-border);
        }
        th, td {
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background: var(--vscode-textBlockQuote-background);
            font-weight: 600;
            color: var(--vscode-editor-foreground);
        }
        tr:nth-child(even) {
            background: var(--vscode-textBlockQuote-background);
        }
`;

export interface WebviewMessage {
  command: string;
  text?: string;
  context?: string;
  reasoning?: string;
}

export class WebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private messageHandlerDisposable: vscode.Disposable | undefined;
  private messageHandlers: Map<
    string,
    (message: WebviewMessage) => Promise<void> | void
  > = new Map();

  constructor(private context: vscode.ExtensionContext) {}

  registerMessageHandler(
    command: string,
    handler: (message: WebviewMessage) => Promise<void> | void
  ): void {
    this.messageHandlers.set(command, handler);
  }

  async openChat(): Promise<void> {
    console.log(`[DEBUG] openChat called`);

    if (this.panel) {
      console.log(`[DEBUG] Panel already exists, revealing...`);
      this.panel.reveal();
      return;
    }

    console.log(`[DEBUG] Creating new panel...`);
    this.panel = vscode.window.createWebviewPanel(
      "harmonyChat",
      "Harmony",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
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

  async sendMessage(response: LlamaResponse): Promise<void> {
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

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Harmony</title>
    <style>${webviewStyles}</style>
</head>
<body>
    <div class="chat-container">
        <div id="messages" class="messages"></div>
        <div class="input-container">
            <input id="messageInput" type="text" placeholder="Type your message..." autofocus>
            <button id="sendButton">Send</button>
            <button id="contextButton" title="Send current file context">📄</button>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        console.log('Webview: VS Code API acquired');
        
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const contextButton = document.getElementById('contextButton');
        
        console.log('Webview: Elements initialized:', {
            messagesDiv: !!messagesDiv,
            messageInput: !!messageInput,
            sendButton: !!sendButton,
            contextButton: !!contextButton
        });
        
        // Send test message to verify communication
        setTimeout(() => {
            console.log('Webview: Sending test message...');
            vscode.postMessage({ command: 'test', text: 'webview-ready' });
        }, 100);
        
        // Markdown formatting functions
        function formatMarkdown(text) {
            if (!text) return '';
            
            let formatted = text;
            
            // Store code blocks with placeholders to protect them from markdown processing
            const codeBlocks = [];
            let codeBlockIndex = 0;
            
            // Extract code blocks first (before processing headers)
            formatted = formatted.replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, 
                function(match, lang, code) {
                    const placeholder = \`__CODE_BLOCK_\${codeBlockIndex}__\`;
                    codeBlocks[codeBlockIndex] = { lang, code };
                    codeBlockIndex++;
                    return placeholder;
                }
            );
            
            // Now process markdown (headers, etc.) - code blocks are protected
            // Headers
            formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
            formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');
            formatted = formatted.replace(/^# (.*$)/gim, '<h1>$1</h1>');
            
            // Bold and Italic
            formatted = formatted.replace(/\\*\\*\\*(.*?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
            formatted = formatted.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
            formatted = formatted.replace(/\\*(.*?)\\*/g, '<em>$1</em>');
            
            // Inline code (but not code blocks which are already replaced)
            formatted = formatted.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
            
            // Links
            formatted = formatted.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
            
            // Lists
            formatted = formatted.replace(/^\\s*[-*+]\\s+(.+)$/gm, '<li>$1</li>');
            formatted = formatted.replace(/(<li>.*<\\/li>)/g, '<ul>$1</ul>');
            
            // Blockquotes
            formatted = formatted.replace(/^>\\s+(.+)$/gm, '<blockquote>$1</blockquote>');
            
            // Restore code blocks with proper HTML formatting
            for (let i = 0; i < codeBlocks.length; i++) {
                const placeholder = \`__CODE_BLOCK_\${i}__\`;
                const { lang, code } = codeBlocks[i];
                const languageClass = lang ? \`language-\${lang}\` : '';
                const codeBlockHtml = \`<div class="code-block">
                              \${lang ? \`<div class="code-lang">\${lang}</div>\` : ''}
                              <pre><code class="\${languageClass}">\${escapeHtml(code)}</code></pre>
                            </div>\`;
                formatted = formatted.replace(placeholder, codeBlockHtml);
            }
            
            // Line breaks (after code blocks are restored)
            formatted = formatted.replace(/\\n/g, '<br>');
            
            return formatted;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function addMessage(text, isUser, reasoning) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${isUser ? 'user-message' : 'assistant-message'}\`;
            
            // Add reasoning section if present
            if (reasoning && !isUser && reasoning.trim()) {
                const reasoningDiv = document.createElement('div');
                reasoningDiv.className = 'reasoning-section';
                reasoningDiv.innerHTML = '<div class="reasoning-header">💭 Reasoning</div>' + formatMarkdown(reasoning);
                messageDiv.appendChild(reasoningDiv);
            }
            
            // Format markdown and add content
            let formattedText = formatMarkdown(text);
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = formattedText || (isUser ? '' : 'No response received.');
            messageDiv.appendChild(contentDiv);
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            
            // Add timestamp for user messages
            if (isUser) {
                const timestamp = document.createElement('div');
                timestamp.className = 'timestamp';
                timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                messageDiv.appendChild(timestamp);
            }
        }
        
        function addTypingIndicator() {
            const indicator = document.createElement('div');
            indicator.className = 'message assistant-message typing-indicator';
            indicator.id = 'typing-indicator';
            indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
            messagesDiv.appendChild(indicator);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function removeTypingIndicator() {
            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
        
        // Send button click handler
        sendButton.addEventListener('click', () => {
            const text = messageInput.value.trim();
            console.log('Webview: Send button clicked, text:', text);
            if (text) {
                addMessage(text, true);
                addTypingIndicator();
                vscode.postMessage({
                    command: 'sendMessage',
                    text: text
                });
                messageInput.value = '';
                messageInput.focus();
            }
        });
        
        // Enter key handler
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendButton.click();
            }
        });
        
        // Context button
        contextButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'getCodeContext'
            });
        });
        
        // Listen for messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            console.log('Webview: Received message from extension:', message.command);
            
            switch (message.command) {
                case 'receiveMessage':
                    removeTypingIndicator();
                    addMessage(message.text, false, message.reasoning);
                    break;
                case 'updateContext':
                    if (message.context) {
                        messageInput.value = 'Context: ' + message.context + '\\n\\n' + messageInput.value;
                        messageInput.focus();
                    }
                    break;
            }
        });
        
        // Focus input on load
        messageInput.focus();
    </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

