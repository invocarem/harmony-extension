# Harmony Extension State Machine

## Stage Flow

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                   INIT STAGE                            │
│                                                         │
│ Purpose: Initial state before conversation begins       │
│ Tools:   None (conversation not yet started)           │
│                                                         │
│ ✅ Transitions to chat when webview loads              │
│ ✅ Transitions to chat on first prompt                 │
│ ❌ No tools available                                  │
│ ❌ No stage transitions except init → chat             │
└──────┬──────────────────────────────────────────────────┘
       │
       │ Webview loads OR first prompt
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                    CHAT STAGE                           │
│                                                         │
│ Purpose: Clarify and understand user's question         │
│          Review results, decide next iteration          │
│ Tools:   read_file, list_files, grep_files (read-only) │
│                                                         │
│ ✅ Must restate the problem                            │
│ ✅ Review implementation results                        │
│ ✅ Decide next action (iterate or done)                │
│ ❌ NO file modification tools                          │
│ ❌ NO code generation                                  │
└──────┬──────────────────────────────────────────────────┘
       │
       │ User asks to create/modify files
       │ OR code-related questions
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│              ASSUMPTIONS/ANALYSIS STAGE                 │
│                                                         │
│ Purpose: Analyze problem, generate code snippets        │
│ Tools:   read_file, list_files, grep_files (read-only) │
│                                                         │
│ ✅ Generate code content/snippets                      │
│ ✅ Explain assumptions                                 │
│ ✅ Provide examples in code blocks                     │
│ ❌ NO file modification tools                          │
│                                                         │
│ Output: Code snippets with file paths in markdown      │
└──────┬──────────────────────────────────────────────────┘
       │
       │ User explicitly requests implementation
       │ OR code content is ready
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│               IMPLEMENTATION STAGE                      │
│                                                         │
│ Purpose: Create/modify files using generated content   │
│ Tools:   ALL tools (including create_file, etc.)       │
│                                                         │
│ ✅ Create/modify files                                 │
│ ✅ Use content from Analysis stage                     │
│ ✅ Execute file operations                             │
└─────────────────────────────────────────────────────────┘
```

## Transition Rules (State Machine)

### Valid Transitions
- **Init** → Chat
- **Chat** → Analysis
- **Analysis** → Implementation
- **Analysis** → Chat
- **Implementation** → Chat
- **Implementation** → Analysis

### Initialization Transitions

#### Init → Chat
- **Trigger**: Webview loads OR first prompt is sent
- **Purpose**: Initialize conversation, ready to begin
- **Result**: Chat light turns on, conversation ready
- **Auto-transition**: Happens automatically on webview load or first user message
- **Notes**: 
  - This is the only transition from Init stage
  - Enables iterative workflows by providing clear starting point
  - User must explicitly signal to move from Implementation to Chat for next iteration

### Forward Transitions (Workflow Progression)

#### Chat → Analysis (Assumptions)
- **Trigger**: Code-related keywords, file operation intent (without explicit extensions)
- **Detection**: `codeKeywords`, `fileOperationKeywords` (without explicit extensions)
- **Example prompts**:
  - "How do I fix this bug?"
  - "Create a function to parse JSON"
  - "Show me code for authentication"
  - "create JSON" (no extension)
  - "modify the TypeScript code"

#### Analysis → Implementation
- **Trigger**: Explicit file operation commands OR explicit stage transition
- **Detection**: `fileOperationWithExtension`, explicit commands like "move to implementation"
- **Example prompts**:
  - "create config.json" (with extension)
  - "move to implementation"
  - "implement it now"

### Backward Transitions (Error Recovery & Clarification)

#### Implementation → Chat
- **Trigger**: 
  - **Error recovery**: Tool execution errors that require clarification
  - **Manual trigger**: User explicitly requests transition (e.g., "move to chat", "back to chat")
  - **Clarification**: User asks clarification questions
- **Auto-detection (errors)**: File modification errors with keywords like "not found", "permission denied", "invalid", "missing", "required", "cannot", "unable"
- **Manual trigger**: User asks clarification questions or explicitly requests transition
- **Purpose**: 
  - Review implementation results
  - Error clarification
  - User-controlled transition for iterative workflows
- **Example prompts**:
  - "move to chat"
  - "back to chat"
  - "what went wrong?"
  - "why didn't it work?"
  - "I don't understand the error"
- **Note**: No auto-transition - user must explicitly signal to move to chat stage

#### Implementation → Analysis
- **Trigger**: Need to regenerate code or fix code issues
- **Example prompts**:
  - "regenerate the code"
  - "fix the code"
  - "update the code"

#### Analysis → Chat
- **Trigger**: Need clarification on requirements
- **Example prompts**:
  - "can you clarify..."
  - "I'm confused about..."
  - "what do you mean by..."

### Invalid Transitions
- ❌ **Init → Analysis**: NOT ALLOWED - Must transition to Chat first
- ❌ **Init → Implementation**: NOT ALLOWED - Must transition to Chat first
- ❌ **Chat → Implementation**: NOT ALLOWED - Must go through Analysis stage first

### Stage Events (Self-Loop Transitions)

Stage events are triggers that execute actions within the current stage without causing a stage transition. These are handled by the state machine as self-loop transitions (same stage → same stage).

#### Implementation Stage Events

**`next_step` Event**:
- **Trigger**: `@cmd:next_step`, "next step", "continue", "proceed", "advance"
- **Stage**: Implementation only
- **Action**: Executes the current pending step in the ProgressPlan
- **Result**: Stays in implementation stage, step is processed
- **Use Case**: Manually advance through plan steps one at a time

**`auto` Event**:
- **Trigger**: `@cmd:auto`, "auto mode", "execute all"
- **Stage**: Implementation only
- **Action**: Executes the current pending step, then automatically continues to next step
- **Result**: Stays in implementation stage, continues until all steps complete
- **Use Case**: Automatically execute all remaining steps in the plan

#### All-Stage Events

**`verbose_info` Event**:
- **Trigger**: `@cmd:verbose_info`, "verbose info", "show info", "display info"
- **Stage**: Works from any stage (init, chat, assumptions, implementation)
- **Action**: Generates and displays verboseInfo for the current stage
- **Result**: Stays in current stage, no LLM call, just displays information
- **Use Case**: View current stage state, plan progress, file operations, etc.

**How Events Work**:
1. State machine detects the trigger from the prompt
2. Finds matching self-loop transition rule (same stage → same stage)
3. Passes trigger information to stage handler
4. Stage handler executes the appropriate action
5. Stage remains unchanged (no transition)

## Stage Characteristics

| Stage | Read Tools | Write Tools | Code Generation | File Creation | Must Restate Problem | Purpose |
|-------|-----------|-------------|-----------------|---------------|---------------------|---------|
| Init | ❌ | ❌ | ❌ | ❌ | - | Initial state, not started |
| Chat | ✅ | ❌ | ❌ | ❌ | ✅ Yes | Clarify, understand, review results, iterate |
| Analysis | ✅ | ❌ | ✅ (snippets) | ❌ | - | Analyze, plan, generate code snippets |
| Implementation | ✅ | ✅ | ❌ | ✅ | - | Execute, create/modify files |

## ProgressPlan: Multi-Step Task Management

For complex tasks (3+ steps), the system creates a **ProgressPlan** to break down the work into manageable steps and guide sequential implementation.

### Plan Creation (Assumptions Stage)

**When**: Plans are automatically created in the **Assumptions/Analysis** stage when:
- Task complexity is detected as "hard" (3+ steps)
- The LLM response contains multiple step indicators (numbered lists, "Step 1", "first/then/finally", etc.)

**How**:
1. `AutoTransitionManager.detectTaskComplexity()` analyzes the response
2. If complexity is "hard", extracts steps from the response:
   - Looks for numbered lists: "1. Create file.py", "2. Add function", etc.
   - Extracts step goals and descriptions
   - Falls back to generic steps if extraction fails
3. Creates a `ProgressPlan` with:
   - `taskId`: Unique identifier
   - `originalPrompt`: The user's original request
   - `complexity`: "hard"
   - `steps`: Array of `PlanStep` objects, each with:
     - `stepNumber`: Sequential number (1, 2, 3...)
     - `goal`: What needs to be accomplished
     - `description`: Optional detailed description
     - `status`: "pending" | "in_progress" | "completed"
   - `createdAt`: Timestamp
   - `completedAt`: Set when all steps are done

**Example Plan Creation**:
```
User: "Write Python code, provide requirements.txt, and write summary.md"

