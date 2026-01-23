# First Principles Thinking Mode

## Overview

First Principles Thinking is a specialized analysis mode within the **Chat/Clarification** stage that guides users through a structured process to break down problems into fundamental truths during problem restatement, enabling deeper understanding from the ground up.

## Purpose

First Principles Thinking provides:

- **Deep Analysis**: Strips away assumptions and identifies core truths during problem clarification
- **Structured Questioning**: Asks 6-8 targeted questions to isolate fundamentals
- **Enhanced Restatement**: Produces problem restatement based on core requirements and real constraints
- **Better Planning**: Provides solid foundation for the assumptions stage planning

## Integration with Chat Stage

First Principles Thinking is **not a separate stage** but a **mode within the Chat/Clarification stage**:

```
Chat (First-Principles Mode) → Assumptions → Implementation
```

### Flow

1. **User enters Chat stage** with first-principles trigger or setting enabled
2. **Question Phase**: System asks 6-8 short, concrete questions to strip assumptions
3. **Restatement Phase**: After questions answered, provide restated problem based on fundamentals
4. **Normal Chat Phase**: Continue with clarifying questions and tool usage
5. **Proceed to Assumptions**: Normal flow continues with solid understanding

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
  - "What must be true for this to work?"
  - "Which assumptions are we making automatically?"
  - "Remove everything non-essential, what remains?"
  - "What is the absolute minimum required?"
  - "What's the real constraint here?"

**DON'T:**

- Ask what the user "thinks" about solutions
- Ask for solution preferences
- Ask for justification or rationalization
- Ask for analysis of choices during the process

### Question Tracking

- **Total Questions**: 6-8 questions per session
- **State Tracking**: Questions and answers stored in `ConversationContext.firstPrinciplesState`
- **Progress**: System tracks which question number (1-8) is current
- **Completion**: After all questions answered, automatically provide restated problem

## Restatement Output

After the question sequence, the system provides a restated problem statement covering:

### 1. Core Requirements

- What absolutely must be true (stripped of assumptions)
- Essential elements that cannot be removed

### 3. Essential Elements

- The irreducible components needed to address the problem
- What truly matters vs. what's nice to have

### 4. Clarifications Needed

- Any remaining ambiguities that need resolution
- Questions for further understanding

## Integration with Normal Chat Flow

After restatement is generated:

1. **Restatement becomes foundation** for continued chat stage clarification
2. **Normal chat workflow continues**:
   - Ask any remaining clarifying questions
   - Use read-only tools to understand codebase
   - Confirm understanding with user
3. **Transition to Assumptions** stage with solid understanding
4. **Proceed to Implementation** stage normally

## State Management

### ConversationContext Extensions

```typescript
interface ConversationContext {
  // ... existing fields
  firstPrinciplesMode?: boolean; // Is first-principles mode active?
  firstPrinciplesState?: {
    questionsAsked: number; // How many questions asked (0-8)
    questionsRemaining: number; // How many questions left
    answers: Record<number, string>; // Question number → answer mapping
    restatementGenerated?: boolean; // Has restatement been generated?
    restatement?: {
      coreRequirements: string[];
      realConstraints: string[];
      essentialElements: string[];
      clarificationsNeeded: string[];
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
