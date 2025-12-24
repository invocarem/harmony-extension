import * as vscode from "vscode";
import { HarmonyClient } from "./harmonyClient";
import { TemplateRenderer } from "./templateRenderer";

export class CodeActions {
  constructor(
    private harmonyClient: HarmonyClient,
    private templateRenderer: TemplateRenderer
  ) {}

  async explainCode(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor found");
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage("No text selected");
      return;
    }

    const prompt = `Explain the following code:\n\n${text}\n\nExplanation:`;

    await this.showResponseWithProgress(prompt, "explain");
  }

  async refactorCode(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor found");
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage("No text selected");
      return;
    }

    const language = editor.document.languageId;
    const prompt = `Refactor the following ${language} code to be more efficient and readable:\n\n${text}\n\nRefactored code:`;

    await this.showResponseWithProgress(prompt, "refactor");
  }

  async generateCode(): Promise<void> {
    const prompt = await vscode.window.showInputBox({
      prompt: "What code would you like to generate?",
      placeHolder: "e.g., Create a React component that displays a list of users",
    });

    if (prompt) {
      await this.showResponseWithProgress(prompt, "generate");
    }
  }

  private async showResponseWithProgress(
    prompt: string,
    templateName: string
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Processing with Harmony...",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ increment: 0 });

        try {
          const response = await this.harmonyClient.callServer(
            prompt,
            templateName,
            (name, ctx) => this.templateRenderer.applyTemplate(name, ctx)
          );
          progress.report({ increment: 100 });

          // Show response in a new document (include reasoning if present)
          let content = response.content;
          if (response.reasoning) {
            content = `## Reasoning\n\n${response.reasoning}\n\n---\n\n## Response\n\n${response.content}`;
          }

          const document = await vscode.workspace.openTextDocument({
            content: content,
            language: "markdown",
          });

          await vscode.window.showTextDocument(
            document,
            vscode.ViewColumn.Beside
          );
        } catch (error: any) {
          vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
      }
    );
  }
}

