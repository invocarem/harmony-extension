/**
 * Unit tests for markdown formatting module
 */

// Mock DOM APIs before importing the module
// Create a mock div that simulates browser behavior: setting textContent escapes HTML in innerHTML
const createMockDiv = () => {
  let _textContent = '';
  return {
    set textContent(value: string) {
      _textContent = value;
      // Simulate browser: setting textContent and reading innerHTML automatically escapes HTML
      (this as any).innerHTML = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    get textContent() {
      return _textContent;
    },
    innerHTML: '',
  };
};

// Mock document for Node.js environment
(global as any).document = {
  createElement: jest.fn((tag: string) => {
    if (tag === 'div') {
      return createMockDiv() as any;
    }
    return {} as any;
  }),
};

// Mock Prism.js before importing the module
// Set up Prism globally first so components can access it
(global as any).Prism = {
  highlight: jest.fn((code: string, grammar: any, language: string) => {
    // Simple mock that returns escaped HTML
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }),
  languages: {
    javascript: {},
    typescript: {},
    python: {},
    json: {},
    bash: {},
    markdown: {},
    swift: {},
    markup: {},
  },
  util: {
    encode: (tokens: any) => tokens,
  },
};

jest.mock('prismjs', () => (global as any).Prism);

// Mock Prism language components
jest.mock('prismjs/components/prism-json', () => ({}));
jest.mock('prismjs/components/prism-javascript', () => ({}));
jest.mock('prismjs/components/prism-typescript', () => ({}));
jest.mock('prismjs/components/prism-python', () => ({}));
jest.mock('prismjs/components/prism-bash', () => ({}));
jest.mock('prismjs/components/prism-markdown', () => ({}));
jest.mock('prismjs/components/prism-swift', () => ({}));
jest.mock('prismjs/components/prism-xml-doc', () => ({}));
jest.mock('prismjs/components/prism-markup', () => ({}));

import { formatMarkdown, escapeHtml } from '../webview/modules/markdown';

describe('formatMarkdown', () => {
  describe('C-style comments protection', () => {
    it('should preserve /* ... */ comments without converting to italic', () => {
      const input = 'This is a comment /* 25 */ in the text';
      const result = formatMarkdown(input);
      
      // Should contain the comment as-is (HTML escaped)
      expect(result).toContain('/* 25 */');
      // Should not contain italic tags around the number
      expect(result).not.toContain('<em> 25 </em>');
      expect(result).not.toContain('<em>25</em>');
    });

    it('should preserve multiple C-style comments', () => {
      const input = 'Verse /* 5 */ and verse /* 10 */ and verse /* 15 */';
      const result = formatMarkdown(input);
      
      expect(result).toContain('/* 5 */');
      expect(result).toContain('/* 10 */');
      expect(result).toContain('/* 15 */');
      // Should not convert any of them to italic
      expect(result).not.toMatch(/<em>\s*[0-9]+\s*<\/em>/);
    });

    it('should preserve comments with text inside', () => {
      const input = 'Code /* This is a comment */ more code';
      const result = formatMarkdown(input);
      
      expect(result).toContain('/* This is a comment */');
    });

    it('should still process regular italic markdown', () => {
      const input = 'This is *italic* text';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<em>italic</em>');
    });

    it('should handle italic and comments in the same text', () => {
      const input = 'This is *italic* text with /* 25 */ comment';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('/* 25 */');
      expect(result).not.toContain('<em> 25 </em>');
    });
  });

  describe('Code block handling', () => {
    it('should handle code blocks with newline after language', () => {
      const input = '```swift\nlet x = 1\n```';
      const result = formatMarkdown(input);
      
      // Should contain code block structure
      expect(result).toContain('code-block');
      expect(result).toContain('swift');
    });

    it('should handle code blocks without newline after language', () => {
      const input = '```swift private let englishText = [\n"text"\n]```';
      const result = formatMarkdown(input);
      
      // Should contain code block structure
      expect(result).toContain('code-block');
      expect(result).toContain('swift');
      // Should preserve the code content
      expect(result).toContain('private let englishText');
    });

    it('should handle code blocks with whitespace after language', () => {
      const input = '```swift \nlet x = 1\n```';
      const result = formatMarkdown(input);
      
      expect(result).toContain('code-block');
      expect(result).toContain('swift');
    });

    it('should handle code blocks with comments inside', () => {
      const input = '```swift\nlet x = 1 /* comment */\nlet y = 2\n```';
      const result = formatMarkdown(input);
      
      expect(result).toContain('code-block');
      expect(result).toContain('swift');
      // Comment should be preserved in the code
      expect(result).toContain('/* comment */');
    });

    it('should handle multiple code blocks', () => {
      const input = '```swift\ncode1\n```\n```python\ncode2\n```';
      const result = formatMarkdown(input);
      
      expect(result).toContain('swift');
      expect(result).toContain('python');
    });

    it('should handle code blocks without language identifier', () => {
      const input = '```\nplain code\n```';
      const result = formatMarkdown(input);
      
      expect(result).toContain('code-block');
    });
  });

  describe('Bold and italic processing', () => {
    it('should process bold text', () => {
      const input = 'This is **bold** text';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<strong>bold</strong>');
    });

    it('should process italic text', () => {
      const input = 'This is *italic* text';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<em>italic</em>');
    });

    it('should process bold italic text', () => {
      const input = 'This is ***bold italic*** text';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<strong><em>bold italic</em></strong>');
    });

    it('should not process asterisks in code blocks as markdown', () => {
      const input = '```\nlet x = *pointer\n```';
      const result = formatMarkdown(input);
      
      // Should not contain italic tags
      expect(result).not.toContain('<em>pointer</em>');
    });
  });

  describe('Headers', () => {
    it('should process h1 headers', () => {
      const input = '# Header 1';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<h1>Header 1</h1>');
    });

    it('should process h2 headers', () => {
      const input = '## Header 2';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<h2>Header 2</h2>');
    });

    it('should process h3 headers', () => {
      const input = '### Header 3';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<h3>Header 3</h3>');
    });
  });

  describe('Inline code', () => {
    it('should process inline code', () => {
      const input = 'This is `inline code` text';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<code>inline code</code>');
    });

    it('should not process code blocks as inline code', () => {
      const input = '```\ncode block\n```';
      const result = formatMarkdown(input);
      
      // Should not contain simple <code> tags (should be in code-block div)
      expect(result).toContain('code-block');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle Swift code with comments every 5 verses', () => {
      const input = `\`\`\`swift
private let englishText = [
  "Verse 1",
  "Verse 2",
  "Verse 3",
  "Verse 4",
  "Verse 5",
  /* 5 */
  "Verse 6",
  "Verse 7",
  "Verse 8",
  "Verse 9",
  "Verse 10",
  /* 10 */
  "Verse 11"
]
\`\`\``;
      
      const result = formatMarkdown(input);
      
      // Should preserve code block
      expect(result).toContain('code-block');
      expect(result).toContain('swift');
      // Should preserve comments
      expect(result).toContain('/* 5 */');
      expect(result).toContain('/* 10 */');
      // Should not convert comments to italic
      expect(result).not.toMatch(/<em>\s*[0-9]+\s*<\/em>/);
    });

    it('should handle mixed markdown with code and comments', () => {
      const input = `# Title

This is *italic* and this is **bold**.

\`\`\`swift
let x = 1 /* comment */
\`\`\`

More text with /* 25 */ comment.`;
      
      const result = formatMarkdown(input);
      
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('code-block');
      expect(result).toContain('/* comment */');
      expect(result).toContain('/* 25 */');
    });

    it('should handle empty input', () => {
      const result = formatMarkdown('');
      expect(result).toBe('');
    });

    it('should handle input with only code block', () => {
      const input = '```swift\ncode\n```';
      const result = formatMarkdown(input);
      
      expect(result).toContain('code-block');
    });

    it('should handle input with only comment', () => {
      const input = '/* 25 */';
      const result = formatMarkdown(input);
      
      expect(result).toContain('/* 25 */');
    });
  });

  describe('Line breaks', () => {
    it('should convert newlines to br tags', () => {
      const input = 'Line 1\nLine 2';
      const result = formatMarkdown(input);
      
      expect(result).toContain('<br>');
    });
  });
});

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    const input = '<div>&amp;</div>';
    const result = escapeHtml(input);
    
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&amp;');
  });

  it('should handle plain text', () => {
    const input = 'Plain text';
    const result = escapeHtml(input);
    
    expect(result).toBe('Plain text');
  });
});

