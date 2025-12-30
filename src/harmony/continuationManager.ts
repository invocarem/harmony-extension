import { MCPToolResult } from "../mcpClient";
import { WorkflowStage } from "../stageStateMachine";
import { ConversationContext } from "./conversationContext";

/**
 * Manages continuation logic and task completion detection
 */
export class ContinuationManager {
  /**
   * Determine if the task should continue after tool execution
   */
  shouldContinueTask(
    originalPrompt: string,
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    currentContent: string,
    isAlreadyContinuation: boolean,
    currentStage: WorkflowStage,
    conversationContext: ConversationContext | null
  ): boolean {
    // Check if we've reached the maximum steps
    if (conversationContext && conversationContext.currentStep > conversationContext.maxSteps) {
      return false;
    }
    
    // Also check if the NEXT step would exceed maxSteps
    if (conversationContext && conversationContext.currentStep + 1 > conversationContext.maxSteps) {
      return false;
    }
    
    // Stage-specific completion logic
    if (currentStage === 'chat') {
      return this.shouldContinueInChatStage(originalPrompt, executedToolCalls, currentContent);
    }
    
    if (currentStage === 'assumptions') {
      return this.shouldContinueInAssumptionsStage(originalPrompt, executedToolCalls, currentContent, conversationContext);
    }
    
    // Implementation stage
    return this.shouldContinueInImplementationStage(originalPrompt, executedToolCalls, currentContent);
  }

  private shouldContinueInChatStage(
    originalPrompt: string,
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    currentContent: string
  ): boolean {
    // Check if this is a file task with only discovery tools - allow continuation
    const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
    const onlyDiscoveryTools = executedToolCalls.every(tc => 
      ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
    );
    const hasFileModification = executedToolCalls.some(tc => 
      ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
    );
    
    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      console.log(`[Harmony] Chat stage: File task with only discovery tools, continuing`);
      return true;
    }
    
    // Otherwise, only continue if there are explicit continuation hints
    const hasContinuationHint = /(?:next|continue|then|after|now|further|additional|let'?s|proceed)/i.test(currentContent.toLowerCase());
    if (hasContinuationHint) {
      console.log(`[Harmony] Chat stage: Has continuation hints, may need to continue`);
      return true;
    }
    return false;
  }

  private shouldContinueInAssumptionsStage(
    originalPrompt: string,
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    currentContent: string,
    conversationContext: ConversationContext | null
  ): boolean {
    // Check if this is a file task with only discovery tools - allow continuation to implementation
    const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
    const onlyDiscoveryTools = executedToolCalls.every(tc => 
      ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
    );
    const hasFileModification = executedToolCalls.some(tc => 
      ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
    );
    
    // Auto-transition from Assumptions to Implementation is DISABLED
    // Users must explicitly type "move to implementation" or "moveto implementation" to transition
    // This ensures users have control over when to proceed to implementation stage
    // 
    // Previously, if it was a file task with only discovery tools, we would auto-transition.
    // Now we require explicit user command:
    // if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
    //   ... auto-transition code ...
    //   return true;
    // }
    
    // In assumptions stage, completion is when code snippets are provided
    const hasCodeSnippets = /```[\s\S]*?```/.test(currentContent);
    const hasCompletionPhrase = /(?:here'?s|here is|below|above).*(?:code|snippet|solution|example)/i.test(currentContent.toLowerCase());
    
    // Check for explicit continuation hints
    const hasContinuationHint = /(?:next|continue|then|after|now|further|additional|implement|create|write)/i.test(currentContent.toLowerCase());
    
    // In assumptions stage, we don't continue if code snippets are provided
    if (hasCodeSnippets || hasCompletionPhrase) {
      console.log(`[Harmony] Assumptions stage: Code snippets provided, task appears complete`);
      return false;
    }
    
    if (hasContinuationHint) {
      console.log(`[Harmony] Assumptions stage: Has continuation hints`);
      return true;
    }
    
    return false;
  }

  private shouldContinueInImplementationStage(
    originalPrompt: string,
    executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: MCPToolResult }>,
    currentContent: string
  ): boolean {
    const taskCompletionPhrases = [
      /(?:updated|created|wrote|modified).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i,
      /file.*has been.*(?:created|updated|written|modified)/i,
      /task.*(?:complete|done|finished|accomplished)/i,
      /(?:here'?s|here is).*the.*(?:readme|file|code)/i,
      /I have.*(?:created|updated|written)/i,
      /\*\*File:\*\*\s*`[^`]+`/i,
      /```[\s\S]*?```/i,
    ];
    
    const hasCompletionPhrase = taskCompletionPhrases.some(phrase => phrase.test(currentContent.toLowerCase()));
    
    // Check if we've performed file modification
    const hasFileModification = executedToolCalls.some(tc => 
      ['create_file', 'replace_file', 'write_file', 'update_file'].includes(tc.name)
    );
    
    // Check if the response indicates file modification was done (even without tool calls)
    const indicatesFileModified = /(?:I will|I'll|going to|will|should|need to).*(?:update|modify|change|edit|replace).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(currentContent.toLowerCase());
    
    // Check if original prompt requested file creation/modification
    const isFileTask = /(?:update|create|write|modify|edit|generate).*\.(?:md|txt|json|js|ts|py|java|cpp|c|html|css)/i.test(originalPrompt.toLowerCase());
    
    // Check if we've only done discovery/read tools
    const onlyDiscoveryTools = executedToolCalls.every(tc => 
      ['list_files', 'read_file', 'grep_files', 'search', 'find'].includes(tc.name)
    );
    
    // Check if the current content mentions specific tool calls that should be made
    const mentionsToolCalls = /(?:will call|should call|need to call|calling|use).*(?:tool|function|method|update_file|write_file|create_file)/i.test(currentContent.toLowerCase());
    
    // Decision logic for implementation stage
    if (isFileTask && onlyDiscoveryTools && !hasFileModification) {
      // If we have discovery tools but no file modification AND the model mentions doing it
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Implementation stage: Model says it will modify file but didn't call tools. Need continuation.`);
        return true;
      }
      
      console.log(`[Harmony] Implementation stage: Only discovery tools used, no file modification yet`);
      return true;
    }
    
    if (isFileTask && !hasFileModification && !hasCompletionPhrase) {
      // If the model indicates it will modify but doesn't call tools, we need to continue
      if (indicatesFileModified && !mentionsToolCalls) {
        console.log(`[Harmony] Implementation stage: Model says it will modify but didn't call tools`);
        return true;
      }
      
      console.log(`[Harmony] Implementation stage: File task but no file modification or completion phrase`);
      return true;
    }
    
    // Check for explicit "continue" or "next step" in reasoning/content
    const hasContinuationHint = /(?:next|continue|then|after|now|further|additional)/i.test(currentContent.toLowerCase());
    
    if (hasContinuationHint && !hasCompletionPhrase) {
      console.log(`[Harmony] Implementation stage: Has continuation hints but no completion`);
      return true;
    }
    
    // If model says "I will update" but didn't actually call update tools, continue
    if (indicatesFileModified && !hasFileModification && !mentionsToolCalls) {
      console.log(`[Harmony] Implementation stage: Model indicated file modification but didn't call appropriate tools`);
      return true;
    }
    
    console.log(`[Harmony] Implementation stage: Task appears complete: hasFileModification=${hasFileModification}, hasCompletionPhrase=${hasCompletionPhrase}, indicatesFileModified=${indicatesFileModified}`);
    return false;
  }
}

