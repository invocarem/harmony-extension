# Diagnosis: @cmd:convert Command Flow Issues

## User's Expected Behavior

### Chat Stage

- ✅ Verify `file.docx` exists and file type is `.docx`
- ✅ Verify the second parameter `markdown` is valid
- ✅ Transition to assumptions stage

### Assumptions Stage

- ❌ Verify MCP tool (`word-to-md` / `convert_docx_to_markdown`) is available
- ❌ Read the file with `fileReader.readFileToBase64` and save result to code snippets block
- ✅ Generate a simple plan for the next stage

### Implementation Stage

- ❌ Use the base64 strings from code snippets (already read in assumptions stage)
- ✅ Call the MCP tool to get result
- ✅ Save to a markdown file

---

## Current Implementation Analysis

### Chat Stage (`extension.ts` lines 852-923)

**What works:**

- ✅ File existence verification (line 858): `await this.fileReader.readFileToBase64(filename)`
- ✅ File type verification (line 877): `FileReader.isSupportedFile(filename)`
- ✅ MCP tool availability check (line 896): `this.mcpManager.findToolServer(toolName)`
- ✅ Stage transition to assumptions (line 921): `newStage: 'assumptions'`
- ✅ Command preservation (line 917-922): `modifiedMessage: convertCommand`

**Status:** ✅ **CORRECT** - All chat stage expectations are met.

---

### Assumptions Stage (`extension.ts` lines 926-935, `stageHandlers.ts` lines 441-470)

**What's happening:**

1. Command handler returns `handled: false` (line 932), which means:

   - The command is passed through to the LLM
   - No special handling is done
   - The LLM processes `@cmd:convert file.docx markdown` as regular text

2. AssumptionsStageHandler (`stageHandlers.ts` lines 441-470):
   - Only handles post-processing (after LLM response)
   - Does NOT have pre-processing logic to:
     - Verify MCP tools
     - Read files to base64
     - Store in code snippets
   - Comments explicitly state: "Assumptions stage should NOT extract code snippets" (line 455)

**What's missing:**

- ❌ No MCP tool verification in assumptions stage
- ❌ No file reading in assumptions stage
- ❌ No code snippet storage (base64 content)
- ❌ The command is just treated as regular text by the LLM

**Status:** ❌ **INCORRECT** - Assumptions stage does not meet expectations.

---

### Implementation Stage (`extension.ts` lines 937-944, `executeConversion` lines 623-714)

**What's happening:**

1. Command handler executes conversion directly (line 939): `await this.executeConversion(filename, targetType)`
2. `executeConversion` method:
   - Reads file to base64 **AGAIN** (line 657): `await this.fileReader.readFileToBase64(filename)`
   - Calls MCP tool (line 660): `await this.mcpManager.callTool(...)`
   - Returns formatted result (lines 693-698)

**What's wrong:**

- ❌ File is read **again** in implementation stage (should use base64 from code snippets)
- ✅ MCP tool is called correctly
- ✅ Result is returned correctly

**Status:** ⚠️ **PARTIALLY CORRECT** - Works but doesn't use code snippets as expected.

---

## Root Cause Analysis

### Problem 1: Assumptions Stage Doesn't Process Convert Command

The command handler in `extension.ts` line 926-935 returns `handled: false` for assumptions stage, which means:

- The command is NOT intercepted
- The command goes to the LLM as-is: `@cmd:convert file.docx markdown`
- The LLM may or may not understand this is a command
- No file reading happens
- No code snippet storage happens

**Expected behavior:** Assumptions stage should:

1. Detect the `@cmd:convert` command
2. Verify MCP tool availability
3. Read file to base64
4. Store base64 in code snippets (using AssumptionsManager.addCodeSnippet or CodeContext)
5. Generate a plan mentioning the file will be converted

### Problem 2: No Code Snippet Storage Mechanism for Binary Data

The codebase has:

- `AssumptionsManager.addCodeSnippet()` (line 85) - but only stores `file` (path) and `description`, NOT base64 content
- `CodeContext` - designed for text content (line-based), not binary/base64
- No mechanism to store base64 strings in assumptions stage for later use

**Expected behavior:** Need a way to store:

- File path: `file.docx`
- Base64 content: `dGVzdCBjb250ZW50...`
- Metadata: filename, fileSize, etc.

### Problem 3: Implementation Stage Reads File Again

The `executeConversion` method reads the file again (line 657) instead of:

- Retrieving base64 from code snippets/code context
- Using pre-read data from assumptions stage

**Expected behavior:** Implementation stage should:

- Retrieve base64 from code snippets (already read in assumptions stage)
- Only call MCP tool (no file reading)

