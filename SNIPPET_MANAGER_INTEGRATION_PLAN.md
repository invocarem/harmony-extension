# SnippetManager Integration Plan

## Overview
This plan outlines how to integrate SnippetManager into the workflow, covering:
1. **Chat Stage**: Extract code/files and prepare for snippet stage
2. **Snippet Stage Entry**: Initialize SnippetManager with requirements
3. **Snippet Stage Processing**: Track CodeContexts and completion
4. **Continuation Logic**: Use SnippetManager for completion checks

---

## Phase 1: Chat Stage - Initialize and Track Requirements

### 1.1 Initialize SnippetManager (Lazy)

**Location**: `src/harmony/stageHandlers.ts` - `ChatStageHandler`

**Action**: Create SnippetManager instance when first requirement is detected (lazy initialization).

**Implementation**:
```typescript
class ChatStageHandler implements StageHandler {
  private snippetManager?: SnippetManager;
  
  // Lazy initialization
  private getOrCreateSnippetManager(contextManager: ConversationContextManager): SnippetManager {
    if (!this.snippetManager) {
      this.snippetManager = new SnippetManager(contextManager);
      console.log(`[ChatStageHandler] Created SnippetManager for requirement tracking`);
    }
    return this.snippetManager;
  }
}
```

### 1.2 Track Requirements Incrementally

**Location**: `src/harmony/stageHandlers.ts` - `ChatStageHandler.handlePostProcessing()`

**Action**: Analyze each user message to identify requirements and update SnippetManager incrementally.

**Implementation**:
```typescript
async handlePostProcessing(
  // ... existing parameters
  contextManager: ConversationContextManager,
  conversationHistory?: readonly ChatMessage[]
): Promise<void> {
  // ... existing code ...
  
  // NEW: Track requirements from conversation
  if (conversationHistory && contextManager) {
    const userMessages = conversationHistory.filter(m => m.role === "user");
    const lastUserMessage = userMessages[userMessages.length - 1];
    
    if (lastUserMessage) {
      const snippetManager = this.getOrCreateSnippetManager(contextManager);
      
      // Check if this message contains new requirements
      const newRequirements = snippetManager.parseRequirements(lastUserMessage.content);
      
      // Add new requirements incrementally (avoid duplicates)
      for (const req of newRequirements) {
        const existing = snippetManager.getRequirements().find(
          r => r.type === req.type && r.targetFile === req.targetFile
        );
        if (!existing) {
          // Add requirement (but don't create CodeContexts yet - wait for snippet stage)
          snippetManager.addRequirement(req);
        }
      }
    }
  }
}
```

### 1.3 Store read_file Results as Reference CodeContexts

**Location**: `src/harmony/stageHandlers.ts` - `ChatStageHandler.handlePostProcessing()`

**Action**: When `read_file` tool is executed successfully in chat stage:
- Extract file content from tool result
- Create **reference CodeContext** (type: `REFERENCE`) with file content
- Store it so snippet stage can use it without re-reading

**Implementation**:
```typescript
// In ChatStageHandler.handlePostProcessing()
async handlePostProcessing(
  // ... existing parameters
  executedToolCalls: Array<{ name: string; arguments: Record<string, any>; result?: any }> | undefined,
  contextManager: ConversationContextManager,
  // ...
): Promise<void> {
  // ... existing code ...
  
  // NEW: Store read_file results as reference CodeContexts
  if (executedToolCalls && contextManager) {
    for (const toolCall of executedToolCalls) {
      if (toolCall.name === "read_file" && toolCall.result && !toolCall.result.isError) {
        const filePath = toolCall.arguments?.file_path || toolCall.arguments?.filePath;
        const fileContent = toolCall.result.content?.[0]?.text;
        
        if (filePath && fileContent) {
          // Check if reference context already exists (avoid duplicates)
          const existing = contextManager.getActiveCodeContext(filePath);
          if (!existing || existing.type !== CodeContextType.REFERENCE) {
            // Create reference CodeContext with file content
            const contentLines = fileContent.split("\n");
            const refContext = new CodeContext(
              filePath,
              contentLines,
              false, // waitForCreate: false (reference only)
              "v1",
              Date.now(),
              `File read in chat stage`,
              undefined,
              true, // isActive
              undefined,
              CodeContextType.REFERENCE // type: REFERENCE (doesn't count toward completion)
            );
            contextManager.addCodeContext(refContext);
            console.log(
              `[ChatStageHandler] Stored read_file result as reference context: ${filePath}`
            );
          }
        }
      }
    }
  }
}
```

