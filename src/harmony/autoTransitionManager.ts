import { MCPToolCall } from "../mcpClient";
import { ProgressPlanManager, ProgressPlan } from "../progressPlanManager";
import { ConversationContext } from "./conversationContext";
import { StepsMarkdownParser } from "../utils/stepsMarkdownParser";

/**
 * Manages auto-transitions between workflow stages
 */
export class AutoTransitionManager {
  constructor(private progressPlanManager: ProgressPlanManager) {}

  /**
   * Detect task complexity from assumptions stage response
   * Returns: 'simple' (1-2 steps), 'hard' (3+ steps), or null if unable to determine
   *
   * Priority:
   * 1. Check LLM response (content + reasoning) - this is the LLM's analysis
   * 2. Fall back to originalPrompt if LLM response doesn't have clear steps
   *    (especially important for jinja-only models where reasoning is empty)
   */
  detectTaskComplexity(
    content: string,
    reasoning?: string,
    toolCalls?: MCPToolCall[],
    originalPrompt?: string
  ): "simple" | "hard" | null {
    const llmText = [content, reasoning].filter(Boolean).join(" \n");
    const llmComplexity = this.detectComplexityUsingParser(llmText);
    const promptComplexity = originalPrompt
      ? this.detectComplexityUsingParser(originalPrompt)
      : null;

    if (llmComplexity === "hard" || promptComplexity === "hard") {
      return "hard";
    }
    if (llmComplexity === "simple" || promptComplexity === "simple") {
      return "simple";
    }

    return "simple";
  }

  private detectComplexityUsingParser(
    text: string
  ): "simple" | "hard" | null {
    if (!text || text.trim().length === 0) {
      return null;
    }

    const parsedSteps = this.extractNormalizedSteps(text);

    if (parsedSteps.length >= 3) {
      return "hard";
    }
    if (parsedSteps.length >= 1) {
      return "simple";
    }

    return null;
  }

  /**
   * Extract steps from text (content or originalPrompt)
   * Returns array of step objects with goal and description
   */
  extractStepsFromText(
    content: string,
    originalPrompt?: string,
    complexity?: "simple" | "hard" | null
  ): Array<{ goal: string; description?: string }> {
    let steps: Array<{ goal: string; description?: string }> = [];

    const contentSteps = this.extractNormalizedSteps(content);
    const promptSteps = originalPrompt
      ? this.extractNormalizedSteps(originalPrompt)
      : [];

    let selectedSteps = contentSteps;
    const requiredCount = complexity === "hard" ? 3 : 1;

    if (
      promptSteps.length >= requiredCount &&
      (selectedSteps.length < requiredCount ||
        promptSteps.length > selectedSteps.length)
    ) {
      selectedSteps = promptSteps;
    }

    if (selectedSteps.length >= requiredCount) {
      steps = selectedSteps.map((step) => ({
        goal: `Step ${step.number}: ${step.content}`,
        description: step.content,
      }));
    }

    if (complexity === "hard" && steps.length < 3) {
      const filePattern =
        /\b(create|write|make|implement|add|generate)\s+(\w+\.\w{2,4})/gi;
      const textToSearch = content + " " + (originalPrompt || "");
      const fileMatches = Array.from(textToSearch.matchAll(filePattern));
      const files: string[] = [];

      for (const match of fileMatches) {
        const file = match[2];
        if (!files.includes(file)) {
          files.push(file);
        }
      }

      if (files.length >= 3) {
        steps = files.map((file) => ({
          goal: `Create ${file}`,
          description: `Implement ${file} based on requirements`,
        }));
      } else {
        steps = [
          {
            goal: "Step 1: Analyze requirements",
            description: "Understand the task requirements",
          },
          {
            goal: "Step 2: Design solution",
            description: "Plan the implementation approach",
          },
          {
            goal: "Step 3: Implement solution",
            description: "Execute the implementation",
          },
        ];
      }
    }

    if ((complexity === "simple" || !complexity) && steps.length === 0) {
      const description = originalPrompt
        ? `Execute the task: ${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? "..." : ""}`
        : "Execute the task implementation";
      steps = [{ goal: "Complete the task", description }];
    }

    return steps;
  }

  /**
   * Helper method to detect generic/unhelpful step descriptions
   */
  private isGenericStepDescription(description: string): boolean {
    return StepsMarkdownParser.isEdgeCaseStep(description);
  }

