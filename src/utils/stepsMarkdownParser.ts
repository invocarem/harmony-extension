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

   /**
   * Extract a plan from markdown.
   *
   *   • Primary mode – look for the exact delimiter pair you require.
   *   • Fallback   – if the delimiters are not found, just pull out any
   *                  “Step N:” lines that appear anywhere in the text.
   *
   * Returns:
   *   - hasPlan   : true if at least one step was found
   *   - steps     : array of {number, content, isPlanStep}
   *   - planSection (optional) : the raw text that was considered the plan
   */
  static extractPlanAndSteps(text: string): {
    hasPlan: boolean;
    steps: Array<{ number: number; content: string; isPlanStep: boolean }>;
    planSection?: string;
  } {
    // 1️⃣  Remove bold markup (the parser already does this elsewhere)
    const clean = this.stripBoldMarkdown(text);

    // ---------------------------------------------------------------
    // 2️⃣  Primary delimiter – the exact strings you control
    // ---------------------------------------------------------------
    const delimiterMatch = clean.match(
      /Implementation\s+plan\s*\(\s*one\s+step\s+per\s+request\s*\)([\s\S]*?)Implementation\s+plan\s*\(\s*end\s*\)/i
    );

    if (delimiterMatch) {
      const planContent = delimiterMatch[1].trim();

      const planLines = planContent
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const steps = this.extractStepsFromLines(planLines, true);
      return {
        hasPlan: steps.length > 0,
        steps,
        planSection: planContent,
      };
    }

    // ---------------------------------------------------------------
    // 3️⃣  Simple fallback – grab any “Step N:” lines in the whole text
    // ---------------------------------------------------------------
    const allLines = clean
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const steps = this.extractStepsFromLines(allLines, false);
    return {
      hasPlan: steps.length > 0,
      steps,
      // No dedicated planSection when we fall back to the whole document
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