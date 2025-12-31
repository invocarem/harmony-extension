# Harmony Extension State Machine

## Stage Flow

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                    CHAT STAGE                           │
│                                                         │
│ Purpose: Clarify and understand user's question         │
│ Tools:   read_file, list_files, grep_files (read-only) │
│                                                         │
│ ✅ Must restate the problem                            │
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
- **Chat** → Analysis
- **Analysis** → Implementation
- **Analysis** → Chat
- **Implementation** → Chat
- **Implementation** → Analysis

### Forward Transitions

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
- **Trigger**: Tool execution errors that require clarification
- **Auto-detection**: File modification errors with keywords like "not found", "permission denied", "invalid", "missing", "required", "cannot", "unable"
- **Manual trigger**: User asks clarification questions
- **Example prompts**:
  - "what went wrong?"
  - "why didn't it work?"
  - "I don't understand the error"

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
- ❌ **Chat → Implementation**: NOT ALLOWED - Must go through Analysis stage first

## Stage Characteristics

| Stage | Read Tools | Write Tools | Code Generation | File Creation | Must Restate Problem |
|-------|-----------|-------------|-----------------|---------------|---------------------|
| Chat | ✅ | ❌ | ❌ | ❌ | ✅ Yes |
| Analysis | ✅ | ❌ | ✅ (snippets) | ❌ | - |
| Implementation | ✅ | ✅ | ❌ | ✅ | - |

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

2. **Sequential Execution**: 
   - LLM focuses on completing the current step
   - After files are created, the step is automatically marked as "completed"
   - Next call automatically moves to the next pending step

3. **Step Status Updates**:
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

```
1. User: "Create a Python project with calc.py, requirements.txt, and README.md"
   → Assumptions Stage: Plan created with 3 steps

2. User: "move to implementation"
   → Implementation Stage: Step 1 focus ("Create calc.py")
   → LLM creates calc.py
   → Step 1 marked "completed"

3. User: "continue"
   → Implementation Stage: Step 2 focus ("Create requirements.txt")
   → LLM creates requirements.txt
   → Step 2 marked "completed"

4. User: "continue"
   → Implementation Stage: Step 3 focus ("Create README.md")
   → LLM creates README.md
   → Step 3 marked "completed"
   → Plan marked as complete ✅
```

## Key Rules

1. **Content Generation**: Happens in Analysis stage, not Implementation
2. **File Operations**: Only in Implementation stage
3. **Analysis stage output**: Code snippets in markdown code blocks with file paths
4. **Implementation stage input**: Uses content/snippets from Analysis stage to create actual files
5. **Never skip stages**: Chat → Analysis → Implementation (always in this order)
6. **Chat stage**: Must always restate the user's problem in the response
7. **ProgressPlan**: Created automatically for hard tasks (3+ steps) in Assumptions stage
8. **Step-Driven Implementation**: Implementation stage follows plan steps sequentially
9. **Automatic Step Updates**: Steps marked "completed" when files are successfully created

## State Transition Logic

The `StageStateMachine` class enforces these rules:

### Forward Flow
- If in **Chat** stage and user requests file operations → Go to **Analysis** (never skip to Implementation)
- If in **Analysis** stage and user requests explicit file creation → Go to **Implementation**
- If user explicitly says "move to implementation" from Analysis → Go to **Implementation**

### Backward Flow (Error Recovery)
- If in **Implementation** stage and tool execution errors occur → Auto-transition to **Chat** for clarification
- If user asks clarification questions in **Implementation** → Go to **Chat**
- If user requests code regeneration in **Implementation** → Go to **Analysis**

### State Machine Implementation
- `canTransition(from, to)`: Checks if a transition is valid according to the state machine rules
- `determineNextStage(currentStage, prompt)`: Determines the next stage based on prompt content
- `shouldTransitionToChatOnError(currentStage, toolResults)`: Checks if errors require transition back to Chat

The state machine prevents invalid transitions (like Chat → Implementation) and enables proper error recovery loops.

