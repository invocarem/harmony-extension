/**
 * Message types for communication between webview and extension
 */

export interface WebviewToExtensionMessage {
    command: string;
    text?: string;
    context?: string;
    reasoning?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: ContextSummary;
    searchTerm?: string;
}

export interface ExtensionToWebviewMessage {
    command: 'receiveMessage' | 'updateContext' | 'updateContextSummary' | 'showFileAutocomplete' | 'insertText';
    text?: string;
    context?: string;
    reasoning?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: ContextSummary;
}

export interface ContextSummary {
    rulesCount?: number;
    mcpToolsCount?: number;
    files?: string[];
}

export interface AutocompleteFile {
    label: string;
    path: string;
}

