import { LlamaConfig } from "../config";
import { MCPManager } from "../mcpManager";
import { RulesManager, Rule } from "../rulesManager";
import { NativeToolsManager } from "../nativeToolManager";
import { ChatMessage } from "../conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";

/**
 * Builds prompts with tools, rules, stage instructions, and continuation context
 */
export class PromptBuilder {
  constructor(
    private config: LlamaConfig,
    private stageStateMachine: StageStateMachine,
    private mcpManager?: MCPManager,
    private rulesManager?: RulesManager,
    private nativeToolsManager?: NativeToolsManager
  ) {}

  /**
   * Build the final prompt with all context
   */
  async buildPrompt(
    prompt: string,
    currentStage: WorkflowStage,
    conversationContext: ConversationContext | null,
    isContinuation: boolean,
    conversationHistory?: readonly ChatMessage[],
    templateName?: string,
    applyTemplate?: (templateName: string, context: any, history?: readonly ChatMessage[]) => Promise<string>
  ): Promise<string> {
    // Build tools context
    const toolsContext = this.buildToolsContext(currentStage);
    
    // Build rules context
    const rulesContext = this.buildRulesContext(prompt, conversationHistory);
    
    // Build stage instructions (with code snippets ready flag for implementation stage)
    let stageInstructions = this.stageStateMachine.getInstructions(currentStage);
    
    // If in implementation stage, add progressPlan context if available
    if (currentStage === 'implementation' && conversationContext) {
      // Add progressPlan guidance if plan exists
      if (conversationContext.progressPlan) {
        const plan = conversationContext.progressPlan;
        const currentStep = plan.steps.find(step => 
          step.status === 'pending' || step.status === 'in_progress'
        );
        
        if (currentStep) {
          // Show current step to focus on
          stageInstructions += `\n\n**PROGRESS PLAN - CURRENT STEP**:\n`;
          stageInstructions += `You are working on Step ${currentStep.stepNumber}/${plan.totalSteps}: ${currentStep.goal}\n`;
          if (currentStep.description) {
            stageInstructions += `Description: ${currentStep.description}\n`;
          }
          
          // Show remaining steps for context
          const remainingSteps = plan.steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
          if (remainingSteps.length > 1) {
            stageInstructions += `\n**Remaining Steps**:\n`;
            remainingSteps.forEach(step => {
              if (step.stepNumber !== currentStep.stepNumber) {
                stageInstructions += `- Step ${step.stepNumber}: ${step.goal}\n`;
              }
            });
          }
          
          stageInstructions += `\n**FOCUS**: Complete the current step (${currentStep.goal}) by creating the necessary files. After completing this step, you will move to the next step automatically.`;
        } else if (plan.completedAt) {
          stageInstructions += `\n\n**PROGRESS PLAN**: All steps completed! ✅`;
        } else {
          // Plan exists but no current step (all completed or unknown state)
          stageInstructions += `\n\n**PROGRESS PLAN**: Plan exists with ${plan.totalSteps} step(s).`;
        }
      }
      
      // Add code contexts instruction if available
      const codeContexts = conversationContext.codeContexts?.filter(cc => cc.waitForCreate) || [];
      if (codeContexts.length > 0) {
        const fileList = codeContexts.map(cc => cc.name).join(', ');
        stageInstructions += `\n\n**CODE SNIPPETS READY**: The following file(s) have code ready for creation: ${fileList}. Extract the code from conversation history and create these files immediately using create_file. Do NOT restate the problem or ask questions - just create the files.`;
      }
    }
    
    // Build continuation context
    const continuationContext = this.buildContinuationContext(
      conversationContext,
      currentStage,
      isContinuation
    );

    // Apply template if specified
    if (templateName && applyTemplate) {
      const templateContext = {
        prompt: prompt + toolsContext + continuationContext,
        rules: rulesContext || undefined,
        tools: this.getAllowedTools(currentStage),
        stage: currentStage,
        stageInstructions: stageInstructions,
      };
      return await applyTemplate(templateName, templateContext);
    }

    // Build plain prompt
    return stageInstructions + "\n\n" + rulesContext + continuationContext + prompt + toolsContext;
  }