Assumptions Stage Response:
"Here's the plan:
1. Create calc.py with calculator functions
2. Create requirements.txt with dependencies
3. Create README.md with documentation"

→ ProgressPlan created with 3 steps
```

### Plan-Driven Implementation

**In Implementation Stage**, when a `ProgressPlan` exists:

1. **Current Step Focus**: The prompt includes the current pending step:
   ```
   **PROGRESS PLAN - CURRENT STEP**:
   You are working on Step 1/3: Create calc.py
   
   **Remaining Steps**:
   - Step 2: Create requirements.txt
   - Step 3: Create README.md
   
   **FOCUS**: Complete the current step (Create calc.py) by creating the necessary files.
   ```

2. **Step Execution Modes**:
   - **Manual Mode** (default): Steps remain "pending" until explicitly executed
     - User must use `@cmd:next_step` or "next step" to execute each step
     - Provides control over when each step runs
   - **Auto Mode**: Use `@cmd:auto` to automatically execute all remaining steps
     - Executes current step, then automatically continues to next step
     - Continues until all steps are completed
   - **Natural Language**: Can also use "continue", "proceed", "advance" as `next_step` trigger

3. **Sequential Execution**: 
   - Steps are executed one at a time (via `next_step` or `auto` events)
   - After files are created, the step is automatically marked as "completed"
   - Next step becomes available for execution

4. **Step Status Updates**:
   - When `create_file` or `replace_file` succeeds → Current step marked "completed"
   - Steps are completed sequentially (first pending step gets completed)
   - Plan completion is detected when all steps are "completed"

### Step Update Logic

**Automatic Step Updates** happen in three scenarios:

1. **CodeContext File Creation** (early return path):
   - Files created from CodeContext in implementation stage
   - Step updated before returning

2. **Tool Call Execution** (normal flow):
   - After successful `create_file`/`replace_file` tool calls
   - Step updated after tool execution completes

3. **Code Block Extraction** (fallback):
   - If LLM returns code blocks instead of tool calls
   - Code blocks extracted and files created
   - Step updated after file creation

**Step Completion Criteria**:
- At least one successful file modification tool execution
- Tool must be: `create_file`, `replace_file`, `write_file`, or `update_file`
- Tool execution must not have errors (`!result.isError`)

### Plan Completion

- When all steps have `status === 'completed'`
- `completedAt` timestamp is automatically set
- Plan completion is logged for tracking

### Example Flow

**Manual Step Execution**:
```
1. User: "Create a Python project with calc.py, requirements.txt, and README.md"
   → Assumptions Stage: Plan created with 3 steps

