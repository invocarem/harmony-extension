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