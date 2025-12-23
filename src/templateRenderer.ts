import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

export class TemplateRenderer {
  constructor(private context: vscode.ExtensionContext) {}

  async applyTemplate(
    templateName: string,
    templateContext: any
  ): Promise<string> {
    const templatePath = path.join(
      this.context.extensionPath,
      "templates",
      `${templateName}.j2`
    );

    try {
      const template = await fs.promises.readFile(templatePath, "utf-8");
      return this.renderTemplate(template, templateContext);
    } catch (error) {
      console.warn(`Template ${templateName} not found, using default prompt`);

      // Default Harmony format prompt
      return `<|start|>user<|channel|>final<|message|>
{{prompt}}

<|end|>
<|start|>assistant<|channel|>final<|message|>`;
    }
  }

  private renderTemplate(template: string, context: any): string {
    // Simple template rendering - replace {{variable}} with values
    // Handle both {{variable}} and {variable} patterns
    return template
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
  }
}

