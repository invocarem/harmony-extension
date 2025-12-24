/**
 * Utility functions for logging in the Harmony system
 */

/**
 * 分批打印长日志信息
 */
export function logLongMessage(prefix: string, message: string, chunkSize = 1000): void {
  console.log(`${prefix} (total length: ${message.length})`);
  if (!message || message.length === 0) {
    console.log(`${prefix}: [EMPTY]`);
    return;
  }
  
  // 如果消息不长于chunkSize，直接打印
  if (message.length <= chunkSize) {
    console.log(`${prefix}: ${message}`);
    return;
  }
  
  // 分批打印
  const numChunks = Math.ceil(message.length / chunkSize);
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    const chunk = message.substring(start, Math.min(end, message.length));
    console.log(`${prefix} chunk ${i + 1}/${numChunks}: ${chunk}`);
  }
}

/**
 * 记录API请求信息
 */
export function logApiRequest(endpoint: string, prompt: string, maxPreviewLength = 100): void {
  console.log(`[Harmony] Calling endpoint: ${endpoint}`);
  const preview = prompt.length > maxPreviewLength 
    ? `${prompt.substring(0, maxPreviewLength)}...` 
    : prompt;
  console.log(`[Harmony] Prompt: ${preview}`);
}

/**
 * 记录工具调用信息
 */
export function logToolCalls(toolCalls: Array<{ name: string; type?: string }>): void {
  if (toolCalls.length > 0) {
    console.log(`[Harmony] Found ${toolCalls.length} tool call(s):`);
    toolCalls.forEach((call, index) => {
      const type = call.type ? ` (${call.type})` : '';
      console.log(`  ${index + 1}. ${call.name}${type}`);
    });
  }
}

/**
 * 记录规则应用信息
 */
export function logRules(applicableRules: Array<{ id: string; description?: string }>): void {
  if (applicableRules.length > 0) {
    console.log(`[Rules] Found ${applicableRules.length} applicable rule(s)`);
    applicableRules.forEach(rule => {
      console.log(`[Rules] Matched rule: ${rule.id}${rule.description ? ` (${rule.description})` : ""}`);
    });
  }
}


// Add these logging functions to your logger.ts file or create them inline in llamaClient.ts

/**
 * Log step information for multi-step continuations
 */
export function logStepInfo(stepNumber: number, maxSteps: number, originalPrompt: string): void {
  console.log(`[Harmony] Step ${stepNumber}/${maxSteps} for task: "${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? '...' : ''}"`);
}

/**
 * Log continuation decision details
 */
export function logContinuationDecision(
  shouldContinue: boolean,
  reason: string,
  hasFileModification: boolean,
  hasCompletionPhrase: boolean,
  onlyDiscoveryTools: boolean
): void {
  console.log(`[Harmony] Continuation decision: ${shouldContinue ? 'CONTINUE' : 'STOP'}`);
  console.log(`[Harmony] Reason: ${reason}`);
  console.log(`[Harmony] Factors: hasFileModification=${hasFileModification}, hasCompletionPhrase=${hasCompletionPhrase}, onlyDiscoveryTools=${onlyDiscoveryTools}`);
}

/**
 * Log tool execution results
 */
export function logToolExecutionResults(
  executedToolCalls: Array<{ name: string; result?: any }>
): void {
  if (executedToolCalls.length === 0) return;
  
  console.log(`[Harmony] Tool execution results:`);
  executedToolCalls.forEach((toolCall, index) => {
    if (toolCall.result?.isError) {
      console.log(`  ${index + 1}. ❌ ${toolCall.name}: Error - ${toolCall.result.content?.[0]?.text || 'Unknown error'}`);
    } else {
      console.log(`  ${index + 1}. ✅ ${toolCall.name}: Success`);
      // Log first 200 chars of result if available
      if (toolCall.result?.content?.[0]?.text) {
        const text = toolCall.result.content[0].text;
        const preview = text.length > 200 ? `${text.substring(0, 200)}...` : text;
        console.log(`       Result preview: ${preview}`);
      }
    }
  });
}

/**
 * Log conversation context state
 */
export function logConversationContext(context: any): void {
  if (!context) {
    console.log(`[Harmony] No active conversation context`);
    return;
  }
  
  console.log(`[Harmony] Conversation context:`);
  console.log(`  Original prompt: "${context.originalPrompt.substring(0, 100)}${context.originalPrompt.length > 100 ? '...' : ''}"`);
  console.log(`  Steps: ${context.steps.length}/${context.maxSteps}`);
  console.log(`  Current step: ${context.currentStep}`);
  
  if (context.steps.length > 0) {
    console.log(`  Previous steps summary:`);
    context.steps.forEach((step: any, index: number) => {
      console.log(`    Step ${index + 1}: ${step.toolCalls.length} tool calls, ${step.reasoning?.length || 0} chars reasoning`);
    });
  }
}