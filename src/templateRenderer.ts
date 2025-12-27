import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { ChatMessage } from "./conversationManager";

export class TemplateRenderer {
  constructor(
    private context: vscode.ExtensionContext,
    private harmonyMode: boolean = true
  ) {}

  /**
   * Filter out harmony tokens from text
   */
  private filterHarmonyTokens(text: string): string {
    // First remove all harmony tokens: <|...|>
    let filtered = text.replace(/<\|[^|]+\|>/g, '');
    
    // Remove channel type keywords that appear between tokens
    // These keywords appear concatenated (e.g., "userfinal", "assistantfinal") 
    // when they're part of the Harmony protocol structure
    const harmonyKeywords = ['user', 'assistant', 'final', 'analysis', 'commentary', 'start', 'end', 'channel', 'message'];
    const keywordPattern = harmonyKeywords.join('|');
    
    // Remove sequences of harmony keywords that are concatenated together
    // Iterate to handle all sequences like "userfinal", "assistantfinal", etc.
    // We match a harmony keyword followed immediately (no space/letter) by another harmony keyword
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      const before = filtered;
      // Match harmony keyword immediately followed by another harmony keyword (concatenated)
      for (const keyword of harmonyKeywords) {
        for (const otherKeyword of harmonyKeywords) {
          if (keyword !== otherKeyword) {
            // Remove concatenated pairs like "userfinal", "finalassistant", etc.
            filtered = filtered.replace(new RegExp(`${keyword}${otherKeyword}`, 'gi'), '');
          }
        }
        // Also handle sequences of same keyword (unlikely but possible)
        filtered = filtered.replace(new RegExp(`${keyword}${keyword}`, 'gi'), '');
      }
      // Remove single harmony keywords at the very start of string
      filtered = filtered.replace(new RegExp(`^(${keywordPattern})(?![a-zA-Z])`, 'gi'), '');
      // Remove pipe-prefixed harmony keywords (e.g., |assistant)
      filtered = filtered.replace(new RegExp(`\\|(${keywordPattern})(?![a-zA-Z])`, 'gi'), '');
      // Remove pipe-suffixed harmony keywords (e.g., assistant|)
      filtered = filtered.replace(new RegExp(`(${keywordPattern})\\|`, 'gi'), '');
      changed = (before !== filtered);
      iterations++;
    }
    
    // Clean up extra whitespace and leading pipes
    filtered = filtered.replace(/\s+/g, ' ').trim();
    // Remove leading pipe if it exists (from patterns like |assistant being partially cleaned)
    filtered = filtered.replace(/^\|+/, '').trim();
    return filtered;
  }

  async applyTemplate(
    templateName: string,
    templateContext: any,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<string> {
    const templatePath = path.join(
      this.context.extensionPath,
      "templates",
      `${templateName}.j2`
    );

    try {
      const template = await fs.promises.readFile(templatePath, "utf-8");
      return this.renderTemplate(template, templateContext, conversationHistory);
    } catch (error) {
      console.warn(`Template ${templateName} not found, using default prompt`);

      // Default prompt with history support
      const historyText = conversationHistory && conversationHistory.length > 0
        ? this.formatConversationHistory(conversationHistory)
        : '';
      
      const defaultPrompt = `${historyText}<|start|>user<|channel|>final<|message|>
{{prompt}}

<|end|>
<|start|>assistant<|channel|>final<|message|>`;
      
      // Filter harmony tokens if harmonyMode is false
      return this.harmonyMode ? defaultPrompt : this.filterHarmonyTokens(defaultPrompt);
    }
  }

  /**
   * Format conversation history using Harmony protocol tokens (or plain text if harmonyMode is false)
   */
  private formatConversationHistory(
    history: readonly ChatMessage[]
  ): string {
    let historyText = '';
    
    for (const message of history) {
      if (message.role === 'user') {
        if (this.harmonyMode) {
          historyText += `<|start|>user<|channel|>final<|message|>
${message.content}
<|end|>
`;
        } else {
          historyText += `User: ${message.content}\n\n`;
        }
      } else if (message.role === 'assistant') {
        // Include reasoning if present
        let assistantContent = message.content;
        if (message.reasoning) {
          assistantContent = `Reasoning: ${message.reasoning}\n\n${assistantContent}`;
        }
        
        if (this.harmonyMode) {
          historyText += `<|start|>assistant<|channel|>final<|message|>
${assistantContent}
<|end|>
`;
        } else {
          historyText += `Assistant: ${assistantContent}\n\n`;
        }
      }
    }
    
    return historyText;
  }

  private renderTemplate(
    template: string, 
    context: any,
    conversationHistory?: readonly ChatMessage[]
  ): string {
    // Format conversation history if provided
    const historyText = conversationHistory && conversationHistory.length > 0
      ? this.formatConversationHistory(conversationHistory)
      : '';
    
    // Filter harmony tokens from template if harmonyMode is false
    let templateToRender = this.harmonyMode ? template : this.filterHarmonyTokens(template);
    
    // Simple template rendering - replace {{variable}} with values
    // Handle both {{variable}} and {variable} patterns
    let rendered = templateToRender
      .replace(/{{(\w+)}}/g, (match, key) => {
        const value = context[key];
        if (value === undefined || value === null) {
          return ""; // Remove placeholder if value is missing
        }
        return String(value);
      })
      .replace(/{(\w+)}/g, (match, key) => {
        const value = context[key];
        if (value === undefined || value === null) {
          return ""; // Remove placeholder if value is missing
        }
        return String(value);
      });
    
    // Insert conversation history before the user message
    // Look for the first occurrence of <|start|>user to insert history before it (only if harmonyMode is true)
    if (historyText) {
      if (this.harmonyMode && rendered.includes('<|start|>user')) {
        const userIndex = rendered.indexOf('<|start|>user');
        rendered = historyText + rendered.substring(userIndex);
      } else if (!this.harmonyMode) {
        // For plain jinja mode, prepend history
        rendered = historyText + rendered;
      }
    }
    
    return rendered;
  }
}

