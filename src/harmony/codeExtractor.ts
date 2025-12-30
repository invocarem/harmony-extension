import { ChatMessage } from "../conversationManager";

/**
 * Utility class for extracting code snippets from conversation history
 */
export class CodeExtractor {
  /**
   * Extract code snippets from conversation history
   * Looks for code blocks (```language ... ```) in assistant messages
   * Returns array of code block contents with file paths if available
   */
  static extractCodeSnippetsFromHistory(conversationHistory?: readonly ChatMessage[]): string[] {
    if (!conversationHistory || conversationHistory.length === 0) {
      return [];
    }
    
    const codeSnippets: string[] = [];
    
    // Look through assistant messages for code blocks (most recent first, as they're more relevant)
    const messages = [...conversationHistory].reverse();
    
    for (const message of messages) {
      if (message.role === 'assistant' && message.content) {
        // Match code blocks: ```language ... ``` or ``` ... ```
        // Also handle cases where language might be on same line or next line
        const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
        let match;
        
        while ((match = codeBlockPattern.exec(message.content)) !== null) {
          const codeContent = match[1].trim();
          if (codeContent && codeContent.length > 10) { // Only include substantial code blocks
            // Try to extract file path from surrounding context (before the code block)
            const beforeMatch = message.content.substring(0, match.index);
            // Look for file path patterns: "**File:** `path`", "File: `path`", "`path`", etc.
            const filePathMatch = 
              beforeMatch.match(/(?:file|filename|path)[:\s]+`?([^\s`]+\.\w{2,4})`?/i) ||
              beforeMatch.match(/\*\*(?:file|filename|path)\*\*[:\s]+`([^`]+\.\w{2,4})`/i) ||
              beforeMatch.match(/\*\*([^*]+\.\w{2,4})\*\*/i) ||
              beforeMatch.match(/`([^`]+\.\w{2,4})`/i);
            
            // Also check if file path is mentioned in the code block itself (e.g., comment)
            const codeBlockWithPath = codeContent.match(/^#\s*(?:file|path)[:\s]+([^\n]+\.\w{2,4})/i) ||
                                      codeContent.match(/\/\/\s*(?:file|path)[:\s]+([^\n]+\.\w{2,4})/i);
            
            const filePath = filePathMatch?.[1] || codeBlockWithPath?.[1];
            
            let snippet = codeContent;
            if (filePath) {
              snippet = `**File**: \`${filePath}\`\n\n\`\`\`\n${codeContent}\n\`\`\``;
            } else {
              // Include code block without file path
              snippet = `\`\`\`\n${codeContent}\n\`\`\``;
            }
            
            codeSnippets.push(snippet);
          }
        }
      }
    }
    
    console.log(`[Harmony] Extracted ${codeSnippets.length} code snippet(s) from conversation history`);
    return codeSnippets;
  }

  /**
   * Extract code from blocked tool calls (for display in assumptions stage)
   */
  static extractCodeFromToolCalls(
    toolCalls: Array<{ name: string; arguments?: Record<string, any> }>
  ): string[] {
    const codeFromToolCalls: string[] = [];
    
    for (const toolCall of toolCalls) {
      if (toolCall.name === 'create_file' && toolCall.arguments?.content) {
        const filePath = toolCall.arguments.file_path || 'file';
        const fileExtension = filePath.split('.').pop() || '';
        codeFromToolCalls.push(`**File**: \`${filePath}\`\n\n\`\`\`${fileExtension}\n${toolCall.arguments.content}\n\`\`\``);
      } else if (toolCall.name === 'replace_file' && toolCall.arguments?.content) {
        const filePath = toolCall.arguments.file_path || 'file';
        const fileExtension = filePath.split('.').pop() || '';
        codeFromToolCalls.push(`**File**: \`${filePath}\`\n\n\`\`\`${fileExtension}\n${toolCall.arguments.content}\n\`\`\``);
      }
    }
    
    return codeFromToolCalls;
  }
}

