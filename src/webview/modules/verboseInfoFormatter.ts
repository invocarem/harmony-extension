/**
 * VerboseInfo formatter for webview (C#-like toString() functionality)
 * Formats verboseInfo objects that have been serialized from the extension
 */

export interface VerboseInfo {
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
}

/**
 * C#-like toString() formatter for verboseInfo
 * Can be called on any verboseInfo type: chatVerboseInfo.toString(), assumptionsVerboseInfo.toString(), etc.
 */
export function verboseInfoToString(verboseInfo: VerboseInfo | undefined | null): string {
    if (!verboseInfo) {
        return '';
    }
    
    switch (verboseInfo.stage) {
        case 'chat':
            return formatChatVerboseInfo(verboseInfo);
        case 'snippet':
            return formatSnippetVerboseInfo(verboseInfo);
        case 'assumptions':
            return formatAssumptionVerboseInfo(verboseInfo);
        case 'implementation':
            return formatImplementationVerboseInfo(verboseInfo);
        default:
            return formatGenericVerboseInfo(verboseInfo);
    }
}

function formatChatVerboseInfo(info: VerboseInfo): string {
    const lines: string[] = [];
    lines.push(`📋 Chat Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (info.stageTransition) {
        lines.push(`\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`);
    }
    
    if (info.step !== undefined && info.maxSteps !== undefined) {
        lines.push(`\n📊 Progress: Step ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
        lines.push(`✅ Complete`);
    }
    
    if (info.problemSummary) {
        lines.push(`\n📝 Problem Summary:`);
        lines.push(`   Original Query: ${info.problemSummary.originalQuery}`);
        if (info.problemSummary.restatedProblem) {
            lines.push(`   Restated: ${info.problemSummary.restatedProblem}`);
            if (info.problemSummary.extractedFrom) {
                lines.push(`   (Extracted from: ${info.problemSummary.extractedFrom})`);
            }
        }
    }
    
    if (info.extractedFiles) {
        lines.push(`\n📁 Extracted Files:`);
        if (info.extractedFiles.explicitFiles && info.extractedFiles.explicitFiles.length > 0) {
            lines.push(`   Explicit (@file syntax):`);
            info.extractedFiles.explicitFiles.forEach(file => {
                lines.push(`     • ${file.path} (${file.type})`);
            });
        }
        if (info.extractedFiles.detectedFiles && info.extractedFiles.detectedFiles.length > 0) {
            lines.push(`   Detected (natural language):`);
            info.extractedFiles.detectedFiles.forEach(file => {
                lines.push(`     • ${file.path} (${file.type}, confidence: ${file.confidence})`);
            });
        }
        if (info.extractedFiles.ambiguousMatches && info.extractedFiles.ambiguousMatches.length > 0) {
            lines.push(`   Ambiguous matches:`);
            info.extractedFiles.ambiguousMatches.forEach(match => {
                lines.push(`     • ${match.path} (${match.reason})`);
            });
        }
    }
    
    if (info.toolCalls && info.toolCalls.length > 0) {
        lines.push(`\n🔧 Tool Calls:`);
        info.toolCalls.forEach(tc => {
            const status = tc.success ? '✅' : '❌';
            const fileInfo = tc.file ? ` (${tc.file})` : '';
            lines.push(`   ${status} ${tc.name}${fileInfo}`);
            if (tc.error) {
                lines.push(`      Error: ${tc.error}`);
            }
        });
    }
    
    return lines.join('\n');
}

function formatSnippetVerboseInfo(info: VerboseInfo): string {
    const lines: string[] = [];
    lines.push(`✨ Snippet Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (info.stageTransition) {
        lines.push(`\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`);
    }
    
    if (info.step !== undefined && info.maxSteps !== undefined) {
        lines.push(`\n📊 Progress: Step ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
        lines.push(`✅ Complete`);
    }
    
    if (info.problemSummary) {
        lines.push(`\n📝 Request Summary:`);
        lines.push(`   Original Query: ${info.problemSummary.originalQuery}`);
        if (info.problemSummary.restatedProblem) {
            lines.push(`   Restated: ${info.problemSummary.restatedProblem}`);
            if (info.problemSummary.extractedFrom) {
                lines.push(`   (Extracted from: ${info.problemSummary.extractedFrom})`);
            }
        }
    }
    
    if (info.toolCalls && info.toolCalls.length > 0) {
        lines.push(`\n🔧 Tool Calls:`);
        info.toolCalls.forEach(tc => {
            const status = tc.success ? '✅' : '❌';
            const fileInfo = tc.file ? ` (${tc.file})` : '';
            lines.push(`   ${status} ${tc.name}${fileInfo}`);
            if (tc.error) {
                lines.push(`      Error: ${tc.error}`);
            }
        });
    }
    
    return lines.join('\n');
}

