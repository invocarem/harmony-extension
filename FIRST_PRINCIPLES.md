# First Principles Thinking Mode

## Overview

First Principles Thinking is a specialized analysis mode within the **Assumptions/Analysis** stage that guides users through a structured process to break down problems, beliefs, or habits into fundamental truths, enabling reconstruction from the ground up.

## Purpose

First Principles Thinking provides:

- **Deep Analysis**: Strips away assumptions and identifies core truths
- **Structured Questioning**: Asks 10-12 targeted questions to isolate fundamentals
- **Synthesis**: Produces structured analysis (Core Truths, False Assumptions, Reconstruction, Actionable Insights)
- **Enhanced Planning**: Uses synthesis to inform the numbered plan generation

## Integration with Assumptions Stage

First Principles Thinking is **not a separate stage** but a **mode within the Assumptions/Analysis stage**:

```
Chat → Assumptions (First-Principles Mode) → Assumptions (Normal Mode) → Implementation
```

### Flow

1. **User enters Assumptions stage** with first-principles trigger
2. **Question Phase**: System asks 10-12 short, concrete questions
3. **Synthesis Phase**: After questions answered, generate structured synthesis
4. **Normal Assumptions Phase**: Use synthesis as input for normal assumptions analysis
5. **Plan Generation**: Create numbered plan (Step 1:, Step 2:, Step 3:)
6. **Proceed to Implementation**: Normal flow continues

## Activation

### Default Setting

- **Default**: `false` (disabled by default)
- **Configuration**: Can be enabled via trigger keywords or explicit command

### Activation Methods

#### Method 1: Explicit Command

User includes trigger in their message:

- `@first-principles`
- `@fpt`
- `@first-principles-thinking`

#### Method 2: Keyword Detection

System detects first-principles intent:

- "first principles thinking"
- "break down to fundamentals"
- "strip assumptions"
- "fundamental analysis"

#### Method 3: Configuration Flag

Can be enabled via configuration (future enhancement)

## Question Sequence

### Question Guidelines

**DO:**

- Ask short, concrete questions requiring one-word or short-phrase answers
- Force stripping of assumptions
- Isolate fundamentals
- Examples:
  - "What must be true?"
  - "Which assumptions are automatic here?"
  - "Remove everything non-essential, what remains?"

**DON'T:**

- Ask what the user "thinks" about the problem
- Ask for solution preferences
- Ask for justification or rationalization
- Ask for analysis of choices during the process

### Question Tracking

- **Total Questions**: 10-12 questions per session
- **State Tracking**: Questions and answers stored in `ConversationContext.firstPrinciplesState`
- **Progress**: System tracks which question number (1-12) is current
- **Completion**: After all questions answered, automatically trigger synthesis

## Synthesis Output

After the question sequence, the system provides structured synthesis covering:

### 1. Core Truths

- Fundamental facts or principles that cannot be denied
- What is absolutely true about the problem/system

### 2. False Assumptions

- Beliefs taken for granted that distort reality
- Assumptions that need to be challenged or removed

### 3. Reconstruction

- How to reassemble the problem/system from the ground up
- Foundation for planning from first principles

### 4. Actionable Insights

- Practical changes or experiments based on foundational analysis
- Concrete next steps derived from core truths

## Integration with Normal Assumptions Flow

After synthesis is generated:

1. **Synthesis becomes context** for normal assumptions analysis
2. **Normal assumptions workflow continues**:
   - List assumptions about codebase and context
   - Identify edge cases
   - Create numbered plan (Step 1:, Step 2:, Step 3:)
3. **Plan generation** uses Reconstruction from synthesis as foundation
4. **Proceed to Implementation** stage normally

## State Management

### ConversationContext Extensions

```typescript
interface ConversationContext {
  // ... existing fields
  firstPrinciplesMode?: boolean; // Is first-principles mode active?
  firstPrinciplesState?: {
    questionsAsked: number; // How many questions asked (0-12)
    questionsRemaining: number; // How many questions left
    answers: Record<number, string>; // Question number → answer mapping
    synthesisGenerated?: boolean; // Has synthesis been generated?
    synthesis?: {
      coreTruths: string[];
      falseAssumptions: string[];
      reconstruction: string;
      actionableInsights: string[];
    };
  };
}
```

### State Transitions

