/**
 * Main webview entry point
 */

import { WebviewToExtensionMessage } from './types';
import { addMessage, addTypingIndicator } from './modules/ui';
import { checkForAutocomplete, handleAutocompleteKeyboard, hideAutocomplete, insertFileReference } from './modules/autocomplete';
import { handleExtensionMessage } from './modules/messageHandler';

declare const acquireVsCodeApi: () => {
    postMessage: (message: WebviewToExtensionMessage) => void;
};

const vscode = acquireVsCodeApi();
console.log('Webview: VS Code API acquired');

const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
const contextButton = document.getElementById('contextButton') as HTMLButtonElement;
const fileButton = document.getElementById('fileButton') as HTMLButtonElement;
const autocompleteDropdown = document.getElementById('autocompleteDropdown') as HTMLDivElement;
const shortcutHint = document.getElementById('shortcutHint') as HTMLDivElement;

console.log('Webview: Elements initialized:', {
    messagesDiv: !!messagesDiv,
    messageInput: !!messageInput,
    sendButton: !!sendButton,
    contextButton: !!contextButton,
    fileButton: !!fileButton,
    autocompleteDropdown: !!autocompleteDropdown
});

// Send test message to verify communication
setTimeout(() => {
    console.log('Webview: Sending test message...');
    vscode.postMessage({ command: 'test', text: 'webview-ready' });
}, 100);

// Send button click handler
sendButton.addEventListener('click', () => {
    const text = messageInput.value.trim();
    console.log('Webview: Send button clicked, text:', text);
    if (text) {
        addMessage(text, true, undefined, undefined);
        addTypingIndicator();
        vscode.postMessage({
            command: 'sendMessage',
            text: text
        });
        messageInput.value = '';
        hideAutocomplete();
        messageInput.focus();
    }
});

// Input event for autocomplete
messageInput.addEventListener('input', () => {
    checkForAutocomplete();
});

// Unified keyboard handler for Enter key, autocomplete navigation, and shortcuts
messageInput.addEventListener('keydown', (e) => {
    // Handle autocomplete navigation when dropdown is open
    if (autocompleteDropdown.style.display === 'block') {
        const handled = handleAutocompleteKeyboard(e);
        if (handled) {
            return;
        }
        // If Enter was pressed but no item selected, autocomplete closed it
        // Continue to send message below
    }
    
    // Enter key: Send message (Shift+Enter for new line)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendButton.click();
        return;
    }
    
    // Ctrl+F shortcut to insert file reference
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        vscode.postMessage({
            command: 'insertFileReference'
        });
    }
});

// Click outside to hide autocomplete
document.addEventListener('click', (e) => {
    if (!autocompleteDropdown.contains(e.target as Node) && e.target !== messageInput) {
        hideAutocomplete();
    }
});

// Context button
contextButton.addEventListener('click', () => {
    vscode.postMessage({
        command: 'getCodeContext'
    });
});

// File button
fileButton.addEventListener('click', () => {
    vscode.postMessage({
        command: 'insertFileReference'
    });
});

// Listen for messages from extension
window.addEventListener('message', (event) => {
    handleExtensionMessage(event.data);
});

// Focus input on load and add hint
messageInput.focus();

// Show/hide shortcut hint
messageInput.addEventListener('focus', () => {
    shortcutHint.style.display = 'block';
});

messageInput.addEventListener('blur', () => {
    shortcutHint.style.display = 'none';
});

