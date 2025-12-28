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

## Key Rules

1. **Content Generation**: Happens in Analysis stage, not Implementation
2. **File Operations**: Only in Implementation stage
3. **Analysis stage output**: Code snippets in markdown code blocks with file paths
4. **Implementation stage input**: Uses content/snippets from Analysis stage to create actual files
5. **Never skip stages**: Chat → Analysis → Implementation (always in this order)
6. **Chat stage**: Must always restate the user's problem in the response

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