function formatAssumptionVerboseInfo(info: VerboseInfo): string {
    const lines: string[] = [];
    lines.push(`🔍 Assumptions Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (info.stageTransition) {
        lines.push(`\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`);
    }
    
    if (info.step !== undefined && info.maxSteps !== undefined) {
        lines.push(`\n📊 Progress: Step ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
        lines.push(`✅ Complete`);
    }
    
    if (info.codeSnippets) {
        lines.push(`\n💻 Code Snippets:`);
        lines.push(`   Total extracted: ${info.codeSnippets.extractedCount}`);
        if (info.codeSnippets.files && info.codeSnippets.files.length > 0) {
            info.codeSnippets.files.forEach(file => {
                lines.push(`   • ${file.fileName} (v${file.version}, ${file.lineCount} lines)`);
                if (file.waitForCreate) {
                    lines.push(`     ⏳ Waiting for creation`);
                }
            });
        }
    }
    
    if (info.progressPlan) {
        lines.push(`\n📋 Progress Plan:`);
        lines.push(`   Task ID: ${info.progressPlan.taskId}`);
        lines.push(`   Steps: ${info.progressPlan.totalSteps}`);
        lines.push(`   Complexity: ${info.progressPlan.complexity}`);
        
        if (info.progressPlan.steps && info.progressPlan.steps.length > 0) {
            lines.push(`\n   Plan Steps:`);
            info.progressPlan.steps.forEach(step => {
                const statusIcon = step.status === 'completed' ? '✅' : step.status === 'in_progress' ? '🔄' : '⏳';
                lines.push(`     ${statusIcon} Step ${step.stepNumber}: ${step.description}`);
                if (step.tools && step.tools.length > 0) {
                    lines.push(`        Tools: ${step.tools.join(', ')}`);
                }
            });
        }
    }
    
    if (info.toolCalls && info.toolCalls.length > 0) {
        lines.push(`\n🔧 Tool Calls:`);
        info.toolCalls.forEach(tc => {
            const status = tc.success ? '✅' : '❌';
            const fileInfo = tc.file ? ` (${tc.file})` : '';
            lines.push(`   ${status} ${tc.name}${fileInfo}`);
            if (tc.error) {
                lines.push(`      Error: ${tc.error}`);
            }
        });
    }
    
    return lines.join('\n');
}