---

## Test vs Reality Mismatch

The test (`harmonyAssistant.test.ts` lines 640-975) passes because:

1. **Mocks don't reflect reality:**

   - `mockReadFileToBase64` is mocked to return base64
   - `mockIsSupportedFile` is mocked to return true
   - The test doesn't verify that assumptions stage actually reads/stores the file

2. **Test doesn't verify assumptions stage behavior:**

   - Tests only verify chat stage (lines 662-756) and implementation stage (lines 771-974)
   - No tests for assumptions stage handling of convert command
   - Test assumes the command "passes through" without checking what actually happens

3. **Test assumptions are incorrect:**
   - Test line 758-769: "Assumptions stage: Pass through without handling the command"
   - This matches current implementation but NOT the expected behavior

---

## Updated Approach: Flag-Based Help (Not Forced Plan)

### 1. Remove Special Plan Creation

**Decision:** ✅ **REMOVED** - The special 3-step plan for convert command has been removed from `stageHandlers.ts`.

**Rationale:**

- The improved `extractStepsFromText()` logic now properly extracts execution steps (3 steps) from LLM's response instead of edge cases (5 steps)
- The LLM should generate the plan naturally based on the task
- No need to force a specific plan structure

### 2. Flag-Based Context (Future Enhancement)

**Concept:** Instead of forcing a plan, set a flag/context that helps the LLM generate the right plan steps.

**Potential Implementation:**

- Detect `@cmd:convert` command in assumptions stage
- Set a flag in conversation context (e.g., `conversionTask: { filename, sourceType, targetType }`)
- Let LLM generate the plan naturally, but the flag helps guide it
- Template can reference the flag to provide context about the conversion task

**Note:** This is a future enhancement. Current implementation relies on improved step extraction logic.

### 3. File Reading: `readFileToBase64` vs `read_file` Native Tool

**Question:** Do we need to create a native tool for `readFileToBase64`?

**Answer:** ❌ **NO** - `readFileToBase64` is a **utility function**, not a native tool.

**Differences:**

- **`read_file`** (native tool): Available to LLM via `NativeToolsManager`, reads text files, returns text content
- **`readFileToBase64`** (utility function): Internal utility in `FileReader` class, reads binary files (DOCX/PDF), returns base64 string, used by extension code internally

**Current Flow:**

- **Assumptions Stage**: LLM generates plan (no file reading needed)
- **Implementation Stage**: Extension code uses `readFileToBase64` utility to read binary file, then calls MCP tool
- LLM doesn't need to call `readFileToBase64` - the extension handles it

**Conclusion:** No native tool needed. The `readFileToBase64` utility is used internally by the extension when executing the conversion in the implementation stage.

### 4. Implementation Stage

The `executeConversion` method (line 657):

- Uses `fileReader.readFileToBase64(filename)` - ✅ Correct (utility function, not native tool)
- Reads file and converts to base64
- Calls MCP tool with base64 content
- Returns formatted result

**Status:** ✅ **CORRECT** - Implementation stage already uses the right approach.

---

## Summary (Updated Approach)

**Current Flow (After Changes):**

```
Chat Stage → Verify file/MCP → Transition to Assumptions
Assumptions Stage → Pass through command → LLM generates plan naturally (improved step extraction)
Implementation Stage → Read file (readFileToBase64 utility) → Call MCP → Return result
```

**Key Changes:**

1. ✅ **Removed forced plan creation** - Special 3-step plan for convert command has been removed
2. ✅ **Improved step extraction** - `extractStepsFromText()` now properly extracts execution plan (3 steps) instead of edge cases (5 steps)
3. ✅ **LLM generates plan naturally** - No forced plan structure, LLM creates plan based on task
4. ✅ **readFileToBase64 is a utility** - Not a native tool, used internally by extension code in implementation stage

**Future Enhancement (Flag-Based Approach):**

- Set a flag/context when `@cmd:convert` is detected (e.g., `conversionTask: { filename, sourceType, targetType }`)
- Flag helps guide LLM to generate appropriate plan steps
- No forced plan structure - LLM still generates plan naturally

---

## Command Preservation: Should Chat Stage Save Command for Assumptions?

### ✅ **YES - Command Should Be Preserved and Passed to Assumptions Stage**

**Current Approach:**

- Chat stage preserves command in `modifiedMessage`: `@cmd:convert file.docx markdown` (line 917-922)
- This is passed through to assumptions stage in the message text
- **Problem**: Assumptions stage handler returns `handled: false` (line 932), so the command is NOT intercepted
- The command syntax goes directly to the LLM as-is, without special handling