  /**
   * Build tools context string
   */
  private buildToolsContext(currentStage: WorkflowStage): string {
    const allTools: Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> = [];
    
    if (this.mcpManager) {
      const mcpTools = this.mcpManager.getAllTools();
      mcpTools.forEach((tool) => {
        allTools.push({ ...tool, type: "mcp" });
      });
    }
    
    if (this.nativeToolsManager) {
      const nativeTools = this.nativeToolsManager.getAvailableTools();
      nativeTools.forEach((tool) => {
        allTools.push({ ...tool, type: "native" });
      });
    }
    
    // Filter tools based on current stage
    const allowedTools = this.stageStateMachine.getAllowedTools(allTools, currentStage);
    
    if (allowedTools.length === 0) {
      return "";
    }

    let toolsContext = "\n\nAvailable Tools:\n";
    allowedTools.forEach((tool) => {
      const toolType = tool.type === "native" ? "[Built-in] " : "[MCP] ";
      toolsContext += `- ${toolType}${tool.name}: ${tool.description || "No description"}\n`;
      if (tool.inputSchema.properties) {
        const props = Object.entries(tool.inputSchema.properties)
          .map(([key, value]: [string, any]) => {
            const desc = value.description ? ` - ${value.description}` : "";
            return `  ${key}: ${value.type || "any"}${desc}`;
          })
          .join("\n");
        if (props) {
          toolsContext += `  Parameters:\n${props}\n`;
        }
      }
    });
    toolsContext += "\nTo call a tool, use the format: <tool_call name=\"tool_name\" args=\"{...}\" />\n";
    
    // Add stage-specific tool restrictions warning
    if (currentStage === 'chat' || currentStage === 'assumptions') {
      const restrictedTools = allTools.filter(t => !allowedTools.includes(t));
      if (restrictedTools.length > 0) {
        toolsContext += `\n⚠️ NOTE: File modification tools (${restrictedTools.map(t => t.name).join(', ')}) are NOT available in ${currentStage} stage. `;
        if (currentStage === 'assumptions') {
          toolsContext += "Please provide code snippets instead.\n";
        } else {
          toolsContext += "Please continue the conversation to understand the requirements.\n";
        }
      }
    }

    return toolsContext;
  }

  /**
   * Build rules context string
   */
  private buildRulesContext(prompt: string, conversationHistory?: readonly ChatMessage[]): string {
    if (!this.rulesManager) {
      return "";
    }

    let applicableRules: Rule[] = [];
    
    if (conversationHistory && conversationHistory.length > 0) {
      applicableRules = this.rulesManager.getApplicableRulesFromHistory(conversationHistory);
      console.log(`[Rules] Checking rules against conversation history (${conversationHistory.length} messages)`);
    }
    
    // Also check current prompt for any new rules that might match
    const currentPromptRules = this.rulesManager.getApplicableRules(prompt);
    
    // Combine and deduplicate rules
    const allRules = new Map<string, Rule>();
    applicableRules.forEach(rule => allRules.set(rule.id, rule));
    currentPromptRules.forEach(rule => allRules.set(rule.id, rule));
    
    applicableRules = Array.from(allRules.values());
    
    if (applicableRules.length > 0) {
      console.log(`[Rules] Found ${applicableRules.length} applicable rule(s) (from history + current prompt)`);
      return this.rulesManager.formatRulesForPrompt(applicableRules);
    }
    
    return "";
  }

  /**
   * Build continuation context string
   */
  private buildContinuationContext(
    conversationContext: ConversationContext | null,
    currentStage: WorkflowStage,
    isContinuation: boolean
  ): string {
    if (!isContinuation || !conversationContext) {
      return "";
    }

    const previousSteps = conversationContext.steps;
    if (previousSteps.length === 0) {
      return "";
    }

    let continuationContext = "\n\n## CONTINUATION - Previous Steps:\n";
    previousSteps.forEach((step, index) => {
      continuationContext += `\nStep ${index + 1} (${step.stage} stage):\n`;
      if (step.reasoning) {
        continuationContext += `Reasoning: ${step.reasoning.substring(0, 200)}...\n`;
      }
      step.toolCalls.forEach(toolCall => {
        continuationContext += `- Called ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}\n`;
      });
    });
    
    continuationContext += `\nOriginal task: "${conversationContext.originalPrompt}"\n`;
    continuationContext += `Current step: ${conversationContext.currentStep} of ${conversationContext.maxSteps}\n`;
    continuationContext += `Current stage: ${currentStage}\n`;
    continuationContext += `\nNow continue with the NEXT step to complete the task:\n`;

    return continuationContext;
  }

  /**
   * Get allowed tools for a stage (for template context)
   */
  private getAllowedTools(currentStage: WorkflowStage): Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> {
    const allTools: Array<{ name: string; description?: string; inputSchema: any; type: "mcp" | "native" }> = [];
    
    if (this.mcpManager) {
      const mcpTools = this.mcpManager.getAllTools();
      mcpTools.forEach((tool) => {
        allTools.push({ ...tool, type: "mcp" });
      });
    }
    
    if (this.nativeToolsManager) {
      const nativeTools = this.nativeToolsManager.getAvailableTools();
      nativeTools.forEach((tool) => {
        allTools.push({ ...tool, type: "native" });
      });
    }
    
    return this.stageStateMachine.getAllowedTools(allTools, currentStage);
  }
}

