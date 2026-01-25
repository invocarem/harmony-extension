import { TemplateRenderer } from '../templateRenderer';
import * as vscode from 'vscode';
import { ChatMessage } from '../conversationManager';

describe('TemplateRenderer', () => {
  let mockContext: vscode.ExtensionContext;
  let templateRenderer: TemplateRenderer;

  beforeEach(() => {
    mockContext = {
      extensionPath: '/mock/path',
    } as any;
  });

  describe('Harmony token wrapping with conversation history', () => {
    it('should not double-wrap conversation history with harmony tokens', async () => {
      templateRenderer = new TemplateRenderer(mockContext, true);

      const conversationHistory: ChatMessage[] = [
        {
          role: 'user',
          content: 'hello',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
        },
      ];

      const templateContext = {
        prompt: 'what is 2+2?',
        stageInstructions: 'Test instructions',
      };

      const result = await templateRenderer.applyTemplate(
        'nonexistent',
        templateContext,
        conversationHistory
      );

      // Verify conversation history is properly formatted
      expect(result).toContain('<|start|>user<|channel|>final<|message|>\nhello\n<|end|>');
      expect(result).toContain('<|start|>assistant<|channel|>final<|message|>\nHi there!\n<|end|>');
      
      // Verify the new user message is wrapped
      expect(result).toContain('<|start|>user<|channel|>final<|message|>what is 2+2?<|end|>');
      
      // Verify NO double wrapping - should not have nested start tokens
      const nestedPattern = /<\|start\|>user<\|channel\|>final<\|message\|><\|start\|>user/;
      expect(result).not.toMatch(nestedPattern);

      // Verify the order: history comes first, then new message
      const historyIndex = result.indexOf('<|start|>user<|channel|>final<|message|>\nhello');
      const newMessageIndex = result.indexOf('<|start|>user<|channel|>final<|message|>what is 2+2?');
      expect(historyIndex).toBeLessThan(newMessageIndex);
    });

    it('should properly format prompt without conversation history', async () => {
      templateRenderer = new TemplateRenderer(mockContext, true);

      const templateContext = {
        prompt: 'test prompt',
        stageInstructions: 'Test instructions',
      };

      const result = await templateRenderer.applyTemplate(
        'nonexistent',
        templateContext
      );

      // Should have exactly one user message wrapper
      expect(result).toContain('<|start|>user<|channel|>final<|message|>test prompt<|end|>');
      
      // Should not have any double wrapping
      const count = (result.match(/<\|start\|>user<\|channel\|>final<\|message\|>/g) || []).length;
      expect(count).toBe(1);
    });

    it('should work without harmony tokens when harmonyMode is false', async () => {
      templateRenderer = new TemplateRenderer(mockContext, false);

      const conversationHistory: ChatMessage[] = [
        {
          role: 'user',
          content: 'hello',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
        },
      ];

      const templateContext = {
        prompt: 'what is 2+2?',
      };

      const result = await templateRenderer.applyTemplate(
        'nonexistent',
        templateContext,
        conversationHistory
      );

      // Should not contain harmony tokens
      expect(result).not.toContain('<|start|>');
      expect(result).not.toContain('<|end|>');
      
      // Should contain plain text format
      expect(result).toContain('User: hello');
      expect(result).toContain('Assistant: Hi there!');
      expect(result).toContain('what is 2+2?');
    });

    it('should include reasoning in assistant messages when present', async () => {
      templateRenderer = new TemplateRenderer(mockContext, true);

      const conversationHistory: ChatMessage[] = [
        {
          role: 'user',
          content: 'analyze this',
        },
        {
          role: 'assistant',
          content: 'Here is my response',
          reasoning: 'I need to think about this carefully',
        },
      ];

      const templateContext = {
        prompt: 'continue',
      };

      const result = await templateRenderer.applyTemplate(
        'nonexistent',
        templateContext,
        conversationHistory
      );

      // Should include reasoning in the assistant message
      expect(result).toContain('Reasoning: I need to think about this carefully');
      expect(result).toContain('Here is my response');
    });

    it('should handle multiple messages in conversation history', async () => {
      templateRenderer = new TemplateRenderer(mockContext, true);

      const conversationHistory: ChatMessage[] = [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'first response' },
        { role: 'user', content: 'second message' },
        { role: 'assistant', content: 'second response' },
      ];

      const templateContext = {
        prompt: 'third message',
      };

      const result = await templateRenderer.applyTemplate(
        'nonexistent',
        templateContext,
        conversationHistory
      );

      // Should have all messages properly wrapped
      expect(result).toContain('<|start|>user<|channel|>final<|message|>\nfirst message\n<|end|>');
      expect(result).toContain('<|start|>assistant<|channel|>final<|message|>\nfirst response\n<|end|>');
      expect(result).toContain('<|start|>user<|channel|>final<|message|>\nsecond message\n<|end|>');
      expect(result).toContain('<|start|>assistant<|channel|>final<|message|>\nsecond response\n<|end|>');
      expect(result).toContain('<|start|>user<|channel|>final<|message|>third message<|end|>');

      // Count user message tokens - should be 3 (first, second, third)
      const userTokenCount = (result.match(/<\|start\|>user<\|channel\|>final<\|message\|>/g) || []).length;
      expect(userTokenCount).toBe(3);
      
      // Count assistant message tokens - should be 2
      const assistantTokenCount = (result.match(/<\|start\|>assistant<\|channel\|>final<\|message\|>/g) || []).length;
      expect(assistantTokenCount).toBe(2);
    });
  });
});
