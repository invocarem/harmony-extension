# FileManager Class Diagnostics and Design Proposal

## Executive Summary

This document provides diagnostics and design recommendations for a `FileManager` class to support the chat stage workflow, with the following priorities:

**FIRST PRIORITY: Problem Restatement**
- The AI must re-state the user's problem clearly and accurately
- FileManager helps identify relevant files to include in problem restatement
- Problem restatement comes BEFORE information collection and response generation

Secondary objectives:
- **Information Collection**: Automatically locating and collecting files mentioned in user queries (e.g., "calc.py")
- **Workspace File Identification**: Enabling the AI to identify and understand files in the workspace folder at chat stage
- **Cross-Stage Context**: Building file awareness that helps in subsequent stages (assumptions → implementation)
- **Context Provision**: Making file information available to the AI before it formulates its response

## Current State Analysis

### Existing File Handling Infrastructure

#### 1. **FileContextExtractor** (`src/utils/fileContextExtractor.ts`)
- **Purpose**: Extracts file references from messages containing `@file` syntax
- **Capabilities**:
  - Parses `@file:path` and `@file(path)` patterns
  - Reads file contents when explicitly referenced
  - Handles current file references (`@file` without arguments)
  - Formats file contexts for prompt inclusion
- **Limitations**:
  - Only works with explicit `@file` syntax
  - Does not automatically detect file names in natural language queries
  - Requires user to explicitly reference files using special syntax

#### 2. **NativeToolsManager** (`src/nativeToolManager.ts`)
- **Tools Available**:
  - `find_files`: Searches for files by name pattern (substring or regex)
  - `read_file`: Reads file contents
  - `list_files`: Lists directory contents
  - `grep_files`: Searches for text patterns in file contents
- **Chat Stage Availability**: All read-only tools are available in chat stage
- **Limitations**:
  - Tools must be explicitly called by the AI
  - No proactive file detection or collection
  - AI must manually use `find_files` to locate files mentioned in queries

#### 3. **Chat Stage Workflow** (`src/extension.ts` → `handleChatMessage`)
- Current flow:
  1. User sends message
  2. `FileContextExtractor.extractFileReferences()` processes `@file` syntax
  3. File contexts are added to the prompt
  4. AI receives prompt with explicit file references
  5. AI can use read-only tools if needed
- **Gap**: No automatic detection of file names in natural language queries

### Chat Stage Requirements (from `templates/chat.j2`)

The chat stage template specifies:
- AI should re-state the problem
- Only read-only tools (read_file, list_files, grep_files) are available
- When read-only tools are available and helpful: Use them to gather code context, then provide response
- Be direct and concise

**Key Insight**: The AI workflow at chat stage MUST follow this priority order:
1. **FIRST: Re-state the problem** - Always start by clearly restating what the user is asking for
2. **SECOND: Collect information** - If needed, gather context (files, workspace info) to understand the problem better
3. **THIRD: Provide a helpful response** - Answer the question based on the restated problem and collected information

**Problem restatement is non-negotiable and must come first.**

## Problem Statement

### Primary Requirement
**At chat stage, the AI assistant needs to identify files in the workspace folder. This knowledge will help in subsequent stages (assumptions and implementation).**

### Current Limitations

When a user asks a question like "calc.py" or "show me calc.py" or "what does calc.py do?", the current system:

1. ✅ Can handle explicit references: `@file:calc.py`
2. ❌ Cannot automatically detect that "calc.py" in natural language refers to a file
3. ❌ Does not proactively locate and collect file information before the AI responds
4. ❌ Forces the AI to manually call `find_files` to locate the file, adding latency
5. ❌ **No workspace file awareness**: AI doesn't have knowledge of available files in the workspace
6. ❌ **Limited context for next stages**: File knowledge from chat stage doesn't carry forward effectively

### User Experience Gaps

1. **Natural Language Understanding**: Users expect the AI to automatically understand file references without explicit `@file` syntax
2. **Workspace Awareness**: AI should be able to identify and reference files in the workspace folder
3. **Cross-Stage Continuity**: File knowledge gathered at chat stage should inform assumptions and implementation stages

## Proposed Solution: FileManager Class

### Purpose

A `FileManager` class that supports the chat stage workflow with **problem restatement as the first priority**:

**Primary Purpose (First Priority):**
1. **Supports Problem Restatement**: Identifies relevant files and context to help the AI accurately re-state the user's problem. The FileManager provides file information specifically to enhance problem understanding and restatement.

