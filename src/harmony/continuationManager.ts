import { MCPToolResult } from "../mcpClient";
import { WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { SnippetManager } from "./snippetManager";

/**
 * Manages continuation logic and task completion detection
 */
export class ContinuationManager {
  /**
   * Determine if the task should continue after tool execution
   */
  shouldContinueTask(
    originalPrompt: string,
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentContent: string,
    isAlreadyContinuation: boolean,
    currentStage: WorkflowStage,
    conversationContext: ConversationContext | null,
    snippetManager?: SnippetManager
  ): boolean {
    // Check if we've reached the maximum steps
    if (
      conversationContext &&
      conversationContext.continueStep > conversationContext.continueLimit
    ) {
      return false;
    }

    // Also check if the NEXT step would exceed continuation limit
    if (
      conversationContext &&
      conversationContext.continueStep + 1 > conversationContext.continueLimit
    ) {
      return false;
    }

    // If we're already in a continuation and we've executed tool calls, be very conservative
    // The continuation response has already done work, so only continue if explicitly needed
    if (isAlreadyContinuation && executedToolCalls.length > 0) {
      const suggestsCompletion =
        /\b(?:done|complete|finished|ready|all|both|each)\b/i.test(
          currentContent.toLowerCase()
        );
      if (suggestsCompletion) {
        console.log(
          `[Harmony] Already in continuation and content suggests completion, not continuing`
        );
        return false;
      }
      // After a continuation has executed tool calls, only continue if content explicitly says MORE work is needed
      // Simple action statements like "Now I will read another file" don't count - they describe what was just done
      const explicitlyNeedsMore =
        /\b(?:still|also|must|should|more|additional|further|continue|then)\b|need to|next step/i.test(
          currentContent.toLowerCase()
        );
      if (!explicitlyNeedsMore) {
        console.log(
          `[Harmony] Already in continuation with executed tool calls, content doesn't explicitly need more work, not continuing`
        );
        return false;
      }
    }

    // Stage-specific completion logic
    if (currentStage === "chat") {
      return this.shouldContinueInChatStage(
        originalPrompt,
        executedToolCalls,
        currentContent,
        isAlreadyContinuation
      );
    }

    if (currentStage === "assumptions") {
      return this.shouldContinueInAssumptionsStage(
        originalPrompt,
        executedToolCalls,
        currentContent,
        conversationContext
      );
    }

    if (currentStage === "snippet") {
      return this.shouldContinueInSnippetStage(
        originalPrompt,
        executedToolCalls,
        currentContent,
        isAlreadyContinuation,
        snippetManager
      );
    }

    // Implementation stage
    return this.shouldContinueInImplementationStage(
      originalPrompt,
      executedToolCalls,
      currentContent
    );
  }

  private shouldContinueInChatStage(
    originalPrompt: string,
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentContent: string,
    isAlreadyContinuation: boolean = false
  ): boolean {
    // Check if this is a file task with only discovery tools - allow continuation
    const isFileTask =
      /(?:update|create|write|modify|edit|generate|read).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(
        originalPrompt.toLowerCase()
      );
    const onlyDiscoveryTools = executedToolCalls.every((tc) =>
      ["list_files", "read_file", "grep_files", "search", "find"].includes(
        tc.name
      )
    );
    const hasFileModification = executedToolCalls.some((tc) =>
      ["create_file", "replace_file", "write_file", "update_file"].includes(
        tc.name
      )
    );

    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      // Check if content suggests the task is complete
      const suggestsCompletion =
        /\b(?:done|complete|finished|ready|here|below|above)\b/i.test(
          currentContent.toLowerCase()
        );
      if (suggestsCompletion) {
        console.log(
          `[Harmony] Chat stage: File task appears complete, not continuing`
        );
        return false;
      }

      // If we're already in a continuation, be more conservative - only continue if content explicitly suggests more work
      if (isAlreadyContinuation) {
        const explicitlySuggestsMore =
          /\b(?:next|another|also|still|more|should)\b|need to/i.test(
            currentContent.toLowerCase()
          );
        if (!explicitlySuggestsMore) {
          console.log(
            `[Harmony] Chat stage: Already in continuation and no explicit suggestion of more work, not continuing`
          );
          return false;
        }
      }

      console.log(
        `[Harmony] Chat stage: File task with only discovery tools, continuing`
      );
      return true;
    }

    // Otherwise, only continue if there are explicit continuation hints
    const hasContinuationHint =
      /\b(?:next|continue|then|after|now|further|additional|proceed)\b|let'?s/i.test(
        currentContent.toLowerCase()
      );
    if (hasContinuationHint) {
      console.log(
        `[Harmony] Chat stage: Has continuation hints, may need to continue`
      );
      return true;
    }
    return false;
  }

  private shouldContinueInSnippetStage(
    originalPrompt: string,
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentContent: string,
    isAlreadyContinuation: boolean = false,
    snippetManager?: SnippetManager
  ): boolean {
    const contentWithoutToolResults = this.stripToolResults(currentContent);

    // NEW: Check SnippetManager completion status first (if available)
    // This takes priority over other checks - if SnippetManager says tasks are incomplete, continue
    if (snippetManager && snippetManager.hasRequirements()) {
      const allComplete = snippetManager.areAllTasksComplete();
      if (allComplete) {
        console.log(
          `[Harmony] Snippet stage: All tasks complete per SnippetManager, task complete`
        );
        return false; // Don't continue - all tasks done
      }

      // If not all complete, we have pending work - continue
      const pendingReqs = snippetManager.getPendingRequirements();
      const pendingTasks = snippetManager.getPendingTaskCodeContexts();
      
      if (pendingReqs.length > 0 || pendingTasks.length > 0) {
        console.log(
          `[Harmony] Snippet stage: ${pendingReqs.length} pending requirement(s), ${pendingTasks.length} pending task(s) per SnippetManager, continuing`
        );
        // Continue even if read_file was blocked or no tool calls executed - we need to generate code
        return true;
      }
    }

    // Snippet stage goal: Generate code snippets directly - may need to read files or explore workspace first
    // Always continue after read-only tool calls because we need the results to generate code

    // Check if we have code snippets in the response
    const hasCodeSnippets = /```[\s\S]*?```/.test(contentWithoutToolResults);

    // Check if we've only done discovery/read tools
    const onlyDiscoveryTools = executedToolCalls.every((tc) =>
      ["list_files", "read_file", "grep_files", "search", "find"].includes(
        tc.name
      )
    );

    // If we've only used discovery tools and no code is generated yet, continue
    if (onlyDiscoveryTools && !hasCodeSnippets) {
      console.log(
        `[Harmony] Snippet stage: Only discovery tools used, no code generated yet, continuing`
      );
      return true;
    }

    // Check for completion phrases
    const hasCompletionPhrase =
      /(?:here'?s|here is|below is|this (?:could|should|would) go)/i.test(
        contentWithoutToolResults.toLowerCase()
      );

    // If we have code snippets and completion phrases, task is done
    if (hasCodeSnippets && hasCompletionPhrase) {
      console.log(
        `[Harmony] Snippet stage: Code snippets generated with completion phrase, task complete`
      );
      return false;
    }

    // If we have code snippets but no completion phrase, check for continuation hints
    if (hasCodeSnippets) {
      const hasContinuationHint =
        /\b(?:next|another|also|additionally|further|more)\b/i.test(
          contentWithoutToolResults.toLowerCase()
        );
      if (hasContinuationHint) {
        console.log(
          `[Harmony] Snippet stage: Has continuation hints, continuing`
        );
        return true;
      }
      // Has code but no continuation hint - check SnippetManager if available
      if (snippetManager && snippetManager.hasRequirements()) {
        // If SnippetManager says tasks are complete, we're done
        if (snippetManager.areAllTasksComplete()) {
          console.log(
            `[Harmony] Snippet stage: Code snippets generated and SnippetManager confirms all tasks complete`
          );
          return false;
        }
        // Otherwise continue to complete remaining tasks
        console.log(
          `[Harmony] Snippet stage: Code snippets generated but SnippetManager has pending tasks, continuing`
        );
        return true;
      }
      // Has code but no continuation hint - task complete (fallback if no SnippetManager)
      console.log(
        `[Harmony] Snippet stage: Code snippets generated, no continuation hints, task complete`
      );
      return false;
    }

    // If response is very short (< 100 chars), it's likely incomplete
    if (contentWithoutToolResults.trim().length < 100) {
      console.log(
        `[Harmony] Snippet stage: Response too short, likely incomplete, continuing`
      );
      return true;
    }

    // Default: if no code has been generated, continue
    console.log(
      `[Harmony] Snippet stage: Default - continuing to generate code`
    );
    return true;
  }

  private stripToolResults(content: string): string {
    if (
      !content.includes("**Tool Results:**") &&
      !content.includes("Tool Results:")
    ) {
      return content;
    }

    const toolResultsPattern = /(?:\*\*)?Tool Results(?::)?(?:\*\*)?/i;
    const toolResultsMatch = content.match(toolResultsPattern);
    if (!toolResultsMatch || toolResultsMatch.index === undefined) {
      return content;
    }

    return content.substring(0, toolResultsMatch.index);
  }

  private shouldContinueInAssumptionsStage(
    originalPrompt: string,
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentContent: string,
    conversationContext: ConversationContext | null
  ): boolean {
    // Assumptions stage goal: Analyze, create plan, list assumptions - NOT generate code
    // Check if we have a complete plan and analysis

    // Check if a plan exists and is complete
    const plan = conversationContext?.progressPlan;
    const hasPlan = !!plan;
    const planComplete = hasPlan && plan.totalSteps > 0;

    // Check for plan indicators in the response
    const hasPlanSteps = /step\s+\d+:/i.test(currentContent);
    const hasAssumptions =
      /\b(?:assumption|assume|assuming|consideration)\b|edge\s+case/i.test(
        currentContent.toLowerCase()
      );
    const hasAnalysis =
      /\b(?:analyze|analysis|complexity|requirement|identify)\b/i.test(
        currentContent.toLowerCase()
      );

    // Check if we have code snippets (should NOT have them in assumptions stage)
    const hasCodeSnippets = /```[\s\S]*?```/.test(currentContent);
    if (hasCodeSnippets) {
      // If code snippets are present, this suggests the model may be confused about the stage
      // But we should still check if the plan is complete before deciding to continue
      console.log(
        `[Harmony] Assumptions stage: Code snippets detected (unexpected in assumptions stage, but checking plan completeness)`
      );
    }

    // Check for explicit continuation hints
    const hasContinuationHint =
      /\b(?:next|continue|then|after|now|further|additional|more|also)\b/i.test(
        currentContent.toLowerCase()
      );

    // Check if the response looks incomplete (starts with "Below are..." but nothing follows)
    const hasIncompletePhrase =
      /(?:below|above|here).*(?:are|is).*(?:code|snippet|plan|step)/i.test(
        currentContent.toLowerCase()
      ) && currentContent.trim().length < 200; // Short response suggests incomplete

    if (hasIncompletePhrase) {
      console.log(
        `[Harmony] Assumptions stage: Incomplete phrase detected, continuing to get full response...`
      );
      return true;
    }

    // If we have a plan and analysis seems complete, don't continue
    if (
      planComplete &&
      hasPlanSteps &&
      (hasAssumptions || hasAnalysis) &&
      !hasContinuationHint
    ) {
      console.log(
        `[Harmony] Assumptions stage: Plan and analysis appear complete, not continuing`
      );
      return false;
    }

    // If we have continuation hints, continue
    if (hasContinuationHint) {
      console.log(
        `[Harmony] Assumptions stage: Has continuation hints, continuing...`
      );
      return true;
    }

    // If we don't have a plan yet, continue to get one
    if (!hasPlan || !planComplete) {
      console.log(
        `[Harmony] Assumptions stage: Plan not yet complete, continuing...`
      );
      return true;
    }

    // If we have a plan but no clear analysis/assumptions, continue to get them
    if (planComplete && !hasAssumptions && !hasAnalysis) {
      console.log(
        `[Harmony] Assumptions stage: Plan exists but analysis/assumptions missing, continuing...`
      );
      return true;
    }

    // Default: don't continue if we have a complete plan and analysis
    return false;
  }

  private shouldContinueInImplementationStage(
    originalPrompt: string,
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentContent: string
  ): boolean {
    const taskCompletionPhrases = [
      /(?:updated|created|wrote|modified).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i,
      /file.*has been.*(?:created|updated|written|modified)/i,
      /task.*(?:complete|done|finished|accomplished)/i,
      /(?:here'?s|here is).*the.*(?:readme|file|code)/i,
      /I have.*(?:created|updated|written)/i,
      /\*\*File:\*\*\s*`[^`]+`/i,
      /```[\s\S]*?```/i,
    ];

    const hasCompletionPhrase = taskCompletionPhrases.some((phrase) =>
      phrase.test(currentContent.toLowerCase())
    );

    // Check if we've performed file modification
    const hasFileModification = executedToolCalls.some((tc) =>
      ["create_file", "replace_file", "write_file", "update_file"].includes(
        tc.name
      )
    );

    // Check if we've executed terminal commands
    const hasTerminalExecution = executedToolCalls.some(
      (tc) => tc.name === "exec_terminal"
    );

    // Check if the response indicates file modification was done (even without tool calls)
    const indicatesFileModified =
      /(?:I will|I'll|going to|will|should|need to).*(?:update|modify|change|edit|replace).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(
        currentContent.toLowerCase()
      );

    // Check if original prompt requested file creation/modification
    const isFileTask =
      /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(
        originalPrompt.toLowerCase()
      );

    // Check if we've only done discovery/read tools
    const onlyDiscoveryTools = executedToolCalls.every((tc) =>
      ["list_files", "read_file", "grep_files", "search", "find"].includes(
        tc.name
      )
    );

    // Check if we've only done terminal execution (no file modifications yet)
    const onlyTerminalExecution =
      executedToolCalls.length > 0 &&
      executedToolCalls.every((tc) => tc.name === "exec_terminal");

    // Check if the current content mentions specific tool calls that should be made
    const mentionsToolCalls =
      /(?:will call|should call|need to call|calling|use).*(?:tool|function|method|update_file|write_file|create_file)/i.test(
        currentContent.toLowerCase()
      );

    // Decision logic for implementation stage

    // If we executed terminal commands but haven't created documentation files yet, continue
    if (
      onlyTerminalExecution &&
      isFileTask &&
      !hasFileModification &&
      !hasCompletionPhrase
    ) {
      console.log(
        `[Harmony] Implementation stage: Terminal command executed but documentation file not created yet, continuing`
      );
      return true;
    }

    // If we executed terminal commands and the task involves creating log/output files, continue until files are created
    if (hasTerminalExecution && !hasFileModification && !hasCompletionPhrase) {
      const taskMentionsLogging =
        /\b(?:log|output|result|document|save|record)\b|step_\d+/i.test(
          originalPrompt.toLowerCase()
        );
      if (taskMentionsLogging) {
        console.log(
          `[Harmony] Implementation stage: Terminal executed for task requiring documentation, but no file created yet`
        );
        return true;
      }
    }

    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      // If we have discovery tools but no file modification AND the model mentions doing it
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(
          `[Harmony] Implementation stage: Model says it will modify file but didn't call tools. Need continuation.`
        );
        return true;
      }

      console.log(
        `[Harmony] Implementation stage: Only discovery tools used, no file modification yet`
      );
      return true;
    }

    if (isFileTask && !hasFileModification && !hasCompletionPhrase) {
      // If the model indicates it will modify but doesn't call tools, we need to continue
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(
          `[Harmony] Implementation stage: Model says it will modify but didn't call tools`
        );
        return true;
      }

      console.log(
        `[Harmony] Implementation stage: File task but no file modification or completion phrase`
      );
      return true;
    }

    // Check for explicit "continue" or "next step" in reasoning/content
    const hasContinuationHint =
      /\b(?:next|continue|then|after|now|further|additional)\b/i.test(
        currentContent.toLowerCase()
      );

    if (hasContinuationHint && !hasCompletionPhrase) {
      console.log(
        `[Harmony] Implementation stage: Has continuation hints but no completion`
      );
      return true;
    }

    // If model says "I will update" but didn't actually call update tools, continue
    if (indicatesFileModified && !hasFileModification && !mentionsToolCalls) {
      console.log(
        `[Harmony] Implementation stage: Model indicated file modification but didn't call appropriate tools`
      );
      return true;
    }

    console.log(
      `[Harmony] Implementation stage: Task appears complete: hasFileModification=${hasFileModification}, hasCompletionPhrase=${hasCompletionPhrase}, indicatesFileModified=${indicatesFileModified}`
    );
    return false;
  }
}
