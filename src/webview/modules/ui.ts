/**
 * UI manipulation functions
 */

import { formatMarkdown, escapeHtml } from './markdown';
import { ContextSummary } from '../types';

const messagesDiv = document.getElementById('messages') as HTMLDivElement;
let lastUserMessageElement: HTMLElement | null = null;

export function addMessage(
    text: string,
    isUser: boolean,
    reasoning?: string,
    contextSummary?: ContextSummary
): void {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
    
    // Add context summary section if present (for user messages)
    if (contextSummary && isUser) {
        const contextDiv = document.createElement('div');
        contextDiv.className = 'context-summary';
        
        const rowDiv = document.createElement('div');
        rowDiv.className = 'context-summary-row';
        const items: string[] = [];
        if (contextSummary.rulesCount !== undefined) {
            items.push(`<div class="context-summary-item"><span class="context-summary-label">Rules:</span> <span>${contextSummary.rulesCount}</span></div>`);
        }
        if (contextSummary.mcpToolsCount !== undefined) {
            items.push(`<div class="context-summary-item"><span class="context-summary-label">MCP Tools:</span> <span>${contextSummary.mcpToolsCount}</span></div>`);
        }
        if (items.length > 0) {
            rowDiv.innerHTML = items.join('');
            contextDiv.appendChild(rowDiv);
        }
        
        // Add files if present
        if (contextSummary.files && contextSummary.files.length > 0) {
            const filesDiv = document.createElement('div');
            filesDiv.className = 'context-summary-files';
            filesDiv.innerHTML = '<span class="context-summary-label">Files:</span> ' + 
                contextSummary.files.map(file => `<span class="context-summary-file">📄 ${escapeHtml(file)}</span>`).join('');
            contextDiv.appendChild(filesDiv);
        }
        
        if (contextDiv.children.length > 0) {
            messageDiv.appendChild(contextDiv);
        }
    }
    
    // Add reasoning section if present
    if (reasoning && !isUser && reasoning.trim()) {
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'reasoning-section';
        reasoningDiv.innerHTML = '<div class="reasoning-header">💭 Reasoning</div>' + formatMarkdown(reasoning);
        messageDiv.appendChild(reasoningDiv);
    }
    
    // Format markdown and add content
    const formattedText = formatMarkdown(text);
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = formattedText || (isUser ? '' : 'No response received.');
    messageDiv.appendChild(contentDiv);
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Store reference to last user message for contextSummary updates
    if (isUser) {
        lastUserMessageElement = messageDiv;
        // Add timestamp for user messages
        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timestamp);
    }
}

export function updateLastUserMessageContextSummary(contextSummary: ContextSummary): void {
    if (!lastUserMessageElement) {
        return;
    }
    
    // Remove existing context summary if any
    const existingContext = lastUserMessageElement.querySelector('.context-summary');
    if (existingContext) {
        existingContext.remove();
    }
    
    // Add new context summary
    const contextDiv = document.createElement('div');
    contextDiv.className = 'context-summary';
    
    const rowDiv = document.createElement('div');
    rowDiv.className = 'context-summary-row';
    const items: string[] = [];
    if (contextSummary.rulesCount !== undefined) {
        items.push(`<div class="context-summary-item"><span class="context-summary-label">Rules:</span> <span>${contextSummary.rulesCount}</span></div>`);
    }
    if (contextSummary.mcpToolsCount !== undefined) {
        items.push(`<div class="context-summary-item"><span class="context-summary-label">MCP Tools:</span> <span>${contextSummary.mcpToolsCount}</span></div>`);
    }
    if (items.length > 0) {
        rowDiv.innerHTML = items.join('');
        contextDiv.appendChild(rowDiv);
    }
    
    // Add files if present
    if (contextSummary.files && contextSummary.files.length > 0) {
        const filesDiv = document.createElement('div');
        filesDiv.className = 'context-summary-files';
        filesDiv.innerHTML = '<span class="context-summary-label">Files:</span> ' + 
            contextSummary.files.map(file => `<span class="context-summary-file">📄 ${escapeHtml(file)}</span>`).join('');
        contextDiv.appendChild(filesDiv);
    }
    
    if (contextDiv.children.length > 0) {
        // Insert before the content div
        const contentDiv = lastUserMessageElement.querySelector('div:not(.context-summary):not(.timestamp)');
        if (contentDiv) {
            lastUserMessageElement.insertBefore(contextDiv, contentDiv);
        } else {
            lastUserMessageElement.insertBefore(contextDiv, lastUserMessageElement.firstChild);
        }
    }
}

export function addTypingIndicator(): void {
    const indicator = document.createElement('div');
    indicator.className = 'message assistant-message typing-indicator';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    messagesDiv.appendChild(indicator);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

export function removeTypingIndicator(): void {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

