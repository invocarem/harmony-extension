import { ConversationContext } from "./conversationContext";
import { ProgressPlanManager } from "../progressPlanManager";
import { WorkflowStage } from "./stageStateMachine";
import {
  FileExtractionResult,
  FileOperationResult,
  VerboseInfo,
  VerboseInfoBuilder,
} from "../utils/verboseInfo";
import { ChatMessage } from "../conversationManager";
import { MCPToolResult } from "../mcpClient";
import { withToString } from "../utils/verboseInfo";

export interface VerboseInfoOptions {
  fileExtractionResult?: FileExtractionResult;
  content?: string;
  reasoning?: string;
  toolCallsForVerbose?: VerboseInfo["toolCalls"];
  executedToolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: MCPToolResult;
  }>;
  fileOperations?: FileOperationResult;
  conversationHistory?: readonly ChatMessage[];
}

/**
 * Centralized builder for verboseInfo across stages
 */
export class VerboseInfoManager {
  constructor(
    private progressPlanManager: ProgressPlanManager,
    private contextManager: import("./conversationContext").ConversationContextManager
  ) {}

  buildVerboseInfo(
    stage: WorkflowStage,
    context: ConversationContext | null,
    options: VerboseInfoOptions = {}
  ): VerboseInfo {
    const {
      fileExtractionResult,
      content,
      reasoning,
      toolCallsForVerbose,
      executedToolCalls,
      fileOperations,
      conversationHistory,
    } = options;

    const mappedToolCalls =
      toolCallsForVerbose ||
      (executedToolCalls || []).map((tc) => ({
        name: tc.name,
        stage,
        success: !tc.result?.isError,
        error: tc.result?.isError
          ? tc.result?.content?.[0]?.text || "Unknown error"
          : undefined,
      }));

    if (stage === "chat") {
      return VerboseInfoBuilder.forChatStage(
        context,
        this.contextManager,
        fileExtractionResult,
        content,
        reasoning,
        mappedToolCalls,
        conversationHistory
      );
    }

    if (stage === "simple") {
      return VerboseInfoBuilder.forSimpleStage(
        context,
        this.contextManager,
        content,
        reasoning,
        mappedToolCalls,
        conversationHistory
      );
    }

    if (stage === "assumptions") {
      return VerboseInfoBuilder.forAssumptionStage(
        context,
        this.contextManager,
        mappedToolCalls,
        conversationHistory
      );
    }

    // Implementation stage
    const info = VerboseInfoBuilder.forImplementationStage(
      context,
      this.contextManager,
      this.progressPlanManager,
      fileOperations,
      mappedToolCalls
    );

    // Preserve dynamic getters via withToString wrapper
    return withToString(info) as VerboseInfo;
  }

  getCurrentVerboseInfo(
    context: ConversationContext | null,
    conversationHistory?: readonly ChatMessage[]
  ): VerboseInfo {
    const stage = context?.currentStage || "chat";
    return this.buildVerboseInfo(stage, context, { conversationHistory });
  }

  /**
   * Merge verboseInfo from a continuation response
   * If continuation has verboseInfo with additional toolCalls, merge them
   * Otherwise, use the provided fallback verboseInfo
   */
  mergeContinuationVerboseInfo(
    continuationVerboseInfo: VerboseInfo | undefined,
    fallbackVerboseInfo: VerboseInfo,
    options?: {
      mergeToolCalls?: boolean;
    }
  ): VerboseInfo {
    if (!continuationVerboseInfo) {
      return fallbackVerboseInfo;
    }

    const mergeToolCalls = options?.mergeToolCalls ?? false;

    if (mergeToolCalls) {
      // Merge tool calls from both verboseInfo objects
      return {
        ...continuationVerboseInfo,
        toolCalls: [
          ...(fallbackVerboseInfo.toolCalls || []),
          ...(continuationVerboseInfo.toolCalls || []),
        ],
      } as VerboseInfo;
    }

    // Just return continuation verboseInfo (may need stage fallback)
    return continuationVerboseInfo;
  }

  /**
   * Build verboseInfo with stage fallback for continuation scenarios
   * Builds fallback verboseInfo and merges with continuation response
   */
  buildForContinuation(
    continuationVerboseInfo: VerboseInfo | undefined,
    stage: WorkflowStage,
    context: ConversationContext | null,
    options: VerboseInfoOptions & { mergeToolCalls?: boolean } = {}
  ): VerboseInfo {
    const { mergeToolCalls, ...verboseOptions } = options;

    const fallbackVerboseInfo = this.buildVerboseInfo(
      stage,
      context,
      verboseOptions
    );

    return this.mergeContinuationVerboseInfo(
      continuationVerboseInfo,
      fallbackVerboseInfo,
      { mergeToolCalls }
    );
  }
}
