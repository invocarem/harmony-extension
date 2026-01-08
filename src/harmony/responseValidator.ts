import { MCPToolCall } from "../mcpClient";
import { WorkflowStage } from "./stageStateMachine";
import { CodeExtractor } from "./codeExtractor";
import { HarmonyParseResult } from "../harmonyProcessor";

/**
 * Validates tool calls against stage restrictions and detects incomplete responses
 */
export class ResponseValidator {
  private readonly fileModificationTools = [
    'create_file', 'replace_file', 'write_file', 'update_file', 
    'delete_file', 'edit_file', 'modify_file'
  ];

  /**
   * Validate tool calls against stage restrictions
   * Returns filtered tool calls and whether any were blocked
   */
  validateToolCalls(
    toolCalls: MCPToolCall[],
    currentStage: WorkflowStage
  ): { 
    allowedToolCalls: MCPToolCall[]; 
    blockedToolCalls: MCPToolCall[];
    wereBlocked: boolean;
  } {
    const restrictedToolCalls = toolCalls.filter(tc => 
      this.fileModificationTools.includes(tc.name)
    );

    // Block file modification tools in chat and assumptions stages
    if (restrictedToolCalls.length > 0 && (currentStage === 'assumptions' || currentStage === 'chat')) {
      const allowedToolCalls = toolCalls.filter(tc => 
        !this.fileModificationTools.includes(tc.name)
      );
      
      return {
        allowedToolCalls,
        blockedToolCalls: restrictedToolCalls,
        wereBlocked: true,
      };
    }

    return {
      allowedToolCalls: toolCalls,
      blockedToolCalls: [],
      wereBlocked: false,
    };
  }

  /**
   * Handle blocked tool calls by extracting code and adding warnings
   * Modifies parsed.content to include extracted code and warnings
   */
  handleBlockedToolCalls(
    parsed: HarmonyParseResult,
    blockedToolCalls: MCPToolCall[],
    currentStage: WorkflowStage,
    originalPrompt: string
  ): void {
    let hasContent = !!(parsed.content && parsed.content.trim());

    // For Assumptions stage: Always extract code from blocked tool calls to display
    if (currentStage === 'assumptions' && blockedToolCalls.length > 0) {
      const codeFromToolCalls = CodeExtractor.extractCodeFromToolCalls(blockedToolCalls);
      
      if (codeFromToolCalls.length > 0) {
        if (hasContent) {
          parsed.content = codeFromToolCalls.join('\n\n') + '\n\n' + parsed.content;
        } else {
          parsed.content = codeFromToolCalls.join('\n\n');
        }
        hasContent = true;
      }
    }

    // Add warning message if not already present
    // IMPORTANT: Preserve AI's content (restatement) if it exists - only append warning
    if (!parsed.content || !hasContent || !parsed.content.includes('⚠️')) {
      let stageWarning: string;
      
      if (currentStage === 'assumptions') {
        if (hasContent) {
          // Preserve AI's restatement/content and append warning
          stageWarning = `${parsed.content}\n\n⚠️ **Note**: File modification tools (${blockedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Analysis stage. Please provide code snippets instead. To create files, say "move to implementation" after the code is ready.`;
        } else {
          // No content from AI - use generic message (AI should have restated per template)
          stageWarning = `I understand you want to create files. In the Analysis stage, I should provide code snippets first.\n\n⚠️ **Note**: File modification tools (${blockedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Analysis stage. Please provide code snippets instead. To create files, say "move to implementation" after the code is ready.`;
        }
      } else {
        // Chat stage
        if (hasContent) {
          // Preserve AI's restatement/content and append warning
          stageWarning = `${parsed.content}\n\n⚠️ **Note**: File modification tools (${blockedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Chat stage. To create files, say "move to assumption" to analyze and provide code snippets first, then "move to implementation" to create the files.`;
        } else {
          // No content from AI - use generic message (AI should have restated per template)
          stageWarning = `I understand you want to create files.\n\n⚠️ **Note**: File modification tools (${blockedToolCalls.map(tc => tc.name).join(', ')}) are not available in the Chat stage. To create files, say "move to assumption" to analyze and provide code snippets first, then "move to implementation" to create the files.`;
        }
      }
      parsed.content = stageWarning;
    }
  }

  /**
   * Detect if a response looks incomplete (truncated code blocks, incomplete file content, etc.)
   */
  detectIncompleteResponse(response: string): boolean {
    // Check for unclosed code blocks
    const codeBlockMatches = response.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      console.log(`[Harmony] Detected unclosed code block (${codeBlockMatches.length} code block markers)`);
      return true;
    }

    // Check for file descriptions with code blocks that might be incomplete
    const filePattern = /\*\*File:\*\*\s*`[^`]+`/gi;
    const codeBlockPattern = /```[\s\S]*?```/g;
    
    if (filePattern.test(response)) {
      filePattern.lastIndex = 0;
      
      const fileMatches = Array.from(response.matchAll(filePattern));
      const lastFileMatch = fileMatches[fileMatches.length - 1];
      if (lastFileMatch) {
        const afterFileMatch = response.substring(lastFileMatch.index! + lastFileMatch[0].length);
        const codeBlocksAfter = Array.from(afterFileMatch.matchAll(codeBlockPattern));
        
        if (codeBlocksAfter.length === 0 && afterFileMatch.includes('```')) {
          console.log(`[Harmony] Detected file mention with potentially incomplete code block`);
          return true;
        }
      }
    }

    // Check for incomplete Harmony tokens
    if (response.includes('<|')) {
      const channelTokens = (response.match(/<\|channel\|>/g) || []).length;
      const endTokens = (response.match(/<\|end\|>/g) || []).length;
      
      if (channelTokens > 1 && channelTokens > endTokens) {
        console.log(`[Harmony] Detected unclosed Harmony tokens (${channelTokens} channels, ${endTokens} ends)`);
        return true;
      }
    }

    return false;
  }

  /**
   * Enforce restatement in Chat stage
   */
  enforceRestatement(
    parsed: HarmonyParseResult,
    currentStage: WorkflowStage,
    originalPrompt: string
  ): void {
    if (currentStage !== 'chat' || !parsed.content || !parsed.content.trim()) {
      return;
    }

    const contentTrimmed = parsed.content.trim();
    const isModerateResponse = contentTrimmed.length > 30 && contentTrimmed.length <= 2000;
    
    if (isModerateResponse) {
      const responsePatterns = [
        /^(you want to|you're asking|your question|you asked|you'd like|you need|you're looking for|you want|let me help|i understand)/i,
        /^(to answer|regarding|about your)/i,
        /^(here'?s|here is|the answer|the solution|the result)/i,
        /^(yes|no|sure|of course|certainly|absolutely)/i,
        /^(partial|continued|response)/i,
        /<tool_call|<|start|>/,
      ];
      const startsWithResponse = responsePatterns.some(pattern => pattern.test(contentTrimmed));
      
      if (!startsWithResponse) {
        const restatement = `You're asking: "${originalPrompt}". Let me help you with that.\n\n`;
        parsed.content = restatement + parsed.content;
        console.log(`[Harmony] Prepend restatement to Chat stage response`);
      }
    }
  }
}

