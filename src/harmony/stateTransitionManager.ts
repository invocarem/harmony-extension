import { ConversationContext, ConversationContextManager } from "./conversationContext";
import { ChatManager } from "./chatManager";
import { AssumptionsManager } from "./assumptionsManager";
import { StageDetector } from "./stageDetector";
import { WorkflowStage } from "./stageStateMachine";
import { NativeToolsManager } from "../nativeToolManager";
import { ImplementationManager } from "./implementationManager";
import { ChatMessage } from "../conversationManager";
import { logStepInfo } from "../utils/logger";

/**
 * StateTransitionManager
 * Handles all state transitions and stage management logic
 * Extracts complex transition handling from HarmonyClient.callServer
 */
export class StateTransitionManager {
  constructor(
    private contextManager: ConversationContextManager,
    private stageDetector: StageDetector,
    private chatManager: ChatManager,
    private assumptionsManager: AssumptionsManager,
    private implementationManager: ImplementationManager
  ) {}

  /**
   * Initialize or update conversation context on first call
   */
  async initializeConversation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    if (!this.contextManager.hasContext()) {
      this.contextManager.initialize(prompt, 'init');
      const context = this.contextManager.getContext();
      
      if (context && context.currentStage === 'init') {
        console.log(`[Harmony] Initializing conversation: init -> chat`);
        this.contextManager.updateStage('chat', prompt);
      }

      // Detect if we should transition further from chat
      const updatedContext = this.contextManager.getContext();
      if (updatedContext) {
        const detectedStage = this.stageDetector.detectStage(
          prompt,
          conversationHistory,
          updatedContext
        );
        if (detectedStage !== 'chat' && detectedStage !== 'init') {
          console.log(`[Harmony] Stage transition detected at start: chat -> ${detectedStage}`);
          this.contextManager.updateStage(detectedStage, prompt);
        }
      }

      const finalContext = this.contextManager.getContext();
      console.log(`[Harmony] Starting new conversation in stage: ${finalContext?.currentStage || 'chat'}`);

      // Initialize chat manager when entering chat stage
      if (finalContext?.currentStage === 'chat' && !this.chatManager.hasContent()) {
        this.chatManager.initialize();
      }
    }
  }

  /**
   * Check and perform stage transitions if needed
   */
  async checkAndPerformStageTransition(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context) {
      return;
    }

    const previousStage = context.currentStage;
    console.log(
      `[Harmony] Checking stage transition. Current stage: ${previousStage}, Prompt: "${prompt.substring(0, 50)}..."`
    );

    const detectedStage = this.stageDetector.detectStage(
      prompt,
      conversationHistory,
      context
    );

    console.log(
      `[Harmony] State machine detected stage: ${detectedStage} (was: ${previousStage})`
    );

    if (detectedStage !== previousStage) {
      console.log(
        `[Harmony] ✅ STAGE TRANSITION APPROVED: ${previousStage} -> ${detectedStage}`
      );

      // Handle chat -> assumptions transition
      if (previousStage === 'chat' && detectedStage === 'assumptions') {
        await this.handleChatToAssumptionsTransition(
          prompt,
          conversationHistory,
          nativeToolsManager
        );
      }

      // Handle assumptions -> implementation transition
      if (previousStage === 'assumptions' && detectedStage === 'implementation') {
        await this.handleAssumptionsToImplementationTransition(prompt);
      }

      // Verify implementation transition has a plan
      if (detectedStage === 'implementation') {
        await this.validateImplementationTransition();
      }

      // Perform the transition
      this.contextManager.updateStage(detectedStage, prompt);

      const updatedContext = this.contextManager.getContext();
      if (updatedContext?.currentStage === detectedStage) {
        console.log(
          `[Harmony] ✅ Stage successfully updated in context: ${updatedContext.currentStage}`
        );
      } else {
        console.error(
          `[Harmony] ❌ ERROR: Stage update failed! Expected: ${detectedStage}, Got: ${updatedContext?.currentStage}`
        );
      }
    } else {
      console.log(`[Harmony] Stage remains: ${previousStage} (no transition needed)`);
    }
  }

  /**
   * Handle transition from chat to assumptions stage
   */
  private async handleChatToAssumptionsTransition(
    prompt: string,
    conversationHistory?: readonly ChatMessage[],
    nativeToolsManager?: NativeToolsManager
  ): Promise<void> {
    console.log(`[Harmony] Transitioning from chat to assumptions stage`);

    // Initialize assumptions manager
    this.assumptionsManager.initialize();

    // Get aggregated prompt from ChatManager
    let aggregatedPrompt: string | undefined;
    let queries: string[] = [];

    if (this.chatManager.hasContent()) {
      const chatExport = this.chatManager.exportForTransition();
      aggregatedPrompt = chatExport.aggregatedPrompt;
      queries = chatExport.queries;
      console.log(
        `[Harmony] Using aggregated prompt from ChatManager (${queries.length} queries)`
      );
    }

    // Check conversation history to ensure all user queries are captured
    if (conversationHistory && conversationHistory.length > 0) {
      const chatStageUserQueries: string[] = [];
      let inChatStage = true;

      for (const message of conversationHistory) {
        if (message.role === 'user') {
          const content = message.content.trim();
          if (content && !content.match(/^@cmd:/i)) {
            const hasStageTransition = /\b(move\s+to|go\s+to|goto)\s+(assumptions|implementation|chat)\b/i.test(
              content
            );
            if (hasStageTransition && content.toLowerCase().includes('assumptions')) {
              break;
            }
            if (inChatStage) {
              chatStageUserQueries.push(content);
            }
          }
        } else if (message.role === 'assistant') {
          const content = message.content.toLowerCase();
          if (
            content.includes('moving to assumptions') ||
            content.includes('transitioning to assumptions') ||
            content.includes('now in assumptions stage')
          ) {
            inChatStage = false;
          }
        }
      }

      // Use history if it has different/more queries than ChatManager
      const historyHasMore = chatStageUserQueries.length > queries.length;
      const historyHasDifferent = chatStageUserQueries.some((q) => !queries.includes(q));

      if (
        historyHasMore ||
        historyHasDifferent ||
        (!aggregatedPrompt && chatStageUserQueries.length > 0)
      ) {
        if (historyHasMore || historyHasDifferent) {
          console.log(
            `[Harmony] Found ${chatStageUserQueries.length} queries in conversation history vs ${queries.length} in ChatManager. History has ${historyHasMore ? 'more' : 'different'} queries. Using history to ensure all queries are captured.`
          );
        } else {
          console.log(
            `[Harmony] ChatManager had no content, but found ${chatStageUserQueries.length} queries in conversation history. Using history.`
          );
        }

        queries = chatStageUserQueries;

        // Rebuild aggregated prompt from all queries
        if (queries.length === 1) {
          aggregatedPrompt = queries[0];
        } else if (queries.length > 1) {
          aggregatedPrompt = `Please address the following requests:\n\n${queries.join('\n\n')}`;
        }
      }
    }

    if (aggregatedPrompt) {
      // Collect assistant responses from chat stage
      const assistantResponses: Array<{ content: string; reasoning?: string }> = [];
      if (conversationHistory && conversationHistory.length > 0) {
        let inChatStage = true;
        for (const message of conversationHistory) {
          if (message.role === 'user') {
            const content = message.content.trim();
            const hasStageTransition = /\b(move\s+to|go\s+to|goto)\s+(assumptions|implementation|chat)\b/i.test(
              content
            );
            if (hasStageTransition && content.toLowerCase().includes('assumptions')) {
              break;
            }
          } else if (message.role === 'assistant') {
            const assistantContent = message.content.trim();
            if (inChatStage && assistantContent && assistantContent.length > 0) {
              assistantResponses.push({
                content: assistantContent,
                reasoning: message.reasoning,
              });
            }
            const contentLower = assistantContent.toLowerCase();
            if (
              contentLower.includes('moving to assumptions') ||
              contentLower.includes('transitioning to assumptions') ||
              contentLower.includes('now in assumptions stage')
            ) {
              inChatStage = false;
            }
          }
        }
      }

      // Get referred files from ChatManager
      const referredFiles = this.chatManager.getReferredFiles();

      // Generate aggregated_prompt.json
      await this.assumptionsManager.generateAggregatedPromptFile(
        {
          queries: queries,
          assistantResponses: assistantResponses,
          referredFiles: referredFiles,
        },
        conversationHistory,
        nativeToolsManager,
        this.contextManager
      );
    }

    // Clear chat manager after transition
    this.chatManager.clear();
  }

  /**
   * Handle transition from assumptions to implementation stage
   */
  private async handleAssumptionsToImplementationTransition(
    prompt: string
  ): Promise<void> {
    console.log(`[Harmony] Transitioning from assumptions to implementation stage`);

    const context = this.contextManager.getContext();

    // Initialize implementation manager
    const taskId = context?.progressPlan?.taskId;
    if (taskId) {
      this.implementationManager.initialize(taskId);
      console.log(`[Harmony] Initialized ImplementationManager for task: ${taskId}`);
    }

    // Add code snippets from assumptions stage
    if (context?.codeContexts) {
      for (const [fileName, versions] of context.codeContexts.entries()) {
        const activeVersion = versions.find((v) => v.isActive);
        if (
          activeVersion &&
          fileName !== 'aggregated_prompt.json' &&
          fileName !== 'assumption_data.json'
        ) {
          this.assumptionsManager.addCodeSnippet(
            fileName,
            activeVersion.description || `Code context for ${fileName}`
          );
        }
      }
    }

    // Set taskId in AssumptionsManager if plan exists
    if (context?.progressPlan) {
      if (!this.assumptionsManager.getState()) {
        this.assumptionsManager.initialize();
      }
      this.assumptionsManager.setTaskId(context.progressPlan.taskId);
      console.log(
        `[Harmony] Transition: Set taskId in AssumptionsManager: ${context.progressPlan.taskId}`
      );
    } else {
      console.log(`[Harmony] Transition: No progressPlan found in context`);
    }

    // Export assumptions data
    const assumptionsExport = this.assumptionsManager.exportForTransition(
      context?.originalPrompt
    );
    console.log(
      `[Harmony] Transition: Exported assumptions data - has progressPlan: ${!!assumptionsExport.progressPlan}, steps: ${assumptionsExport.progressPlan?.totalSteps || 0}`
    );

    // Set progressPlan in context if created
    if (assumptionsExport.progressPlan && !context?.progressPlan) {
      this.contextManager.setProgressPlan(assumptionsExport.progressPlan);
    }

    // Generate assumption_data.json
    await this.implementationManager.generateAssumptionDataFile(
      assumptionsExport,
      undefined, // nativeToolsManager not available here
      this.contextManager
    );

    // Clear assumptions manager
    this.assumptionsManager.clear();
  }

  /**
   * Validate implementation transition has a plan
   */
  private async validateImplementationTransition(): Promise<void> {
    const currentContext = this.contextManager.getContext();
    if (!currentContext?.progressPlan) {
      console.warn(
        `[Harmony] ⚠️ Attempting to transition to implementation stage without a ProgressPlan.`
      );

      // Try to get plan from assumptions manager as fallback
      const assumptionsExport = this.assumptionsManager.exportForTransition();
      if (assumptionsExport.progressPlan) {
        console.log(
          `[Harmony] Found plan in assumptions manager, setting it before transition`
        );
        this.contextManager.setProgressPlan(assumptionsExport.progressPlan);
      } else {
        console.error(
          `[Harmony] ❌ Cannot transition to implementation stage: No ProgressPlan found.`
        );
      }
    } else {
      console.log(
        `[Harmony] ✅ ProgressPlan found - proceeding with transition to implementation stage`
      );
    }
  }

  /**
   * Handle continuation stage check
   */
  async handleContinuation(
    prompt: string,
    conversationHistory?: readonly ChatMessage[]
  ): Promise<void> {
    const context = this.contextManager.getContext();
    if (!context) {
      return;
    }

    const detectedStage = this.stageDetector.detectStage(
      prompt,
      conversationHistory,
      context
    );
    const previousStage = context.currentStage;

    if (detectedStage !== previousStage) {
      console.log(
        `[Harmony] Stage transition: ${previousStage} -> ${detectedStage}`
      );
      this.contextManager.updateStage(detectedStage, prompt);
    }
  }

  /**
   * Log current stage info
   */
  logCurrentStageInfo(isContinuation: boolean): void {
    const context = this.contextManager.getContext();
    if (context && isContinuation) {
      logStepInfo(context.currentStep, context.maxSteps, context.originalPrompt);
    }
  }

  /**
   * Check if max steps exceeded
   */
  isMaxStepsExceeded(): boolean {
    const context = this.contextManager.getContext();
    return context ? context.currentStep > context.maxSteps : false;
  }

  /**
   * Get current stage
   */
  getCurrentStage(): WorkflowStage {
    const context = this.contextManager.getContext();
    return context?.currentStage || 'chat';
  }
}