**Secondary Purposes:**
2. **Identifies files in workspace**: Discovers and catalogs files in the workspace folder
3. **Detects** file names mentioned in user queries
4. **Locates** files in the workspace using intelligent search
5. **Collects** file contents and metadata when needed for problem understanding
6. **Builds workspace awareness**: Creates a knowledge base of available files that persists across stages
7. **Provides** formatted context to be included in prompts (prioritizing problem restatement context)
8. **Enables cross-stage context**: Makes file knowledge available to assumptions and implementation stages

**Workflow Priority**: Problem Restatement → File Collection → Response

### Design Principles

1. **Non-Intrusive**: Works alongside existing `FileContextExtractor` without breaking current functionality
2. **Chat Stage Focused**: Specifically designed for chat stage workflow requirements
3. **Intelligent Matching**: Uses heuristics to identify file references in natural language
4. **Performance Conscious**: Caches results, avoids redundant searches
5. **Diagnostic Support**: Provides detailed diagnostics for troubleshooting

### Class Design

```typescript
// Proposed location: src/utils/fileManager.ts

export interface FileReference {
  type: 'file' | 'directory' | 'ambiguous';
  path: string;              // Absolute path
  relativePath: string;      // Relative to workspace root
  content?: string;          // File contents (if file)
  metadata?: {
    size?: number;
    extension?: string;
    lastModified?: Date;
  };
  confidence: 'high' | 'medium' | 'low';  // Confidence in match
  matchType: 'exact' | 'pattern' | 'similar';  // How it was matched
}

export interface WorkspaceFileIndex {
  files: Array<{
    relativePath: string;
    extension: string;
    size: number;
    directory: string;
  }>;
  directories: string[];
  projectStructure: {
    rootFiles: string[];
    commonDirectories: string[];
    fileTypes: Map<string, number>;  // extension -> count
  };
  lastUpdated: Date;
}

export interface FileDetectionResult {
  detectedFiles: FileReference[];
  ambiguousMatches: FileReference[];  // Files that might match but aren't certain
  diagnostics: {
    queryTokens: string[];            // Tokens extracted from query
    searchPatterns: string[];         // Patterns used for searching
    searchResults: Array<{
      pattern: string;
      matches: number;
      files: string[];
    }>;
    processingTime: number;
  };
}

export class FileManager {
  private workspaceRoot: string | undefined;
  private fileCache: Map<string, { content: string; timestamp: number }>;
  private searchCache: Map<string, FileReference[]>;
  private workspaceIndex: WorkspaceFileIndex | null = null;
  
  constructor() {
    // Initialize workspace root
    // Initialize caches
    // Optionally pre-index workspace for faster lookups
  }

  /**
   * Build or refresh workspace file index
   * Creates a catalog of files in the workspace for AI awareness
   */
  async buildWorkspaceIndex(options?: {
    includeHidden?: boolean;
    excludePatterns?: string[];
    maxDepth?: number;
  }): Promise<WorkspaceFileIndex>

  /**
   * Get workspace file index (cached or fresh)
   * Provides overview of files in workspace
   */
  async getWorkspaceIndex(): Promise<WorkspaceFileIndex>

  /**
   * Get workspace structure summary for AI context
   * Returns formatted string describing project structure
   */
  getWorkspaceStructureSummary(index?: WorkspaceFileIndex): string

  /**
   * Main entry point: Detect and collect files from user query
   * Used at chat stage to proactively gather file information
   */
  async detectAndCollectFiles(
    userQuery: string,
    options?: {
      includeContent?: boolean;      // Whether to read file contents
      maxFiles?: number;              // Maximum files to collect
      confidenceThreshold?: 'high' | 'medium' | 'low';
      includeWorkspaceContext?: boolean;  // Include workspace overview
    }
  ): Promise<FileDetectionResult>

  /**
   * Detect potential file references in natural language query
   * Returns candidate file names/patterns
   */
  private detectFileReferences(query: string): string[]

  /**
   * Locate files in workspace matching the detected references
   */
  private async locateFiles(
    patterns: string[],
    options?: { maxResults?: number }
  ): Promise<FileReference[]>

  /**
   * Read file contents if requested
   */
  private async readFileContents(
    files: FileReference[]
  ): Promise<FileReference[]>

  /**
   * Format file references for prompt inclusion
   * Similar to FileContextExtractor.formatFileContexts but tailored for chat stage
   */
  formatForChatPrompt(
    result: FileDetectionResult,
    includeDiagnostics?: boolean
  ): string

  /**
   * Generate problem restatement with file context
   * Helps AI re-state the problem mentioning relevant files
   */
  generateProblemRestatement(
    originalQuery: string,
    detectedFiles: FileReference[]
  ): string

  /**
   * Get files relevant to query for cross-stage context
   * Returns file references that should be available in next stages
   */
  getFilesForNextStage(
    detectedFiles: FileReference[],
    workspaceIndex?: WorkspaceFileIndex
  ): FileReference[]
}
```

