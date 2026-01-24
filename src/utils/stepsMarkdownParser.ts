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

    let steps: Array<{ number: number; content: string; isPlanStep: boolean }> = [];
    let planSection = "";
    let hasPlanSection = false;
    let inPlanSection = false;
    // More specific plan headers - must end with colon or be standalone
    const planHeaderPatterns = [
      /^(\d+\.\s*)?numbered\s+plan\s*:?$/i,
      /^(\d+\.\s*)?plan\s*:$/i,
      /^(\d+\.\s*)?steps?\s*:$/i,
      /^(\d+\.\s*)?execution\s*:$/i,
    ];

    // First pass: look for plan section headers
    let planStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (planHeaderPatterns.some(pattern => pattern.test(line))) {
        planStartIndex = i;
        inPlanSection = true;
        hasPlanSection = true;
        break;
      }
    }

    // If we found a plan section, extract steps from that section onward
    if (planStartIndex >= 0) {
      const planLines = lines.slice(planStartIndex + 1);
      planSection = planLines.join('\n');
      steps = this.extractStepsFromLines(planLines, true);
    }

    // If no plan section found, try to extract steps from the whole text
    if (steps.length === 0) {
      steps = this.extractStepsFromLines(lines, false);
    }

    return {
      hasPlan: steps.length > 0,
      steps,
      planSection: hasPlanSection && planSection.length > 0 ? planSection : undefined,
    };
  }

  /**
   * Extract steps from an array of lines
   */
  private static extractStepsFromLines(
    lines: string[],
    isPlanSection: boolean
  ): Array<{ number: number; content: string; isPlanStep: boolean }> {
    const steps: Array<{ number: number; content: string; isPlanStep: boolean }> = [];
    
    let currentStepNum = 0;
    let currentContent = "";

    for (const line of lines) {
      // Try to match step patterns: "Step 1:", "1.", "1-", etc.
      const stepMatch = line.match(/^(?:Step\s+)?(\d+)\s*[:.—–\-]\s*(.*)/i);
      
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