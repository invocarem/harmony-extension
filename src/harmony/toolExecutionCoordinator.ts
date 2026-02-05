import { MCPToolCall, MCPToolResult } from "../mcpClient";
import { NativeToolsManager } from "../nativeToolManager";
import { ToolExecutor } from "./toolExecutor";
import { ToolResultFormatter } from "./toolResultFormatter";
import { RulesManager, Rule } from "../rulesManager";
import {
  ConversationContextManager,
  ConversationContext,
} from "./conversationContext";
import { ProgressPlanManager } from "../progressPlanManager";
import { AutoTransitionManager } from "./autoTransitionManager";
import { ImplementationManager } from "./implementationManager";
import { CodeContext } from "./codeContext";
import { WorkflowStage } from "./index";
import { logToolCalls } from "../utils/logger";

/**
 * ToolExecutionCoordinator
 * Coordinates tool execution, file creation, and progress plan updates
 * Extracts tool execution logic from HarmonyClient.callServer
 */
export class ToolExecutionCoordinator {
  constructor(
    private toolExecutor: ToolExecutor,
    private toolResultFormatter: ToolResultFormatter,
    private contextManager: ConversationContextManager,
    private progressPlanManager: ProgressPlanManager,
    private autoTransitionManager: AutoTransitionManager,
    private implementationManager: ImplementationManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {}

  /**
   * Execute tool calls
   */
  async executeToolCalls(
    toolCalls: MCPToolCall[],
    currentStage: WorkflowStage
  ): Promise<
    Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>
  > {
    if (toolCalls.length === 0) {
      return [];
    }

    console.log(
      `[Harmony] Executing ${toolCalls.length} tool call(s) in stage: ${currentStage}`
    );
    logToolCalls(toolCalls.map((tc) => ({ name: tc.name })));

    // Safeguard: merge previous-step content when replace_file would overwrite
    const processedCalls = this.mergePreviousStepContentForReplaceFile(
      toolCalls,
      currentStage
    );

    const executedToolCalls = await this.toolExecutor.executeToolCalls(
      processedCalls,
      currentStage
    );

    console.log(
      `[Harmony] Completed execution of ${executedToolCalls.length} tool call(s) in stage: ${currentStage}`
    );

    return executedToolCalls;
  }

  /**
   * For replace_file/create_file: when the file was created in a previous step and
   * the new content would overwrite (doesn't include previous content), merge to preserve.
   */
  private mergePreviousStepContentForReplaceFile(
    toolCalls: MCPToolCall[],
    currentStage: WorkflowStage
  ): MCPToolCall[] {
    if (
      currentStage !== "implementation" ||
      !this.contextManager ||
      !this.implementationManager ||
      !this.nativeToolsManager
    ) {
      return toolCalls;
    }

    const currentStep = this.implementationManager.getCurrentStep();
    if (!currentStep || currentStep.stepNumber <= 1) {
      return toolCalls;
    }

    const fileModTools = ["replace_file", "create_file"];
    const processed = toolCalls.map((tc) => {
      if (!fileModTools.includes(tc.name)) return tc;

      const filePath = tc.arguments?.file_path || tc.arguments?.filePath;
      const newContent = tc.arguments?.content;
      if (
        !filePath ||
        typeof newContent !== "string" ||
        newContent.trim().length === 0
      ) {
        return tc;
      }

      // Skip diagnostic files
      if (
        String(filePath).startsWith("implementation_step_") ||
        String(filePath) === "assumption_data.json" ||
        String(filePath) === "aggregated_prompt.json"
      ) {
        return tc;
      }

      const previousContent = this.contextManager.getContentBeforeStep(
        filePath,
        currentStep.stepNumber
      );
      if (!previousContent || previousContent.trim().length < 20) {
        return tc;
      }

      // Check if new content already includes previous (LLM followed instruction)
      const prevSample = previousContent.substring(
        0,
        Math.min(150, previousContent.length)
      );
      if (newContent.includes(prevSample)) {
        return tc; // LLM preserved it, no merge needed
      }

      // New content doesn't include previous = overwrite, merge to preserve
      const mergedContent = previousContent.trim() + "\n\n" + newContent.trim();
      console.log(
        `[Harmony] Merge safeguard: prepended previous-step content to ${filePath} (LLM would have overwritten)`
      );
      return {
        ...tc,
        arguments: {
          ...tc.arguments,
          content: mergedContent,
        },
      };
    });

    return processed;
  }

  /**
   * Format tool results
   */
  async formatToolResults(
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    prompt: string,
    currentStage: WorkflowStage
  ): Promise<string> {
    let applicableRules: Rule[] = [];
    if (this.rulesManager) {
      applicableRules = this.rulesManager.getApplicableRules(prompt);
      if (applicableRules.length === 0) {
        applicableRules = this.rulesManager.getRulesForTools(
          executedToolCalls.map((tc) => tc.name)
        );
      }
    }

    let formattedContent = "";
    if (applicableRules.length > 0) {
      console.log(
        `[Rules] Formatting tool results according to ${applicableRules.length} rule(s) in ${currentStage} stage`
      );
      try {
        formattedContent =
          await this.toolResultFormatter.formatToolResultsWithRules(
            executedToolCalls,
            applicableRules,
            prompt,
            currentStage
          );
      } catch (formatError: any) {
        console.error(`[Rules] Error formatting tool results:`, formatError);
        formattedContent =
          this.toolResultFormatter.formatToolResults(executedToolCalls);
      }
    } else {
      formattedContent =
        this.toolResultFormatter.formatToolResults(executedToolCalls);
    }

    return formattedContent;
  }

  /**
   * Update progress plan based on executed tool calls
   */
  async updateProgressPlan(
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentStage: string
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context?.progressPlan || currentStage !== "implementation") {
      return;
    }

    const plan = context.progressPlan;
    const fileModificationTools = [
      "create_file",
      "replace_file",
      "write_file",
      "update_file",
    ];

    // Ensure ImplementationManager is initialized
    if (!this.implementationManager.getTaskId()) {
      this.implementationManager.initialize(plan.taskId);
    }

    // Check for file modification tool executions
    const fileModToolCalls = executedToolCalls.filter((tc) =>
      fileModificationTools.includes(tc.name)
    );

    if (fileModToolCalls.length > 0) {
      // Get current step before processFileCreations (it may advance the step)
      const currentStep = this.implementationManager.getCurrentStep();

      // Track tool calls for completion summary
      const stepNumber = currentStep?.stepNumber;
      if (stepNumber) {
        for (const tc of fileModToolCalls) {
          const filePath = tc.arguments?.file_path || tc.arguments?.filePath;
          const success = !!(tc.result && !tc.result.isError);
          this.implementationManager.recordToolCall(
            stepNumber,
            tc.name,
            filePath,
            success
          );
        }
      }

      // Delegate to ImplementationManager
      const completedStepNumber =
        this.implementationManager.processFileCreations(executedToolCalls);

      // Record implementation step contexts for pre-inject in later steps
      if (stepNumber) {
        for (const tc of fileModToolCalls) {
          if (tc.result && !tc.result.isError) {
            const filePath = tc.arguments?.file_path || tc.arguments?.filePath;
            const content = tc.arguments?.content;
            // Skip diagnostic files (implementation_step_*.json, etc.)
            const isDiagnostic =
              typeof filePath === "string" &&
              (filePath.startsWith("implementation_step_") ||
                filePath === "assumption_data.json" ||
                filePath === "aggregated_prompt.json");
            if (
              filePath &&
              typeof content === "string" &&
              content.length > 0 &&
              !isDiagnostic
            ) {
              this.contextManager.addImplementationStepContext(
                filePath,
                content,
                stepNumber
              );
            }
          }
        }
      }

      if (completedStepNumber) {
        // Update diagnostic file with completion summary
        await this.implementationManager.updateImplementationStepFileOnCompletion(
          completedStepNumber,
          "llm_tools",
          this.nativeToolsManager,
          this.contextManager
        );

        const updatedPlan = this.implementationManager.getProgressPlan();
        if (updatedPlan?.completedAt) {
          console.log(
            `[Harmony] ProgressPlan: All steps completed! Plan "${plan.taskId}" is now complete.`
          );
        } else {
          // Report next pending step that user needs to start with @cmd:step
          const nextPendingStep = updatedPlan?.steps.find(
            (s) => s.status === "pending"
          );
          if (nextPendingStep) {
            console.log(
              `[Harmony] Step completed. Next step ${nextPendingStep.stepNumber} is pending (use @cmd:step to start)`
            );
          }
        }
      }
    }
  }