### ✅ **Recommended: Keep Command in Message + Detect in Pre-Processing**

**Approach:**

1. **Chat stage** (current - OK): Preserve command in `modifiedMessage`

   - Keeps `@cmd:convert file.docx markdown` in the message
   - Simple and works with existing flow

2. **Assumptions stage** (needs implementation): Add pre-processing to detect and handle command
   - Assumptions stage handler should have `handlePreProcessing` method
   - Detect `@cmd:convert` pattern in prompt
   - Extract parameters (filename, targetType)
   - Read file and store base64
   - Transform message: Remove command syntax, use natural language for LLM
   - Example: `@cmd:convert file.docx markdown` → `Convert file.docx to markdown format`

**Why This Approach:**

- ✅ Simple: Uses existing message passing mechanism
- ✅ Explicit: Command syntax `@cmd:convert` is clear and detectable
- ✅ Flexible: Works with existing `handlePreProcessing` pattern
- ✅ No new infrastructure: Doesn't require new metadata fields or context storage

**Alternative Approaches (Not Recommended):**

- ❌ Store command metadata separately: Adds complexity, requires new context fields
- ❌ Store in ConversationContext: Over-engineered for this use case
- ❌ Pass via different mechanism: Breaks existing message flow pattern

**Implementation Needed:**

```typescript
// In AssumptionsStageHandler.handlePreProcessing:
if (prompt.includes("@cmd:convert")) {
  // Extract command parameters
  const match = prompt.match(
    /@cmd:convert\s+([\w.-\/\\]+\.(?:docx|pdf))(?:\s+(\w+))?/i
  );
  if (match) {
    const filename = match[1];
    const targetType = match[2] || "markdown";

    // Read file and store base64
    const fileResult = await fileReader.readFileToBase64(filename);
    // Store in code snippets/code context

    // Transform prompt for LLM (remove command syntax)
    const transformedPrompt = `Convert ${filename} to ${targetType} format`;
    return { shouldSkipLLM: false, modifiedPrompt: transformedPrompt };
  }
}
```

---

## Recommendation: Where to Read and Store File

### ❌ **NOT at Chat Stage**

**Reasons:**

- **Stage Purpose Mismatch**: Chat stage is for lightweight verification, not data preparation
- **Resource Waste**: User might change their mind or cancel, wasting I/O on large files
- **Current Inefficiency**: Chat stage currently reads entire file just to verify existence (line 858), then discards result

### ❌ **NOT at Assumptions Stage**

**Reasons (Updated Analysis):**

- **Template Instructions Conflict**: Assumptions template explicitly says "DO NOT generate code" and "DO NOT include code snippets"
- **Stage Purpose**: Assumptions stage is for **planning and analysis**, NOT data preparation
- **No Storage Mechanism**: `AssumptionsManager.addCodeSnippet()` only stores file path + description, NOT base64 content
- **Architecture Mismatch**: `CodeContext` is designed for text content (line-based), not binary/base64
- **Over-Engineering**: Would require extending AssumptionsManager or creating new storage mechanism
- **Planning Doesn't Need File Content**: Plan only needs to know "convert file.docx to markdown", not the actual file content

### ✅ **At Implementation Stage (REVISED RECOMMENDATION)**

**Reasons:**

- **Aligns with Stage Purpose**: Implementation stage is for **execution** - reading files and calling tools
- **Matches Template Instructions**: Assumptions stage focuses on planning, implementation stage executes
- **Simpler Architecture**: No need to extend AssumptionsManager or create base64 storage
- **Already Implemented**: Implementation stage already reads file (line 657 in `executeConversion`)
- **Clear Separation**: Chat (verify) → Assumptions (plan) → Implementation (execute/read file)

**What to do:**

1. **Optimize Chat Stage**: Change line 858 to use `fs.stat()` or `fs.access()` for existence check (don't read file)
2. **Keep Assumptions Stage Simple**: Just create plan (no file reading needed)
3. **Implementation Stage**: Already reads file and calls MCP tool (current implementation is correct)
4. **Update Assumptions Stage Handler**: Detect `@cmd:convert` command, verify MCP tool, create plan mentioning conversion task

**Revised Flow:**

```
Chat Stage → Stat file (exists?) → Verify type/tool → Transition
Assumptions Stage → Detect command → Verify MCP tool → Create plan (no file reading)
Implementation Stage → Read file → Call MCP tool → Save result
```

**Key Insight:** The assumptions stage doesn't need the file content to create a plan. It only needs to know:

- What task: "Convert file.docx to markdown"
- What tool: "MCP tool convert_docx_to_markdown"
- What file: "file.docx"

The actual file reading happens in implementation stage when executing the plan.
