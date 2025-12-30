import { MCPToolCall } from "../mcpClient";
import { ProgressPlanManager, ProgressPlan } from "../progressPlanManager";
import { ConversationContext } from "./conversationContext";

/**
 * Manages auto-transitions between workflow stages
 */
export class AutoTransitionManager {
  constructor(
    private progressPlanManager: ProgressPlanManager
  ) {}

  /**
   * Detect task complexity from assumptions stage response
   * Returns: 'simple' (1-2 steps), 'hard' (3+ steps), or null if unable to determine
   */
  detectTaskComplexity(
    content: string,
    reasoning?: string,
    toolCalls?: MCPToolCall[]
  ): 'simple' | 'hard' | null {
    // Combine all text for analysis
    const combinedText = [content, reasoning].filter(Boolean).join(' ').toLowerCase();
    
    // Look for step indicators in the response
    const stepPatterns = [
      /\b(step\s+1|first|second|third|fourth|fifth|then|next|after that|subsequently)\b/gi,
      /\b(1\.|2\.|3\.|4\.|5\.)/g, // Numbered steps
      /\b(initially|subsequently|finally|lastly|additionally|furthermore)\b/gi,
    ];
    
    // Count potential steps
    let stepCount = 0;
    for (const pattern of stepPatterns) {
      const matches = combinedText.match(pattern);
      if (matches) {
        stepCount += matches.length;
      }
    }
    
    // Look for explicit step numbers
    const numberedSteps = combinedText.match(/\b(?:step|stage)\s*(\d+)\b/gi);
    if (numberedSteps) {
      const maxStepNumber = Math.max(...numberedSteps.map(s => {
        const match = s.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
      }));
      stepCount = Math.max(stepCount, maxStepNumber);
    }
    
    // Simple task: 1-2 steps
    if (stepCount <= 2) {
      // Check if it's a straightforward single-file operation
      const singleFileOperation = /\b(update|create|modify|edit)\s+\w+\.\w{2,4}\b/i.test(combinedText);
      if (singleFileOperation && stepCount <= 1) {
        return 'simple';
      }
      if (stepCount <= 2) {
        return 'simple';
      }
    }
    
    // Hard task: 3+ steps
    if (stepCount >= 3) {
      return 'hard';
    }
    
    // Default: if we can't determine, consider it simple for auto-transition
    return 'simple';
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
    const fileModificationTools = ['create_file', 'replace_file'];
    if (toolCalls && toolCalls.some(tc => fileModificationTools.includes(tc.name))) {
      console.log(`[Harmony] Auto-transition: Tool calls include file modification tools`);
      return { shouldTransition: true };
    }

    // Trigger 2: Detect task complexity
    const complexity = this.detectTaskComplexity(content, reasoning, toolCalls);
    if (!complexity) {
      return { shouldTransition: false };
    }

    console.log(`[Harmony] Detected task complexity: ${complexity}`);

    if (complexity === 'simple') {
      // Simple task: auto-transition immediately
      console.log(`[Harmony] Auto-transition: Simple task (1-2 steps), transitioning to implementation`);
      return { shouldTransition: true };
    } else if (complexity === 'hard') {
      // Hard task: create plan first, then transition
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const prompt = originalPrompt || conversationContext.originalPrompt;
      
      // Extract steps from content (simple extraction)
      const steps: Array<{ goal: string; description?: string; tools?: string[] }> = [];
      
      // Try to extract steps from numbered list or step indicators
      const stepMatches = content.match(/(?:^|\n)(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)(.+?)(?=\n(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?|$))/gi);
      if (stepMatches && stepMatches.length >= 3) {
        stepMatches.forEach((match) => {
          const goal = match.replace(/^(?:\d+\.|\*\s+|-\s+|Step\s+\d+[:.]?\s*)/i, '').trim();
          if (goal) {
            steps.push({ goal, description: goal });
          }
        });
      } else {
        // Fallback: create generic steps based on complexity
        for (let i = 1; i <= 3; i++) {
          steps.push({ goal: `Step ${i}: Complete part ${i} of the task`, description: `Execute step ${i}` });
        }
      }

      const plan = this.progressPlanManager.createPlan(
        taskId,
        prompt,
        'hard',
        steps.length > 0 ? steps : [{ goal: 'Complete the task', description: 'Execute the planned steps' }]
      );

      conversationContext.progressPlan = plan;
      console.log(`[Harmony] Auto-transition: Hard task (3+ steps), created plan with ${plan.totalSteps} steps, transitioning to implementation`);
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
      continuationPrompt += `\n\nProgress Plan:\n${plan.steps.map(s => `${s.stepNumber}. ${s.goal}`).join('\n')}\n\nStart implementing step 1.`;
    }
    return continuationPrompt;
  }
}

