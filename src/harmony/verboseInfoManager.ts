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
  constructor(private progressPlanManager: ProgressPlanManager) {}

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
        fileExtractionResult,
        content,
        reasoning,
        mappedToolCalls,
        conversationHistory
      );
    }

    if (stage === "assumptions") {
      return VerboseInfoBuilder.forAssumptionStage(
        context,
        mappedToolCalls,
        conversationHistory
      );
    }

    // Implementation stage
    const info = VerboseInfoBuilder.forImplementationStage(
      context,
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
}
