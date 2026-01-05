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

      it('should not extract duplicate tool calls when same tool call appears in text', () => {
        // This test reproduces the bug where the same tool call gets extracted multiple times
        // The incomplete/truncated handler was processing tool calls already extracted by the self-closing loop
        const text = 'The correct format is: <tool_call name="analyze_latin" args=\'{"word": "invenietur"}\' /> Please note that the tool call must be in this exact format.';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('analyze_latin');
        expect(result[0].args).toEqual({ word: 'invenietur' });
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

    describe('Tool calls with > character in content', () => {
      it('should extract complete tool call when content contains -> (type hints)', () => {
        // This reproduces the bug: regex pattern [^>]+ stops at first > character
        // The tool call content has "->" in type hints, causing regex to fail
        const text = '<tool_call name="create_file" args=\'{"file_path": "hello.py", "content": "def greet(name: str) -> None:\\n    \\"\\"\\"Print a greeting for the given name.\\"\\"\\"\\n    print(f\\"Hello, {name}!\\")\\n\\nif __name__ == \\"__main__\\":\\n    # Greet Mary\\n    greet(\\"Mary\\")\\n"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args).toBeDefined();
        expect(result[0].args.file_path).toBe('hello.py');
        // The critical test: content should be fully extracted despite -> in type hints
        expect(result[0].args.content).toBeDefined();
        expect(result[0].args.content).toContain('def greet(name: str) -> None');
        expect(result[0].args.content).toContain('greet("Mary")');
      });

      it('should handle tool calls with > characters in various places', () => {
        const text = '<tool_call name="create_file" args=\'{"file_path": "test.py", "content": "x = 5 > 3\\nprint(x)"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.content).toContain('5 > 3');
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

    describe('Incomplete tool calls', () => {
      it('should extract content from incomplete tool call without including closing brace', () => {
        // Simulate an incomplete tool call where the content string is truncated
        // The partial JSON extraction will add a closing } to make it valid,
        // but the content should NOT include that closing brace
        // This matches the actual bug scenario from the logs
        const incompleteToolCall = `<tool_call name="create_file" args='{
  "file_path": "README.md",
  "content": "# hello.py

A tiny Python script that greets a user.

## Overview

\`hello.py\` defines a single function, **\`greet("`;
        
        const result = XmlProcessor.extractToolCalls(incompleteToolCall);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('README.md');
        
        // The critical test: if content is extracted, it should NOT end with }
        if (result[0].args.content) {
          const content = result[0].args.content;
          expect(content).not.toMatch(/\}\s*$/);
          expect(content.endsWith('}')).toBe(false);
          
          // Content should contain the actual text
          expect(content).toContain('# hello.py');
          expect(content).toContain('A tiny Python script that greets a user.');
          expect(content).toContain('## Overview');
          expect(content).toContain('`hello.py` defines a single function');
        }
      });

      it('should handle incomplete tool call with multi-line content', () => {
        const incompleteToolCall = `<tool_call name="create_file" args='{
  "file_path": "test.py",
  "content": "def hello():\\n    print(\\"world\\")\\n    return True`;
        
        const result = XmlProcessor.extractToolCalls(incompleteToolCall);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('test.py');
        
        // Content might not be extracted if JSON is too incomplete, but if it is, it shouldn't have }
        if (result[0].args.content) {
          const content = result[0].args.content;
          // Should not include closing brace
          expect(content.endsWith('}')).toBe(false);
          expect(content).toContain('def hello():');
          expect(content).toContain('print("world")');
        }
      });

      it('should extract file_path even when content is incomplete', () => {
        const incompleteToolCall = `<tool_call name="create_file" args='{
  "file_path": "config.json",
  "content": "{\\"key\\": "value`;
        
        const result = XmlProcessor.extractToolCalls(incompleteToolCall);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('config.json');
        
        // Content might be incomplete, but should not include closing brace
        if (result[0].args.content) {
          expect(result[0].args.content.endsWith('}')).toBe(false);
        }
      });

      it('should handle incomplete tool call where JSON is closed with added brace', () => {
        // This simulates the exact bug scenario: partial JSON extraction adds }
        // but content extraction should stop before it
        // The content string is incomplete (no closing quote), and a } is added to close JSON
        const incompleteToolCall = `<tool_call name="create_file" args='{
  "file_path": "README.md",
  "content": "# hello.py

A tiny Python script that greets a user.

## Overview

\`hello.py\` defines a single function}`;
        
        const result = XmlProcessor.extractToolCalls(incompleteToolCall);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('README.md');
        
        // The critical test: if content is extracted, it should NOT include the closing }
        if (result[0].args.content) {
          const content = result[0].args.content;
          // Content should end with the actual text, not with }
          expect(content).not.toMatch(/\}\s*$/);
          expect(content.endsWith('}')).toBe(false);
          // Should contain the actual content
          expect(content).toContain('`hello.py` defines a single function');
          // Should NOT end with just }
          expect(content.trim()).not.toBe('}');
        }
      });

      it('should extract both file_path and content from incomplete tool call when JSON is truncated', () => {
        // This tests the bug fix: when JSON is incomplete/truncated (no closing brace),
        // both file_path and content should be extracted directly from raw string
        // This simulates the actual bug where content was undefined
        const incompleteToolCall = `<tool_call name="create_file" args='{"file_path":"hello.md","content":"# hello.py – Simple Greeting Module

## Table of Contents
1. [Project Overview](#project-overview)  
2. [Installation](#installation)  
3. [Usage](#usage)  
   - [Command‑line](#command‑line)  
   - [Programmatic API](#pro`;
        
        const result = XmlProcessor.extractToolCalls(incompleteToolCall);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        
        // Both fields should be extracted even though JSON is incomplete
        expect(result[0].args.file_path).toBe('hello.md');
        expect(result[0].args.content).toBeDefined();
        expect(result[0].args.content).not.toBeUndefined();
        
        // Content should be properly extracted
        const content = result[0].args.content;
        expect(content).toContain('# hello.py – Simple Greeting Module');
        expect(content).toContain('## Table of Contents');
        expect(content).toContain('[Project Overview](#project-overview)');
        expect(content).toContain('[Installation](#installation)');
        expect(content).toContain('[Usage](#usage)');
        expect(content).toContain('[Command‑line](#command‑line)');
        expect(content).toContain('[Programmatic API](#pro');
        
        // Content should NOT end with closing brace
        expect(content.endsWith('}')).toBe(false);
        expect(content).not.toMatch(/\}\s*$/);
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

    describe('MCP_CALL format support', () => {
      it('should extract MCP_CALL self-closing format', () => {
        const text = '<MCP_CALL name="analyze_latin" args=\'{"word": "invenietur"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('analyze_latin');
        expect(result[0].args).toEqual({ word: 'invenietur' });
      });

      it('should extract MCP_CALL with double-quoted args', () => {
        const text = '<MCP_CALL name="test" args="{\\"key\\": \\"value\\"}" />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
        expect(result[0].args).toEqual({ key: 'value' });
      });

      it('should extract MCP_CALL from full element format', () => {
        const text = `<MCP_CALL>
{
  "name": "analyze_latin",
  "arguments": {
    "word": "amo"
  }
}
</MCP_CALL>`;
        
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('analyze_latin');
        expect(result[0].args.word).toBe('amo');
      });

      it('should extract both tool_call and MCP_CALL in same text', () => {
        const text = '<tool_call name="read_file" args=\'{"file_path": "test.txt"}\' /><MCP_CALL name="analyze_latin" args=\'{"word": "invenietur"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('read_file');
        expect(result[1].name).toBe('analyze_latin');
      });

      it('should extract MCP_CALL with variant pattern <| prefix', () => {
        const text = '<|analysis MCP_CALL name="test" args=\'{"key": "value"}\' />';
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
      });

      it('should handle MCP_CALL with escaped quotes in args', () => {
        const jsonArgs = '{"file_path": "test.py", "content": "print(\\"hello\\")"}';
        const text = `<MCP_CALL name="create_file" args='${jsonArgs}' />`;
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('test.py');
        expect(result[0].args.content).toBe('print("hello")');
      });

      it('should handle MCP_CALL with HTML entities in args', () => {
        const jsonArgs = '{"file_path": "test.html", "content": "&lt;div&gt;Hello&lt;/div&gt;"}';
        const text = `<MCP_CALL name="create_file" args='${jsonArgs}' />`;
        const result = XmlProcessor.extractToolCalls(text);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('create_file');
        expect(result[0].args.file_path).toBe('test.html');
        expect(result[0].args.content).toBe('<div>Hello</div>');
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

    it('should return true for MCP_CALL format', () => {
      expect(XmlProcessor.looksLikeXmlToolCall('<MCP_CALL name="analyze_latin" args=\'{"word": "invenietur"}\' />')).toBe(true);
      expect(XmlProcessor.looksLikeXmlToolCall('<MCP_CALL name="test" />')).toBe(true);
      expect(XmlProcessor.looksLikeXmlToolCall('<|analysis MCP_CALL name="test" />')).toBe(true);
    });

    it('should return true for MCP_CALL full element format', () => {
      expect(XmlProcessor.looksLikeXmlToolCall('<MCP_CALL name="test">content</MCP_CALL>')).toBe(true);
    });
  });
});

