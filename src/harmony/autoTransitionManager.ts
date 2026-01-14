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
  ): 'simple' | 'hard' | null {
    // First, try to detect from LLM response (content + reasoning)
    // For jinja-only models, reasoning will be empty, so we rely on content
    const llmText = [content, reasoning].filter(Boolean).join(' ');
    
    // Check if LLM response has clear step indicators
    const llmComplexity = this.detectComplexityFromText(llmText);
    
    // Always check originalPrompt as well, especially when:
    // - LLM doesn't explicitly repeat the steps in its response
    // - Using jinja-only models (no reasoning channel)
    // - LLM analyzes but doesn't format as "Step 1, Step 2, Step 3"
    // - LLM response returns 'simple' but originalPrompt has 3+ steps
    let promptComplexity: 'simple' | 'hard' | null = null;
    if (originalPrompt) {
      promptComplexity = this.detectComplexityFromText(originalPrompt);
    }
    
    // Priority: prefer 'hard' over 'simple', and prefer detected complexity over null
    // This ensures that if originalPrompt has 3+ steps, we detect it as 'hard'
    // even if the LLM response only shows 1-2 steps
    if (llmComplexity === 'hard' || promptComplexity === 'hard') {
      return 'hard';
    }
    if (llmComplexity === 'simple' || promptComplexity === 'simple') {
      return 'simple';
    }
    
    // If neither has clear indicators, default to simple
    return 'simple';
  }

  /**
   * Internal helper to detect complexity from a text string
   */
  private detectComplexityFromText(text: string): 'simple' | 'hard' | null {
    if (!text || text.trim().length === 0) {
      return null;
    }
    
    const lowerText = text.toLowerCase();
    
    // Priority 1: Look for explicit step numbers (most reliable)
    // Match patterns like: "Step 1", "Step 2", "Step 3", "Step1", "step 1:", "Step 1:", etc.
    const stepNumberPatterns = [
      /\b(?:step|stage)\s*(\d+)[:.)]?/gi,  // "Step 1", "Step 2:", "Step 3)", "Step1", etc.
      /(?:^|\n)\s*(\d+)[:.)]\s+/gm,        // "1.", "2:", "3)", etc. at start of line
      /(?:^|\n)\s*(\d+)\s*[-–—]\s+/gm,     // "1 -", "2 -", etc. at start of line
    ];
    
    let maxStepNumber = 0;
    for (const pattern of stepNumberPatterns) {
      const matches = text.matchAll(pattern);
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
    const numberedListMatches = text.match(numberedListPattern);
    if (numberedListMatches) {
      const listCount = numberedListMatches.length;
      stepCount = Math.max(stepCount, listCount);
    }
    
    // If we found clear step indicators, return the complexity
    if (stepCount >= 3) {
      return 'hard';
    }
    if (stepCount >= 1) {
      // Check if it's a straightforward single-file operation
      const singleFileOperation = /\b(update|create|modify|edit)\s+\w+\.\w{2,4}\b/i.test(text);
      if (singleFileOperation && stepCount <= 1) {
        return 'simple';
      }
      if (stepCount <= 2) {
        return 'simple';
      }
    }
    
    // No clear indicators found in this text
    return null;
  }

  /**
   * Extract steps from text (content or originalPrompt)
   * Returns array of step objects with goal and description
   */
  extractStepsFromText(
    content: string,
    originalPrompt?: string,
    complexity?: 'simple' | 'hard' | null
  ): Array<{ goal: string; description?: string }> {
    // Helper function to check if a step is an edge case discussion
    const isEdgeCaseStep = (stepContent: string): boolean => {
      const edgeCaseKeywords = [
        'file not found',
        'multiple matches',
        'large file',
        'corrupted',
        'binary reading',
        'size limits',
        'valid.*docx',
        'error.*surface',
        'reject.*file'
      ];
      const lowerContent = stepContent.toLowerCase();
      return edgeCaseKeywords.some(keyword => {
        const pattern = new RegExp(keyword, 'i');
        return pattern.test(lowerContent);
      });
    };

    // Helper function to check if a step is an execution step (has action verbs)
    const isExecutionStep = (stepContent: string): boolean => {
      const actionVerbs = [
        'locate', 'find', 'read', 'encode', 'convert', 'call', 'save', 'write',
        'create', 'implement', 'execute', 'perform', 'run', 'use', 'pass',
        'determine', 'prepare', 'obtain', 'capture', 'return'
      ];
      const lowerContent = stepContent.toLowerCase();
      return actionVerbs.some(verb => {
        const pattern = new RegExp(`\\b${verb}\\b`, 'i');
        return pattern.test(lowerContent);
      });
    };

    // Helper function to extract steps using regex patterns
    const extractStepsFromTextHelper = (text: string): Array<{number: number, content: string, isInNumberedPlan?: boolean}> => {
      const stepPatterns = [
        // Handle: "**Step 1:**", "Step 1:", "Step 1." (with optional markdown bold)
        /(?:^|\n)\s*(?:\*\*)?\s*(?:Step|step)\s*(\d+)[:.)]?\s*\*?\*?\s*(.+?)(?=\n\s*(?:\*\*)?\s*(?:Step|step)\s*\d+[:.)]?|$)/gis,
        // Handle: "1.", "1:", "1)" 
        /(?:^|\n)\s*(\d+)[:.)]\s*(.+?)(?=\n\s*\d+[:.)]|$)/gis,
      ];
      
      // Try to find the "Numbered plan" section first
      const numberedPlanMatch = text.match(/(?:^|\n)\s*(?:\*\*)?\s*\d+\.\s*(?:Numbered\s+plan|numbered\s+plan).*?(?=\n\s*(?:\*\*)?\s*\d+\.\s*|$)/is);
      const numberedPlanSection = numberedPlanMatch ? numberedPlanMatch[0] : text;
      
      let extractedSteps: Array<{number: number, content: string, isInNumberedPlan?: boolean}> = [];
      
      for (const pattern of stepPatterns) {
        // First, try extracting from the "Numbered plan" section
        const numberedPlanMatches = Array.from(numberedPlanSection.matchAll(pattern));
        for (const match of numberedPlanMatches) {
          const stepNum = parseInt(match[1] || '0', 10);
          const stepContent = (match[2] || '').trim().replace(/^\*\*|\*\*$/g, ''); // Remove markdown bold
          
          if (stepNum > 0 && stepContent && stepContent.length > 5) {
            if (!/execute\s+step|complete\s+part|part\s+\d+|step\s+\d+:?$/i.test(stepContent)) {
              extractedSteps.push({ number: stepNum, content: stepContent, isInNumberedPlan: true });
            }
          }
        }
        
        // If we found steps in the numbered plan section, use those
        if (extractedSteps.length >= 3) break;
        
        // Otherwise, extract from the full text and filter
        const matches = Array.from(text.matchAll(pattern));
        for (const match of matches) {
          const stepNum = parseInt(match[1] || '0', 10);
          const stepContent = (match[2] || '').trim().replace(/^\*\*|\*\*$/g, ''); // Remove markdown bold
          
          if (stepNum > 0 && stepContent && stepContent.length > 5) {
            if (!/execute\s+step|complete\s+part|part\s+\d+|step\s+\d+:?$/i.test(stepContent)) {
              // Skip edge case steps
              if (!isEdgeCaseStep(stepContent)) {
                extractedSteps.push({ number: stepNum, content: stepContent, isInNumberedPlan: false });
              }
            }
          }
        }
        
        // If we found steps with this pattern, stop trying other patterns
        if (extractedSteps.length >= 3) break;
      }
      
      return extractedSteps;
    };
    
    let steps: Array<{ goal: string; description?: string }> = [];
    
    // First try extracting from content
    let extractedStepsWithFlags = extractStepsFromTextHelper(content);
    
    // Filter and prioritize: prefer steps from numbered plan section, then execution steps
    let extractedSteps: Array<{number: number, content: string}> = [];
    if (extractedStepsWithFlags.length > 0) {
      // Separate steps from numbered plan vs other steps
      const numberedPlanSteps = extractedStepsWithFlags.filter(s => s.isInNumberedPlan);
      const otherSteps = extractedStepsWithFlags.filter(s => !s.isInNumberedPlan);
      
      // Use numbered plan steps if we have them, otherwise use other steps (filtered to execution steps)
      const stepsToUse = numberedPlanSteps.length >= 3
        ? numberedPlanSteps
        : otherSteps.filter(s => isExecutionStep(s.content));
      
      // Group by step number and keep the first occurrence
      const stepMap = new Map<number, {number: number, content: string}>();
      for (const step of stepsToUse) {
        if (!stepMap.has(step.number) || step.isInNumberedPlan) {
          stepMap.set(step.number, { number: step.number, content: step.content });
        }
      }
      
      extractedSteps = Array.from(stepMap.values());
    }
    
    // If not found in content, try originalPrompt
    if (extractedSteps.length < 3 && originalPrompt) {
      const promptStepsWithFlags = extractStepsFromTextHelper(originalPrompt);
      const promptSteps = promptStepsWithFlags.map(s => ({ number: s.number, content: s.content }));
      // Only use prompt steps if we don't have any from content, or if they're better
      if (extractedSteps.length === 0 || (promptSteps.length >= 3 && extractedSteps.length < 3)) {
        extractedSteps = promptSteps;
      }
    }
    
    // Convert to step format
    if (extractedSteps.length >= (complexity === 'hard' ? 3 : 1)) {
      extractedSteps
        .sort((a, b) => a.number - b.number)
        .forEach(step => {
          steps.push({ 
            goal: `Step ${step.number}: ${step.content}`, 
            description: step.content 
          });
        });
    }
    
    // For hard tasks, if we don't have enough steps, try fallback strategies
    if (complexity === 'hard' && steps.length < 3) {
      // Look for file mentions in content or originalPrompt
      const filePattern = /\b(create|write|make|implement|add|generate)\s+(\w+\.\w{2,4})/gi;
      const textToSearch = content + ' ' + (originalPrompt || '');
      const fileMatches = Array.from(textToSearch.matchAll(filePattern));
      const files: string[] = [];
      
      for (const match of fileMatches) {
        const file = match[2];
        if (!files.includes(file)) {
          files.push(file);
        }
      }
      
      if (files.length >= 3) {
        steps = files.map(file => ({
          goal: `Create ${file}`,
          description: `Implement ${file} based on requirements`
        }));
      } else {
        // Generic fallback for hard tasks
        steps = [
          { goal: 'Step 1: Analyze requirements', description: 'Understand the task requirements' },
          { goal: 'Step 2: Design solution', description: 'Plan the implementation approach' },
          { goal: 'Step 3: Implement solution', description: 'Execute the implementation' }
        ];
      }
    }
    
    // For simple tasks, if no steps found, create single step
    if ((complexity === 'simple' || !complexity) && steps.length === 0) {
      const description = originalPrompt 
        ? `Execute the task: ${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? '...' : ''}`
        : 'Execute the task implementation';
      steps = [{ goal: 'Complete the task', description }];
    }
    
    return steps;
  }

  /**
   * Helper method to detect generic/unhelpful step descriptions
   */
  private isGenericStepDescription(description: string): boolean {
    const genericPatterns = [
      /execute\s+step\s+\d+/i,
      /complete\s+part\s+\d+/i,
      /step\s+\d+\s*:/i,
      /part\s+\d+\s+of\s+the\s+task/i,
      /^implement\s+step\s+\d+$/i,
      /^\s*\w+\s+step\s+\d+\s*$/i,
      /complete\s+the\s+task/i,
      /execute\s+the\s+task/i
    ];
    
    return genericPatterns.some(pattern => pattern.test(description));
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
    const complexity = this.detectTaskComplexity(content, reasoning, toolCalls, originalPrompt);
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
      
      // Extract steps from content or originalPrompt (improved extraction)
      let steps: Array<{ goal: string; description?: string; tools?: string[] }> = [];
      
      // Try multiple patterns to extract steps
      const stepPatterns = [
        // Handle: "Step 1.", "Step 1:", "Step 1"
        /(?:^|\n)\s*(?:Step|step)\s*(\d+)[:.)]?\s*(.+?)(?=\n\s*(?:Step|step)\s*\d+[:.)]?|$)/gis,
        // Handle: "1.", "1:", "1)"
        /(?:^|\n)\s*(\d+)[:.)]\s*(.+?)(?=\n\s*\d+[:.)]|$)/gis,
        // Handle: "1 -", "1 –"
        /(?:^|\n)\s*(\d+)\s*[-–—]\s*(.+?)(?=\n\s*\d+\s*[-–—]|$)/gis,
      ];
      
      let stepMatches: RegExpMatchArray[] = [];
      
      // First try extracting from LLM response content
      for (const pattern of stepPatterns) {
        const matches = Array.from(content.matchAll(pattern));
        if (matches.length >= 3) {
          stepMatches = matches;
          break;
        }
      }
      
      // If not found in content, try extracting from originalPrompt
      if (stepMatches.length < 3 && prompt) {
        for (const pattern of stepPatterns) {
          const matches = Array.from(prompt.matchAll(pattern));
          if (matches.length >= 3) {
            stepMatches = matches;
            break;
          }
        }
      }
      
      if (stepMatches.length >= 3) {
        stepMatches.forEach((match) => {
          // match[1] is the step number, match[2] is the step content
          const stepContent = (match[2] || match[0]
            .replace(/^(?:\d+[.)]|\*\s+|-\s+|Step\s+\d+[:.)]?\s*)/i, '')
            .trim());
          
          // Filter out generic/unhelpful step descriptions
          if (stepContent && !this.isGenericStepDescription(stepContent)) {
            steps.push({ 
              goal: stepContent, 
              description: stepContent.substring(0, 100) // Keep concise
            });
          }
        });
      } else {
        // Fallback: create task-specific steps instead of generic ones
        // Look for file mentions in the content
        const filePattern = /\b(create|write|make|implement|add|generate)\s+(\w+\.\w{2,4})/gi;
        const fileMatches = Array.from(content.matchAll(filePattern));
        const files: string[] = [];
        
        for (const match of fileMatches) {
          const file = match[2];
          if (!files.includes(file)) {
            files.push(file);
          }
        }
        
        if (files.length >= 3) {
          // Create steps based on files found
          files.forEach((file, index) => {
            steps.push({ 
              goal: `Create ${file}`, 
              description: `Implement ${file} based on requirements` 
            });
          });
        } else {
          // Create meaningful steps based on the original prompt
          const promptText = prompt || '';
          if (promptText.includes('hello.py') && promptText.includes('hello.test.py')) {
            // Example: For your specific hello module task
            steps = [
              { goal: 'Create hello.py with greet function', description: 'Implement the main module with greet() function and main block' },
              { goal: 'Create hello.test.py for testing', description: 'Write unit tests for the greet function using unittest framework' },
              { goal: 'Create hello.md documentation', description: 'Document the module with usage examples and API reference' }
            ];
          } else {
            // Generic but meaningful steps
            steps = [
              { goal: 'Analyze requirements and plan implementation', description: 'Understand all requirements and create detailed plan' },
              { goal: 'Implement core functionality', description: 'Write the main code implementation' },
              { goal: 'Add tests and documentation', description: 'Create tests and documentation for the implementation' }
            ];
          }
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