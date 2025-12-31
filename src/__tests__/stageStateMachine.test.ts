import { StageStateMachine, WorkflowStage } from '../harmony/stageStateMachine';
import { ChatMessage } from '../conversationManager';
import { MCPToolResult } from '../mcpClient';

describe('StageStateMachine', () => {
  let stateMachine: StageStateMachine;

  beforeEach(() => {
    stateMachine = new StageStateMachine();
  });

  describe('getInstructions()', () => {
    it('should return chat stage instructions', () => {
      const instructions = stateMachine.getInstructions('chat');
      
      expect(instructions).toContain('CHAT/CLARIFICATION');
      expect(instructions).toContain('Chat/Clarification');
      expect(instructions).toContain('restate the user\'s problem FIRST');
      expect(instructions).toContain('Do NOT use file modification tools');
      expect(instructions).toContain('read-only tools');
      expect(instructions).toContain('Chat → Analysis');
      expect(instructions).toContain('Implementation');
    });

    it('should return assumptions stage instructions', () => {
      const instructions = stateMachine.getInstructions('assumptions');
      
      expect(instructions).toContain('ASSUMPTIONS/ANALYSIS');
      expect(instructions).toContain('Assumptions/Analysis');
      expect(instructions).toContain('code snippets');
      // Check for key phrases separately to be more robust against wording changes
      expect(instructions).toMatch(/DO NOT.*file modification tools/i);
      expect(instructions).toContain('file modification tools');
      // MCP tools are now available in assumptions stage
      expect(instructions).toContain('MCP Tools are AVAILABLE');
      expect(instructions).toMatch(/provide code snippets/i);
      expect(instructions).toContain('break it down into steps');
      expect(instructions).toContain('Use MCP tools when needed');
    });

    it('should return implementation stage instructions', () => {
      const instructions = stateMachine.getInstructions('implementation');
      
      expect(instructions).toContain('IMPLEMENTATION');
      expect(instructions).toContain('create_file');
      expect(instructions).toContain('replace_file');
      expect(instructions).toContain('All tools are available');
      expect(instructions).toContain('conversation history');
      expect(instructions).toContain('If code exists in conversation history');
      expect(instructions).toContain('If code doesn\'t exist');
    });

    it('should return empty string for invalid stage', () => {
      // TypeScript should prevent this, but test runtime behavior
      const instructions = stateMachine.getInstructions('invalid' as WorkflowStage);
      expect(instructions).toBe('');
    });
  });

  describe('getAllowedTools()', () => {
    const allTools = [
      { name: 'read_file', description: 'Read a file', type: 'native' as const },
      { name: 'list_files', description: 'List files', type: 'native' as const },
      { name: 'grep_files', description: 'Search files', type: 'native' as const },
      { name: 'create_file', description: 'Create a file', type: 'native' as const },
      { name: 'replace_file', description: 'Replace file content', type: 'native' as const },
      { name: 'delete_file', description: 'Delete a file', type: 'native' as const },
      { name: 'custom_tool', description: 'Custom tool', type: 'mcp' as const },
    ];

    it('should filter out file modification tools in chat stage', () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, 'chat');
      
      const allowedNames = allowedTools.map(t => t.name);
      expect(allowedNames).toContain('read_file');
      expect(allowedNames).toContain('list_files');
      expect(allowedNames).toContain('grep_files');
      // MCP tools are NOT available in chat stage, only read-only native tools
      expect(allowedNames).not.toContain('custom_tool');
      expect(allowedNames).not.toContain('create_file');
      expect(allowedNames).not.toContain('replace_file');
      expect(allowedNames).not.toContain('delete_file');
    });

    it('should filter out file modification tools in assumptions stage', () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, 'assumptions');
      
      const allowedNames = allowedTools.map(t => t.name);
      expect(allowedNames).toContain('read_file');
      expect(allowedNames).toContain('list_files');
      expect(allowedNames).toContain('grep_files');
      expect(allowedNames).toContain('custom_tool');
      expect(allowedNames).not.toContain('create_file');
      expect(allowedNames).not.toContain('replace_file');
      expect(allowedNames).not.toContain('delete_file');
    });

    it('should allow all tools in implementation stage', () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, 'implementation');
      
      expect(allowedTools.length).toBe(allTools.length);
      const allowedNames = allowedTools.map(t => t.name);
      expect(allowedNames).toContain('read_file');
      expect(allowedNames).toContain('create_file');
      expect(allowedNames).toContain('replace_file');
      expect(allowedNames).toContain('delete_file');
      expect(allowedNames).toContain('custom_tool');
    });

    it('should preserve tool properties when filtering', () => {
      const allowedTools = stateMachine.getAllowedTools(allTools, 'chat');
      
      const readFileTool = allowedTools.find(t => t.name === 'read_file');
      expect(readFileTool).toBeDefined();
      expect(readFileTool?.description).toBe('Read a file');
      expect(readFileTool?.type).toBe('native');
    });

    it('should handle empty tools array', () => {
      const allowedTools = stateMachine.getAllowedTools([], 'chat');
      expect(allowedTools).toEqual([]);
    });

    it('should handle read-only tools list correctly in chat stage', () => {
      const toolsWithReadOnly = [
        { name: 'read_file' },
        { name: 'list_files' },
        { name: 'grep_files' },
        { name: 'search_files' },
        { name: 'read_directory' },
        { name: 'create_file' },
      ];

      const allowedTools = stateMachine.getAllowedTools(toolsWithReadOnly, 'chat');
      const allowedNames = allowedTools.map(t => t.name);
      
      expect(allowedNames).toContain('read_file');
      expect(allowedNames).toContain('list_files');
      expect(allowedNames).toContain('grep_files');
      expect(allowedNames).toContain('search_files');
      expect(allowedNames).toContain('read_directory');
      expect(allowedNames).not.toContain('create_file');
    });
  });

  describe('canTransition()', () => {
    it('should allow staying in the same stage', () => {
      expect(stateMachine.canTransition('chat', 'chat')).toBe(true);
      expect(stateMachine.canTransition('assumptions', 'assumptions')).toBe(true);
      expect(stateMachine.canTransition('implementation', 'implementation')).toBe(true);
    });

    it('should allow valid transitions', () => {
      // Chat → Assumptions
      expect(stateMachine.canTransition('chat', 'assumptions')).toBe(true);
      
      // Assumptions → Implementation
      expect(stateMachine.canTransition('assumptions', 'implementation')).toBe(true);
      
      // Assumptions → Chat
      expect(stateMachine.canTransition('assumptions', 'chat')).toBe(true);
      
      // Implementation → Chat
      expect(stateMachine.canTransition('implementation', 'chat')).toBe(true);
      
      // Implementation → Assumptions
      expect(stateMachine.canTransition('implementation', 'assumptions')).toBe(true);
    });

    it('should disallow invalid transitions', () => {
      // Chat → Implementation (NOT ALLOWED - must go through Analysis first)
      expect(stateMachine.canTransition('chat', 'implementation')).toBe(false);
    });
  });

  describe('determineNextStage()', () => {
    it('should detect explicit "move to implementation" command from assumptions stage', () => {
      const nextStage = stateMachine.determineNextStage('assumptions', 'move to implementation');
      expect(nextStage).toBe('implementation');
    });

    it('should reject "move to implementation" from chat stage (invalid transition)', () => {
      const nextStage = stateMachine.determineNextStage('chat', 'move to implementation');
      expect(nextStage).toBe(null); // Invalid transition
    });

    it('should detect code-related questions and transition to assumptions from chat', () => {
      const nextStage = stateMachine.determineNextStage('chat', 'how to implement a function');
      expect(nextStage).toBe('assumptions');
    });

    it('should detect file operations with extensions and transition to assumptions from chat', () => {
      const nextStage = stateMachine.determineNextStage('chat', 'create hello.py file');
      expect(nextStage).toBe('assumptions');
    });

    it('should NOT auto-transition from assumptions to implementation for file operations (auto-transition disabled)', () => {
      // Auto-transition is disabled - file operations with extensions no longer auto-transition
      // Users must explicitly say "move to implementation" to transition
      const nextStage = stateMachine.determineNextStage('assumptions', 'create config.json');
      expect(nextStage).toBeNull(); // Should stay in assumptions stage
    });

    it('should detect explicit implementation commands from assumptions stage', () => {
      const nextStage = stateMachine.determineNextStage('assumptions', 'now create the file');
      expect(nextStage).toBe('implementation');
    });

    it('should detect clarification requests and transition to chat from implementation', () => {
      const nextStage = stateMachine.determineNextStage('implementation', 'what went wrong?');
      expect(nextStage).toBe('chat');
    });

    it('should detect code regeneration requests and transition to assumptions from implementation', () => {
      const nextStage = stateMachine.determineNextStage('implementation', 'regenerate the code');
      expect(nextStage).toBe('assumptions');
    });

    it('should return null when no transition is needed', () => {
      const nextStage = stateMachine.determineNextStage('chat', 'hello, how are you?');
      expect(nextStage).toBe(null);
    });
  });

  describe('shouldTransitionToChatOnError()', () => {
    const createErrorResult = (errorText: string): MCPToolResult => ({
      content: [{ type: 'text', text: errorText }],
      isError: true,
    });

    const createSuccessResult = (): MCPToolResult => ({
      content: [{ type: 'text', text: 'Success' }],
      isError: false,
    });

    it('should return false for non-implementation stages', () => {
      const toolResults = [
        { name: 'create_file', result: createErrorResult('not found') },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('chat', toolResults)).toBe(false);
      expect(stateMachine.shouldTransitionToChatOnError('assumptions', toolResults)).toBe(false);
    });

    it('should return true for file modification errors with "not found" in implementation stage', () => {
      const toolResults = [
        { name: 'create_file', result: createErrorResult('File not found') },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(true);
    });

    it('should return true for file modification errors with various error keywords', () => {
      const errorKeywords = [
        'permission denied',
        'invalid path',
        'missing file',
        'required field',
        'cannot create',
        'unable to write',
      ];

      errorKeywords.forEach(keyword => {
        const toolResults = [
          { name: 'replace_file', result: createErrorResult(`Error: ${keyword}`) },
        ];
        expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(true);
      });
    });

    it('should return false for non-file-modification tool errors', () => {
      const toolResults = [
        { name: 'read_file', result: createErrorResult('not found') },
        { name: 'list_files', result: createErrorResult('permission denied') },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(false);
    });

    it('should return false when file modification tools succeed', () => {
      const toolResults = [
        { name: 'create_file', result: createSuccessResult() },
        { name: 'replace_file', result: createSuccessResult() },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(false);
    });

    it('should return false when file modification errors do not require clarification', () => {
      const toolResults = [
        { name: 'create_file', result: createErrorResult('File already exists') }, // Not a clarification error
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(false);
    });

    it('should return true when at least one file modification tool has clarification-requiring error', () => {
      const toolResults = [
        { name: 'read_file', result: createSuccessResult() },
        { name: 'create_file', result: createErrorResult('File not found') }, // This triggers transition
        { name: 'replace_file', result: createSuccessResult() },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(true);
    });

    it('should handle tool results without error details', () => {
      const toolResults = [
        { name: 'create_file', result: undefined },
        { name: 'create_file', result: { content: [], isError: false } },
      ];

      expect(stateMachine.shouldTransitionToChatOnError('implementation', toolResults)).toBe(false);
    });
  });
});

