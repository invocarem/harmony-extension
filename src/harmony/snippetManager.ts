import { CodeContext, CodeContextType } from "./codeContext";
import { ConversationContextManager } from "./conversationContext";

/**
 * Represents a user requirement that needs to be fulfilled in snippet stage
 */
export interface SnippetRequirement {
  /** Type of requirement */
  type: "question" | "bug_fix" | "feature_addition" | "text_generation";
  /** Description of the requirement */
  description: string;
  /** Target file (if applicable) */
  targetFile?: string;
  /** Target function (if applicable) */
  targetFunction?: string;
  /** Associated CodeContext (created when code is generated) */
  codeContextsByName?: Map<string, CodeContext>;
  /** Whether this requirement is complete */
  isComplete: boolean;
  /** Step number when this requirement was created */
  stepNumber?: number;
}

/**
 * Manages multiple CodeContexts and requirements in snippet stage
 * Tracks completion status of all tasks
 */
export class SnippetManager {
  private requirements: SnippetRequirement[] = [];
  private contextManager: ConversationContextManager;

  constructor(contextManager: ConversationContextManager) {
    this.contextManager = contextManager;
  }

  /**
   * Initialize from user prompt when entering snippet stage
   * Parses the prompt to identify requirements and create initial CodeContexts
   */
  initializeFromPrompt(prompt: string, stepNumber?: number): void {
    this.requirements = [];

    // Parse prompt to identify requirements
    // This is a simple implementation - can be enhanced with LLM-based parsing
    const requirements = this.parseRequirements(prompt);

    for (const req of requirements) {
      req.stepNumber = stepNumber;
      this.requirements.push(req);

      // Create placeholder CodeContext for task requirements
      if (this.isExecutionRequirement(req)) {
        const codeContext = this.createCommandExecutionCodeContext(
          req,
          stepNumber
        );
        const contextMap = this.getRequirementContextMap(req, true);
        contextMap.set(codeContext.name, codeContext);
        this.contextManager.addCodeContext(codeContext, prompt);
      } else if (req.type !== "question" && req.targetFile) {
        const codeContext = new CodeContext(
          req.targetFile,
          [], // Empty content initially
          true, // waitForCreate: true
          "v1",
          Date.now(),
          req.description,
          undefined,
          true, // isActive
          stepNumber,
          CodeContextType.TASK // Counts toward completion
        );
        const contextMap = this.getRequirementContextMap(req, true);
        contextMap.set(codeContext.name, codeContext);
        this.contextManager.addCodeContext(codeContext, prompt);
      }
    }

    console.log(
      `[SnippetManager] Initialized with ${this.requirements.length} requirement(s)`
    );
  }

  /**
   * Add a requirement (for incremental tracking in chat stage)
   * Does NOT create CodeContexts - those are created when entering snippet stage
   */
  addRequirement(requirement: SnippetRequirement): void {
    // Check if requirement already exists
    const existing = this.requirements.find(
      (r) =>
        r.type === requirement.type &&
        r.targetFile === requirement.targetFile &&
        r.targetFunction === requirement.targetFunction
    );

    if (!existing) {
      this.requirements.push(requirement);
      console.log(
        `[SnippetManager] Added requirement: ${requirement.type} - ${requirement.description}`
      );
    }
  }

  /**
   * Parse user prompt to identify requirements
   * Simple pattern-based parsing - can be enhanced with LLM
   * Made public for use in chat stage
   */
  parseRequirements(prompt: string): SnippetRequirement[] {
    const requirements: SnippetRequirement[] = [];

    // Helper to check if requirement already exists
    const isDuplicate = (type: string, targetFile?: string): boolean => {
      return requirements.some(
        (req) => req.type === type && req.targetFile === targetFile
      );
    };

    // Check for bug fix requests
    const bugFixPatterns = [
      /fix\s+(?:the\s+)?bug\s+in\s+([^\s]+)/i,
      /bug\s+in\s+([^\s]+)/i,
      /fix\s+(?:the\s+|a\s+|an\s+)?([^\s]+\.[\w]+)/i, // More specific: must have file extension
    ];
    for (const pattern of bugFixPatterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const fileName = this.extractFileName(match[1]);
        if (fileName && !isDuplicate("bug_fix", fileName)) {
          requirements.push({
            type: "bug_fix",
            description: `Fix bug in ${fileName}`,
            targetFile: fileName,
            isComplete: false,
          });
        }
      }
    }

