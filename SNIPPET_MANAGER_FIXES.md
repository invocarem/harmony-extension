# SnippetManager Integration Fixes

## Issues Identified

1. **SnippetManager not initialized when entering snippet stage**
   - Only initialized for `verbose_info` trigger, not for regular prompts
   - Requirements not parsed from conversation

2. **ContinuationManager doesn't check SnippetManager**
   - `shouldContinueInSnippetStage()` doesn't have access to SnippetManager
   - Can't determine if all tasks are complete

3. **System stops when read_file is blocked**
   - When read_file is blocked (file already available), system stops
   - Should continue to generate code fix/snippet

## Fixes Applied

### 1. Initialize SnippetManager on Entry to Snippet Stage

**File**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler.handlePreProcessing()`

- Initialize SnippetManager for all prompts (not just verbose_info)
- Parse requirements from `context.originalPrompt` (contains full requirement from chat)
- Create task CodeContexts for requirements

### 2. ContinuationManager Integration

**File**: `src/harmony/continuationManager.ts` - `shouldContinueInSnippetStage()`

- Added `snippetManager` parameter
- Check `snippetManager.areAllTasksComplete()` first (priority check)
- If tasks incomplete → continue (even if read_file blocked)
- If tasks complete → stop

### 3. Pass SnippetManager to Continuation Check

**File**: `src/harmonyClient.ts`

- Get SnippetManager from `stageHandlerRegistry.getSnippetManager()`
- Pass to `continuationManager.shouldContinueTask()`

### 4. Enhanced Blocked Message

**File**: `src/harmony/stageHandlers.ts` - `SnippetStageHandler.filterToolCalls()`

- Updated blocked message to explicitly tell LLM to proceed with code generation
- Message: "You can reference them directly without reading again. Please proceed to generate the code fix/snippet based on the available file content."

## Flow After Fixes

**Scenario**: User says "fix bug in calc.py" → "@cmd:move_to_snippet" → "continue"

1. **Enter snippet stage**:
   - SnippetManager initialized
   - Requirements parsed: `bug_fix` for `calc.py`
   - Task CodeContext created (empty, waiting for code)

2. **LLM tries read_file("calc.py")**:
   - SnippetManager checks: file already available as reference
   - Block read_file
   - Inform LLM: "calc.py is already available, proceed to generate fix"

3. **Continuation check**:
   - SnippetManager: `areAllTasksComplete()` → `false` (no code generated yet)
   - ContinuationManager: Continue = `true`
   - System continues

4. **LLM generates code fix**:
   - Code snippet extracted
   - Task CodeContext updated with fix
   - Requirement marked complete

5. **Continuation check**:
   - SnippetManager: `areAllTasksComplete()` → `true`
   - ContinuationManager: Continue = `false`
   - System stops (task complete)

## Key Changes

1. **SnippetManager initialization**: Now happens for all prompts in snippet stage
2. **Requirements parsing**: Uses `context.originalPrompt` to get full requirement
3. **Continuation logic**: Checks SnippetManager completion status first
4. **Blocked read_file handling**: System continues even when read_file is blocked if tasks incomplete