  /**
   * Check if we should auto-transition from Assumptions to Implementation
   * Returns the transition decision and created plan (if any)
   */
  shouldAutoTransitionFromAssumptions(
    content: string,
    reasoning: string | undefined,
    toolCalls: MCPToolCall[] | undefined,
    originalPrompt: string | undefined,
    conversationContext: ConversationContext | null
  ): { shouldTransition: boolean; plan?: ProgressPlan } {
    if (!conversationContext) {
      return { shouldTransition: false };
    }

    // Trigger 1: Tool calls include replace_file or create_file
    const fileModificationTools = ["create_file", "replace_file"];
    if (
      toolCalls &&
      toolCalls.some((tc) => fileModificationTools.includes(tc.name))
    ) {
      console.log(
        `[Harmony] Auto-transition: Tool calls include file modification tools`
      );
      return { shouldTransition: true };
    }

    // Trigger 2: Detect task complexity
    const complexity = this.detectTaskComplexity(
      content,
      reasoning,
      toolCalls,
      originalPrompt
    );
    if (!complexity) {
      return { shouldTransition: false };
    }

    console.log(`[Harmony] Detected task complexity: ${complexity}`);

    if (complexity === "simple") {
      // Simple task: auto-transition immediately
      console.log(
        `[Harmony] Auto-transition: Simple task (1-2 steps), transitioning to implementation`
      );
      return { shouldTransition: true };
    } else if (complexity === "hard") {
      // Hard task: create plan first, then transition
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const prompt = originalPrompt || conversationContext.originalPrompt;
      const steps = this.extractStepsFromText(content, prompt, complexity);

      const plan = this.progressPlanManager.createPlan(
        taskId,
        prompt,
        "hard",
        steps.length > 0
          ? steps
          : [
              {
                goal: "Complete the task",
                description: "Execute the planned steps",
              },
            ]
      );

      conversationContext.progressPlan = plan;
      console.log(
        `[Harmony] Auto-transition: Hard task (3+ steps), created plan with ${plan.totalSteps} steps, transitioning to implementation`
      );
      return { shouldTransition: true, plan };
    }

    return { shouldTransition: false };
  }

  /**
   * Build continuation prompt for implementation stage after auto-transition
   */
  buildImplementationPrompt(plan?: ProgressPlan): string {
    let continuationPrompt = `Create the files now. Use code from conversation history if available, otherwise generate the code. Call create_file or replace_file tools to create the files.`;
    if (plan) {
      continuationPrompt += `\n\nProgress Plan:\n${plan.steps.map((s) => `${s.stepNumber}. ${s.goal}`).join("\n")}\n\nStart implementing step 1.`;
    }
    return continuationPrompt;
  }

  private extractNormalizedSteps(
    text: string
  ): Array<{ number: number; content: string; isPlanStep: boolean }> {
    if (!text) {
      return [];
    }

    const parsed = StepsMarkdownParser.extractPlanAndSteps(text);
    return this.normalizeSteps(parsed.steps);
  }

  private normalizeSteps(
    steps: Array<{ number: number; content: string; isPlanStep: boolean }>
  ): Array<{ number: number; content: string; isPlanStep: boolean }> {
    const filtered = steps.filter((step) => this.isMeaningfulStep(step.content));
    const grouped = this.groupStepsBySequence(filtered);
    const bestGroup = this.selectBestStepGroup(grouped);

    const deduped = new Map<
      number,
      { number: number; content: string; isPlanStep: boolean }
    >();

    bestGroup.forEach((step) => {
      deduped.set(step.number, step);
    });

    return Array.from(deduped.values()).sort((a, b) => a.number - b.number);
  }

  private groupStepsBySequence(
    steps: Array<{ number: number; content: string; isPlanStep: boolean }>
  ): Array<Array<{ number: number; content: string; isPlanStep: boolean }>> {
    const groups: Array<
      Array<{ number: number; content: string; isPlanStep: boolean }>
    > = [];

    let current: Array<{ number: number; content: string; isPlanStep: boolean }> = [];
    let lastNumber = 0;

    for (const step of steps) {
      if (current.length === 0 || step.number > lastNumber) {
        current.push(step);
        lastNumber = step.number;
      } else {
        if (current.length > 0) {
          groups.push(current);
        }
        current = [step];
        lastNumber = step.number;
      }
    }

    if (current.length > 0) {
      groups.push(current);
    }

    return groups;
  }

  private selectBestStepGroup(
    groups: Array<Array<{ number: number; content: string; isPlanStep: boolean }>>
  ): Array<{ number: number; content: string; isPlanStep: boolean }> {
    if (groups.length === 0) {
      return [];
    }

    const startingAtOne = groups.filter((group) => group[0]?.number === 1);
    const candidates = startingAtOne.length > 0 ? startingAtOne : groups;

    let best: Array<{ number: number; content: string; isPlanStep: boolean }> = [];

    for (const group of candidates) {
      if (group.length > best.length || group.length === best.length) {
        best = group;
      }
    }

    return best;
  }

  private isMeaningfulStep(content: string): boolean {
    if (!content) {
      return false;
    }

    const lowerContent = content.toLowerCase();
    const metaSectionPattern = /^(?:\d+\s*[.:]\s*)?(numbered\s+plan|complexity\s+assessment|plan\s+progress|restatement|analysis|assumptions)/i;

    if (metaSectionPattern.test(lowerContent)) {
      return false;
    }

    const extraActionWords = [
      "calculate",
      "design",
      "draft",
      "outline",
      "summarize",
      "document",
      "provide",
      "configure",
      "install",
      "setup",
      "set up",
      "add",
      "update",
      "fix",
      "refactor",
      "test",
      "plan",
      "review",
      "analyze",
      "integrate",
    ];

    const hasAction =
      StepsMarkdownParser.isExecutionStep(content) ||
      extraActionWords.some((word) => {
        const pattern = new RegExp(`\\b${word}\\b`, "i");
        return pattern.test(content);
      });

    if (!hasAction) {
      return false;
    }

    const edgeCaseLeadPattern = /^(?:step\s*\d+\s*[:.\-–—]?\s*)?(file not found|multiple matches|large file|corrupted|binary reading|size limits|valid|error|reject)/i;

    if (edgeCaseLeadPattern.test(lowerContent)) {
      return false;
    }

    return hasAction;
  }
}