  /**
   * Create files from code contexts in implementation stage
   */
  async createFilesFromCodeContexts(
    conversationHistory?: readonly any[]
  ): Promise<{
    createdFiles: string[];
    updatedFiles: string[];
    failedFiles: Array<{ path: string; error: string }>;
  }> {
    const context = this.contextManager.getContext();
    const codeContexts = this.contextManager.getCodeContexts();

    const result = {
      createdFiles: [] as string[],
      updatedFiles: [] as string[],
      failedFiles: [] as Array<{ path: string; error: string }>,
    };

    if (!context || !this.nativeToolsManager || codeContexts.length === 0) {
      return result;
    }

    console.log(
      `[Harmony] Creating ${codeContexts.length} file(s) from CodeContext...`
    );

    for (const codeContext of codeContexts) {
      if (
        codeContext.waitForCreate &&
        codeContext.content &&
        codeContext.content.length > 0
      ) {
        try {
          const filePath = codeContext.name;

          // Validate content
          if (
            !codeContext.content ||
            !Array.isArray(codeContext.content) ||
            codeContext.content.length === 0
          ) {
            console.warn(
              `[Harmony] CodeContext for ${filePath} has invalid content array, skipping...`
            );
            continue;
          }

          // Get content as string
          let content: string;
          try {
            content = codeContext.getContentAsString();
          } catch (error) {
            console.warn(
              `[Harmony] Error calling getContentAsString() for ${filePath}:`,
              error
            );
            content = codeContext.content
              .filter((line) => line != null)
              .join("\n");
          }

          if (
            !content ||
            typeof content !== "string" ||
            content.trim().length === 0
          ) {
            console.warn(
              `[Harmony] CodeContext for ${filePath} has empty or invalid content, skipping...`
            );
            continue;
          }

          console.log(
            `[Harmony] Creating file ${filePath} from CodeContext (${content.length} chars)...`
          );

          const createResult = await this.nativeToolsManager.callTool(
            "create_file",
            {
              file_path: filePath,
              content: content,
            }
          );

          if (!createResult.isError) {
            result.createdFiles.push(filePath);
            this.contextManager.markCodeContextCreated(filePath);
            console.log(
              `[Harmony] Successfully created file ${filePath} from CodeContext`
            );
          } else if (
            createResult.content?.[0]?.text?.includes("already exists")
          ) {
            // File exists, use replace_file
            const replaceResult = await this.nativeToolsManager.callTool(
              "replace_file",
              {
                file_path: filePath,
                content: content,
              }
            );
            if (!replaceResult.isError) {
              result.updatedFiles.push(filePath);
              this.contextManager.markCodeContextCreated(filePath);
              console.log(
                `[Harmony] Successfully updated file ${filePath} from CodeContext`
              );
            } else {
              const errorMsg =
                replaceResult.content?.[0]?.text || "Unknown error";
              result.failedFiles.push({ path: filePath, error: errorMsg });
              console.warn(
                `[Harmony] Failed to update file ${filePath}: ${errorMsg}`
              );
            }
          } else {
            const errorMsg = createResult.content?.[0]?.text || "Unknown error";
            result.failedFiles.push({ path: filePath, error: errorMsg });
            console.warn(
              `[Harmony] Failed to create file ${filePath}: ${errorMsg}`
            );
          }
        } catch (error: any) {
          console.warn(
            `[Harmony] Error creating file ${codeContext.name}:`,
            error
          );
          result.failedFiles.push({
            path: codeContext.name,
            error: error.message || "Unknown error",
          });
        }
      }
    }

    return result;
  }