2. User: "move to implementation"
   → Implementation Stage: Step 1 is pending, waiting for execution

3. User: "@cmd:next_step" or "next step"
   → Implementation Stage: Step 1 executed ("Create calc.py")
   → LLM creates calc.py
   → Step 1 marked "completed", Step 2 becomes current

4. User: "@cmd:next_step"
   → Implementation Stage: Step 2 executed ("Create requirements.txt")
   → LLM creates requirements.txt
   → Step 2 marked "completed", Step 3 becomes current

5. User: "@cmd:next_step"
   → Implementation Stage: Step 3 executed ("Create README.md")
   → LLM creates README.md
   → Step 3 marked "completed"
   → Plan marked as complete ✅
```

**Auto Mode Execution**:
```
1. User: "Create a Python project with calc.py, requirements.txt, and README.md"
   → Assumptions Stage: Plan created with 3 steps

2. User: "move to implementation"
   → Implementation Stage: Step 1 is pending, waiting for execution

3. User: "@cmd:auto"
   → Implementation Stage: Auto mode activated
   → Step 1 executed → Step 1 completed
   → Step 2 executed → Step 2 completed
   → Step 3 executed → Step 3 completed
   → Plan marked as complete ✅
   (All steps executed automatically without user intervention)
```

## Key Rules

1. **Initialization**: Conversation starts in Init stage, transitions to Chat when webview loads or first prompt
2. **Content Generation**: Happens in Analysis stage, not Implementation
3. **File Operations**: Only in Implementation stage
4. **Analysis stage output**: Code snippets in markdown code blocks with file paths
5. **Implementation stage input**: Uses content/snippets from Analysis stage to create actual files
6. **Never skip stages**: Init → Chat → Analysis → Implementation (always in this order)
7. **Chat stage**: Must always restate the user's problem in the response
8. **Iterative Workflows**: User-controlled transitions enable iterative cycles (chat → assumptions → implementation → (user signals) → chat → ...)
9. **No Auto-transition from Implementation**: User must explicitly signal to move from Implementation to Chat
10. **ProgressPlan**: Created automatically for hard tasks (3+ steps) in Assumptions stage
11. **Step-Driven Implementation**: Implementation stage follows plan steps sequentially
12. **Step Execution Events**: Steps are executed via `next_step` or `auto` events (state machine triggers)
13. **Automatic Step Updates**: Steps marked "completed" when files are successfully created
14. **Stage Events**: `next_step`, `auto`, and `verbose_info` are state machine events that don't cause stage transitions
15. **VerboseInfo Event**: Can be triggered from any stage to view current state information

## State Transition Logic

The `StageStateMachine` class enforces these rules:

### Initialization Flow
- **Init → Chat**: Automatic transition when webview loads or first prompt is sent
- This is the only transition from Init stage

### Forward Flow (Workflow Progression)
- If in **Chat** stage and user requests file operations → Go to **Analysis** (never skip to Implementation)
- If in **Analysis** stage and user requests explicit file creation → Go to **Implementation**
- If user explicitly says "move to implementation" from Analysis → Go to **Implementation**

### Backward Flow (Error Recovery & Manual Transitions)
- If in **Implementation** stage and tool execution errors occur → Auto-transition to **Chat** for clarification
- If user asks clarification questions in **Implementation** → Go to **Chat**
- If user explicitly requests "move to chat" from **Implementation** → Go to **Chat**
- If user requests code regeneration in **Implementation** → Go to **Analysis**
- **Iterative Pattern**: Implementation → (user signals) → Chat → (review results) → Analysis → Implementation → (user signals) → Chat → ...

### State Machine Implementation
- `canTransition(from, to)`: Checks if a transition is valid according to the state machine rules
- `detectTrigger(prompt, currentStage)`: Detects triggers from prompt (including events like `next_step`, `auto`, `verbose_info`)
- `determineNextStage(currentStage, prompt)`: Determines the next stage based on prompt content
  - Returns same stage for self-loop transitions (events)
  - Returns new stage for actual transitions
- `shouldTransitionToChatOnError(currentStage, toolResults)`: Checks if errors require transition back to Chat

**Event Detection**:
- Events are detected by `detectTrigger()` method
- Self-loop transitions (same stage → same stage) indicate events occurred
- Trigger information is passed to stage handlers for execution
- Events don't cause stage transitions but execute stage-specific actions

The state machine prevents invalid transitions (like Chat → Implementation, Init → Analysis) and enables proper error recovery loops and iterative workflows. It also handles stage events that execute actions without changing stages.

## Iterative Workflow Pattern

The state machine supports iterative analysis/development cycles:

```
1. Init → Chat (webview loads)
2. Chat: "Create a reading document of current project"
3. Assumptions: Analyze project, plan diagnostics.md
4. Implementation: Generate diagnostics.md
5. User: "move to chat" (explicit signal)
6. Chat: Review diagnostics.md, decide next action
7. Chat: "Do another analysis" (using diagnostics.md as context)
8. Assumptions: Plan diagnostics2.md based on diagnostics.md
9. Implementation: Generate diagnostics2.md
10. User: "move to chat" (explicit signal)
11. Chat: Review results
12. Chat: "Compare diagnostics.md and diagnostics2.md"
13. ... (continue iterating as needed)
```

This pattern enables:
- **Review & Reflect**: Chat stage between iterations allows reviewing results
- **Context Building**: Each iteration can build on previous artifacts
- **User Control**: User explicitly controls when to transition to chat (no auto-transition)
- **Flexible Flow**: User decides when to review results and continue iterating

## State Machine Events Reference

### Implementation Stage Events

| Event | Trigger | Action | Stage Restriction |
|-------|---------|--------|-------------------|
| `next_step` | `@cmd:next_step`, "next step", "continue", "proceed", "advance" | Execute current pending step | Implementation only |
| `auto` | `@cmd:auto`, "auto mode", "execute all" | Execute current step, then auto-continue until complete | Implementation only |

### All-Stage Events

| Event | Trigger | Action | Stage Restriction |
|-------|---------|--------|-------------------|
| `verbose_info` | `@cmd:verbose_info`, "verbose info", "show info", "display info" | Generate and display verboseInfo | All stages (init, chat, assumptions, implementation) |

### Event Flow

1. **User Input**: User provides command or natural language trigger
2. **State Machine Detection**: `detectTrigger()` identifies the event trigger
3. **Self-Loop Transition**: State machine finds matching self-loop rule (same stage → same stage)
4. **Handler Execution**: Stage handler receives trigger information and executes appropriate action
5. **No Stage Change**: Stage remains the same, only the action is executed

### Examples

**Using `next_step` event**:
```
User: "@cmd:next_step"
→ State machine detects 'next_step' trigger
→ Finds self-loop: implementation → implementation
→ ImplementationStageHandler executes current step
→ Step completed, stays in implementation stage
```

**Using `auto` event**:
```
User: "@cmd:auto"
→ State machine detects 'auto' trigger
→ Finds self-loop: implementation → implementation
→ ImplementationStageHandler executes current step
→ After step completes, automatically triggers next 'auto' event
→ Continues until all steps complete
→ Stays in implementation stage throughout
```

**Using `verbose_info` event**:
```
User: "@cmd:verbose_info" (from any stage)
→ State machine detects 'verbose_info' trigger
→ Finds self-loop: current_stage → current_stage
→ Stage handler generates verboseInfo for current stage
→ Displays verboseInfo, no LLM call
→ Stays in current stage
```