### Integration Points

#### 1. **Extension.ts - handleChatMessage**
```typescript
// Before sending to AI:
const fileManager = new FileManager();

// Option 1: Build workspace index for awareness (can be cached)
const workspaceIndex = await fileManager.getWorkspaceIndex();

// Option 2: Detect files from query AND provide workspace context
const fileDetection = await fileManager.detectAndCollectFiles(text, {
  includeContent: true,
  maxFiles: 5,
  confidenceThreshold: 'medium',
  includeWorkspaceContext: true  // Include workspace overview
});

// Add file context to prompt
let fileContext = '';
if (fileDetection.detectedFiles.length > 0) {
  fileContext = fileManager.formatForChatPrompt(fileDetection);
} else {
  // Even if no specific files detected, provide workspace awareness
  const workspaceSummary = fileManager.getWorkspaceStructureSummary(workspaceIndex);
  fileContext = `📁 WORKSPACE CONTEXT:\n${workspaceSummary}\n\n`;
}

finalMessage = fileContext + '\n\n' + 'USER REQUEST:\n' + finalMessage;

// Store file references for next stages
const filesForNextStage = fileManager.getFilesForNextStage(
  fileDetection.detectedFiles,
  workspaceIndex
);
// These can be stored in conversation context for assumptions/implementation stages
```

#### 2. **Relationship with FileContextExtractor**
- **FileContextExtractor**: Handles explicit `@file` syntax (existing functionality)
- **FileManager**: Handles implicit file references in natural language (new functionality)
- **Cooperation**: Both can work together:
  1. First, FileContextExtractor processes `@file` syntax
  2. Then, FileManager processes the cleaned message for implicit references
  3. Merge results, prioritizing explicit references

#### 3. **Chat Stage Template Integration**
The chat template must emphasize problem restatement as the FIRST priority:
```
**FIRST PRIORITY: Problem Restatement**
- **MUST re-state the problem first**: Always start your response by clearly restating what the user is asking for
- Use the file context provided to understand which files are relevant to the problem
- Include relevant file names in your problem restatement when appropriate
- Example: "You're asking about [problem description], and I can see [relevant files] that relate to this."

**SECOND: Information Collection**
- **File Detection**: Files mentioned in your query have been automatically located and included above
- **Workspace Awareness**: You have access to information about files in the workspace. Use this knowledge to understand the project structure if needed.
- Use the provided file contexts to better understand the problem

**THIRD: Response**
- Provide a helpful response based on your restatement of the problem
- The files you identify here will help in the assumptions and implementation stages

**Remember: Problem restatement comes FIRST, before any information gathering or response.**
```

#### 4. **Cross-Stage Context Integration**
Files identified at chat stage should be available in subsequent stages:

```typescript
// In ConversationContext or similar
interface ConversationContext {
  // ... existing fields
  identifiedFiles?: FileReference[];  // Files identified at chat stage
  workspaceIndex?: WorkspaceFileIndex;  // Workspace structure knowledge
}

// At assumptions/implementation stages, these files are available
// allowing AI to reference and use them without re-discovery
```

### File Detection Heuristics

#### Pattern Recognition
1. **Exact Filename Matches**:
   - Patterns like: `"calc.py"`, `'app.js'`, `(config.json)`
   - Quoted strings are strong indicators
   - File extensions (.py, .js, .ts, .json, etc.) are strong indicators

2. **Common Phrases**:
   - "show me [filename]"
   - "what does [filename] do"
   - "read [filename]"
   - "look at [filename]"
   - "[filename] file"
   - "the [filename]"

3. **Token Analysis**:
   - Split query into tokens
   - Identify tokens that:
     - Contain file extensions
     - Match common file naming patterns
     - Are quoted strings
     - Follow phrases like "file", "script", "module"

4. **Confidence Scoring**:
   - **High**: Quoted filename with extension, exact match found
   - **Medium**: Unquoted filename with extension, pattern match found
   - **Low**: Unquoted token that might be a filename, multiple matches

#### Search Strategy
1. **Try exact match first**: Search for exact filename in workspace
2. **Try pattern match**: Use `find_files` tool with substring matching
3. **Try similar names**: Fuzzy matching for typos
4. **Limit results**: Return top N matches ranked by relevance

