import { LlamaClient } from '../llamaClient';
import { LlamaConfig } from '../config';

describe('LlamaClient - cleanHarmonyResponse', () => {
  let llamaClient: LlamaClient;
  let mockConfig: LlamaConfig;

  beforeEach(() => {
    // Create a minimal mock config
    mockConfig = {
      serverUrl: 'http://localhost:8000',
      apiKey: '',
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 2048,
      mcpServers: [],
      rulesPaths: [],
    };
    llamaClient = new LlamaClient(mockConfig);
  });

  describe('Basic token removal', () => {
    it('should remove basic harmony tokens from response', () => {
      const response = '<|assistant|>Hello world<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Hello world');
      expect(result.reasoning).toBeUndefined();
    });

    it('should remove all harmony token patterns', () => {
      const response = '<|start|>user<|channel|>final<|message|>Hi there<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Hi there');
      expect(result.content).not.toContain('<|');
      expect(result.content).not.toContain('|>');
    });

    it('should handle empty response', () => {
      const result = llamaClient.cleanHarmonyResponse('');
      expect(result.content).toBe('');
    });

    it('should handle null/undefined response', () => {
      const result1 = llamaClient.cleanHarmonyResponse(null as any);
      expect(result1.content).toBe('');
    });
  });

  describe('Final message channel extraction', () => {
    it('should extract content from final message channel', () => {
      const response = '<|channel|>final<|message|>This is the final message<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('This is the final message');
    });

    it('should extract content from final message channel ending with eoa', () => {
      const response = '<|channel|>final<|message|>Message content<|eoa|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Message content');
    });

    it('should extract content from final message channel without end token', () => {
      const response = '<|channel|>final<|message|>Final content without end';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Final content without end');
    });

    it('should extract multiline content from final message channel', () => {
      const response = `<|channel|>final<|message|>Line 1
Line 2
Line 3<|end|>`;
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('Assistant message extraction', () => {
    it('should extract content from assistant message when final channel not found', () => {
      const response = '<|assistant|>Assistant response<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Assistant response');
    });

    it('should extract content from assistant with final channel token', () => {
      const response = '<|assistant|><|channel|>final<|message|>Response text<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Response text');
    });

    it('should prioritize final message channel over assistant pattern', () => {
      const response = '<|channel|>final<|message|>Final message<|end|><|assistant|>Other content<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Final message');
    });
  });

  describe('Reasoning/thinking extraction', () => {
    it('should extract thinking section', () => {
      const response = '<|thinking|>This is my reasoning<|end|><|assistant|>Final answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('This is my reasoning');
      expect(result.content).toBe('Final answer');
    });

    it('should extract reasoning section', () => {
      const response = '<|reasoning|>Let me think about this<|end|><|assistant|>Answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Let me think about this');
      expect(result.content).toBe('Answer');
    });

    it('should extract thinking channel with message token', () => {
      const response = '<|channel|>thinking<|message|>My thoughts here<|end|><|assistant|>Response<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('My thoughts here');
      expect(result.content).toBe('Response');
    });

    it('should extract analysis channel', () => {
      const response = '<|channel|>analysis<|message|>Analysis content<|end|><|assistant|>Result<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Analysis content');
      expect(result.content).toBe('Result');
    });

    it('should remove harmony tokens from extracted reasoning', () => {
      const response = '<|thinking|>Reasoning with <|token|> inside<|end|><|assistant|>Answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Reasoning with  inside');
      expect(result.reasoning).not.toContain('<|token|>');
    });

    it('should clean up multiple newlines in reasoning', () => {
      const response = '<|thinking|>Line 1\n\n\nLine 2<|end|><|assistant|>Answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Line 1\n\nLine 2');
    });

    it('should handle reasoning ending with eoa token', () => {
      const response = '<|thinking|>Some reasoning<|eoa|><|assistant|>Answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Some reasoning');
    });

    it('should handle reasoning ending with assistant token', () => {
      const response = '<|thinking|>Reasoning text<|assistant|>Answer<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.reasoning).toBe('Reasoning text');
      expect(result.content).toBe('Answer');
    });
  });

  describe('Complex harmony token scenarios', () => {
    it('should handle the test format from extension.ts', () => {
      const testResponse = `<|thinking|>Let me think about this response carefully...<|end|><|assistant|>final<|message|>Hello! 👋 I'm here to help you with any coding questions you have<|end|>assistant<|eoa|><|assistant|>final<|message|>**Hi!** How can I assist you today?

## Example Code
Here's some \`code\`:
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`

**Key Points:**
1. This is a list item
2. Another item

<|eoa|>`;
      
      const result = llamaClient.cleanHarmonyResponse(testResponse);
      
      expect(result.reasoning).toBe('Let me think about this response carefully...');
      // The function extracts the first assistant message found, which contains the first "Hello!" message
      // After token removal, "final" becomes part of content since it's not a token
      expect(result.content).toContain('Hello!');
      expect(result.content).not.toContain('<|');
      expect(result.content).not.toContain('|>');
    });

    it('should handle multiple harmony tokens scattered throughout', () => {
      const response = '<|start|>user<|channel|>final<|message|>Text with <|token1|> and <|token2|> tokens<|end|><|eoa|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Text with  and  tokens');
      expect(result.content).not.toMatch(/<\|.*?\|>/);
    });

    it('should handle nested or complex token structures', () => {
      const response = '<|channel|>final<|message|>Content<|inner|>token<|end|>here<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      // The pattern extracts up to the first <|end|>, so "Content<|inner|>token"
      // After token removal: "Contenttoken" (the "here" part is after the first <|end|>)
      expect(result.content).toBe('Contenttoken');
      expect(result.content).not.toContain('<|');
    });
  });

  describe('Whitespace and formatting cleanup', () => {
    it('should trim whitespace from content', () => {
      const response = '<|assistant|>   Content with spaces   <|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Content with spaces');
    });

    it('should clean up multiple consecutive newlines', () => {
      const response = '<|assistant|>Line 1\n\n\n\nLine 2<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Line 1\n\nLine 2');
    });

    it('should preserve intentional double newlines', () => {
      const response = '<|assistant|>Paragraph 1\n\nParagraph 2<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Paragraph 1\n\nParagraph 2');
    });
  });

  describe('Edge cases and fallbacks', () => {
    it('should handle response with only tokens and no content', () => {
      const response = '<|assistant|><|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      // The function falls back to returning the original response when cleaned is empty
      // After fallback processing, it may still contain tokens if no content was extracted
      expect(result.content).toBeDefined();
      // The fallback tries to remove tokens, but if that results in empty, returns original
      // In this case, it returns the original response trimmed
      expect(result.content).toBe('<|assistant|><|end|>');
    });

    it('should handle malformed tokens gracefully', () => {
      const response = '<|incomplete token<|assistant|>Content<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      // Should still extract content and remove what it can
      expect(result.content).toContain('Content');
    });

    it('should handle response with markdown and tokens', () => {
      const response = '<|assistant|>**Bold** text with <|token|> in it<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('**Bold** text with  in it');
      expect(result.content).toContain('**Bold**');
    });

    it('should handle very long responses', () => {
      const longContent = 'A'.repeat(10000);
      const response = `<|assistant|>${longContent}<|end|>`;
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe(longContent);
      expect(result.content.length).toBe(10000);
    });
  });

  describe('Token pattern variations', () => {
    it('should handle tokens with different content between pipes', () => {
      const response = '<|custom_token_name|>Content<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Content');
    });

    it('should handle tokens with special characters', () => {
      const response = '<|token-with-dashes|>Content<|token_with_underscores|>More<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('ContentMore');
    });

    it('should handle tokens with numbers', () => {
      const response = '<|token123|>Content<|end|>';
      const result = llamaClient.cleanHarmonyResponse(response);
      
      expect(result.content).toBe('Content');
    });
  });
});

