/**
 * Message handling between webview and extension
 */

import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types';
import { addMessage, removeTypingIndicator, updateLastUserMessageContextSummary } from './ui';
import { populateAutocomplete, insertFileReference, checkForAutocomplete } from './autocomplete';

declare const vscode: {
    postMessage: (message: WebviewToExtensionMessage) => void;
};

const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;

export function handleExtensionMessage(message: ExtensionToWebviewMessage): void {
    console.log('Webview: Received message from extension:', message.command);
    
    switch (message.command) {
        case 'receiveMessage':
            removeTypingIndicator();
            addMessage(message.text || '', false, message.reasoning, undefined, message.verboseInfo);
            break;
        case 'updateContext':
            if (message.context) {
                messageInput.value = 'Context: ' + message.context + '\n\n' + messageInput.value;
                messageInput.focus();
            }
            break;
        case 'updateContextSummary':
            if (message.contextSummary) {
                updateLastUserMessageContextSummary(message.contextSummary);
            }
            break;
        case 'showFileAutocomplete':
            console.log('Webview: Received file list with', (message.files || []).length, 'files');
            populateAutocomplete(message.files || []);
            break;
        case 'insertText':
            if (message.text) {
                const cursorPos = messageInput.selectionStart;
                const textBefore = messageInput.value.substring(0, cursorPos);
                const textAfter = messageInput.value.substring(cursorPos);
                
                messageInput.value = textBefore + message.text + textAfter;
                messageInput.focus();
                messageInput.selectionStart = cursorPos + message.text.length;
                messageInput.selectionEnd = cursorPos + message.text.length;
                
                // Trigger autocomplete check if it's a file reference
                if (message.text.includes('@file')) {
                    setTimeout(checkForAutocomplete, 100);
                }
            }
            break;
    }
}

