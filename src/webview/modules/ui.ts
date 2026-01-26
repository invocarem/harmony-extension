/**
 * UI manipulation functions
 */

import { formatMarkdown, escapeHtml } from './markdown';
import { ContextSummary } from '../types';
import { verboseInfoToString, addToString, VerboseInfo } from './verboseInfoFormatter';

const messagesDiv = document.getElementById('messages') as HTMLDivElement;
let lastUserMessageElement: HTMLElement | null = null;
let currentHasPlan = false; // Track whether a plan exists in assumptions stage

export function addMessage(
    text: string,
    isUser: boolean,
    reasoning?: string,
    contextSummary?: ContextSummary,
    verboseInfo?: VerboseInfo,
    final?: string,
    commentary?: string
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
    // Use C#-like toString() to format any verboseInfo type
    if (verboseInfo && !isUser) {
        const verboseDiv = document.createElement('div');
        verboseDiv.className = 'verbose-info-section';
        
        // Use toString() to format the verboseInfo (C#-like behavior)
        // This works for chatVerboseInfo, assumptionsVerboseInfo, or implementationVerboseInfo
        const verboseInfoWithToString = addToString(verboseInfo);
        const formattedText = verboseInfoWithToString.toString();
        
        if (formattedText) {
            // Create a pre-formatted text display (monospace for better readability)
            const contentDiv = document.createElement('div');
            contentDiv.className = 'verbose-info-content';
            contentDiv.style.fontFamily = 'monospace';
            contentDiv.style.whiteSpace = 'pre-wrap';
            contentDiv.style.fontSize = '0.9em';
            contentDiv.style.lineHeight = '1.4';
            contentDiv.style.padding = '8px';
            contentDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
            contentDiv.style.borderRadius = '4px';
            contentDiv.style.overflowX = 'auto';
            contentDiv.textContent = formattedText;
            
            verboseDiv.innerHTML = '<div class="verbose-info-header">ℹ️ Verbose Info</div>';
            verboseDiv.appendChild(contentDiv);
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
    
    // Add commentary section if present
    if (commentary && !isUser && commentary.trim()) {
        const commentaryDiv = document.createElement('div');
        commentaryDiv.className = 'commentary-section';
        commentaryDiv.innerHTML = '<div class="commentary-header">💬 Commentary</div>' + formatMarkdown(commentary);
        messageDiv.appendChild(commentaryDiv);
    }
    
    // Format markdown and add content
    // If final is available, use it as the primary display content
    const hasFinal = final && !isUser && final.trim();
    const displayText = hasFinal ? '' : text; // Don't show text if we have final
    const formattedText = formatMarkdown(displayText);
    const contentDiv = document.createElement('div');
    // Don't show "No response received" if verboseInfo is present (e.g., for @cmd:verbose-info)
    const shouldShowNoResponse = !isUser && !hasFinal && !formattedText && !verboseInfo;
    contentDiv.innerHTML = formattedText || (isUser ? '' : (hasFinal ? '' : (shouldShowNoResponse ? 'No response received.' : '')));
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

/**
 * Update stage indicator lights based on current stage
 * Also enables/disables arrows based on valid transitions
 */
export function updateStageIndicator(stage?: 'init' | 'chat' | 'assumptions' | 'implementation', hasPlan?: boolean): void {
    // Update plan status if provided
    // hasPlan indicates whether user has explicitly created/updated plan via @cmd:plan
    if (hasPlan !== undefined) {
        currentHasPlan = hasPlan;
    }
    
    // Remove active class from all lights
    const allLights = document.querySelectorAll('.stage-light');
    allLights.forEach(light => light.classList.remove('active'));
    
    // Activate the appropriate light based on stage
    // Note: 'init' stage doesn't have a light (transitions immediately to chat)
    if (stage && stage !== 'init') {
        const stageLight = document.getElementById(`stage-light-${stage}`);
        if (stageLight) {
            stageLight.classList.add('active');
        }
    } else if (stage === 'init') {
        // Init stage: show chat light (init→chat transition)
        const chatLight = document.getElementById('stage-light-chat');
        if (chatLight) {
            chatLight.classList.add('active');
        }
    }
    
    // Update arrow states based on valid transitions
    // Valid transitions:
    // - chat -> assumptions
    // - assumptions -> implementation (only if user has explicitly created plan via @cmd:plan)
    // - assumptions -> chat (backward)
    // - implementation -> chat (backward)
    // - implementation -> assumptions (backward)
    
    const arrowChatToAssumptions = document.getElementById('arrow-chat-to-assumptions');
    const arrowAssumptionsToImplementation = document.getElementById('arrow-assumptions-to-implementation');
    
    if (arrowChatToAssumptions) {
        // Enable if we're in chat stage
        if (stage === 'chat') {
            arrowChatToAssumptions.classList.remove('disabled');
        } else {
            arrowChatToAssumptions.classList.add('disabled');
        }
    }
    
    if (arrowAssumptionsToImplementation) {
        // Enable ONLY if:
        // 1. We're in assumptions stage AND
        // 2. User has explicitly created/updated plan via @cmd:plan (currentHasPlan is true)
        if (stage === 'assumptions' && currentHasPlan) {
            arrowAssumptionsToImplementation.classList.remove('disabled');
        } else {
            arrowAssumptionsToImplementation.classList.add('disabled');
        }
    }
    
    const buttonNextStep = document.getElementById('button-next-step') as HTMLButtonElement;
    if (buttonNextStep) {
        // Enable if we're in implementation stage
        if (stage === 'implementation') {
            buttonNextStep.classList.remove('disabled');
        } else {
            buttonNextStep.classList.add('disabled');
        }
    }
}