### 1.4 Extract Code Blocks from User Messages

**Location**: `src/harmony/stageHandlers.ts` - `ChatStageHandler.handlePostProcessing()`

**Action**: When user provides code blocks in chat stage:
- Extract code blocks from user messages
- Create **reference CodeContexts** (type: `REFERENCE`)
- Store them for use in snippet stage

**Implementation**:
```typescript
// In ChatStageHandler.handlePostProcessing()
async handlePostProcessing(
  // ... existing parameters
  contextManager: ConversationContextManager,
  // ...
): Promise<void> {
  // ... existing code ...
  
  // NEW: Extract code blocks from user messages and create reference contexts
  if (conversationHistory) {
    const userMessages = conversationHistory.filter(m => m.role === "user");
    for (const userMsg of userMessages) {
      const codeBlocks = this.extractCodeBlocks(userMsg.content);
      for (const codeBlock of codeBlocks) {
        const codeContext = CodeContext.fromCodeBlock(codeBlock);
        if (codeContext) {
          // Mark as REFERENCE (doesn't count toward completion)
          codeContext.type = CodeContextType.REFERENCE;
          codeContext.waitForCreate = false;
          contextManager.addCodeContext(codeContext, userMsg.content);
        }
      }
    }
  }
}
```

### 1.2 Identify Potential Requirements (Optional)

**Location**: `src/harmony/stageHandlers.ts` - `ChatStageHandler.handlePostProcessing()`

**Action**: Analyze conversation to identify potential snippet stage requirements:
- Bug fix requests
- Feature addition requests
- Questions that need answers

**Note**: This is optional - requirements can also be identified when entering snippet stage.

---

## Phase 2: Snippet Stage Entry - Initialize SnippetManager

### 2.1 Create SnippetManager Instance

**Location**: `src/harmonyClient.ts` or `src/harmony/stageHandlers.ts`

**Action**: Create SnippetManager instance when entering snippet stage.

**Implementation**:
```typescript
// In HarmonyClient or StageHandlerRegistry
private snippetManager?: SnippetManager;

// Initialize when entering snippet stage
if (currentStage === "snippet" && !this.snippetManager) {
  this.snippetManager = new SnippetManager(this.contextManager);
}
```

### 2.2 Activate SnippetManager for Snippet Stage

**Location**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler.handlePreProcessing()`

**Action**: When entering snippet stage, use existing SnippetManager from chat stage (or create if needed) and create task CodeContexts.

**Implementation**:
```typescript
// In SnippetStageHandler.handlePreProcessing()
async handlePreProcessing(
  context: ConversationContext | null,
  prompt: string,
  // ... other params
  contextManager?: ConversationContextManager,
  // ...
): Promise<{ shouldSkipLLM: boolean; response?: any }> {
  // ... existing code ...
  
  // NEW: Get or create SnippetManager (may already exist from chat stage)
  if (contextManager) {
    // Try to get from chat stage handler first (if available)
    // Otherwise create new one
    if (!this.snippetManager) {
      this.snippetManager = new SnippetManager(contextManager);
    }
    
    // If SnippetManager was created in chat stage, it already has requirements
    // Otherwise, initialize from current prompt
    if (!this.snippetManager.hasRequirements()) {
      this.snippetManager.initializeFromPrompt(prompt);
    } else {
      // Requirements already exist from chat stage
      // Create task CodeContexts for existing requirements
      this.snippetManager.createTaskCodeContextsFromRequirements();
    }
    
    // Reference CodeContexts from chat stage are already available
    const refContexts = contextManager.getReferenceCodeContexts();
    console.log(`[SnippetManager] Found ${refContexts.length} reference context(s) from chat stage`);
  }
  
  return { shouldSkipLLM: false };
}
```

### 2.3 Store SnippetManager Reference

**Location**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler`

