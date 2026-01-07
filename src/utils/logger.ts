/**
 * Logger utility with configurable verbosity
 * Allows easy toggling of verbose logging for specific components
 */

// Global flag to control verbose logging (can be set via config)
let verboseToolExtraction = false;

export const Logger = {
  /**
   * Set verbose mode for tool extraction logging
   */
  setVerboseToolExtraction(enabled: boolean): void {
    verboseToolExtraction = enabled;
  },

  /**
   * Check if verbose tool extraction logging is enabled
   */
  isVerboseToolExtraction(): boolean {
    return verboseToolExtraction;
  },

  /**
   * Log message only if verbose tool extraction is enabled
   */
  logVerbose(component: string, message: string, ...args: any[]): void {
    if (verboseToolExtraction) {
      console.log(`[${component}] ${message}`, ...args);
    }
  },

  /**
   * Log warning (always shown, regardless of verbose mode)
   */
  logWarn(component: string, message: string, ...args: any[]): void {
    console.warn(`[${component}] ${message}`, ...args);
  },
};

/**
 * Log a long message (truncated for readability)
 */
export function logLongMessage(prefix: string, message: string, maxLength: number = 500): void {
  if (!message || message.length === 0) {
    console.log(`${prefix}: [EMPTY]`);
    return;
  }
  
  if (message.length > maxLength) {
    // Log total length first
    console.log(`${prefix} (total length: ${message.length})`);
    
    // Split into chunks
    const numChunks = Math.ceil(message.length / maxLength);
    for (let i = 0; i < numChunks; i++) {
      const start = i * maxLength;
      const end = Math.min(start + maxLength, message.length);
      const chunk = message.substring(start, end);
      console.log(`${prefix} chunk ${i + 1}/${numChunks}: ${chunk}`);
    }
  } else {
    console.log(`${prefix}: ${message}`);
  }
}

/**
 * Log API request details
 */
export function logApiRequest(endpoint: string, prompt: string, maxPromptLength: number = 200): void {
  const promptPreview = prompt.length > maxPromptLength 
    ? `${prompt.substring(0, maxPromptLength)}...` 
    : prompt;
  console.log(`[Harmony] Calling endpoint: ${endpoint}`);
  console.log(`[Harmony] Prompt: ${promptPreview}`);
}

/**
 * Log tool calls
 */
export function logToolCalls(toolCalls: Array<{ name: string }>): void {
  if (toolCalls.length > 0) {
    console.log(`[Harmony] Tool calls: ${toolCalls.map(tc => tc.name).join(', ')}`);
  }
}

/**
 * Log rules information
 */
export function logRules(rules: any[]): void {
  if (rules && rules.length > 0) {
    console.log(`[Rules] Loaded ${rules.length} rule(s)`);
  }
}

/**
 * Log step information
 */
export function logStepInfo(currentStep: number | undefined, maxSteps: number | undefined, originalPrompt?: string): void {
  if (currentStep !== undefined && maxSteps !== undefined) {
    console.log(`[Harmony] Step ${currentStep}/${maxSteps}${originalPrompt ? ` - ${originalPrompt.substring(0, 50)}...` : ''}`);
  }
}

/**
 * Log verbose info
 */
export function logVerboseInfo(verboseInfo: any, formatted?: string): void {
  if (!verboseInfo) {
    console.log('[VerboseInfo] toString() called on null/undefined verboseInfo');
    return;
  }
  
  // Determine emoji and stage name based on stage type
  const stage = verboseInfo.stage || 'unknown';
  const stageEmojis: Record<string, string> = {
    'chat': '💬',
    'assumptions': '🔍',
    'implementation': '⚙️',
    'unknown': '📋'
  };
  const emoji = stageEmojis[stage] || '📋';
  
  // Log basic info about toString() being called
  console.log(`[VerboseInfo] ${emoji} toString() called for ${stage} stage verboseInfo`);
  
  // Log stage-specific details
  if (stage === 'chat') {
    if (verboseInfo.step !== undefined && verboseInfo.maxSteps !== undefined) {
      console.log(`[VerboseInfo] Progress: Step ${verboseInfo.step}/${verboseInfo.maxSteps}`);
    }
    if (verboseInfo.problemSummary?.restatedProblem) {
      console.log(`[VerboseInfo] Problem restated: ${verboseInfo.problemSummary.restatedProblem}`);
    }
    if (verboseInfo.stageTransition) {
      console.log(`[VerboseInfo] Stage transition: ${verboseInfo.stageTransition.from} → ${verboseInfo.stageTransition.to}`);
    }
    if (verboseInfo.isComplete) {
      console.log(`[VerboseInfo] Status: Complete`);
    }
  } else if (stage === 'assumptions') {
    if (verboseInfo.progressPlan) {
      console.log(`[VerboseInfo] ProgressPlan created: ${verboseInfo.progressPlan.totalSteps} steps, complexity: ${verboseInfo.progressPlan.complexity}`);
      if (verboseInfo.progressPlan.steps && verboseInfo.progressPlan.steps.length > 0) {
        console.log(`[VerboseInfo] Plan steps:`);
        verboseInfo.progressPlan.steps.forEach((step: any) => {
          console.log(`[VerboseInfo]   Step ${step.stepNumber}: ${step.goal}`);
        });
      }
    }
  } else if (stage === 'implementation') {
    if (verboseInfo.planProgress) {
      console.log(`[VerboseInfo] Plan progress: ${verboseInfo.planProgress.completedSteps}/${verboseInfo.planProgress.totalSteps} steps completed`);
      if (verboseInfo.planProgress.currentStep) {
        console.log(`[VerboseInfo] Current step: Step ${verboseInfo.planProgress.currentStep.stepNumber} - ${verboseInfo.planProgress.currentStep.goal}`);
      }
    }
    if (verboseInfo.fileOperations) {
      const created = verboseInfo.fileOperations.created?.length || 0;
      const updated = verboseInfo.fileOperations.updated?.length || 0;
      const failed = verboseInfo.fileOperations.failed?.length || 0;
      if (created > 0 || updated > 0 || failed > 0) {
        console.log(`[VerboseInfo] File operations: ${created} created, ${updated} updated, ${failed} failed`);
      }
    }
  } else {
    // Unknown stage - just log basic info
    if (verboseInfo.stageTransition) {
      console.log(`[VerboseInfo] Stage transition: ${verboseInfo.stageTransition.from} → ${verboseInfo.stageTransition.to}`);
    }
  }
  
  // Log the formatted string using logLongMessage (it handles both short and long strings)
  if (formatted) {
    logLongMessage('[VerboseInfo] Full toString() output', formatted, 1000);
  }
}
