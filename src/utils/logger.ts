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

/**
 * Log verboseInfo when toString() is called
 * Uses logLongMessage for long verboseInfo content
 * This is called automatically when toString() is invoked on verboseInfo objects
 */
export function logVerboseInfo(verboseInfo: any, formattedString: string): void {
  if (!verboseInfo) {
    console.log(`[VerboseInfo] toString() called on null/undefined verboseInfo`);
    return;
  }
  
  const stage = verboseInfo.stage || 'unknown';
  const stageEmojiMap: Record<string, string> = {
    'chat': '💬',
    'assumptions': '🔍',
    'implementation': '⚙️',
    'init': '🔄'
  };
  const stageEmoji = stageEmojiMap[stage] || '📋';
  
  console.log(`[VerboseInfo] ${stageEmoji} toString() called for ${stage} stage verboseInfo`);
  
  // Log basic info
  if (verboseInfo.stageTransition) {
    console.log(`[VerboseInfo] Stage transition: ${verboseInfo.stageTransition.from} → ${verboseInfo.stageTransition.to}`);
  }
  
  if (verboseInfo.step !== undefined && verboseInfo.maxSteps !== undefined) {
    console.log(`[VerboseInfo] Progress: Step ${verboseInfo.step}/${verboseInfo.maxSteps}`);
  }
  
  if (verboseInfo.isComplete) {
    console.log(`[VerboseInfo] Status: Complete`);
  }
  
  // Log stage-specific highlights
  if (stage === 'chat' && verboseInfo.problemSummary) {
    console.log(`[VerboseInfo] Problem restated: ${verboseInfo.problemSummary.restatedProblem?.substring(0, 100) || 'N/A'}${verboseInfo.problemSummary.restatedProblem && verboseInfo.problemSummary.restatedProblem.length > 100 ? '...' : ''}`);
  }
  
  if (stage === 'assumptions' && verboseInfo.progressPlan) {
    console.log(`[VerboseInfo] ProgressPlan created: ${verboseInfo.progressPlan.totalSteps} steps, complexity: ${verboseInfo.progressPlan.complexity}`);
    if (verboseInfo.progressPlan.steps && verboseInfo.progressPlan.steps.length > 0) {
      console.log(`[VerboseInfo] Plan steps:`);
      verboseInfo.progressPlan.steps.forEach((step: any) => {
        const statusIcon = step.status === 'completed' ? '✅' : step.status === 'in_progress' ? '🔄' : '⏳';
        console.log(`[VerboseInfo]   ${statusIcon} Step ${step.stepNumber}: ${step.goal}`);
      });
    }
  }
  
  if (stage === 'implementation' && verboseInfo.planProgress) {
    console.log(`[VerboseInfo] Plan progress: ${verboseInfo.planProgress.completedSteps}/${verboseInfo.planProgress.totalSteps} steps completed`);
    if (verboseInfo.planProgress.currentStep) {
      console.log(`[VerboseInfo] Current step: ${verboseInfo.planProgress.currentStep.stepNumber} - ${verboseInfo.planProgress.currentStep.goal} (${verboseInfo.planProgress.currentStep.status})`);
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
  
  // Log the full formatted string using logLongMessage for long content
  logLongMessage(`[VerboseInfo] Full toString() output`, formattedString, 2000);
}