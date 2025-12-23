import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { ChatMessage } from "./conversationManager";

export class TemplateRenderer {
  constructor(private context: vscode.ExtensionContext) {}

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

      // Default Harmony format prompt with history support
      const historyText = conversationHistory && conversationHistory.length > 0
        ? this.formatConversationHistory(conversationHistory)
        : '';
      
      return `${historyText}<|start|>user<|channel|>final<|message|>
{{prompt}}

<|end|>
<|start|>assistant<|channel|>final<|message|>`;
    }
  }

  /**
   * Format conversation history using Harmony protocol tokens
   */
  private formatConversationHistory(
    history: readonly ChatMessage[]
  ): string {
    let historyText = '';
    
    for (const message of history) {
      if (message.role === 'user') {
        historyText += `<|start|>user<|channel|>final<|message|>
${message.content}
<|end|>
`;
      } else if (message.role === 'assistant') {
        // Include reasoning if present
        let assistantContent = message.content;
        if (message.reasoning) {
          assistantContent = `Reasoning: ${message.reasoning}\n\n${assistantContent}`;
        }
        
        historyText += `<|start|>assistant<|channel|>final<|message|>
${assistantContent}
<|end|>
`;
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
    
    // Simple template rendering - replace {{variable}} with values
    // Handle both {{variable}} and {variable} patterns
    let rendered = template
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
    // Look for the first occurrence of <|start|>user to insert history before it
    if (historyText && rendered.includes('<|start|>user')) {
      const userIndex = rendered.indexOf('<|start|>user');
      rendered = historyText + rendered.substring(userIndex);
    }
    
    return rendered;
  }
}