**Action**: Store SnippetManager as instance variable.

**Implementation**:
```typescript
class SnippetStageHandler implements StageHandler {
  private snippetManager?: SnippetManager;
  
  // ... rest of class
}
```

---

## Phase 3: Snippet Stage Processing - Extract and Track CodeContexts

### 3.1 Check for Available File References Before read_file

**Location**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler.filterToolCalls()` (if exists) or prompt building

**Action**: Before allowing read_file in snippet stage, check if file is already available as reference context.

**Implementation**:
```typescript
// In SnippetStageHandler (add filterToolCalls method or enhance prompt)
async filterToolCalls(
  toolCalls: MCPToolCall[],
  context: ConversationContext | null,
  // ... other params
  contextManager?: ConversationContextManager
): Promise<{
  filtered: MCPToolCall[];
  blocked: MCPToolCall[];
  blockedMessage?: string;
}> {
  const filtered: MCPToolCall[] = [];
  const blocked: MCPToolCall[] = [];
  
  if (this.snippetManager && contextManager) {
    for (const toolCall of toolCalls) {
      if (toolCall.name === "read_file") {
        const filePath = toolCall.arguments?.file_path || toolCall.arguments?.filePath;
        if (filePath) {
          // Check if file is already available as reference
          const refContext = this.snippetManager.getFileReference(filePath);
          if (refContext) {
            // File already read in chat stage - block read_file, inform LLM
            blocked.push(toolCall);
            console.log(
              `[SnippetStageHandler] Blocking read_file for ${filePath} - already available as reference context`
            );
          } else {
            // File not read yet - allow read_file
            filtered.push(toolCall);
          }
        }
      } else {
        // Allow other tool calls
        filtered.push(toolCall);
      }
    }
  } else {
    // No SnippetManager - allow all tool calls
    filtered.push(...toolCalls);
  }
  
  const blockedFiles = blocked
    .filter((tc) => tc.name === "read_file")
    .map((tc) => tc.arguments?.file_path || tc.arguments?.filePath)
    .filter(Boolean);
  const blockedMessage =
    blockedFiles.length > 0
      ? `Note: The following file(s) are already available from chat stage: ${blockedFiles.join(", ")}. You can reference them directly without reading again.`
      : undefined;
  
  return { filtered, blocked, blockedMessage };
}
```

### 3.2 Extract CodeContexts from LLM Response

**Location**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler.handlePostProcessing()`

**Action**: After LLM response, extract CodeContexts and update SnippetManager.

**Implementation**:
```typescript
// In SnippetStageHandler.handlePostProcessing()
async handlePostProcessing(
  context: ConversationContext | null,
  content: string,
  parsed: HarmonyParseResult,
  // ... other params
  contextManager: ConversationContextManager,
  // ...
): Promise<void> {
  // ... existing code ...
  
  // NEW: Extract CodeContexts from response
  if (this.snippetManager && context) {
    const stepNumber = context.continueStep;
    this.snippetManager.extractCodeContextsFromResponse(content, stepNumber);
    
    // Log progress
    const pending = this.snippetManager.getPendingRequirements();
    const completed = this.snippetManager.getRequirements().filter(r => r.isComplete);
    console.log(
      `[SnippetManager] Progress: ${completed.length}/${this.snippetManager.getRequirements().length} requirements complete`
    );
  }
}
```

### 3.2 Update ContinuationManager Integration

**Location**: `src/harmony/continuationManager.ts` - `shouldContinueInSnippetStage()`

**Action**: Use SnippetManager to check if all tasks are complete.