    // Check for feature addition requests
    const featurePatterns = [
      /add\s+(?:a\s+)?(?:new\s+)?(?:function|feature|method)\s+(?:to\s+)?([^\s]+)/i,
      /create\s+(?:a\s+)?(?:new\s+)?(?:function|feature|method)\s+(?:in\s+)?([^\s]+)/i,
      /implement\s+(?:a\s+)?(?:new\s+)?(?:function|feature|method)\s+(?:in\s+)?([^\s]+)/i,
    ];
    for (const pattern of featurePatterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const fileName = this.extractFileName(match[1]);
        if (fileName && !isDuplicate("feature_addition", fileName)) {
          requirements.push({
            type: "feature_addition",
            description: `Add feature to ${fileName}`,
            targetFile: fileName,
            isComplete: false,
          });
        }
      }
    }

    // Check for command execution requests
    const executionPatterns = [
      /\b(?:run|execute|invoke|launch)\s+(?:the\s+)?[^\s]+\.(?:py|js|ts|sh|bat|ps1|rb|php|pl|go|rs|jar|exe)\b/i,
      /\b(?:run|execute|invoke|launch)\s+(?:the\s+)?(?:script|command|program|tool)\b/i,
      /\b(?:terminal|command\s+line|cli)\b/i,
    ];
    const mentionsExecution = executionPatterns.some((p) => p.test(prompt));
    if (mentionsExecution) {
      const fileMatch = prompt.match(
        /([^\s]+\.(?:py|js|ts|sh|bat|ps1|rb|php|pl|go|rs|jar|exe))/i
      );
      const fileName = fileMatch
        ? this.extractFileName(fileMatch[1])
        : undefined;
      if (!isDuplicate("question", fileName)) {
        requirements.push({
          type: "question",
          description: fileName
            ? `Execute ${fileName}`
            : "Execute the requested command",
          targetFile: fileName,
          isComplete: false,
        });
      }
    }

    // Check for question/answer requests (text/markdown generation)
    const questionPatterns = [
      /(?:explain|what|how|why|describe|analyze|brief)/i,
      /(?:answer|analysis|brief|summary)/i,
      /(?:suggest|recommend|advice|approach|best way|best approach)/i,
    ];
    if (questionPatterns.some((p) => p.test(prompt))) {
      // If it's a question, add a question requirement alongside others
      if (!isDuplicate("question")) {
        requirements.push({
          type: "question",
          description: "Generate answer/analysis/brief",
          isComplete: false,
        });
      }
    }

    // If no specific requirements found, create a generic one
    if (requirements.length === 0) {
      requirements.push({
        type: "text_generation",
        description: prompt.substring(0, 100),
        isComplete: false,
      });
    }

    return requirements;
  }

  /**
   * Extract file name from a string (handles various formats)
   */
  private extractFileName(input: string): string | undefined {
    // Remove common prefixes/suffixes
    const cleaned = input
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/[.,;:!?]+$/, "")
      .trim();

    // Check if it looks like a file path
    if (/\.\w{2,4}$/.test(cleaned)) {
      return cleaned;
    }

    return undefined;
  }

  /**
   * Extract CodeContexts from LLM response
   * Updates existing requirements with extracted code
   */
  extractCodeContextsFromResponse(response: string, stepNumber?: number): void {
    // Extract code blocks from response
    const codeBlockPattern = /```[\s\S]*?```/g;
    const codeBlocks = response.match(codeBlockPattern) || [];

    for (const codeBlock of codeBlocks) {
      const codeContext = CodeContext.fromCodeBlock(
        codeBlock,
        undefined,
        stepNumber
      );
      if (codeContext) {
        // Set type to TASK (counts toward completion)
        codeContext.type = CodeContextType.TASK;

        // Try to match with existing requirement
        const matchingRequirement = this.findMatchingRequirement(
          codeContext.name
        );
        if (matchingRequirement) {
          const contextMap = this.getRequirementContextMap(
            matchingRequirement,
            true
          );
          contextMap.set(codeContext.name, codeContext);
          // Update the CodeContext in context manager
          this.contextManager.addCodeContext(codeContext);
        } else {
          // New CodeContext not matching any requirement - add as new requirement
          this.requirements.push({
            type: "text_generation",
            description: `Code snippet for ${codeContext.name}`,
            targetFile: codeContext.name,
            codeContextsByName: new Map([[codeContext.name, codeContext]]),
            isComplete: false,
            stepNumber: stepNumber,
          });
          this.contextManager.addCodeContext(codeContext);
        }
      }
    }

    // Check for text/markdown content (for question requirements)
    const textRequirements = this.requirements.filter(
      (r) =>
        r.type === "question" &&
        !r.isComplete &&
        !this.isExecutionRequirement(r)
    );
    if (textRequirements.length > 0 && response.trim().length > 50) {
      // If we have question requirements and substantial text response, mark as complete
      for (const req of textRequirements) {
        req.isComplete = true;
      }
    }

    // Update completion status
    this.updateCompletionStatus();
  }

  /**
   * Mark command execution requirements as complete when terminal tool is used
   */
  markCommandExecutionComplete(
    executedToolCalls:
      | Array<{ name: string; arguments: Record<string, any>; result?: any }>
      | undefined
  ): void {
    if (!executedToolCalls || executedToolCalls.length === 0) {
      return;
    }

    const terminalCalls = executedToolCalls.filter(
      (tc) => tc.name === "exec_terminal"
    );
    if (terminalCalls.length === 0) {
      return;
    }

    const outputLines: string[] = [];
    terminalCalls.forEach((tc, index) => {
      const command = tc.arguments?.command;
      if (command) {
        outputLines.push(`Command: ${command}`);
      }

      const textParts = (tc.result?.content || [])
        .filter(
          (content: { type: string; text?: string }) =>
            content.type === "text" && content.text
        )
        .map(
          (content: { type: string; text?: string }) => content.text as string
        );

      textParts.forEach((text: string) => {
        const lines = text.split("\n");
        lines.forEach((line: string) => outputLines.push(line));
      });

      if (index < terminalCalls.length - 1) {
        outputLines.push("---");
      }
    });

    for (const req of this.requirements) {
      if (this.isExecutionRequirement(req)) {
        const contextMap = this.getRequirementContextMap(req, true);
        const key = req.targetFile || "command_execution";
        const existing = contextMap.get(key);
        const codeContext =
          existing || this.createCommandExecutionCodeContext(req);
        codeContext.content = outputLines;
        codeContext.timestamp = Date.now();
        contextMap.set(codeContext.name, codeContext);
        this.contextManager.addCodeContext(codeContext);
        req.isComplete = outputLines.some((line) => line.trim().length > 0);
      }
    }
  }

  /**
   * Find requirement that matches a file name
   */
  private findMatchingRequirement(
    fileName: string
  ): SnippetRequirement | undefined {
    return this.requirements.find(
      (req) => req.targetFile === fileName && !req.isComplete
    );
  }

  /**
   * Update completion status of all requirements
   */
  private updateCompletionStatus(): void {
    for (const req of this.requirements) {
      const contextMap = req.codeContextsByName;
      if (contextMap && contextMap.size > 0) {
        const contexts = Array.from(contextMap.values());
        req.isComplete = contexts.some(
          (context) =>
            context.content.length > 0 &&
            context.content.some((line) => line.trim().length > 0)
        );
      } else if (this.isExecutionRequirement(req)) {
        // Command execution completion is tracked via tool execution
        // Preserve current status
      } else if (req.type === "question") {
        // Question requirements are marked complete in extractCodeContextsFromResponse
        // Keep existing status
      } else {
        // No CodeContext yet - not complete
        req.isComplete = false;
      }
    }
  }

  /**
   * Get all task CodeContexts (count toward completion)
   */
  getTaskCodeContexts(): CodeContext[] {
    const taskContexts: CodeContext[] = [];
    for (const req of this.requirements) {
      const contextMap = req.codeContextsByName;
      if (contextMap && contextMap.size > 0) {
        for (const context of contextMap.values()) {
          if (context.type === CodeContextType.TASK) {
            taskContexts.push(context);
          }
        }
      }
    }
    return taskContexts;
  }

  /**
   * Get reference CodeContexts (don't count toward completion)
   */
  getReferenceCodeContexts(): CodeContext[] {
    // Get from context manager - all CodeContexts with type REFERENCE
    return this.contextManager.getReferenceCodeContexts();
  }

  /**
   * Get all requirements
   */
  getRequirements(): SnippetRequirement[] {
    return [...this.requirements];
  }

  /**
   * Get pending (incomplete) requirements
   */
  getPendingRequirements(): SnippetRequirement[] {
    return this.requirements.filter((req) => !req.isComplete);
  }

  /**
   * Check if all task CodeContexts are complete
   * Updates completion status before checking to ensure accuracy
   */
  areAllTasksComplete(): boolean {
    // Update completion status first to ensure it's current
    this.updateCompletionStatus();

    const taskRequirements = this.requirements.filter(
      (req) => req.type !== "question" || this.isExecutionRequirement(req)
    );

    console.log(
      `[SnippetManager.areAllTasksComplete] Total requirements: ${this.requirements.length}, Task requirements: ${taskRequirements.length}`
    );

    if (taskRequirements.length === 0) {
      // No task requirements - check if we have any question requirements
      const questionRequirements = this.requirements.filter(
        (req) => req.type === "question" && !this.isExecutionRequirement(req)
      );
      console.log(
        `[SnippetManager.areAllTasksComplete] No task requirements, question requirements: ${questionRequirements.length}`
      );
      if (questionRequirements.length === 0) {
        // No requirements at all - consider complete (nothing to do)
        console.log(
          `[SnippetManager.areAllTasksComplete] No requirements at all, returning true`
        );
        return true;
      }
      const allComplete = questionRequirements.every((req) => req.isComplete);
      console.log(
        `[SnippetManager.areAllTasksComplete] Question requirements all complete: ${allComplete}`
      );
      return allComplete;
    }

    // Check if all task requirements are complete
    const allComplete = taskRequirements.every((req) => req.isComplete);

    // Log detailed status for debugging
    taskRequirements.forEach((req) => {
      const contexts = req.codeContextsByName
        ? Array.from(req.codeContextsByName.values())
        : [];
      const hasContent = contexts.some((context) => context.content.length > 0);
      const hasNonEmptyLines = contexts.some((context) =>
        context.content.some((line) => line.trim().length > 0)
      );
      console.log(
        `[SnippetManager.areAllTasksComplete] Requirement: ${req.description}, isComplete: ${req.isComplete}, hasContent: ${hasContent}, hasNonEmptyLines: ${hasNonEmptyLines}`
      );
    });

    if (!allComplete) {
      // Log which requirements are incomplete for debugging
      const incomplete = taskRequirements.filter((req) => !req.isComplete);
      console.log(
        `[SnippetManager.areAllTasksComplete] Incomplete requirements: ${incomplete.map((r) => r.description).join(", ")}`
      );
    } else {
      console.log(
        `[SnippetManager.areAllTasksComplete] All task requirements complete`
      );
    }

    return allComplete;
  }

  /**
   * Get pending task CodeContexts
   */
  getPendingTaskCodeContexts(): CodeContext[] {
    return this.getTaskCodeContexts().filter((cc) => {
      const req = this.requirements.find((r) => {
        if (!r.codeContextsByName) {
          return false;
        }
        return r.codeContextsByName.get(cc.name) === cc;
      });
      return req ? !req.isComplete : false;
    });
  }

  /**
   * Add a reference CodeContext (from chat stage)
   * These don't count toward completion
   */
  addReferenceCodeContext(
    fileName: string,
    content: string[],
    description?: string
  ): void {
    const refContext = new CodeContext(
      fileName,
      content,
      false, // waitForCreate: false (reference only)
      "v1",
      Date.now(),
      description || "Reference from chat stage",
      undefined,
      true, // isActive
      undefined,
      CodeContextType.REFERENCE // type: REFERENCE (doesn't count)
    );
    this.contextManager.addCodeContext(refContext);
    console.log(`[SnippetManager] Added reference CodeContext: ${fileName}`);
  }

  /**
   * Create task CodeContexts from existing requirements
   * Called when entering snippet stage to convert requirements to CodeContexts
   */
  createTaskCodeContextsFromRequirements(stepNumber?: number): void {
    for (const req of this.requirements) {
      // Only create CodeContexts for task requirements (not questions)
      if (this.isExecutionRequirement(req)) {
        const contextMap = this.getRequirementContextMap(req, true);
        const key = req.targetFile || "command_execution";
        if (!contextMap.has(key)) {
          const codeContext = this.createCommandExecutionCodeContext(
            req,
            stepNumber
          );
          contextMap.set(codeContext.name, codeContext);
          req.stepNumber = stepNumber;
          this.contextManager.addCodeContext(codeContext);
          console.log(
            `[SnippetManager] Created task CodeContext for requirement: ${req.description}`
          );
        }
      } else if (req.type !== "question" && req.targetFile) {
        const contextMap = this.getRequirementContextMap(req, true);
        if (!contextMap.has(req.targetFile)) {
          const codeContext = new CodeContext(
            req.targetFile,
            [], // Empty content initially
            true, // waitForCreate: true
            "v1",
            Date.now(),
            req.description,
            undefined,
            true, // isActive
            stepNumber,
            CodeContextType.TASK // Counts toward completion
          );
          contextMap.set(codeContext.name, codeContext);
          req.stepNumber = stepNumber;
          this.contextManager.addCodeContext(codeContext);
          console.log(
            `[SnippetManager] Created task CodeContext for requirement: ${req.description}`
          );
        }
      }
    }
  }

  private createCommandExecutionCodeContext(
    requirement: SnippetRequirement,
    stepNumber?: number
  ): CodeContext {
    const name = requirement.targetFile || "command_execution";
    return new CodeContext(
      name,
      [],
      false, // waitForCreate: false (execution output only)
      "v1",
      Date.now(),
      requirement.description,
      undefined,
      true,
      stepNumber,
      CodeContextType.TASK
    );
  }

  private isExecutionRequirement(requirement: SnippetRequirement): boolean {
    if (requirement.type !== "question") {
      return false;
    }
    return requirement.description.toLowerCase().startsWith("execute ");
  }

  private getRequirementContextMap(
    requirement: SnippetRequirement,
    createIfMissing: boolean = false
  ): Map<string, CodeContext> {
    if (!requirement.codeContextsByName && createIfMissing) {
      requirement.codeContextsByName = new Map<string, CodeContext>();
    }
    return requirement.codeContextsByName || new Map<string, CodeContext>();
  }

  /**
   * Clear all requirements (when leaving snippet stage)
   */
  clear(): void {
    this.requirements = [];
    console.log(`[SnippetManager] Cleared all requirements`);
  }

  /**
   * Check if manager has any requirements
   */
  hasRequirements(): boolean {
    return this.requirements.length > 0;
  }

  /**
   * Check if a file is already available as a reference context
   * Returns the CodeContext if available, null otherwise
   */
  getFileReference(fileName: string): CodeContext | null {
    const refContexts = this.getReferenceCodeContexts();
    // Try exact match first
    let context = refContexts.find((cc) => cc.name === fileName);
    if (context) return context;

    // Try basename match (in case paths differ slightly)
    const baseName = fileName.split(/[/\\]/).pop();
    if (baseName) {
      context = refContexts.find((cc) => {
        const ccBaseName = cc.name.split(/[/\\]/).pop();
        return ccBaseName === baseName;
      });
      if (context) return context;
    }

    return null;
  }

  /**
   * Check if a file needs to be read (not already available as reference)
   */
  needsFileRead(fileName: string): boolean {
    return this.getFileReference(fileName) === null;
  }
}
