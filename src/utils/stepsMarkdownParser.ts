// file: stepsMarkdownParser.ts
export class StepsMarkdownParser {
  /**
   * Extract bold content from markdown text
   * Returns full bold phrases as they appear in the text
   */
  static extractBoldContent(text: string): {
    boldPhrases: string[];
    positions: number[];
  } {
    const boldPattern = /\*\*([\s\S]*?)\*\*/g;
    const boldPhrases: string[] = [];
    const positions: number[] = [];

    let match: RegExpExecArray | null;
    while ((match = boldPattern.exec(text)) !== null) {
      // Get the full bold phrase, preserving its original form
      const fullPhrase = match[1].trim();
      boldPhrases.push(fullPhrase);
      positions.push(match.index);
    }

    return {
      boldPhrases: boldPhrases,
      positions: positions,
    };

  }

  /**
   * Strip ** markdown from text
   */
  static stripBoldMarkdown(text: string): string {
    return text.replace(/\*\*/g, "");
  }
  // Updated extractPlanAndSteps method in stepsMarkdownParser.ts
  static extractPlanAndSteps(text: string): {
    hasPlan: boolean;
    steps: Array<{ number: number; content: string; isPlanStep: boolean }>;
    planSection?: string;
  } {
    const cleanText = this.stripBoldMarkdown(text);
    
    // Split text into lines and trim each line
    const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Plan section patterns - ordered by priority (most specific first)
    // Patterns must handle markdown headers (###), numbered sections (5.), and plain text
    const planHeaderPatterns = [
      { pattern: /^#+\s*(\d+\.\s*)?implementation\s+plan/i, priority: 1, name: 'Implementation Plan (Markdown)' },
      { pattern: /^(\d+\.\s*)?implementation\s+plan/i, priority: 1, name: 'Implementation Plan' },
      { pattern: /^#+\s*(\d+\.\s*)?execution\s+plan/i, priority: 1, name: 'Execution Plan (Markdown)' },
      { pattern: /^(\d+\.\s*)?execution\s+plan/i, priority: 1, name: 'Execution Plan' },
      { pattern: /^#+\s*(\d+\.\s*)?numbered\s+plan\s*:?$/i, priority: 2, name: 'Numbered Plan (Markdown)' },
      { pattern: /^(\d+\.\s*)?numbered\s+plan\s*:?$/i, priority: 2, name: 'Numbered Plan' },
      { pattern: /^#+\s*(\d+\.\s*)?plan\s*:$/i, priority: 3, name: 'Plan (Markdown)' },
      { pattern: /^(\d+\.\s*)?plan\s*:$/i, priority: 3, name: 'Plan' },
      { pattern: /^#+\s*(\d+\.\s*)?steps?\s*:$/i, priority: 3, name: 'Steps (Markdown)' },
      { pattern: /^(\d+\.\s*)?steps?\s*:$/i, priority: 3, name: 'Steps' },
      { pattern: /^#+\s*(\d+\.\s*)?execution\s*:$/i, priority: 3, name: 'Execution (Markdown)' },
      { pattern: /^(\d+\.\s*)?execution\s*:$/i, priority: 3, name: 'Execution' },
    ];

    // Section headers that indicate we should stop extracting steps
    const stopSectionPatterns = [
      /^#+\s*\d+\.\s*assumptions/i,
      /^#+\s*assumptions/i,
      /^#+\s*\d+\.\s*edge\s+cases/i,
      /^#+\s*edge\s+cases/i,
      /^#+\s*\d+\.\s*considerations/i,
      /^#+\s*special\s+considerations/i,
      /^#+\s*\d+\.\s*notes/i,
      /^#+\s*background/i,
      /^#+\s*context/i,
      /^#+\s*summary/i,
    ];

    // Scan through all lines and find ALL plan section headers
    const planSections: Array<{ index: number; priority: number; name: string }> = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const planPattern of planHeaderPatterns) {
        if (planPattern.pattern.test(line)) {
          planSections.push({
            index: i,
            priority: planPattern.priority,
            name: planPattern.name
          });
          console.log(`[StepsMarkdownParser] Found plan section at line ${i}: "${line}" (${planPattern.name}, priority ${planPattern.priority})`);
          break; // Only match one pattern per line
        }
      }
    }

    // If we found multiple plan sections, use the one with highest priority (lowest number)
    // If there are ties, use the LAST one (as it's likely the actual implementation plan)
    let bestPlanIndex = -1;
    let bestPriority = Infinity;
    
    if (planSections.length > 0) {
      // Sort by priority (ascending), then by index (descending for tie-breaking)
      planSections.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority; // Lower priority number = higher priority
        }
        return b.index - a.index; // For same priority, prefer later occurrence
      });
      
      const bestSection = planSections[0];
      bestPlanIndex = bestSection.index;
      console.log(`[StepsMarkdownParser] Selected plan section: ${bestSection.name} at line ${bestPlanIndex}`);
    }

    // Extract steps from the selected plan section
    let steps: Array<{ number: number; content: string; isPlanStep: boolean }> = [];
    let planSection = "";
    
    if (bestPlanIndex >= 0) {
      // Find where the plan section ends (next section header or end of text)
      let planEndIndex = lines.length;
      for (let i = bestPlanIndex + 1; i < lines.length; i++) {
        if (stopSectionPatterns.some(pattern => pattern.test(lines[i]))) {
          planEndIndex = i;
          console.log(`[StepsMarkdownParser] Plan section ends at line ${i}: "${lines[i]}"`);
          break;
        }
      }
      
      const planLines = lines.slice(bestPlanIndex + 1, planEndIndex);
      planSection = planLines.join('\n');
      steps = this.extractStepsFromLines(planLines, true);
      console.log(`[StepsMarkdownParser] Extracted ${steps.length} steps from plan section`);
    }

    // If no plan section found, try to extract steps from the whole text
    if (steps.length === 0) {
      console.log(`[StepsMarkdownParser] No plan section found, scanning entire text for steps`);
      steps = this.extractStepsFromLines(lines, false);
    }

    return {
      hasPlan: steps.length > 0,
      steps,
      planSection: bestPlanIndex >= 0 && planSection.length > 0 ? planSection : undefined,
    };
  }

  /**
   * Extract steps from an array of lines
   * This method now assumes the lines are already from a specific section
   */
  private static extractStepsFromLines(
    lines: string[],
    isPlanSection: boolean
  ): Array<{ number: number; content: string; isPlanStep: boolean }> {
    const steps: Array<{ number: number; content: string; isPlanStep: boolean }> = [];
    
    let currentStepNum = 0;
    let currentContent = "";

    for (const line of lines) {
      // Try to match step patterns: "Step 1:", "1.", "1-", "Step 3 (optional):", etc.
      // Allow optional text in parentheses between the number and delimiter
      const stepMatch = line.match(/^(?:Step\s+)?(\d+)\s*(?:\([^)]*\))?\s*[:.—–\-]\s*(.*)/i);
      
      if (stepMatch) {
        const stepNum = parseInt(stepMatch[1], 10);
        const content = stepMatch[2].trim();

        // If we have a previous step, save it
        if (currentStepNum > 0 && currentContent.length > 0) {
          if (!this.isGenericStep(currentContent)) {
            steps.push({
              number: currentStepNum,
              content: currentContent,
              isPlanStep: isPlanSection,
            });
          }
        }

        // Start a new step
        currentStepNum = stepNum;
        currentContent = content;
      } else if (currentStepNum > 0 && line.length > 0) {
        // Continue the current step's content
        if (currentContent) {
          currentContent += " " + line;
        } else {
          currentContent = line;
        }
      }
    }

    // Don't forget the last step
    if (currentStepNum > 0 && currentContent.length > 0) {
      if (!this.isGenericStep(currentContent)) {
        steps.push({
          number: currentStepNum,
          content: currentContent,
          isPlanStep: isPlanSection,
        });
      }
    }

    return steps;
  }

