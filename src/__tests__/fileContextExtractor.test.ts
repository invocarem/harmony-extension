import { FileContextExtractor, FileReference } from '../utils/fileContextExtractor';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn(),
  },
}));

// Get the mocked workspace
const mockAsRelativePath = (vscode.workspace.asRelativePath as jest.MockedFunction<typeof vscode.workspace.asRelativePath>);

describe('FileContextExtractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up workspace folders mock
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: '/home/chenchen/code/ordo',
        },
      },
    ];
    mockAsRelativePath.mockImplementation((pathOrUri: string | any) => {
      return typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath || pathOrUri.toString();
    });
  });

  describe('extractFileReferences', () => {
    it('should fail to resolve file when only filename is provided and file is in subdirectory', async () => {
      const workspaceRoot = '/home/chenchen/code/ordo';
      const actualFilePath = path.join(workspaceRoot, 'Tests/LatinServices/Psalm71Tests.swift');
      const filenameOnly = 'Psalm71Tests.swift';
      const wrongPath = path.join(workspaceRoot, filenameOnly); // This is where it will try to resolve

      // Mock that file does NOT exist at the wrong location (workspace root + filename)
      (fs.promises.stat as jest.Mock).mockImplementation((filePath: any) => {
        const resolvedPath = typeof filePath === 'string' ? filePath : filePath.toString();
        if (resolvedPath === wrongPath) {
          // File doesn't exist at workspace root + filename
          return Promise.reject(new Error(`ENOENT: no such file or directory, open '${wrongPath}'`));
        }
        if (resolvedPath === actualFilePath) {
          // File exists at the actual location
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
          } as fs.Stats);
        }
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`));
      });

      // Message with file reference containing only filename (not relative path)
      const message = `Please review @file:${filenameOnly}`;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await FileContextExtractor.extractFileReferences(message);

      // Should fail to extract the file context and keep the reference in the message
      expect(result.fileContexts).toHaveLength(0);
      expect(result.cleanMessage).toContain(`@file:${filenameOnly}`);
      
      // Should have attempted to stat the wrong path (workspace root + filename)
      expect(fs.promises.stat).toHaveBeenCalledWith(wrongPath);
      
      // Should have logged a warning - update the expected string to match the actual format
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to get file context for "${filenameOnly}"`),
        expect.any(String)
      );

      consoleWarnSpy.mockRestore();
    });


    it('should successfully resolve file when relative path is provided', async () => {
      const workspaceRoot = '/home/chenchen/code/ordo';
      const relativePath = 'Tests/LatinServices/Psalm71Tests.swift';
      const actualFilePath = path.join(workspaceRoot, relativePath);
      const fileContent = '// File content here';

      // Mock that file exists at the correct location
      (fs.promises.stat as jest.Mock).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as fs.Stats);

      (fs.promises.readFile as jest.Mock).mockResolvedValue(fileContent);

      // Message with file reference containing relative path
      const message = `Please review @file:${relativePath}`;

      const result = await FileContextExtractor.extractFileReferences(message);

      // Should successfully extract the file context
      expect(result.fileContexts).toHaveLength(1);
      expect(result.fileContexts[0].path).toBe(actualFilePath);
      expect(result.fileContexts[0].content).toBe(fileContent);
      expect(result.fileContexts[0].type).toBe('file');
      
      // Should have removed the file reference from the message
      expect(result.cleanMessage).not.toContain(`@file:${relativePath}`);
      
      // Should have called stat with the resolved path
      expect(fs.promises.stat).toHaveBeenCalledWith(actualFilePath);
      expect(fs.promises.readFile).toHaveBeenCalledWith(actualFilePath, 'utf-8');
    });
  });

  describe('formatFileContexts', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockAsRelativePath.mockImplementation((pathOrUri: string | any) => {
        return typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath || pathOrUri.toString();
      });
    });

    it('should return empty string for empty file contexts', () => {
      const result = FileContextExtractor.formatFileContexts([]);
      expect(result).toBe('');
    });

    it('should format file context without truncation for small files', () => {
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file.ts',
          content: 'Small file content',
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      expect(result).toContain('Small file content');
      expect(result).not.toContain('truncated');
      expect(result).toContain('## File 1: /path/to/file.ts');
      expect(result).toContain('Type: file');
    });

    it('should truncate large file content at 20000 characters', () => {
      const largeContent = 'x'.repeat(25000);
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/large-file.ts',
          content: largeContent,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should contain first 20000 characters
      expect(result).toContain('x'.repeat(20000));
      // Should not contain characters beyond 20000
      expect(result).not.toContain('x'.repeat(20001));
      // Should contain truncation message
      expect(result).toContain('[Content truncated. Full file is 25000 characters.]');
    });

    it('should NOT truncate selections under 50000 characters', () => {
      const selectionContent = 'x'.repeat(30000);
      const fileContexts: FileReference[] = [
        {
          type: 'selection',
          path: '/path/to/file.ts',
          lineStart: 10,
          lineEnd: 50,
          content: selectionContent,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should contain full content (no truncation)
      expect(result).toContain(selectionContent);
      expect(result).not.toContain('truncated');
      expect(result).toContain('Lines: 10-50');
      expect(result).toContain('Type: selection');
    });

    it('should truncate very large selections at 50000 characters', () => {
      const veryLargeSelection = 'x'.repeat(60000);
      const fileContexts: FileReference[] = [
        {
          type: 'selection',
          path: '/path/to/file.ts',
          lineStart: 1,
          lineEnd: 1000,
          content: veryLargeSelection,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should contain first 50000 characters
      expect(result).toContain('x'.repeat(50000));
      // Should not contain characters beyond 50000
      expect(result).not.toContain('x'.repeat(50001));
      // Should contain truncation message for selection
      expect(result).toContain('[Content truncated. Full selection is 60000 characters.]');
    });

    it('should handle file at exactly 20000 characters (boundary case)', () => {
      const exactContent = 'x'.repeat(20000);
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file.ts',
          content: exactContent,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should contain full content (no truncation at boundary)
      expect(result).toContain(exactContent);
      expect(result).not.toContain('truncated');
    });

    it('should handle file at exactly 20001 characters (should truncate)', () => {
      const exactContent = 'x'.repeat(20001);
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file.ts',
          content: exactContent,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should truncate
      expect(result).toContain('x'.repeat(20000));
      expect(result).not.toContain('x'.repeat(20001));
      expect(result).toContain('[Content truncated. Full file is 20001 characters.]');
    });

    it('should handle selection at exactly 50000 characters (boundary case)', () => {
      const exactContent = 'x'.repeat(50000);
      const fileContexts: FileReference[] = [
        {
          type: 'selection',
          path: '/path/to/file.ts',
          lineStart: 1,
          lineEnd: 100,
          content: exactContent,
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      // Should contain full content (no truncation at boundary)
      expect(result).toContain(exactContent);
      expect(result).not.toContain('truncated');
    });

    it('should format multiple file contexts correctly', () => {
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file1.ts',
          content: 'Content 1',
        },
        {
          type: 'file',
          path: '/path/to/file2.ts',
          content: 'Content 2',
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      expect(result).toContain('## File 1: /path/to/file1.ts');
      expect(result).toContain('Content 1');
      expect(result).toContain('## File 2: /path/to/file2.ts');
      expect(result).toContain('Content 2');
    });

    it('should handle file context without content', () => {
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file.ts',
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      expect(result).toContain('## File 1: /path/to/file.ts');
      expect(result).toContain('Type: file');
      expect(result).not.toContain('```');
    });

    it('should format directory context correctly', () => {
      const fileContexts: FileReference[] = [
        {
          type: 'directory',
          path: '/path/to/directory',
          content: 'Directory listing',
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      expect(result).toContain('## File 1: /path/to/directory');
      expect(result).toContain('Type: directory');
      expect(result).toContain('Directory listing');
    });

    it('should use relative path from workspace', () => {
      mockAsRelativePath.mockReturnValue('relative/path/to/file.ts');
      
      const fileContexts: FileReference[] = [
        {
          type: 'file',
          path: '/absolute/path/to/file.ts',
          content: 'Content',
        },
      ];

      const result = FileContextExtractor.formatFileContexts(fileContexts);

      expect(mockAsRelativePath).toHaveBeenCalledWith('/absolute/path/to/file.ts', false);
      expect(result).toContain('## File 1: relative/path/to/file.ts');
    });
  });
});