function formatImplementationVerboseInfo(info: VerboseInfo): string {
    const lines: string[] = [];
    lines.push(`⚙️ Implementation Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Only show stage transition if we're just starting (no progress yet)
    // Don't show it if plan is completed or we've already completed steps
    if (info.stageTransition) {
        const shouldShowTransition = !info.planProgress || // No plan yet
            (!info.planProgress.planCompleted && info.planProgress.completedSteps === 0); // Plan exists but not started
        if (shouldShowTransition) {
            lines.push(`\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`);
        }
    }
    
    // For implementation stage with planProgress, use planProgress values for top-level progress
    // Otherwise fall back to generic step/maxSteps
    if (info.planProgress) {
        lines.push(`\n📊 Progress: Step ${info.planProgress.completedSteps}/${info.planProgress.totalSteps}`);
    } else if (info.step !== undefined && info.maxSteps !== undefined) {
        lines.push(`\n📊 Progress: Step ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
        lines.push(`✅ Complete`);
    }
    
    if (info.planProgress) {
        lines.push(`\n📋 Plan Progress:`);
        lines.push(`   Task ID: ${info.planProgress.taskId}`);
        lines.push(`   Steps: ${info.planProgress.completedSteps}/${info.planProgress.totalSteps} completed`);
        
        if (info.planProgress.currentStep) {
            lines.push(`\n   Current Step:`);
            lines.push(`     #${info.planProgress.currentStep.stepNumber}: ${info.planProgress.currentStep.description}`);
            lines.push(`     Status: ${info.planProgress.currentStep.status}`);
            if (info.planProgress.currentStep.startedAt) {
                lines.push(`     Started: ${new Date(info.planProgress.currentStep.startedAt).toLocaleString()}`);
            }
            if (info.planProgress.currentStep.completedAt) {
                lines.push(`     Completed: ${new Date(info.planProgress.currentStep.completedAt).toLocaleString()}`);
            }
        }
        
        if (info.planProgress.steps && info.planProgress.steps.length > 0) {
            lines.push(`\n   All Steps (Plan Fulfillment):`);
            info.planProgress.steps.forEach(step => {
                const statusIcon = step.status === 'completed' ? '✅' : step.status === 'in_progress' ? '🔄' : '⏳';
                lines.push(`     ${statusIcon} Step ${step.stepNumber}: ${step.description} (${step.status})`);
                if (step.completedAt) {
                    lines.push(`        Completed: ${new Date(step.completedAt).toLocaleString()}`);
                }
                if (step.toolsUsed && step.toolsUsed.length > 0) {
                    lines.push(`        Tools Used: ${step.toolsUsed.join(', ')}`);
                }
                if (step.filesCreated && step.filesCreated.length > 0) {
                    lines.push(`        Files Created:`);
                    step.filesCreated.forEach(file => {
                        lines.push(`          ✅ ${file}`);
                    });
                }
                if (step.filesUpdated && step.filesUpdated.length > 0) {
                    lines.push(`        Files Updated:`);
                    step.filesUpdated.forEach(file => {
                        lines.push(`          🔄 ${file}`);
                    });
                }
            });
        }
        
        if (info.planProgress.planCompleted) {
            lines.push(`\n   🎉 Plan Completed!`);
            if (info.planProgress.planCompletedAt) {
                lines.push(`   Completed at: ${new Date(info.planProgress.planCompletedAt).toLocaleString()}`);
            }
        }
    }
    
    if (info.fileOperations) {
        lines.push(`\n📁 File Operations:`);
        if (info.fileOperations.created && info.fileOperations.created.length > 0) {
            lines.push(`   Created (${info.fileOperations.created.length}):`);
            info.fileOperations.created.forEach(file => {
                const stepInfo = file.relatedStep ? ` [Step ${file.relatedStep}]` : '';
                lines.push(`     ✅ ${file.path} (${file.source}${file.version ? `, v${file.version}` : ''}${stepInfo})`);
            });
        }
        if (info.fileOperations.updated && info.fileOperations.updated.length > 0) {
            lines.push(`   Updated (${info.fileOperations.updated.length}):`);
            info.fileOperations.updated.forEach(file => {
                const stepInfo = file.relatedStep ? ` [Step ${file.relatedStep}]` : '';
                lines.push(`     🔄 ${file.path} (${file.source}${file.version ? `, v${file.version}` : ''}${stepInfo})`);
            });
        }
        if (info.fileOperations.failed && info.fileOperations.failed.length > 0) {
            lines.push(`   Failed (${info.fileOperations.failed.length}):`);
            info.fileOperations.failed.forEach(file => {
                const stepInfo = file.relatedStep ? ` [Step ${file.relatedStep}]` : '';
                lines.push(`     ❌ ${file.path}${stepInfo}`);
                lines.push(`        Error: ${file.error}`);
            });
        }
    }
    
    if (info.toolCalls && info.toolCalls.length > 0) {
        lines.push(`\n🔧 Tool Calls:`);
        info.toolCalls.forEach(tc => {
            const status = tc.success ? '✅' : '❌';
            const fileInfo = tc.file ? ` (${tc.file})` : '';
            lines.push(`   ${status} ${tc.name}${fileInfo}`);
            if (tc.relatedStep) {
                lines.push(`      Related to Step: ${tc.relatedStep}`);
            }
            if (tc.error) {
                lines.push(`      Error: ${tc.error}`);
            }
        });
    }
    
    return lines.join('\n');
}

function formatGenericVerboseInfo(info: VerboseInfo): string {
    const lines: string[] = [];
    lines.push(`📋 Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (info.stage) {
        lines.push(`\nStage: ${info.stage}`);
    }
    if (info.stageTransition) {
        lines.push(`\nTransition: ${info.stageTransition.from} → ${info.stageTransition.to}`);
    }
    if (info.step !== undefined && info.maxSteps !== undefined) {
        lines.push(`\nStep: ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
        lines.push(`\n✅ Complete`);
    }
    
    return lines.join('\n');
}

/**
 * Helper to add toString() method to verboseInfo object (C#-like behavior)
 * Usage: const verboseInfoWithToString = addToString(verboseInfo);
 *        console.log(verboseInfoWithToString.toString());
 */
export function addToString(verboseInfo: VerboseInfo | undefined | null): VerboseInfo & { toString(): string } {
    if (!verboseInfo) {
        return { toString: () => '' } as any;
    }
    
    return Object.assign(verboseInfo, {
        toString: () => verboseInfoToString(verboseInfo)
    });
}

