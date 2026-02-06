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
   * Get steps from LLM content only (no prompt, no fallbacks).
   * Used when we require a detected plan/steps to create or update a plan.
   * Returns empty array when no plan or steps are detected.
   */
  getStepsFromContent(content: string): Array<{ description: string }> {
    const normalized = this.extractNormalizedSteps(content || "");
    return normalized.map((step) => ({ description: step.content }));
  }

  /**
   * Extract steps from text (content or originalPrompt)
   * Returns array of step objects with goal and description
   */
  extractStepsFromText(
    content: string,
    originalPrompt?: string,
    complexity?: "simple" | "hard" | null
  ): Array<{ description: string }> {
    let steps: Array<{ description: string }> = [];

    const contentSteps = this.extractNormalizedSteps(content);
    const promptSteps = originalPrompt
      ? this.extractNormalizedSteps(originalPrompt)
      : [];

    console.log(`[AutoTransitionManager] extractStepsFromText: complexity=${complexity}, contentSteps=${contentSteps.length}, promptSteps=${promptSteps.length}`);
    console.log(`[AutoTransitionManager] Content being parsed (first 500 chars): "${content.substring(0, 500)}"`);
    if (contentSteps.length > 0) {
      console.log(`[AutoTransitionManager] Extracted contentSteps:`, contentSteps.map(s => `Step ${s.number}: ${s.content.substring(0, 100)}`));
    }

    // Always prefer contentSteps (LLM response) over promptSteps (original prompt)
    // The LLM response is the source of truth for the plan
    let selectedSteps = contentSteps;
    const requiredCount = complexity === "hard" ? 3 : 1;

    // Only use promptSteps as a fallback if contentSteps is completely empty
    // Never prefer promptSteps over contentSteps, even if promptSteps has more steps
    if (contentSteps.length === 0 && promptSteps.length >= requiredCount) {
      selectedSteps = promptSteps;
      console.log(`[AutoTransitionManager] Using promptSteps as fallback (contentSteps is empty)`);
    } else if (contentSteps.length > 0) {
      console.log(`[AutoTransitionManager] Using contentSteps (LLM response) - ${contentSteps.length} step(s)`);
    }

    if (selectedSteps.length >= requiredCount) {
      steps = selectedSteps.map((step) => ({
        description: step.content,
      }));
      console.log(`[AutoTransitionManager] Extracted ${steps.length} steps from selectedSteps`);
    } else {
      console.log(`[AutoTransitionManager] selectedSteps.length (${selectedSteps.length}) < requiredCount (${requiredCount}), will apply fallback`);
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
          description: `Implement ${file} based on requirements`,
        }));
      } else {
        steps = [
          { description: "Understand the task requirements" },
          { description: "Plan the implementation approach" },
          { description: "Execute the implementation" },
        ];
      }
    }

    if ((complexity === "simple" || !complexity) && steps.length === 0) {
      const description = originalPrompt
        ? `Execute the task: ${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? "..." : ""}`
        : "Execute the task implementation";
      steps = [{ description }];
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
   * Check if we should create a plan from Assumptions stage
   * Returns the created plan (if any) - user must manually transition
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

    // Detect task complexity from steps
    const steps = this.getStepsFromContent(content);
    if (steps.length === 0) {
      console.log(
        `[Harmony] No plan or steps detected in content`
      );
      return { shouldTransition: false };
    }

    const complexity = steps.length >= 3 ? "hard" : "simple";
    console.log(`[Harmony] Detected task complexity: ${complexity} (${steps.length} steps)`);

    if (complexity === "hard") {
      // Hard task: create plan with detected steps (user must manually transition)
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const prompt = originalPrompt || conversationContext.originalPrompt;
      const plan = this.progressPlanManager.createPlan(
        taskId,
        prompt,
        "hard",
        steps
      );

      conversationContext.progressPlan = plan;
      console.log(
        `[Harmony] Hard task (3+ steps), created plan with ${plan.totalSteps} steps`
      );
      return { shouldTransition: false, plan };
    }

    // Simple task: no auto-transition, user must manually transition
    console.log(
      `[Harmony] Simple task (1-2 steps), waiting for user to transition`
    );
    return { shouldTransition: false };
  }

  /**
   * Build continuation prompt for implementation stage after auto-transition
   */
  buildImplementationPrompt(plan?: ProgressPlan): string {
    let continuationPrompt = `Create the files now. Use code from conversation history if available, otherwise generate the code. Call create_file or replace_file tools to create the files.`;
    if (plan) {
      continuationPrompt += `\n\nProgress Plan:\n${plan.steps.map((s) => `${s.stepNumber}. ${s.description}`).join("\n")}\n\nStart implementing step 1.`;
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

    // Prefer plan section steps (isPlanStep=true) over casual numbered lists
    const planGroups = candidates.filter((group) => 
      group.some((step) => step.isPlanStep)
    );
    const finalCandidates = planGroups.length > 0 ? planGroups : candidates;

    let best: Array<{ number: number; content: string; isPlanStep: boolean }> = [];

    for (const group of finalCandidates) {
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
    
    // Only filter if it's a standalone meta-section header (very short, no meaningful content)
    // Don't filter if it's a step that includes these words in a longer description
    const standaloneMetaPattern = /^(?:numbered\s+plan|complexity\s+assessment|plan\s+progress|restatement)\s*:?\s*$/i;
    if (standaloneMetaPattern.test(lowerContent) && content.length < 30) {
      return false;
    }

    // Expanded action/planning verbs - include analytical and planning activities
    const actionVerbs = [
      // Execution verbs (from StepsMarkdownParser.isExecutionStep)
      "create", "write", "implement", "generate", "build", "make", "develop",
      "add", "update", "modify", "edit", "change", "fix", "refactor",
      "delete", "remove", "replace", "move", "rename",
      "install", "setup", "set up", "configure", "initialize",
      "test", "verify", "validate", "check",
      "deploy", "run", "execute", "launch", "start",
      "capture", "record", "save", "store", "persist",  // Data capture verbs
      // Analytical and planning verbs
      "identify", "determine", "analyze", "assess", "evaluate", "examine",
      "review", "investigate", "explore", "study", "research",
      "outline", "plan", "design", "draft", "sketch", "structure",
      "define", "specify", "describe", "document", "list", "enumerate",
      "calculate", "compute", "measure", "estimate",
      "summarize", "explain", "clarify", "detail",
      "confirm", "ensure", "verify", "validate",
      "prepare", "organize", "arrange", "gather", "collect",
      "integrate", "combine", "merge", "consolidate",
      "provide", "supply", "construct", "formulate",
    ];

    const hasActionVerb = actionVerbs.some((verb) => {
      // Match whole word at start or after common prefixes
      const pattern = new RegExp(`^(?:step\\s*\\d+\\s*[:.\\-–—]?\\s*)?${verb}\\b`, "i");
      return pattern.test(lowerContent);
    });

    // If it has an action verb, it's meaningful
    if (hasActionVerb) {
      // Still filter out edge case error descriptions
      const edgeCaseLeadPattern = /^(?:step\s*\d+\s*[:.\-–—]?\s*)?(file not found|multiple matches|large file|corrupted|binary reading|size limits|error handling|reject)/i;
      if (edgeCaseLeadPattern.test(lowerContent)) {
        return false;
      }
      return true;
    }

    // Fallback: if content is substantial (>20 chars) and looks like a step, include it
    // This catches steps that might not start with standard verbs but are clearly intentional
    if (content.length > 20 && !standaloneMetaPattern.test(lowerContent)) {
      return true;
    }

    return false;
  }
}