### Example Usage Scenarios

#### Scenario 1: Simple File Reference
**User Query**: "calc.py"

**FileManager Behavior**:
1. Optionally builds/refreshes workspace index for context
2. Detects "calc.py" as high-confidence file reference (has extension)
3. Searches workspace for "calc.py"
4. If found: Reads content and includes in context
5. If not found: Returns diagnostics showing search attempted, suggests similar files from workspace index

**Prompt Addition**:
```
📁 WORKSPACE CONTEXT:
Project contains 45 files:
- 12 Python files (.py)
- 8 TypeScript files (.ts)
- 3 JSON files (.json)
- Common directories: src/, tests/, dist/

📁 FILE CONTEXT DETECTED:

## File: calc.py
Location: src/utils/calc.py
[File content here]

---

**IMPORTANT: Start your response by re-stating the problem first.**
Example restatement: "You're asking about the calc.py file. Based on the file content, I can see..."

**For Next Stages**: This file (calc.py) has been identified and will be available in assumptions/implementation stages.

USER REQUEST:
calc.py
```

#### Scenario 2: Natural Language Query
**User Query**: "what does the app.js file do?"

**FileManager Behavior**:
1. Detects "app.js" from phrase "the app.js file"
2. Searches for "app.js"
3. Reads content
4. Includes in context with problem restatement hint

**Prompt Addition**:
```
📁 FILE CONTEXT DETECTED:

## File: app.js
[File content here]

---

**IMPORTANT: Your FIRST priority is to re-state the problem.**
Start with: "You're asking about the app.js file and what it does."

Then proceed with your analysis and response.

USER REQUEST:
what does the app.js file do?
```

#### Scenario 3: Ambiguous Reference
**User Query**: "show me the config file"

**FileManager Behavior**:
1. Uses workspace index to understand available config files
2. Detects "config" as potential file reference (low confidence, no extension)
3. Searches for files containing "config" in name
4. Finds multiple matches: config.json, config.yaml, config.js
5. Returns ambiguous matches with diagnostics and workspace context

**Prompt Addition**:
```
📁 WORKSPACE CONTEXT:
Project structure shows:
- Configuration files in root: config.json, config.yaml
- Configuration in src/: src/config.js

📁 MULTIPLE FILES DETECTED:

The query mentions "config file". Found multiple matches in workspace:
- config.json (root, 2.3KB)
- config.yaml (root, 1.8KB)  
- src/config.js (src/, 4.1KB)

Please clarify which file you're referring to, or I can show all of them.

USER REQUEST:
show me the config file
```

#### Scenario 4: Workspace Exploration
**User Query**: "what files are in this project?"

**FileManager Behavior**:
1. Builds/uses workspace index
2. Provides structured overview of project
3. Highlights important files (package.json, README, main entry points)

**Prompt Addition**:
```
📁 WORKSPACE OVERVIEW:

Project Structure:
- Root files: package.json, README.md, tsconfig.json
- Source code (src/): 23 TypeScript files
  - Main entry: src/extension.ts
  - Components: src/harmony/, src/utils/
- Tests (src/__tests__/): 15 test files
- Configuration: package.json, tsconfig.json, webpack.config.js

Key Files:
- package.json: Project configuration
- src/extension.ts: Main extension entry point
- README.md: Project documentation

USER REQUEST:
what files are in this project?
```

### Diagnostics and Observability

#### Diagnostic Information Provided

1. **Detection Diagnostics**:
   - Which tokens were identified as potential file references
   - Confidence scores for each detection
   - Reasoning for detection decisions

2. **Search Diagnostics**:
   - Search patterns used
   - Number of matches found for each pattern
   - Search performance (time taken)
   - Cache hits/misses

3. **Result Diagnostics**:
   - Files found vs. files requested
   - Ambiguous matches
   - Errors encountered
   - Suggestions for improvement

#### Diagnostic Output Format

```typescript
interface FileManagerDiagnostics {
  detection: {
    queryTokens: string[];
    detectedPatterns: Array<{
      pattern: string;
      confidence: 'high' | 'medium' | 'low';
      reasoning: string;
    }>;
  };
  search: {
    patternsSearched: string[];
    resultsPerPattern: Array<{
      pattern: string;
      matchesFound: number;
      files: string[];
      searchTime: number;
    }>;
    totalSearchTime: number;
    cacheStats: {
      hits: number;
      misses: number;
    };
  };
  collection: {
    filesFound: number;
    filesRead: number;
    errors: Array<{
      file: string;
      error: string;
    }>;
  };
}
```

