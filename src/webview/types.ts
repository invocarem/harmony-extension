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
    from?: 'init' | 'chat' | 'assumptions' | 'implementation';
    to?: 'init' | 'chat' | 'assumptions' | 'implementation';
}

export interface ExtensionToWebviewMessage {
    command: 'receiveMessage' | 'updateContext' | 'updateContextSummary' | 'showFileAutocomplete' | 'insertText';
    text?: string;
    context?: string;
    reasoning?: string;
    commentary?: string;
    final?: string;
    files?: Array<{ label: string; path: string }>;
    contextSummary?: ContextSummary;
    verboseInfo?: {
        stage?: 'init' | 'chat' | 'assumptions' | 'implementation';
        stageTransition?: {
            from: 'init' | 'chat' | 'assumptions' | 'implementation';
            to: 'init' | 'chat' | 'assumptions' | 'implementation';
        };
        step?: number;
        maxSteps?: number;
        isComplete?: boolean;
        toolCalls?: Array<{
            name: string;
            stage: 'init' | 'chat' | 'assumptions' | 'implementation';
            success: boolean;
            error?: string;
        }>;
    };
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

