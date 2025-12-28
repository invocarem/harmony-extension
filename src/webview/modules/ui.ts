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
    contextSummary?: ContextSummary,
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
    },
    final?: string
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
    
    // Add verbose info section if present (for assistant messages)
    if (verboseInfo && !isUser) {
        const verboseDiv = document.createElement('div');
        verboseDiv.className = 'verbose-info-section';
        
        const infoItems: string[] = [];
        
        // Stage information
        if (verboseInfo.stage) {
            const stageEmoji = {
                'chat': '💬',
                'assumptions': '🔍',
                'implementation': '⚙️'
            }[verboseInfo.stage] || '📋';
            const stageLabel = verboseInfo.stage.charAt(0).toUpperCase() + verboseInfo.stage.slice(1);
            infoItems.push(`<div class="verbose-info-item"><span class="verbose-info-label">${stageEmoji} Stage:</span> <span class="verbose-info-value">${stageLabel}</span></div>`);
        }
        
        // Stage transition
        if (verboseInfo.stageTransition) {
            const fromEmoji = {
                'chat': '💬',
                'assumptions': '🔍',
                'implementation': '⚙️'
            }[verboseInfo.stageTransition.from] || '📋';
            const toEmoji = {
                'chat': '💬',
                'assumptions': '🔍',
                'implementation': '⚙️'
            }[verboseInfo.stageTransition.to] || '📋';
            const fromLabel = verboseInfo.stageTransition.from.charAt(0).toUpperCase() + verboseInfo.stageTransition.from.slice(1);
            const toLabel = verboseInfo.stageTransition.to.charAt(0).toUpperCase() + verboseInfo.stageTransition.to.slice(1);
            infoItems.push(`<div class="verbose-info-item verbose-info-transition"><span class="verbose-info-label">🔄 Transition:</span> <span class="verbose-info-value">${fromEmoji} ${fromLabel} → ${toEmoji} ${toLabel}</span></div>`);
        }
        
        // Step information - show step count if continuing, or "Complete" if finished
        if (verboseInfo.isComplete) {
            infoItems.push(`<div class="verbose-info-item"><span class="verbose-info-label">📊 Status:</span> <span class="verbose-info-value">Complete</span></div>`);
        } else if (verboseInfo.step !== undefined && verboseInfo.maxSteps !== undefined) {
            infoItems.push(`<div class="verbose-info-item"><span class="verbose-info-label">📊 Step:</span> <span class="verbose-info-value">${verboseInfo.step} / ${verboseInfo.maxSteps}</span></div>`);
        }
        
        // Tool call information
        if (verboseInfo.toolCalls && verboseInfo.toolCalls.length > 0) {
            const toolCallsDiv = document.createElement('div');
            toolCallsDiv.className = 'verbose-info-toolcalls';
            toolCallsDiv.innerHTML = '<div class="verbose-info-label">🔧 Tool Calls:</div>';
            
            verboseInfo.toolCalls.forEach((toolCall, index) => {
                const toolCallItem = document.createElement('div');
                toolCallItem.className = 'verbose-info-toolcall-item';
                
                const stageEmoji = {
                    'chat': '💬',
                    'assumptions': '🔍',
                    'implementation': '⚙️'
                }[toolCall.stage] || '📋';
                
                const statusEmoji = toolCall.success ? '✅' : '❌';
                const statusText = toolCall.success ? 'OK' : 'Error';
                
                let toolCallHtml = `<span class="verbose-info-toolcall-name">${statusEmoji} ${escapeHtml(toolCall.name)}</span>`;
                toolCallHtml += ` <span class="verbose-info-toolcall-status ${toolCall.success ? 'success' : 'error'}">${statusText}</span>`;
                toolCallHtml += ` <span class="verbose-info-toolcall-stage">${stageEmoji} ${toolCall.stage}</span>`;
                
                if (toolCall.error) {
                    toolCallHtml += `<div class="verbose-info-toolcall-error">${escapeHtml(toolCall.error)}</div>`;
                }
                
                toolCallItem.innerHTML = toolCallHtml;
                toolCallsDiv.appendChild(toolCallItem);
            });
            
            infoItems.push(toolCallsDiv.outerHTML);
        }
        
        if (infoItems.length > 0) {
            verboseDiv.innerHTML = '<div class="verbose-info-header">ℹ️ Info</div><div class="verbose-info-content">' + infoItems.join('') + '</div>';
            messageDiv.appendChild(verboseDiv);
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
    // If final equals text, only show it once (in final section, not in main content)
    const hasFinal = final && !isUser && final.trim();
    const finalSameAsText = hasFinal && final.trim() === text.trim();
    const displayText = finalSameAsText ? '' : text;
    const formattedText = formatMarkdown(displayText);
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = formattedText || (isUser ? '' : (hasFinal ? '' : 'No response received.'));
    messageDiv.appendChild(contentDiv);
    
    // Add final section if present (after main content)
    if (hasFinal) {
        const finalDiv = document.createElement('div');
        finalDiv.className = 'final-section';
        finalDiv.innerHTML = '<div class="final-header">✨ Final Result</div>' + formatMarkdown(final);
        messageDiv.appendChild(finalDiv);
    }
    
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

