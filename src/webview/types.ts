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
        stage?: 'init' | 'chat' | 'snippet' | 'assumptions' | 'implementation';
        stageTransition?: {
            from: 'init' | 'chat' | 'snippet' | 'assumptions' | 'implementation';
            to: 'init' | 'chat' | 'snippet' | 'assumptions' | 'implementation';
        };
        step?: number;
        maxSteps?: number;
        isComplete?: boolean;
        
        // Chat stage fields
        problemSummary?: {
            originalQuery: string;
            restatedProblem?: string;
            extractedFrom?: 'content' | 'reasoning';
            extractedAt: number;
        };
        extractedFiles?: {
            explicitFiles: Array<{ path: string; type: 'file' | 'directory'; extractedAt: number }>;
            detectedFiles: Array<{ path: string; type: 'file' | 'directory'; confidence: 'high' | 'medium' | 'low'; extractedAt: number }>;
            ambiguousMatches?: Array<{ path: string; reason: string }>;
        };
        
        // Assumptions stage fields
        codeSnippets?: {
            extractedCount: number;
            files: Array<{
                fileName: string;
                version: string;
                lineCount: number;
                extractedAt: number;
                waitForCreate: boolean;
            }>;
        };
        hasPlan?: boolean;  // Whether a plan has been created in assumptions stage
        progressPlan?: {
            taskId: string;
            totalSteps: number;
            complexity: 'simple' | 'hard';
            createdAt: number;
            steps?: Array<{
                stepNumber: number;
                description: string;
                status?: 'pending' | 'in_progress' | 'completed';
                tools?: string[];
            }>;
        };
        
        // Implementation stage fields
        planProgress?: {
            taskId: string;
            totalSteps: number;
            completedSteps: number;
            currentStep?: {
                stepNumber: number;
                description: string;
                status: 'pending' | 'in_progress' | 'completed';
                startedAt?: number;
                completedAt?: number;
            };
            steps: Array<{
                stepNumber: number;
                description: string;
                status: 'pending' | 'in_progress' | 'completed';
                completedAt?: number;
                toolsUsed?: string[];
                filesCreated?: string[];
                filesUpdated?: string[];
            }>;
            planCompleted: boolean;
            planCompletedAt?: number;
        };
        fileOperations?: {
            created: Array<{ path: string; source: string; version?: string; createdAt: number; relatedStep?: number }>;
            updated: Array<{ path: string; source: string; version?: string; updatedAt: number; relatedStep?: number }>;
            failed: Array<{ path: string; error: string; attemptedAt: number; relatedStep?: number }>;
        };
        
        toolCalls?: Array<{
            name: string;
            stage: 'init' | 'chat' | 'snippet' | 'assumptions' | 'implementation';
            success: boolean;
            error?: string;
            file?: string;
            relatedStep?: number;
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

