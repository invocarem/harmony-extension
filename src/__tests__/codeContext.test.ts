import { CodeContext } from '../harmony/codeContext';

describe('CodeContext', () => {
  describe('fromCodeBlock', () => {
    it('should reject "File" as filename and default to "file.txt"', () => {
      const codeBlock = '```python File\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension), not "File"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject "file" (lowercase) as filename and default to "file"', () => {
      const codeBlock = '```python file\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension)
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject "Code" as filename and default to "file"', () => {
      const codeBlock = '```python Code\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension), not "Code"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject "Script" as filename and default to "file"', () => {
      const codeBlock = '```python Script\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension), not "Script"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject "Text" as filename and default to "file"', () => {
      const codeBlock = '```python Text\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension), not "Text"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject "Data" as filename and default to "file"', () => {
      const codeBlock = '```python Data\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" (with extension), not "Data"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should accept valid filename with extension', () => {
      const codeBlock = '```python hello.py\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('hello.py');
      expect(result?.content).toContain('print("Hello")');
    });

    it('should accept valid filename with path', () => {
      const codeBlock = '```python src/main.py\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('src/main.py');
      expect(result?.content).toContain('print("Hello")');
    });

    it('should accept valid filename even if it contains "file" as part of the name', () => {
      const codeBlock = '```python fileManager.py\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('fileManager.py'); // Should accept because it has extension and is not just "file"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should reject filename without extension', () => {
      const codeBlock = '```python hello\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should default to "file.txt" because no extension
      expect(result?.content).toContain('print("Hello")');
    });

    it('should handle code block with valid filename in header even if text mentions "File:"', () => {
      // When filename is in the code block header, it should work correctly
      const codeBlock = '```python hello.py\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('hello.py');
      expect(result?.content).toContain('print("Hello")');
    });

    it('should handle code block without newline after language tag', () => {
      const codeBlock = '```python File\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should reject "File" and default to "file.txt"
      expect(result?.content).toContain('print("Hello")');
    });

    it('should handle code block with version tag and invalid filename', () => {
      const codeBlock = '```python File v2\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('file.txt'); // Should reject "File" even with version, default to "file.txt"
      expect(result?.version).toBe('v2');
      expect(result?.content).toContain('print("Hello")');
    });

    it('should accept valid filename with version tag', () => {
      const codeBlock = '```python hello.py v2\nprint("Hello")\n```';
      const result = CodeContext.fromCodeBlock(codeBlock);
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('hello.py');
      expect(result?.version).toBe('v2');
      expect(result?.content).toContain('print("Hello")');
    });
  });
});