**Implementation**:
```typescript
// In ContinuationManager.shouldContinueInSnippetStage()
private shouldContinueInSnippetStage(
  originalPrompt: string,
  executedToolCalls: Array<{...}>,
  currentContent: string,
  isAlreadyContinuation: boolean = false,
  snippetManager?: SnippetManager  // NEW parameter
): boolean {
  // ... existing code ...
  
  // NEW: Check SnippetManager completion status
  if (snippetManager && snippetManager.hasRequirements()) {
    const allComplete = snippetManager.areAllTasksComplete();
    if (allComplete) {
      console.log(
        `[Harmony] Snippet stage: All tasks complete per SnippetManager, task complete`
      );
      return false; // Don't continue - all tasks done
    }
    
    // If not all complete, check if we have pending tasks
    const pendingTasks = snippetManager.getPendingTaskCodeContexts();
    if (pendingTasks.length > 0) {
      console.log(
        `[Harmony] Snippet stage: ${pendingTasks.length} pending task(s), continuing`
      );
      return true; // Continue to complete pending tasks
    }
  }
  
  // ... rest of existing logic ...
}
```

**Note**: Need to pass SnippetManager to ContinuationManager. This requires updating the call site.

---

## Phase 4: Integration Points Summary

### 4.1 Files to Modify

1. **`src/harmony/stageHandlers.ts`**
   - `ChatStageHandler.handlePostProcessing()`: Extract code blocks, create reference contexts
   - `SnippetStageHandler`: Add SnippetManager instance
   - `SnippetStageHandler.handlePreProcessing()`: Initialize SnippetManager
   - `SnippetStageHandler.handlePostProcessing()`: Extract CodeContexts from response

2. **`src/harmony/continuationManager.ts`**
   - `shouldContinueInSnippetStage()`: Add SnippetManager parameter and completion check

3. **`src/harmonyClient.ts`** (or wherever ContinuationManager is called)
   - Pass SnippetManager to `shouldContinueInSnippetStage()`

4. **`src/harmony/stageStateMachine.ts`** (if needed)
   - Store SnippetManager reference for access across stages

### 4.2 Data Flow

```
Chat Stage:
  User provides code/file → Extract → Create REFERENCE CodeContext → Store in ContextManager

Snippet Stage Entry:
  User prompt → SnippetManager.initializeFromPrompt() → Parse requirements → Create TASK CodeContexts

Snippet Stage Processing:
  LLM response → SnippetManager.extractCodeContextsFromResponse() → Update requirements → Check completion

Continuation Check:
  ContinuationManager.shouldContinueInSnippetStage() → SnippetManager.areAllTasksComplete() → Return continue/done
```

---

## Phase 5: Edge Cases and Considerations

### 5.1 Multiple Requirements in One Prompt
- SnippetManager already handles this via `parseRequirements()`
- Each requirement gets its own CodeContext

### 5.2 Reference Contexts from Chat Stage
- Already handled: Reference contexts are stored with `type: REFERENCE`
- SnippetManager can access them via `getReferenceCodeContexts()`
- They don't count toward completion

### 5.3 Question Requirements (No Code)
- Handled: `type: "question"` requirements don't need CodeContexts
- Completion is based on text response length

### 5.4 Partial Responses
- SnippetManager tracks completion per requirement
- Continuation continues until all requirements are complete

### 5.5 Stage Transitions
- Clear SnippetManager when leaving snippet stage
- Re-initialize when re-entering snippet stage

---

## Phase 6: Testing Checklist

- [ ] Chat stage: Code blocks extracted as reference contexts
- [ ] Snippet stage entry: SnippetManager initialized with requirements
- [ ] Snippet stage: CodeContexts extracted from responses
- [ ] Completion check: All tasks complete → stop continuation
- [ ] Completion check: Pending tasks → continue
- [ ] Multiple requirements: All tracked separately
- [ ] Reference contexts: Available but don't count toward completion
- [ ] Question requirements: Completed based on text response

---

## Implementation Order

1. **Phase 1**: Chat stage code extraction (reference contexts)
2. **Phase 2**: Snippet stage initialization
3. **Phase 3**: Response processing and CodeContext extraction
4. **Phase 4**: ContinuationManager integration
5. **Testing**: Verify all scenarios work correctly