### Benefits

1. **Problem Restatement Support (FIRST PRIORITY)**:
   - FileManager provides file context specifically to enable accurate problem restatement
   - AI can mention specific files in problem restatement
   - More accurate understanding of user intent through file awareness
   - Can reference workspace structure when restating the problem
   - **Ensures problem restatement comes first** by providing necessary context upfront

2. **Improved User Experience**:
   - No need for `@file` syntax for simple queries
   - Faster responses (files pre-loaded)
   - More natural interaction
   - AI understands project structure

3. **Workspace Awareness**:
   - AI can identify files in workspace folder
   - Knowledge of project structure and file organization
   - Context about available files without explicit queries

4. **Cross-Stage Continuity**:
   - Files identified at chat stage help in assumptions stage
   - Workspace knowledge informs implementation stage
   - Reduces need to re-discover files in later stages
   - Better context for code generation and modification

5. **Reduced AI Tool Calls**:
   - Files are already loaded, reducing need for `find_files` calls
   - AI can focus on answering rather than gathering information
   - Faster response times
   - Workspace index reduces search overhead

6. **Diagnostic Capabilities**:
   - Understanding why files were/were not detected
   - Performance monitoring
   - Debugging file search issues
   - Workspace indexing metrics

### Potential Challenges

1. **False Positives**:
   - Tokens that look like filenames but aren't (e.g., "python" in "python code")
   - **Mitigation**: Confidence scoring, context awareness, user confirmation for ambiguous cases

2. **Performance**:
   - Searching workspace can be slow for large projects
   - **Mitigation**: Caching, limiting search scope, async processing

3. **Ambiguity**:
   - Multiple files with similar names
   - **Mitigation**: Return all matches with diagnostics, let AI handle ambiguity

4. **Integration Complexity**:
   - Must work alongside existing FileContextExtractor
   - **Mitigation**: Clear separation of concerns, optional integration

### Implementation Recommendations

#### Phase 1: Core Detection (MVP)
- Basic pattern recognition (quoted strings, extensions)
- Simple file search using existing `find_files` tool
- Basic formatting for prompt inclusion
- Diagnostic output structure

#### Phase 2: Enhanced Detection
- Natural language phrase detection
- Confidence scoring
- Ambiguous match handling
- Caching layer

#### Phase 3: Optimization
- Performance improvements
- Advanced search strategies
- Integration with FileContextExtractor
- Comprehensive diagnostics

### Testing Strategy

1. **Unit Tests**:
   - Pattern detection accuracy
   - File search functionality
   - Formatting output
   - Diagnostic generation

2. **Integration Tests**:
   - End-to-end flow in chat stage
   - Interaction with FileContextExtractor
   - Tool call reduction verification

3. **Performance Tests**:
   - Large workspace handling
   - Cache effectiveness
   - Search time benchmarks

4. **User Experience Tests**:
   - Natural language query understanding
   - False positive rate
   - Response time improvements

## Conclusion

A `FileManager` class would significantly enhance the chat stage workflow by prioritizing problem restatement:

**Primary Benefit:**
- **Supporting Problem Restatement (FIRST PRIORITY)**: FileManager provides file context specifically to help the AI accurately re-state the user's problem. Problem restatement must come first, before any information collection or response generation.

**Additional Benefits:**
- **Enabling workspace file identification**: AI can identify and understand files in the workspace folder
- Automatically detecting and collecting files from natural language queries
- Building workspace awareness that persists across stages
- Providing context before the AI formulates its response (primarily for problem restatement)
- **Helping subsequent stages**: File knowledge from chat stage informs assumptions and implementation stages
- Reducing the need for explicit tool calls
- Providing comprehensive diagnostics

The design should:
- **Prioritize problem restatement**: All file collection and context provision should support the primary goal of enabling accurate problem restatement
- Work alongside existing `FileContextExtractor`
- Focus on chat stage requirements with cross-stage benefits
- Build and maintain workspace file index for awareness
- Use intelligent heuristics for file detection
- Provide detailed diagnostics
- Be performant and cache-aware
- **Support cross-stage context**: Make identified files available to assumptions/implementation stages

**Workflow**: Problem Restatement (FIRST) → File Collection → Response

This addresses the core requirement: **At chat stage, the AI assistant can identify files in the workspace folder, which will help on the next stage (assumptions and implementation)**. The FileManager enables workspace awareness at chat stage that carries forward, while ensuring that problem restatement remains the first priority in the chat stage workflow.