  /**
   * Create files from code blocks in response content
   */
  async createFilesFromCodeBlocks(content: string): Promise<{
    createdFiles: string[];
    failedFiles: Array<{ path: string; error: string }>;
  }> {
    const result = {
      createdFiles: [] as string[],
      failedFiles: [] as Array<{ path: string; error: string }>,
    };

    if (!this.nativeToolsManager || !content) {
      return result;
    }

    const codeBlockPattern = /```(?:\w+)?\s*[\n ]([\s\S]*?)```/g;
    const matches = content.matchAll(codeBlockPattern);
    const codeBlocks: Array<{
      codeContext: CodeContext;
      match: RegExpMatchArray;
    }> = [];

    for (const match of matches) {
      try {
        const codeBlock = match[0];
        const codeContext = CodeContext.fromCodeBlock(codeBlock);

        if (codeContext && codeContext.content.length > 0) {
          codeBlocks.push({ codeContext, match });
          console.log(
            `[Harmony] Extracted code block for file: ${codeContext.name}`
          );
        }
      } catch (error) {
        console.warn(
          `[Harmony] Failed to extract code context from block:`,
          error
        );
      }
    }

    if (codeBlocks.length === 0) {
      return result;
    }

    console.log(
      `[Harmony] Found ${codeBlocks.length} code block(s) in response, creating files...`
    );

    for (const { codeContext } of codeBlocks) {
      try {
        const filePath = codeContext.name;
        const fileContent = codeContext.getContentAsString();

        if (!fileContent || fileContent.trim().length === 0) {
          console.warn(`[Harmony] Skipping empty code block for ${filePath}`);
          continue;
        }

        console.log(
          `[Harmony] Creating file ${filePath} from code block (${fileContent.length} chars)...`
        );

        const createResult = await this.nativeToolsManager.callTool(
          "create_file",
          {
            file_path: filePath,
            content: fileContent,
          }
        );

        if (!createResult.isError) {
          result.createdFiles.push(filePath);
          console.log(
            `[Harmony] Successfully created file ${filePath} from code block`
          );
        } else if (
          createResult.content?.[0]?.text?.includes("already exists")
        ) {
          // File exists, use replace_file
          const replaceResult = await this.nativeToolsManager.callTool(
            "replace_file",
            {
              file_path: filePath,
              content: fileContent,
            }
          );

          if (!replaceResult.isError) {
            result.createdFiles.push(filePath);
            console.log(
              `[Harmony] Successfully updated file ${filePath} from code block`
            );
          } else {
            const errorMsg =
              replaceResult.content?.[0]?.text || "Unknown error";
            result.failedFiles.push({ path: filePath, error: errorMsg });
            console.warn(
              `[Harmony] Failed to update file ${filePath}: ${errorMsg}`
            );
          }
        } else {
          const errorMsg = createResult.content?.[0]?.text || "Unknown error";
          result.failedFiles.push({ path: filePath, error: errorMsg });
          console.warn(
            `[Harmony] Failed to create file ${filePath}: ${errorMsg}`
          );
        }
      } catch (error: any) {
        console.warn(
          `[Harmony] Error creating file ${codeContext.name}:`,
          error
        );
        result.failedFiles.push({
          path: codeContext.name,
          error: error.message || "Unknown error",
        });
      }
    }

    return result;
  }

  /**
   * Check if stage should transition back to chat due to errors
   */
  shouldTransitionToChatOnError(
    executedToolCalls: Array<{
      name: string;
      arguments: Record<string, any>;
      result?: MCPToolResult;
    }>,
    currentStage: string,
    stageStateMachine: any
  ): boolean {
    return stageStateMachine.shouldTransitionToChatOnError(
      currentStage,
      executedToolCalls
    );
  }
}
