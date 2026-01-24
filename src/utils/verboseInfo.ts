import { WorkflowStage } from "../harmony/stageStateMachine";
import { ConversationContext } from "../harmony/conversationContext";
import { ProgressPlanManager, ProgressPlan } from "../progressPlanManager";
import { CodeContext } from "../harmony/codeContext";
import { logVerboseInfo } from "./logger";
import { ChatMessage } from "../conversationManager";

/**
 * File extraction result for chat stage
 */
export interface FileExtractionResult {
  explicitFiles?: Array<{
    path: string;
    type: "file" | "directory";
    extractedAt: number;
  }>;
  detectedFiles?: Array<{
    path: string;
    type: "file" | "directory";
    confidence: "high" | "medium" | "low";
    extractedAt: number;
  }>;
  ambiguousMatches?: Array<{
    path: string;
    reason: string;
  }>;
}

/**
 * File operation result for implementation stage
 */
export interface FileOperationResult {
  created?: Array<{
    path: string;
    source: "codeContext" | "codeBlock" | "toolCall";
    version?: string;
    createdAt: number;
  }>;
  updated?: Array<{
    path: string;
    source: "codeContext" | "codeBlock" | "toolCall";
    version?: string;
    updatedAt: number;
  }>;
  failed?: Array<{
    path: string;
    error: string;
    attemptedAt: number;
  }>;
}

/**
 * Chat stage verbose info
 */
export interface ChatVerboseInfo {
  stage: "chat";
  stageTransition?: {
    from: WorkflowStage;
    to: WorkflowStage;
  };
  step?: number;
  maxSteps?: number;
  readonly isComplete?: boolean;

  problemSummary?: {
    originalQuery: string;
    restatedProblem?: string;
    extractedFrom?: "content" | "reasoning";
    extractedAt: number;
  };

  extractedFiles?: {
    explicitFiles: Array<{
      path: string;
      type: "file" | "directory";
      extractedAt: number;
    }>;
    detectedFiles: Array<{
      path: string;
      type: "file" | "directory";
      confidence: "high" | "medium" | "low";
      extractedAt: number;
    }>;
    ambiguousMatches?: Array<{
      path: string;
      reason: string;
    }>;
  };

  toolCalls?: Array<{
    name: string;
    stage: WorkflowStage;
    success: boolean;
    error?: string;
    file?: string; // File path for file-related tool calls (e.g., create_file)
  }>;
}

/**
 * Assumption stage verbose info
 */
export interface AssumptionVerboseInfo {
  stage: "assumptions";
  stageTransition?: {
    from: WorkflowStage;
    to: WorkflowStage;
  };
  step?: number;
  maxSteps?: number;
  readonly isComplete?: boolean;

  problemSummary?: {
    originalQuery: string;
    restatedProblem?: string;
    extractedFrom?: "content" | "reasoning";
    extractedAt: number;
  };

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
    complexity: "simple" | "hard";
    createdAt: number;
    steps?: Array<{
      stepNumber: number;
      goal: string;
      description?: string;
      status?: "pending" | "in_progress" | "completed";
      tools?: string[];
    }>;
  };

  toolCalls?: Array<{
    name: string;
    stage: WorkflowStage;
    success: boolean;
    error?: string;
    file?: string; // File path for file-related tool calls (e.g., create_file)
  }>;
}

/**
 * Implementation stage verbose info
 */
export interface ImplementationVerboseInfo {
  stage: "implementation";
  stageTransition?: {
    from: WorkflowStage;
    to: WorkflowStage;
  };
  step?: number;
  readonly maxSteps?: number;
  readonly isComplete?: boolean;

  planProgress?: {
    taskId: string;
    totalSteps: number;
    completedSteps: number;
    currentStep?: {
      stepNumber: number;
      goal: string;
      status: "pending" | "in_progress" | "completed";
      startedAt?: number;
      completedAt?: number;
    };
    steps: Array<{
      stepNumber: number;
      goal: string;
      status: "pending" | "in_progress" | "completed";
      completedAt?: number;
      toolsUsed?: string[]; // Actual tools executed (not just planned)
      filesCreated?: string[]; // Files created for this step
      filesUpdated?: string[]; // Files updated for this step
    }>;
    planCompleted: boolean;
    planCompletedAt?: number;
  };

