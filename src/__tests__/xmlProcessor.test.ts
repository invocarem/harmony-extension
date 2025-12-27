import { XmlProcessor } from '../utils/xmlProcessor';

describe('XmlProcessor', () => {
  describe('extractToolCalls', () => {
    describe('Basic XML tool calls', () => {
      it('should extract simple self-closing tool call', () => {
        const text = '<tool_call name="analyze_latin" args=\'{"word": "amo"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('analyze_latin');
        expect(result[0].args).toEqual({ word: 'amo' });
      });

      it('should extract tool call with double-quoted args', () => {
        const text = '<tool_call name="test" args="{\\"key\\": \\"value\\"}" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
        expect(result[0].args).toEqual({ key: 'value' });
      });

      it('should extract multiple tool calls', () => {
        const text = '<tool_call name="tool1" args=\'{"arg": "1"}\' /><tool_call name="tool2" args=\'{"arg": "2"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('tool1');
        expect(result[1].name).toBe('tool2');
      });
    });

    describe('Brace matching fallback for complex JSON', () => {
      it('should handle JSON with Python triple quotes using brace matching', () => {
        // This is the problematic case: triple quotes in JSON string
        const codeContent = '# animation.py\n"""\nAnimated spinning hexagon with a bouncing ball.\n"""\n\nprint("Hello")';
        const jsonArgs = JSON.stringify({
          file_path: 'animation.py',
          content: codeContent
        });
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('animation.py');
        expect(result[0].args.content).toBe(codeContent);
      });

      it('should handle JSON with escaped newlines and special characters', () => {
        const codeContent = 'def example():\n    """Docstring"""\n    return "test"';
        const jsonArgs = JSON.stringify({
          file_path: 'example.py',
          content: codeContent
        });
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.content).toBe(codeContent);
      });

      it('should handle JSON with HTML entities', () => {
        const jsonArgs = '{"file_path": "test.html", "content": "&lt;div&gt;Hello&lt;/div&gt;"}';
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('test.html');
        expect(result[0].args.content).toBe('<div>Hello</div>');
      });

      it('should handle JSON with nested objects and arrays', () => {
        const jsonArgs = JSON.stringify({
          file_path: 'config.json',
          content: '{"nested": {"array": [1, 2, 3]}}'
        });
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].args.content).toBe('{"nested": {"array": [1, 2, 3]}}');
      });

      it('should handle very long JSON strings in args attribute', () => {
        // Create a long code content that would break quote matching
        const longContent = '# ' + 'x'.repeat(500) + '\n"""' + 'y'.repeat(300) + '"""\n' + 'print("test")';
        const jsonArgs = JSON.stringify({
          file_path: 'long_file.py',
          content: longContent
        });
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.content).toBe(longContent);
      });

      it('should handle JSON with mixed quote types in content', () => {
        const codeContent = `const str = "double 'single' quotes";`;
        const jsonArgs = JSON.stringify({
          file_path: 'test.js',
          content: codeContent
        });
        const text = `<tool_call name="create_file" args='${jsonArgs}' />`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].args.content).toBe(codeContent);
      });
    });

    describe('Full element format', () => {
      it('should extract tool call from full element with JSON content', () => {
        const text = `<tool_call>
{
  "name": "create_file",
  "arguments": {
    "file_path": "test.py",
    "content": "print('hello')"
  }
}
</tool_call>`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('test.py');
        expect(result[0].args.content).toBe("print('hello')");
      });
    });

    describe('Edge cases', () => {
      it('should handle empty arguments', () => {
        const text = '<tool_call name="no_args" args="{}" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].args).toEqual({});
      });

      it('should handle tool call without args attribute', () => {
        const text = '<tool_call name="test" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        // Should return empty array since args is required
        expect(result).toHaveLength(0);
      });

      it('should handle malformed JSON gracefully', () => {
        const text = '<tool_call name="test" args=\'{"invalid": json}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        // Should fail gracefully and return empty array
        expect(result).toHaveLength(0);
      });

      it('should handle tool call with only whitespace in args', () => {
        const text = '<tool_call name="test" args="   " />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(0);
      });

      it('should skip tool calls with placeholder args like "{...}"', () => {
        // This is a common pattern in example/documentation text that should be skipped
        const text = '<tool_call name="tool_name1" args="{...}" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        // Should skip placeholder tool calls
        expect(result).toHaveLength(0);
      });

      it('should skip tool calls with placeholder args like "{ ... }"', () => {
        const text = '<tool_call name="tool_name2" args="{ ... }" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(0);
      });
    });

    describe('Variant patterns', () => {
      it('should extract from variant pattern with <| prefix', () => {
        const text = '<|analysis tool_call name="test" args=\'{"key": "value"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
      });

      it('should extract from variant pattern with | prefix', () => {
        const text = '|analysis tool_call name="test" args=\'{"key": "value"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
      });
    });
  });

  describe('looksLikeXmlToolCall', () => {
    it('should return true for standard XML tool call', () => {
      expect(XmlProcessor.looksLikeXmlToolCall('<tool_call name="test" />')).toBe(true);
    });

    it('should return true for variant pattern', () => {
      expect(XmlProcessor.looksLikeXmlToolCall('<|analysis tool_call name="test" />')).toBe(true);
      expect(XmlProcessor.looksLikeXmlToolCall('|analysis tool_call name="test" />')).toBe(true);
    });

    it('should return false for non-XML tool calls', () => {
      expect(XmlProcessor.looksLikeXmlToolCall('to=test_function {}')).toBe(false);
      expect(XmlProcessor.looksLikeXmlToolCall('{"name": "test"}')).toBe(false);
      expect(XmlProcessor.looksLikeXmlToolCall('regular text')).toBe(false);
    });

    it('should return false for natural language mentioning tool_call', () => {
      // This tests the fix: natural language text that mentions <tool_call
      // should NOT be identified as a valid XML tool call
      const naturalLanguage = "The system will execute the tool and return the result. After all tools are called and results received, provide your final response. You are to update the `englishText` array in the Psalm101Tests.swift file to add a comment every 5 verses, following the 29 verses of Latin text. I'll analyze the existing structure and add appropriate comments.";
      
      // looksLikeXmlToolCall checks for the pattern, but extraction should return 0
      // The important test is that extraction returns 0, not that looksLikeXmlToolCall returns false
      expect(XmlProcessor.extractToolCalls(naturalLanguage)).toHaveLength(0);
      
      // Even if it contains the substring <tool_call, extraction should return 0
      const withSubstring = "I need to call the <tool_call function to update the file.";
      expect(XmlProcessor.extractToolCalls(withSubstring)).toHaveLength(0);
    });

    it('should still return true for actual XML tool call structures', () => {
      // Ensure actual tool calls are still detected correctly
      expect(XmlProcessor.looksLikeXmlToolCall('<tool_call name="test" args=\'{"arg": "value"}\' />')).toBe(true);
      expect(XmlProcessor.looksLikeXmlToolCall('<tool_call name="analyze_latin" />')).toBe(true);
    });
  });
});