```
1. User triggers first-principles
   → firstPrinciplesMode = true
   → firstPrinciplesState initialized
   → questionsAsked = 0

2. System asks Question 1
   → questionsAsked = 1
   → questionsRemaining = 11

3. User answers Question 1
   → answers[1] = "answer text"
   → System asks Question 2
   → questionsAsked = 2
   → questionsRemaining = 10

... (continues for 10-12 questions)

12. User answers Question 12
    → answers[12] = "answer text"
    → questionsAsked = 12
    → questionsRemaining = 0
    → synthesisGenerated = true
    → Generate synthesis

13. Synthesis complete
    → Continue with normal assumptions analysis
    → Use synthesis as context
    → Generate numbered plan
```

## Template Structure

The first-principles template (`templates/first-principles.j2`) includes:

1. **Stage Instructions**: Standard assumptions stage instructions
2. **First-Principles Instructions**:
   - Question guidelines
   - Synthesis requirements
   - Integration with normal assumptions flow
3. **Rules**: Standard rules from RulesManager
4. **User Query**: The current prompt

## Example Flow

```
User: "I want to refactor my authentication system. @first-principles"

→ Assumptions Stage (First-Principles Mode Activated)

Assistant: "Let's break this down to fundamentals. Question 1: What must be true for authentication to work?"

User: "Users must prove identity"

Assistant: "Question 2: Which assumptions are automatic here?"

User: "That passwords are the only way"

Assistant: "Question 3: Remove everything non-essential, what remains?"

User: "Identity verification"

... (continues for 10-12 questions)

Assistant: "## Synthesis

**Core Truths:**
- Authentication requires identity verification
- System must distinguish between authorized and unauthorized users

**False Assumptions:**
- Passwords are the only authentication method
- Current implementation is optimal

**Reconstruction:**
- Build authentication from identity verification principle
- Support multiple authentication methods
- Separate authentication from authorization

**Actionable Insights:**
- Implement multi-factor authentication
- Use token-based authentication
- Separate auth logic from business logic

## Assumptions Analysis

Based on the first-principles analysis above:

**Assumptions:**
- Current codebase uses password-based auth
- Need to support multiple auth methods
- Token-based system preferred

**Edge Cases:**
- Token expiration
- Multiple concurrent sessions
- Password reset flow

**Plan:**
Step 1: Create authentication service with token support
Step 2: Implement multi-factor authentication
Step 3: Refactor existing password auth to use new service
Step 4: Add token refresh mechanism
"
```

## Configuration

### Default Behavior

- **Enabled**: `false` (disabled by default)
- **Questions**: 10-12 questions per session
- **Auto-synthesis**: After all questions answered

### Future Configuration Options

- Number of questions (configurable)
- Synthesis format customization
- Question templates
- Integration depth (how much synthesis influences plan)

## Key Rules

1. **First-Principles is a Mode**: Not a separate stage, but a mode within Assumptions stage
2. **Question Sequence**: 10-12 questions, tracked in conversation state
3. **Synthesis Required**: After questions, synthesis must be generated before normal assumptions
4. **Plan Integration**: Synthesis informs but doesn't replace normal assumptions analysis
5. **Default Disabled**: Must be explicitly activated (command or keyword)
6. **State Persistence**: First-principles state persists across messages in same conversation
7. **Mode Reset**: First-principles mode resets when transitioning out of assumptions stage

## Implementation Details

### Detection Logic

- Detects first-principles triggers in user prompt
- Sets `firstPrinciplesMode = true` in ConversationContext
- Initializes `firstPrinciplesState`

### Template Selection

- When in Assumptions stage AND `firstPrinciplesMode === true`
- Use `first-principles.j2` template instead of `assumptions.j2`
- After synthesis generated, can switch back to normal assumptions template

### Question Management

- `AssumptionsManager` tracks question count
- After 12 questions answered, triggers synthesis generation
- Synthesis stored in `firstPrinciplesState.synthesis`

### Plan Generation

- Normal `AssumptionsManager.createOrUpdatePlan()` is called
- Synthesis included as context in prompt
- Plan generation uses Reconstruction from synthesis

## Benefits

1. **Deeper Analysis**: Strips assumptions before planning
2. **Better Plans**: Plans built from fundamental truths
3. **User Engagement**: Interactive questioning process
4. **Structured Output**: Clear synthesis format
5. **Flexible Integration**: Works with existing assumptions workflow