  fileOperations?: {
    created: Array<{
      path: string;
      source: "codeContext" | "codeBlock" | "toolCall";
      version?: string;
      createdAt: number;
      relatedStep?: number; // Link to plan step
    }>;
    updated: Array<{
      path: string;
      source: "codeContext" | "codeBlock" | "toolCall";
      version?: string;
      updatedAt: number;
      relatedStep?: number; // Link to plan step
    }>;
    failed: Array<{
      path: string;
      error: string;
      attemptedAt: number;
      relatedStep?: number; // Link to plan step
    }>;
  };

  toolCalls?: Array<{
    name: string;
    stage: WorkflowStage;
    success: boolean;
    error?: string;
    relatedStep?: number;
    file?: string; // File path for file-related tool calls (e.g., create_file)
  }>;
}

/**
 * Union type for all verbose info types
 */
export type VerboseInfo =
  | ChatVerboseInfo
  | AssumptionVerboseInfo
  | ImplementationVerboseInfo;

/**
 * Builder for creating verbose info objects
 */
export class VerboseInfoBuilder {
  /**
   * Extract problem restatement from response content or reasoning
   */
  private static extractProblemRestatement(
    content?: string,
    reasoning?: string,
    originalQuery?: string
  ): { restatedProblem?: string; extractedFrom?: "content" | "reasoning" } {
    if (!content && !reasoning) {
      return {};
    }

    // Look for common restatement patterns - expanded and more flexible
    const restatementPatterns = [
      // Direct restatement patterns
      /(?:You want to|You're asking about|The problem is|I understand you need|You need to|You're trying to|You would like to|You're looking for|You want|You need)([^.!?\n]+[.!?]?)/i,
      /(?:So you want|So the task is|So the problem is|So you need|So you're asking)([^.!?\n]+[.!?]?)/i,
      // More flexible patterns
      /(?:I understand|I see|I gather|Based on|From your request|Your request is|Your task is)([^.!?\n]+[.!?]?)/i,
      // Pattern for "Let me..." or "I'll help you..."
      /(?:Let me|I'll help you|I can help you)([^.!?\n]+[.!?]?)/i,
    ];

    // Try content first
    if (content) {
      // Try pattern matching first
      for (const pattern of restatementPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          const restatement = match[1].trim();
          // Validate it's not too short and not just whitespace
          if (restatement.length > 10) {
            return {
              restatedProblem: restatement,
              extractedFrom: "content",
            };
          }
        }
      }

      // Improved fallback: use first 1-3 sentences if they look like a restatement
      const sentences = content
        .split(/([.!?]+)/)
        .filter((s) => s.trim().length > 0);
      if (sentences.length > 0) {
        // Take first sentence, or first 2-3 if they're short
        let candidateSentences: string[] = [];
        let totalLength = 0;

        for (let i = 0; i < Math.min(sentences.length, 3); i++) {
          const sentence = sentences[i].trim();
          // Skip very short sentences or sentences that are just punctuation
          if (sentence.length < 5) continue;

          // Skip sentences that are clearly about tools/actions, not problem restatement
          const lowerSentence = sentence.toLowerCase();
          if (lowerSentence.includes("tool") && lowerSentence.includes("call"))
            continue;
          if (lowerSentence.includes("i will") && lowerSentence.includes("use"))
            continue;
          if (
            lowerSentence.includes("let me") &&
            lowerSentence.includes("check")
          )
            continue;

          candidateSentences.push(sentence);
          totalLength += sentence.length;

          // Stop if we have enough content (2-3 sentences or >150 chars)
          if (candidateSentences.length >= 2 || totalLength > 150) break;
        }

        if (candidateSentences.length > 0) {
          const firstSentence = candidateSentences[0];
          // Validate: should be at least 20 chars and not start with action words
          if (firstSentence.length >= 20) {
            const restatement = candidateSentences.join(" ").trim();
            // Ensure it ends with punctuation
            const finalRestatement = restatement.match(/[.!?]$/)
              ? restatement
              : restatement + ".";
            return {
              restatedProblem: finalRestatement,
              extractedFrom: "content",
            };
          }
        }
      }
    }

    // Try reasoning
    if (reasoning) {
      for (const pattern of restatementPatterns) {
        const match = reasoning.match(pattern);
        if (match && match[1]) {
          const restatement = match[1].trim();
          if (restatement.length > 10) {
            return {
              restatedProblem: restatement,
              extractedFrom: "reasoning",
            };
          }
        }
      }
    }

    return {};
  }

  /**
   * Extract all user queries from conversation history
   * Filters out commands like @cmd:verbose-info and combines meaningful queries
   */
  private static extractAllUserQueries(
    conversationHistory?: readonly ChatMessage[]
  ): string {
    if (!conversationHistory || conversationHistory.length === 0) {
      return "";
    }

    // Extract all user messages, filtering out commands
    const userQueries: string[] = [];
    for (const message of conversationHistory) {
      if (message.role === "user") {
        const content = message.content.trim();
        // Skip empty messages and command-only messages
        if (content && !content.match(/^@cmd:/i)) {
          userQueries.push(content);
        }
      }
    }

    // Combine queries with separator
    if (userQueries.length === 0) {
      return "";
    } else if (userQueries.length === 1) {
      return userQueries[0];
    } else {
      // Combine multiple queries with a clear separator
      return userQueries.join("\n\n");
    }
  }

  /**
   * Build verbose info for chat stage
   */
  static forChatStage(
    context: ConversationContext | null,
    extractedFiles?: FileExtractionResult,
    responseContent?: string,
    responseReasoning?: string,
    toolCalls?: Array<{
      name: string;
      stage: WorkflowStage;
      success: boolean;
      error?: string;
    }>,
    conversationHistory?: readonly ChatMessage[]
  ): ChatVerboseInfo {
    // Extract all user queries from conversation history
    const allUserQueries = this.extractAllUserQueries(conversationHistory);

    // Prefer conversation history queries if available, otherwise fall back to originalPrompt
    // If conversationHistory was provided and we extracted queries, use them
    // Only fall back to originalPrompt if no queries were extracted from history
    const originalQuery =
      conversationHistory !== undefined && allUserQueries
        ? allUserQueries
        : context?.originalPrompt || "";

    const problemRestatement = this.extractProblemRestatement(
      responseContent,
      responseReasoning,
      originalQuery
    );

    const verboseInfo: ChatVerboseInfo = {
      stage: "chat",
      stageTransition: context?.lastStageTransition,
      step: context ? context.currentStep : undefined,
      maxSteps: context ? context.maxSteps : undefined,
      // isComplete is not meaningful for chat stage - no real plan exists yet
      // The real plan is only created when moving to implementation stage
    };

    // Add problem summary if we have original query or restatement
    if (originalQuery || problemRestatement.restatedProblem) {
      verboseInfo.problemSummary = {
        originalQuery: originalQuery,
        ...problemRestatement,
        extractedAt: Date.now(),
      };
    }

    // Add extracted files
    if (extractedFiles) {
      verboseInfo.extractedFiles = {
        explicitFiles: extractedFiles.explicitFiles || [],
        detectedFiles: extractedFiles.detectedFiles || [],
        ambiguousMatches: extractedFiles.ambiguousMatches,
      };
    }

    // Add tool calls
    if (toolCalls && toolCalls.length > 0) {
      verboseInfo.toolCalls = toolCalls;
    }

    return verboseInfo;
  }

  /**
   * Build verbose info for assumption stage
   */
  static forAssumptionStage(
    context: ConversationContext | null,
    toolCalls?: Array<{
      name: string;
      stage: WorkflowStage;
      success: boolean;
      error?: string;
    }>,
    conversationHistory?: readonly ChatMessage[]
  ): AssumptionVerboseInfo {
    // Extract all user queries from conversation history
    const allUserQueries = this.extractAllUserQueries(conversationHistory);

    // Prefer conversation history queries if available, otherwise fall back to originalPrompt
    const originalQuery =
      conversationHistory !== undefined && allUserQueries
        ? allUserQueries
        : context?.originalPrompt || "";
    const verboseInfo: AssumptionVerboseInfo = {
      stage: "assumptions",
      stageTransition: context?.lastStageTransition,
      step: context ? context.currentStep : undefined,
      maxSteps: context ? context.maxSteps : undefined,
      // isComplete is not meaningful for assumptions stage - no real plan exists yet
      // The real plan is only created when moving to implementation stage
    };

    // Add problem summary if we have original query
    if (originalQuery) {
      verboseInfo.problemSummary = {
        originalQuery: originalQuery,
        extractedAt: Date.now(),
      };
    }

    // Add code snippets info
    const codeContexts = context?.codeContexts
      ? Array.from(context.codeContexts.values()).flat()
      : [];
    const activeContexts = codeContexts.filter(
      (cc) => cc.isActive && cc.waitForCreate
    );

    if (activeContexts.length > 0) {
      verboseInfo.codeSnippets = {
        extractedCount: activeContexts.length,
        files: activeContexts.map((cc) => ({
          fileName: cc.name,
          version: cc.version,
          lineCount: cc.content.length,
          extractedAt: cc.timestamp || Date.now(),
          waitForCreate: cc.waitForCreate,
        })),
      };
    }

    // Add progress plan info with full step details
    if (context?.progressPlan) {
      verboseInfo.progressPlan = {
        taskId: context.progressPlan.taskId,
        totalSteps: context.progressPlan.totalSteps,
        complexity: context.progressPlan.complexity,
        createdAt: context.progressPlan.createdAt,
        steps: context.progressPlan.steps.map((step) => ({
          stepNumber: step.stepNumber,
          goal: step.goal,
          description: step.description,
          status: step.status || "pending",
          tools: step.tools || [],
        })),
      };
    }

    // Add tool calls
    if (toolCalls && toolCalls.length > 0) {
      verboseInfo.toolCalls = toolCalls;
    }

    return verboseInfo;
  }

  /**
   * Build verbose info for implementation stage
   * Returns wrapped object with computed getter for isComplete
   */
  static forImplementationStage(
    context: ConversationContext | null,
    progressPlanManager: ProgressPlanManager,
    fileOperations?: FileOperationResult,
    toolCalls?: Array<{
      name: string;
      stage: WorkflowStage;
      success: boolean;
      error?: string;
      relatedStep?: number;
    }>
  ): ImplementationVerboseInfo {
    // Only include step/maxSteps when there's a ProgressPlan (real multi-step task)
    // For simple tasks without a plan, don't show misleading step counts
    const hasProgressPlan = !!context?.progressPlan;

    const verboseInfo: ImplementationVerboseInfo = {
      stage: "implementation",
      stageTransition: context?.lastStageTransition,
      step: hasProgressPlan && context ? context.currentStep : undefined,
      maxSteps: hasProgressPlan && context ? context.maxSteps : undefined,
      // isComplete is now computed dynamically as a getter based on planProgress.steps
    };

    // Add plan progress with file operation linking
    if (context?.progressPlan) {
      const plan = progressPlanManager.getPlan(context.progressPlan.taskId);
      if (plan) {
        const completedSteps = plan.steps.filter(
          (s) => s.status === "completed"
        ).length;
        const currentStep = plan.steps.find(
          (s) => s.status === "in_progress" || s.status === "pending"
        );

        // Track which files belong to which step
        // For now, link files to the current active step or infer from completed steps
        const stepFileMap = new Map<
          number,
          { created: string[]; updated: string[] }
        >();

        // If we have file operations, try to link them to steps
        if (fileOperations) {
          // Get the current step number (if we're working on a specific step)
          const activeStepNumber =
            currentStep?.stepNumber ||
            plan.steps.find((s) => s.status === "in_progress")?.stepNumber ||
            (plan.steps.filter((s) => s.status === "completed").length > 0
              ? plan.steps.filter((s) => s.status === "completed").length + 1
              : 1);

          // For now, link all current file operations to the active step
          // In a more sophisticated implementation, we could track step transitions
          const createdFiles = (fileOperations.created || []).map(
            (f) => f.path
          );
          const updatedFiles = (fileOperations.updated || []).map(
            (f) => f.path
          );

          if (createdFiles.length > 0 || updatedFiles.length > 0) {
            stepFileMap.set(activeStepNumber, {
              created: createdFiles,
              updated: updatedFiles,
            });
          }
        }

        // Collect actual executed tools per step from toolCalls
        const stepToolsMap = new Map<number, string[]>();
        if (toolCalls) {
          toolCalls.forEach((tc) => {
            const stepNum =
              tc.relatedStep ||
              currentStep?.stepNumber ||
              (plan.steps.filter((s) => s.status === "completed").length > 0
                ? plan.steps.filter((s) => s.status === "completed").length + 1
                : 1);
            if (!stepToolsMap.has(stepNum)) {
              stepToolsMap.set(stepNum, []);
            }
            if (tc.success && !stepToolsMap.get(stepNum)!.includes(tc.name)) {
              stepToolsMap.get(stepNum)!.push(tc.name);
            }
          });
        }

        verboseInfo.planProgress = {
          taskId: plan.taskId,
          totalSteps: plan.totalSteps,
          completedSteps,
          currentStep: currentStep
            ? {
                stepNumber: currentStep.stepNumber,
                goal: currentStep.goal,
                status: currentStep.status || "pending",
                startedAt:
                  currentStep.status === "in_progress" ? Date.now() : undefined,
                completedAt:
                  currentStep.status === "completed" ? Date.now() : undefined,
              }
            : undefined,
          steps: plan.steps.map((step) => {
            const stepFiles = stepFileMap.get(step.stepNumber);
            const stepTools = stepToolsMap.get(step.stepNumber) || [];
            // Combine planned tools with actually executed tools
            const allTools = [
              ...new Set([...(step.tools || []), ...stepTools]),
            ];

            return {
              stepNumber: step.stepNumber,
              goal: step.goal,
              status: step.status || "pending",
              completedAt: step.status === "completed" ? Date.now() : undefined,
              toolsUsed: allTools.length > 0 ? allTools : step.tools || [],
              filesCreated: stepFiles?.created || [],
              filesUpdated: stepFiles?.updated || [],
            };
          }),
          planCompleted: !!plan.completedAt,
          planCompletedAt: plan.completedAt,
        };
      }
    }

    // Add file operations with step linking
    if (fileOperations) {
      const activeStepNumber = context?.progressPlan
        ? progressPlanManager
            .getPlan(context.progressPlan.taskId)
            ?.steps.find(
              (s) => s.status === "in_progress" || s.status === "pending"
            )?.stepNumber
        : undefined;

      verboseInfo.fileOperations = {
        created: (fileOperations.created || []).map((f) => ({
          ...f,
          relatedStep: activeStepNumber,
        })),
        updated: (fileOperations.updated || []).map((f) => ({
          ...f,
          relatedStep: activeStepNumber,
        })),
        failed: (fileOperations.failed || []).map((f) => ({
          ...f,
          relatedStep: activeStepNumber,
        })),
      };
    }

    // Add tool calls
    if (toolCalls && toolCalls.length > 0) {
      verboseInfo.toolCalls = toolCalls;
    }

    // Wrap with display class to enable computed getter for isComplete
    return withToString(verboseInfo) as ImplementationVerboseInfo;
  }
}

/**
 * Formatter for converting verbose info to display strings
 */
export class VerboseInfoFormatter {
  /**
   * Format any verbose info type to a human-readable string
   */
  static format(verboseInfo: VerboseInfo): string {
    switch (verboseInfo.stage) {
      case "chat":
        return this.formatChatVerboseInfo(verboseInfo);
      case "assumptions":
        return this.formatAssumptionVerboseInfo(verboseInfo);
      case "implementation":
        return this.formatImplementationVerboseInfo(verboseInfo);
      default:
        return JSON.stringify(verboseInfo, null, 2);
    }
  }

  private static formatChatVerboseInfo(info: ChatVerboseInfo): string {
    const lines: string[] = [];
    lines.push(`📋 Chat Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (info.stageTransition) {
      lines.push(
        `\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`
      );
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
        lines.push(`   (Extracted from: ${info.problemSummary.extractedFrom})`);
      }
    }

    if (info.extractedFiles) {
      lines.push(`\n📁 Extracted Files:`);
      if (
        info.extractedFiles.explicitFiles &&
        info.extractedFiles.explicitFiles.length > 0
      ) {
        lines.push(`   Explicit (@file syntax):`);
        info.extractedFiles.explicitFiles.forEach((file) => {
          lines.push(`     • ${file.path} (${file.type})`);
        });
      }
      if (
        info.extractedFiles.detectedFiles &&
        info.extractedFiles.detectedFiles.length > 0
      ) {
        lines.push(`   Detected (natural language):`);
        info.extractedFiles.detectedFiles.forEach((file) => {
          lines.push(
            `     • ${file.path} (${file.type}, confidence: ${file.confidence})`
          );
        });
      }
      if (
        info.extractedFiles.ambiguousMatches &&
        info.extractedFiles.ambiguousMatches.length > 0
      ) {
        lines.push(`   Ambiguous matches:`);
        info.extractedFiles.ambiguousMatches.forEach((match) => {
          lines.push(`     • ${match.path} (${match.reason})`);
        });
      }
    }

    if (info.toolCalls && info.toolCalls.length > 0) {
      lines.push(`\n🔧 Tool Calls:`);
      info.toolCalls.forEach((tc) => {
        const status = tc.success ? "✅" : "❌";
        const fileInfo = tc.file ? ` (${tc.file})` : "";
        lines.push(`   ${status} ${tc.name}${fileInfo}`);
        if (tc.error) {
          lines.push(`      Error: ${tc.error}`);
        }
      });
    }

    return lines.join("\n");
  }

  private static formatAssumptionVerboseInfo(
    info: AssumptionVerboseInfo
  ): string {
    const lines: string[] = [];
    lines.push(`🔍 Assumptions Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (info.stageTransition) {
      lines.push(
        `\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`
      );
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
        lines.push(`   (Extracted from: ${info.problemSummary.extractedFrom})`);
      }
    }

    if (info.codeSnippets) {
      lines.push(`\n💻 Code Snippets:`);
      lines.push(`   Total extracted: ${info.codeSnippets.extractedCount}`);
      if (info.codeSnippets.files && info.codeSnippets.files.length > 0) {
        info.codeSnippets.files.forEach((file) => {
          lines.push(
            `   • ${file.fileName} (v${file.version}, ${file.lineCount} lines)`
          );
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

      // Show plan step details if available
      if (info.progressPlan.steps && info.progressPlan.steps.length > 0) {
        lines.push(`\n   Plan Steps:`);
        info.progressPlan.steps.forEach((step) => {
          const statusIcon =
            step.status === "completed"
              ? "✅"
              : step.status === "in_progress"
                ? "🔄"
                : "⏳";
          lines.push(
            `     ${statusIcon} Step ${step.stepNumber}: ${step.goal}`
          );
          if (step.description && step.description !== step.goal) {
            lines.push(`        ${step.description}`);
          }
          if (step.tools && step.tools.length > 0) {
            lines.push(`        Tools: ${step.tools.join(", ")}`);
          }
        });
      }
    }

    if (info.toolCalls && info.toolCalls.length > 0) {
      lines.push(`\n🔧 Tool Calls:`);
      info.toolCalls.forEach((tc) => {
        const status = tc.success ? "✅" : "❌";
        const fileInfo = tc.file ? ` (${tc.file})` : "";
        lines.push(`   ${status} ${tc.name}${fileInfo}`);
        if (tc.error) {
          lines.push(`      Error: ${tc.error}`);
        }
      });
    }

    return lines.join("\n");
  }

  private static formatImplementationVerboseInfo(
    info: ImplementationVerboseInfo
  ): string {
    const lines: string[] = [];
    lines.push(`⚙️ Implementation Stage Verbose Info`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Only show stage transition if we're just starting (no progress yet)
    // Don't show it if plan is completed or we've already completed steps
    if (info.stageTransition) {
      const shouldShowTransition =
        !info.planProgress || // No plan yet
        (!info.planProgress.planCompleted &&
          info.planProgress.completedSteps === 0); // Plan exists but not started
      if (shouldShowTransition) {
        lines.push(
          `\n🔄 Stage Transition: ${info.stageTransition.from} → ${info.stageTransition.to}`
        );
      }
    }

    // For implementation stage with planProgress, use planProgress values for top-level progress
    // Otherwise fall back to generic step/maxSteps
    if (info.planProgress) {
      lines.push(
        `\n📊 Progress: Step ${info.planProgress.completedSteps}/${info.planProgress.totalSteps}`
      );
    } else if (info.step !== undefined && info.maxSteps !== undefined) {
      lines.push(`\n📊 Progress: Step ${info.step}/${info.maxSteps}`);
    }
    if (info.isComplete) {
      lines.push(`✅ Complete`);
    }

    if (info.planProgress) {
      lines.push(`\n📋 Plan Progress:`);
      lines.push(`   Task ID: ${info.planProgress.taskId}`);
      lines.push(
        `   Steps: ${info.planProgress.completedSteps}/${info.planProgress.totalSteps} completed`
      );

      if (info.planProgress.currentStep) {
        lines.push(`\n   Current Step:`);
        lines.push(
          `     #${info.planProgress.currentStep.stepNumber}: ${info.planProgress.currentStep.goal}`
        );
        lines.push(`     Status: ${info.planProgress.currentStep.status}`);
        if (info.planProgress.currentStep.startedAt) {
          lines.push(
            `     Started: ${new Date(info.planProgress.currentStep.startedAt).toLocaleString()}`
          );
        }
        if (info.planProgress.currentStep.completedAt) {
          lines.push(
            `     Completed: ${new Date(info.planProgress.currentStep.completedAt).toLocaleString()}`
          );
        }
      }

      if (info.planProgress.steps && info.planProgress.steps.length > 0) {
        lines.push(`\n   All Steps (Plan Fulfillment):`);
        info.planProgress.steps.forEach((step) => {
          const statusIcon =
            step.status === "completed"
              ? "✅"
              : step.status === "in_progress"
                ? "🔄"
                : "⏳";
          lines.push(
            `     ${statusIcon} Step ${step.stepNumber}: ${step.goal} (${step.status})`
          );
          if (step.completedAt) {
            lines.push(
              `        Completed: ${new Date(step.completedAt).toLocaleString()}`
            );
          }
          if (step.toolsUsed && step.toolsUsed.length > 0) {
            lines.push(`        Tools Used: ${step.toolsUsed.join(", ")}`);
          }
          // Show which files were created/updated for this step
          if (step.filesCreated && step.filesCreated.length > 0) {
            lines.push(`        Files Created:`);
            step.filesCreated.forEach((file) => {
              lines.push(`          ✅ ${file}`);
            });
          }
          if (step.filesUpdated && step.filesUpdated.length > 0) {
            lines.push(`        Files Updated:`);
            step.filesUpdated.forEach((file) => {
              lines.push(`          🔄 ${file}`);
            });
          }
        });
      }

      if (info.planProgress.planCompleted) {
        lines.push(`\n   🎉 Plan Completed!`);
        if (info.planProgress.planCompletedAt) {
          lines.push(
            `   Completed at: ${new Date(info.planProgress.planCompletedAt).toLocaleString()}`
          );
        }
      }
    }

    if (info.fileOperations) {
      lines.push(`\n📁 File Operations:`);
      if (
        info.fileOperations.created &&
        info.fileOperations.created.length > 0
      ) {
        lines.push(`   Created (${info.fileOperations.created.length}):`);
        info.fileOperations.created.forEach((file) => {
          const stepInfo = file.relatedStep
            ? ` [Step ${file.relatedStep}]`
            : "";
          lines.push(
            `     ✅ ${file.path} (${file.source}${file.version ? `, v${file.version}` : ""}${stepInfo})`
          );
        });
      }
      if (
        info.fileOperations.updated &&
        info.fileOperations.updated.length > 0
      ) {
        lines.push(`   Updated (${info.fileOperations.updated.length}):`);
        info.fileOperations.updated.forEach((file) => {
          const stepInfo = file.relatedStep
            ? ` [Step ${file.relatedStep}]`
            : "";
          lines.push(
            `     🔄 ${file.path} (${file.source}${file.version ? `, v${file.version}` : ""}${stepInfo})`
          );
        });
      }
      if (info.fileOperations.failed && info.fileOperations.failed.length > 0) {
        lines.push(`   Failed (${info.fileOperations.failed.length}):`);
        info.fileOperations.failed.forEach((file) => {
          const stepInfo = file.relatedStep
            ? ` [Step ${file.relatedStep}]`
            : "";
          lines.push(`     ❌ ${file.path}${stepInfo}`);
          lines.push(`        Error: ${file.error}`);
        });
      }
    }

    if (info.toolCalls && info.toolCalls.length > 0) {
      lines.push(`\n🔧 Tool Calls:`);
      info.toolCalls.forEach((tc) => {
        const status = tc.success ? "✅" : "❌";
        const fileInfo = tc.file ? ` (${tc.file})` : "";
        lines.push(`   ${status} ${tc.name}${fileInfo}`);
        if (tc.relatedStep) {
          lines.push(`      Related to Step: ${tc.relatedStep}`);
        }
        if (tc.error) {
          lines.push(`      Error: ${tc.error}`);
        }
      });
    }

    return lines.join("\n");
  }
}

/**
 * Wrapper classes for C#-like toString() functionality
 */
export class ChatVerboseInfoDisplay implements ChatVerboseInfo {
  constructor(private info: ChatVerboseInfo) {
    // Don't use Object.assign - just keep the reference to info
  }

  /**
   * C#-like toString() method - can be called on any ChatVerboseInfo
   */
  toString(): string {
    const formatted = VerboseInfoFormatter.format(this.info);
    // Log when toString() is called
    logVerboseInfo(this.info, formatted);
    return formatted;
  }

  /**
   * Alias for toString() for consistency
   */
  toDisplayString(): string {
    return this.toString();
  }

  get stage() {
    return this.info.stage;
  }
  get stageTransition() {
    return this.info.stageTransition;
  }
  get step() {
    return this.info.step;
  }
  get maxSteps() {
    return this.info.maxSteps;
  }
  get isComplete() {
    return this.info.isComplete;
  }
  get problemSummary() {
    return this.info.problemSummary;
  }
  get extractedFiles() {
    return this.info.extractedFiles;
  }
  get toolCalls() {
    return this.info.toolCalls;
  }
}

export class AssumptionVerboseInfoDisplay implements AssumptionVerboseInfo {
  constructor(private info: AssumptionVerboseInfo) {
    // Don't use Object.assign - just keep the reference to info
  }

  /**
   * C#-like toString() method - can be called on any AssumptionVerboseInfo
   */
  toString(): string {
    const formatted = VerboseInfoFormatter.format(this.info);
    // Log when toString() is called
    logVerboseInfo(this.info, formatted);
    return formatted;
  }

  /**
   * Alias for toString() for consistency
   */
  toDisplayString(): string {
    return this.toString();
  }

  get stage() {
    return this.info.stage;
  }
  get stageTransition() {
    return this.info.stageTransition;
  }
  get step() {
    return this.info.step;
  }
  get maxSteps() {
    return this.info.maxSteps;
  }
  get isComplete() {
    return this.info.isComplete;
  }
  get codeSnippets() {
    return this.info.codeSnippets;
  }
  get progressPlan() {
    return this.info.progressPlan;
  }
  get toolCalls() {
    return this.info.toolCalls;
  }
}

export class ImplementationVerboseInfoDisplay implements ImplementationVerboseInfo {
  constructor(private info: ImplementationVerboseInfo) {
    // Don't use Object.assign - it conflicts with getters
    // Just keep the reference to info
  }

  /**
   * C#-like toString() method - can be called on any ImplementationVerboseInfo
   */
  toString(): string {
    const formatted = VerboseInfoFormatter.format(this.info);
    // Log when toString() is called
    logVerboseInfo(this.info, formatted);
    return formatted;
  }

  /**
   * Alias for toString() for consistency
   */
  toDisplayString(): string {
    return this.toString();
  }

  get stage() {
    return this.info.stage;
  }
  get stageTransition() {
    return this.info.stageTransition;
  }
  get step() {
    return this.info.step;
  }
  /**
   * Computed getter: returns total steps from plan if available
   * Otherwise returns undefined
   */
  get maxSteps(): number | undefined {
    if (this.info.planProgress) {
      return this.info.planProgress.totalSteps;
    }
    return undefined;
  }
  /**
   * Computed getter: determines completion based on current plan step status
   * Dynamically evaluates if all steps are completed or the last step is completed
   */
  get isComplete(): boolean | undefined {
    if (!this.info.planProgress) {
      return undefined;
    }
    const steps = this.info.planProgress.steps || [];
    if (steps.length === 0) {
      return undefined;
    }
    // Check if all steps are completed
    const allCompleted = steps.every((s) => s.status === "completed");
    if (allCompleted) {
      return true;
    }
    
    // Check if the last step is completed (implicit completion)
    const lastStep = steps[steps.length - 1];
    return lastStep?.status === "completed";
  }
  get planProgress() {
    return this.info.planProgress;
  }
  get fileOperations() {
    return this.info.fileOperations;
  }
  get toolCalls() {
    return this.info.toolCalls;
  }
}

/**
 * Factory function to wrap verbose info with toString() capability (C#-like)
 * This allows calling toString() on any verboseInfo type
 */
export function withToString(
  verboseInfo: VerboseInfo
): VerboseInfo & { toString(): string; toDisplayString(): string } {
  switch (verboseInfo.stage) {
    case "chat":
      return new ChatVerboseInfoDisplay(verboseInfo) as any;
    case "assumptions":
      return new AssumptionVerboseInfoDisplay(verboseInfo) as any;
    case "implementation":
      return new ImplementationVerboseInfoDisplay(verboseInfo) as any;
    default:
      return verboseInfo as any;
  }
}

/**
 * Log verboseInfo using toString() (C#-like approach)
 * This wraps verboseInfo with toString() and calls it, which triggers logging
 * Returns the formatted string (useful if you want to use it)
 */
export function logVerboseInfoWithToString(
  verboseInfo: VerboseInfo | null | undefined
): string {
  if (!verboseInfo) {
    return "";
  }
  const verboseInfoWithToString = withToString(verboseInfo);
  return verboseInfoWithToString.toString(); // This will log via logVerboseInfo() inside toString()
}

/**
 * Factory function to wrap verbose info with display capability
 * @deprecated Use withToString() instead for C#-like toString() behavior
 */
export function withDisplayString(
  verboseInfo: VerboseInfo
): VerboseInfo & { toDisplayString(): string; toString(): string } {
  return withToString(verboseInfo);
}
