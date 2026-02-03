import { LlamaConfig } from "../config";
import { MCPManager } from "../mcpManager";
import { RulesManager, Rule } from "../rulesManager";
import { NativeToolsManager } from "../nativeToolManager";
import { ChatMessage } from "../conversationManager";
import { StageStateMachine, WorkflowStage } from "./stageStateMachine";
import { ConversationContext } from "./conversationContext";
import { CodeContext } from "./codeContext";

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
    applyTemplate?: (templateName: string, context: any, history?: readonly ChatMessage[]) => Promise<string>,
    isFirstPrinciplesMode?: boolean
  ): Promise<string> {
    // Build tools context
    const toolsContext = this.buildToolsContext(currentStage);
    
    // Build rules context
    const rulesContext = this.buildRulesContext(prompt, conversationHistory);
    
    // Build stage instructions (with code snippets ready flag for implementation stage)
    let stageInstructions = this.stageStateMachine.getInstructions(currentStage, this.config.harmonyMode);
    
    // If in assumptions stage, add referred files from chat stage so AI doesn't re-detect them
    if (currentStage === 'assumptions' && conversationContext) {
      const referredFiles = conversationContext.referredFiles;
      if (referredFiles && referredFiles.length > 0) {
        const fileList = referredFiles
          .map(f => `- ${f.file}${f.description ? ` (${f.description})` : ''}`)
          .join('\n');
        stageInstructions += `\n\n**IDENTIFIED FILES**:\n${fileList}\n\nUse read_file on these files directly.`;
      }
    }
    
    // If in implementation stage, add progressPlan context if available
    if (currentStage === 'implementation' && conversationContext) {
      // Add referred files if available
      const referredFiles = conversationContext.referredFiles;
      if (referredFiles && referredFiles.length > 0) {
        const fileList = referredFiles
          .map(f => `- ${f.file}${f.description ? ` (${f.description})` : ''}`)
          .join('\n');
        stageInstructions += `\n\n**IDENTIFIED FILES**:\n${fileList}\n\nUse read_file on these files directly.`;
      }
      
      // Add progressPlan guidance if plan exists
      if (conversationContext.progressPlan) {
        const plan = conversationContext.progressPlan;
        const currentStep = plan.steps.find(step => 
          step.status === 'pending' || step.status === 'in_progress'
        );
        
        if (currentStep) {
          // Show current step to focus on
          stageInstructions += `\n\n**PROGRESS PLAN - CURRENT STEP**:\n`;
          stageInstructions += `You are working on Step ${currentStep.stepNumber}/${plan.totalSteps}: ${currentStep.description}\n`;
          
          // Show remaining steps for context
          const remainingSteps = plan.steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
          if (remainingSteps.length > 1) {
            stageInstructions += `\n**Remaining Steps**:\n`;
            remainingSteps.forEach(step => {
              if (step.stepNumber !== currentStep.stepNumber) {
                stageInstructions += `- Step ${step.stepNumber}: ${step.description}\n`;
              }
            });
          }
          
          // Determine the appropriate action based on step requirements
          // Priority: explicit tools array > keyword analysis
          const fileCreationTools = ['create_file', 'replace_file', 'write_file', 'update_file'];
          const needsFileCreation = currentStep.tools?.some(tool => fileCreationTools.includes(tool)) || false;
          const needsCommandExecution = currentStep.tools?.includes('exec_terminal') || false;
          
          // Check step goal/description for hints about what action is needed
          // Use more specific patterns to avoid false positives
          const stepText = currentStep.description.toLowerCase();
          
          // More specific execution patterns - look for command execution context
          const mentionsExecution = /\b(execute|run|command|terminal).*(?:python|npm|node|bash|sh|calc\.py|\.py\s|\.js\s|\.sh\s)/i.test(stepText) ||
                                   /\b(execute|run)\s+(?:the\s+)?(?:script|command|program|calc)/i.test(stepText) ||
                                   (/\b(python|npm|node|bash|sh)\s+/.test(stepText) && /\b(execute|run|command)/i.test(stepText));
          
          // More specific file creation patterns - avoid matching "create script to execute"
          const mentionsFileCreation = /\b(create|write|generate)\s+(?:a\s+)?(?:file|code|content|\.py|\.js|\.ts|\.md|\.txt)/i.test(stepText) ||
                                       /\b(create|write|generate)\s+(?:the|new|an?)\s+(?:file|code)/i.test(stepText);
          
          let actionInstruction: string;
          
          // Priority: explicit tools array takes precedence
          if (needsCommandExecution) {
            actionInstruction = 'by making a tool call to exec_terminal with the command. DO NOT describe the result - actually call the tool. Your response MUST include: <tool_call name="exec_terminal" args=\'{"command": "..."}\' />';
          } else if (needsFileCreation) {
            actionInstruction = 'by creating or updating the necessary files using create_file or replace_file tool calls';
          } else if (mentionsExecution && !mentionsFileCreation) {
            // Only use keyword-based detection if tools array is not set and execution is clearly indicated
            actionInstruction = 'by making a tool call to exec_terminal with the command. DO NOT describe the result - actually call the tool. Your response MUST include: <tool_call name="exec_terminal" args=\'{"command": "..."}\' />';
          } else if (mentionsFileCreation && !mentionsExecution) {
            // Only use keyword-based detection if tools array is not set and file creation is clearly indicated
            actionInstruction = 'by creating or updating the necessary files using create_file or replace_file tool calls';
          } else {
            // Generic instruction that works for both - use when ambiguous
            actionInstruction = 'by making the appropriate tool call (use create_file/replace_file for files, exec_terminal for commands). DO NOT just describe actions - actually make the tool call';
          }
          
          stageInstructions += `\n**FOCUS**: Complete the current step: ${currentStep.description} ${actionInstruction}. After completing this step, you will move to the next step automatically.`;

          // Pre-inject previous-step file content for step 2+ (preserves feature A when adding feature B)
          if (currentStep.stepNumber > 1) {
            const filesFromPreviousSteps: string[] = [];
            if (conversationContext.implementationStepContexts) {
              for (const [fileName, contexts] of conversationContext.implementationStepContexts) {
                const hasPrevious = contexts.some(
                  (cc) => (cc.stepNumber ?? 0) < currentStep.stepNumber
                );
                if (hasPrevious) filesFromPreviousSteps.push(fileName);
              }
            }

            // CRITICAL: Warn about ALL files from previous steps - prevent re-creation
            if (filesFromPreviousSteps.length > 0) {
              stageInstructions += `\n\n**⚠️ CRITICAL - FILES ALREADY CREATED IN PREVIOUS STEPS**:\n`;
              stageInstructions += `The following file(s) ALREADY EXIST from previous steps:\n`;
              filesFromPreviousSteps.forEach(file => {
                stageInstructions += `- ${file}\n`;
              });
              stageInstructions += `\n**DO NOT use create_file on these files** - use edit_file or replace_file instead to modify them.\n`;
              stageInstructions += `If you need to change these files:\n`;
              stageInstructions += `1. Use edit_file for small, localized changes\n`;
              stageInstructions += `2. Use replace_file (with full content below) for larger changes\n`;
              stageInstructions += `3. NEVER use create_file - the file already exists\n`;
            }

            // Inject file content ONLY when step requires file modification
            if (needsFileCreation) {
              // Inject ALL files from previous steps when step modifies files (relaxed matching)
              const stepText = currentStep.description.toLowerCase();
              const filesToInject = filesFromPreviousSteps.filter((fileName) => {
                const lower = fileName.toLowerCase();
                const baseName = fileName.split("/").pop()?.toLowerCase() || lower;
                return stepText.includes(lower) || stepText.includes(baseName);
              });
              // Fallback: if only one file from previous steps, inject it (common: both steps touch same file)
              const filesToInjectFinal =
                filesToInject.length > 0
                  ? filesToInject
                  : filesFromPreviousSteps.length === 1
                    ? filesFromPreviousSteps
                    : [];

              if (filesToInjectFinal.length > 0) {
                stageInstructions += `\n\n**FILES FROM PREVIOUS STEPS - CONTENT FOR MODIFICATION**:\n`;
                stageInstructions += `The following file(s) need to be modified. Use replace_file to include the FULL content below PLUS your new additions. Outputting only your new code will OVERWRITE and LOSE the existing code.\n`;

                for (const fileName of filesToInjectFinal) {
                  let content: string | null = null;
                  if (conversationContext.implementationStepContexts) {
                    const contexts = conversationContext.implementationStepContexts.get(fileName);
                    if (contexts) {
                      const previousSteps = contexts.filter(
                        (cc) => (cc.stepNumber ?? 0) < currentStep.stepNumber
                      );
                      if (previousSteps.length > 0) {
                        const latest = previousSteps.reduce((max, cc) =>
                          (cc.stepNumber ?? 0) > (max.stepNumber ?? 0) ? cc : max
                        );
                        content = latest.getContentAsString();
                      }
                    }
                  }
                  // Fallback: read from disk if not in implementationStepContexts
                  if ((!content || content.trim().length === 0) && this.nativeToolsManager) {
                    try {
                      const readResult = await this.nativeToolsManager.callTool("read_file", {
                        file_path: fileName,
                      });
                      if (!readResult?.isError && readResult?.content?.[0]?.text) {
                        content = readResult.content[0].text;
                      }
                    } catch {
                      // Ignore read errors
                    }
                  }
                  if (content && content.trim().length > 0) {
                    stageInstructions += `\n### ${fileName} (MUST include this full content + your additions):\n\`\`\`\n${content}\n\`\`\`\n`;
                  }
                }
              }
            }
          }
        } else if (plan.completedAt) {
          stageInstructions += `\n\n**PROGRESS PLAN**: All steps completed! ✅`;
        } else {
          // Plan exists but no current step (all completed or unknown state)
          stageInstructions += `\n\n**PROGRESS PLAN**: Plan exists with ${plan.totalSteps} step(s).`;
        }
      }
      
      // Add code contexts instruction if available
      const codeContexts: CodeContext[] = [];
      if (conversationContext.codeContexts) {
        for (const versions of conversationContext.codeContexts.values()) {
          const active = versions.find(cc => cc.waitForCreate && cc.isActive);
          if (active) {
            codeContexts.push(active);
          }
        }
      }
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
      const clarityLevel = this.config.clarityLevel ?? 2; // Default to 2 (full)
      const templateContext = {
        prompt: prompt + toolsContext + continuationContext,
        rules: rulesContext || undefined,
        tools: this.getAllowedTools(currentStage),
        stage: currentStage,
        stageInstructions: stageInstructions,
        // First principles rules only apply in chat stage
        firstPrinciplesRules: (currentStage === 'chat' && isFirstPrinciplesMode) ? this.getFirstPrinciplesRules() : undefined,
        // Clarity assessment criteria only apply in chat stage
        clarityAssessmentCriteria: (currentStage === 'chat') ? this.getClarityAssessmentCriteria(clarityLevel) : undefined,
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

  /**
   * Get first principles thinking rules/instructions
   */
  private getFirstPrinciplesRules(): string {
    return `
## First Principles Thinking Mode

**Your Enhanced Process:**
When restating the user's problem, use first principles thinking to ask fundamental questions that strip away assumptions and reveal core truths.

**Instead of simply restating:**
1. **Ask 6-8 short, concrete questions** that challenge assumptions and isolate fundamentals
2. **Each question should probe a fundamental aspect** of the problem
3. **After user answers**, synthesize the core problem statement

**Question Guidelines:**
- Do NOT ask what the user "thinks" about solutions or preferences
- Do NOT ask for justification or rationalization  
- Focus on fundamentals: "What must be true?", "Which assumptions are automatic?", "What's the actual constraint?"
- Each question should require a one-word or short-phrase answer
- Examples of good questions:
  - "What must be true for this to work?"
  - "Which assumptions are we making automatically?"
  - "Remove everything non-essential, what remains?"
  - "What is the absolute minimum required?"
  - "What are we taking for granted?"
  - "What's the real constraint here?"

**After Question Sequence:**
Provide a **restated problem statement** based on first principles, covering:
- **Core Requirements**: What absolutely must be true (stripped of assumptions)
- **Real Constraints**: Actual limitations vs. perceived ones
- **Essential Elements**: The irreducible components needed
- **Clarifications Needed**: Any remaining ambiguities to resolve

The restatement must be direct and based on fundamentals, not surface-level interpretations.

**Then Continue:**
After restating with first principles, proceed with normal chat stage workflow:
- Ask any remaining clarifying questions
- Use read-only tools to understand codebase
- Confirm understanding with user

**Begin immediately with your first fundamental question.**
`;
  }

  /**
   * Get clarity assessment criteria based on clarity level
   * @param clarityLevel 0=minimal, 1=user friendly, 2=full (default)
   */
  private getClarityAssessmentCriteria(clarityLevel: number = 2): string | undefined {
    if (clarityLevel === 0) {
      // Level 0: Minimal - ask only if request is genuinely unclear
      return `
**CLARITY ASSESSMENT CRITERIA**:
Ask questions ONLY when:
- The request is genuinely unclear or ambiguous
- You cannot understand what the user wants without clarification

Keep questions minimal and only ask when absolutely necessary.
`;
    } else if (clarityLevel === 1) {
      // Level 1: User friendly - do not ask about edge cases or constraints
      return `
**CLARITY ASSESSMENT CRITERIA**:
Ask questions ONLY when:
- The request contains ambiguous terms or vague requirements
- The scope is unclear or potentially too broad
- Context from the codebase is needed but unavailable

DO NOT ask about:
- Edge cases or special scenarios
- Constraints or limitations
- Detailed implementation specifics

Focus on understanding the core request without probing for edge cases.
`;
    } else {
      // Level 2: Full criteria (default) - current detailed version
      return `
**CLARITY ASSESSMENT CRITERIA**:
Ask questions ONLY when:
- The request contains ambiguous terms or vague requirements
- Edge cases or constraints are not specified
- The scope is unclear or potentially too broad
- Context from the codebase is needed but unavailable
`;
    }
  }
}

