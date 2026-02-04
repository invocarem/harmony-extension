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

// Stage transition arrows
const arrowChatToAssumptions = document.getElementById('arrow-chat-to-assumptions');
const arrowAssumptionsToImplementation = document.getElementById('arrow-assumptions-to-implementation');
const buttonNextStep = document.getElementById('button-next-step');

if (arrowChatToAssumptions) {
    arrowChatToAssumptions.addEventListener('click', () => {
        // Don't allow transition if arrow is disabled
        if (arrowChatToAssumptions.classList.contains('disabled')) {
            return;
        }
        // Send message using @cmd:move_to_assumptions format
        const message = '@cmd:move_to_assumptions';
        addMessage(message, true, undefined, undefined);
        addTypingIndicator();
        vscode.postMessage({
            command: 'sendMessage',
            text: message
        });
        messageInput.focus();
    });
}

if (arrowAssumptionsToImplementation) {
    arrowAssumptionsToImplementation.addEventListener('click', () => {
        // Don't allow transition if arrow is disabled
        if (arrowAssumptionsToImplementation.classList.contains('disabled')) {
            return;
        }
        // Send message using @cmd:move_to_implementation format
        const message = '@cmd:move_to_implementation';
        addMessage(message, true, undefined, undefined);
        addTypingIndicator();
        vscode.postMessage({
            command: 'sendMessage',
            text: message
        });
        messageInput.focus();
    });
}

if (buttonNextStep) {
    buttonNextStep.addEventListener('click', () => {
        // Don't allow action if button is disabled
        if (buttonNextStep.classList.contains('disabled')) {
            return;
        }
        // Send @cmd:step command
        const message = '@cmd:step';
        addMessage(message, true, undefined, undefined);
        addTypingIndicator();
        vscode.postMessage({
            command: 'sendMessage',
            text: message
        });
        messageInput.focus();
    });
}

// Listen for messages from extension
window.addEventListener('message', (event) => {
    handleExtensionMessage(event.data);
});

// Initialize stage indicator to chat (since init transitions to chat immediately)
import { updateStageIndicator } from './modules/ui';
updateStageIndicator('chat');

// Focus input on load and add hint
messageInput.focus();

// Initialize stage arrows as disabled (will be enabled when stage is known)
if (arrowChatToAssumptions) {
    arrowChatToAssumptions.classList.add('disabled');
}
if (arrowAssumptionsToImplementation) {
    arrowAssumptionsToImplementation.classList.add('disabled');
}
if (buttonNextStep) {
    buttonNextStep.classList.add('disabled');
}

// Show/hide shortcut hint
messageInput.addEventListener('focus', () => {
    shortcutHint.style.display = 'block';
});

messageInput.addEventListener('blur', () => {
    shortcutHint.style.display = 'none';
});

// Handle code block action buttons (copy)
document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest('.code-action-btn') as HTMLButtonElement;
    if (!button) return;
    
    const action = button.getAttribute('data-action');
    const code = button.getAttribute('data-code');
    
    if (!code || action !== 'copy') return;
    
    try {
        await navigator.clipboard.writeText(code);
        // Visual feedback
        const originalText = button.textContent;
        button.textContent = '✓ Copied';
        button.style.opacity = '0.7';
        setTimeout(() => {
            if (button.textContent === '✓ Copied') {
                button.textContent = originalText;
                button.style.opacity = '1';
            }
        }, 2000);
    } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            button.textContent = '✓ Copied';
            setTimeout(() => {
                button.textContent = '📋';
            }, 2000);
        } catch (fallbackErr) {
            console.error('Fallback copy failed:', fallbackErr);
        }
        document.body.removeChild(textArea);
    }
});

