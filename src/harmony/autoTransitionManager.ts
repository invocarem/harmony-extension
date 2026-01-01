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
    const combinedText = [content, reasoning].filter(Boolean).join(' ');
    const lowerText = combinedText.toLowerCase();
    
    // Priority 1: Look for explicit step numbers (most reliable)
    // Match patterns like: "Step 1", "Step 2", "Step 3", "Step1", "step 1:", "Step 1:", etc.
    const stepNumberPatterns = [
      /\b(?:step|stage)\s*(\d+)[:.)]?/gi,  // "Step 1", "Step 2:", "Step 3)", "Step1", etc.
      /(?:^|\n)\s*(\d+)[:.)]\s+/gm,        // "1.", "2:", "3)", etc. at start of line
      /(?:^|\n)\s*(\d+)\s*[-–—]\s+/gm,     // "1 -", "2 -", etc. at start of line
    ];
    
    let maxStepNumber = 0;
    for (const pattern of stepNumberPatterns) {
      const matches = combinedText.matchAll(pattern);
      for (const match of matches) {
        const stepNum = parseInt(match[1] || match[0].match(/\d+/)?.[0] || '0', 10);
        if (stepNum > maxStepNumber) {
          maxStepNumber = stepNum;
        }
      }
    }
    
    // If we found explicit step numbers, use the maximum
    if (maxStepNumber >= 3) {
      return 'hard';
    }
    if (maxStepNumber >= 1) {
      // We found at least one step, but less than 3
      // Continue to check other indicators
    }
    
    // Priority 2: Look for step indicator words
    const stepIndicatorPatterns = [
      /\b(step\s+1|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi,
      /\b(initially|subsequently|finally|lastly|additionally|furthermore|moreover|next|then|after that|afterward|afterwards)\b/gi,
    ];
    
    let stepIndicatorCount = 0;
    for (const pattern of stepIndicatorPatterns) {
      const matches = lowerText.match(pattern);
      if (matches) {
        stepIndicatorCount += matches.length;
      }
    }
    
    // Combine step number count with indicator count
    let stepCount = Math.max(maxStepNumber, stepIndicatorCount);
    
    // Priority 3: Look for numbered list patterns (1., 2., 3., etc.)
    const numberedListPattern = /(?:^|\n)\s*\d+[.)]\s+/gm;
    const numberedListMatches = combinedText.match(numberedListPattern);
    if (numberedListMatches) {
      const listCount = numberedListMatches.length;
      stepCount = Math.max(stepCount, listCount);
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
      
      // Extract steps from content (improved extraction)
      const steps: Array<{ goal: string; description?: string; tools?: string[] }> = [];
      
      // Try multiple patterns to extract steps
      // Pattern 1: "Step 1:", "Step 2:", "Step 3:", etc.
      const stepPattern1 = /(?:^|\n)\s*(?:Step|step)\s*(\d+)[:.)]?\s*(.+?)(?=\n\s*(?:Step|step)\s*\d+[:.)]?|$)/gis;
      // Pattern 2: Numbered list "1.", "2.", "3.", etc.
      const stepPattern2 = /(?:^|\n)\s*(\d+)[.)]\s*(.+?)(?=\n\s*\d+[.)]|$)/gis;
      // Pattern 3: Bullet points with numbers "1 -", "2 -", etc.
      const stepPattern3 = /(?:^|\n)\s*(\d+)\s*[-–—]\s*(.+?)(?=\n\s*\d+\s*[-–—]|$)/gis;
      
      let stepMatches: RegExpMatchArray[] = [];
      
      // Try pattern 1 first (most specific)
      const matches1 = Array.from(content.matchAll(stepPattern1));
      if (matches1.length >= 3) {
        stepMatches = matches1;
      } else {
        // Try pattern 2
        const matches2 = Array.from(content.matchAll(stepPattern2));
        if (matches2.length >= 3) {
          stepMatches = matches2;
        } else {
          // Try pattern 3
          const matches3 = Array.from(content.matchAll(stepPattern3));
          if (matches3.length >= 3) {
            stepMatches = matches3;
          }
        }
      }
      
      if (stepMatches.length >= 3) {
        stepMatches.forEach((match) => {
          // match[1] is the step number, match[2] is the step content
          const stepContent = match[2] || match[0].replace(/^(?:\d+[.)]|\*\s+|-\s+|Step\s+\d+[:.)]?\s*)/i, '').trim();
          if (stepContent) {
            steps.push({ goal: stepContent, description: stepContent });
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