  /**
   * Check if step description is generic/unhelpful
   * Be more lenient - only filter truly empty or self-referential steps
   */
  private static isGenericStep(description: string): boolean {
    const trimmedDesc = description.trim();

    // Filter out extremely short steps (likely just numbers or punctuation)
    if (trimmedDesc.length < 5) {
      return true;
    }

    // Filter only truly generic/self-referential patterns
    const genericPatterns = [
      /^execute\s+step\s+\d+$/i,
      /^complete\s+step\s+\d+$/i,
      /^step\s+\d+\s*:?$/i,
      /^part\s+\d+$/i,
      /^do\s+step\s+\d+$/i,
      /^perform\s+step\s+\d+$/i,
      /^run\s+step\s+\d+$/i,
    ];

    // Check exact matches only - don't be too aggressive
    for (const pattern of genericPatterns) {
      if (pattern.test(trimmedDesc)) {
        return true;
      }
    }

    // Filter "Execute step 1 from above" type phrases (short and self-referential)
    if (/(execute|complete|perform|do)\s+step\s+\d+/i.test(trimmedDesc) && trimmedDesc.length < 25) {
      return true;
    }

    return false;
  }

  /**
   * Filter edge case steps
   */
  static isEdgeCaseStep(stepContent: string): boolean {
    const edgeCaseKeywords = [
      "file not found",
      "multiple matches",
      "large file",
      "corrupted",
      "binary reading",
      "size limits",
      "valid.*docx",
      "error.*surface",
      "reject.*file",
    ];
    const lowerContent = stepContent.toLowerCase();
    return edgeCaseKeywords.some((keyword) => {
      const pattern = new RegExp(keyword, "i");
      return pattern.test(lowerContent);
    });
  }

  /**
   * Check if step is an execution step (has action verbs)
   */
  static isExecutionStep(stepContent: string): boolean {
    const actionVerbs = [
      "locate",
      "find",
      "read",
      "encode",
      "convert",
      "call",
      "save",
      "write",
      "create",
      "implement",
      "execute",
      "perform",
      "run",
      "use",
      "pass",
      "determine",
      "prepare",
      "obtain",
      "capture",
      "return",
    ];
    const lowerContent = stepContent.toLowerCase();
    return actionVerbs.some((verb) => {
      const pattern = new RegExp(`\\b${verb}\\b`, "i");
      return pattern.test(lowerContent);
    });
  }
}