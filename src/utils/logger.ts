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
  if (message.length > maxLength) {
    console.log(`${prefix} (${message.length} chars): ${message.substring(0, maxLength)}...`);
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
  
  if (formatted) {
    console.log(`[VerboseInfo] ${formatted}`);
  } else {
    console.log('[VerboseInfo]', verboseInfo);
  }
}
