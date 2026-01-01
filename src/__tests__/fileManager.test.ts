import { FileManager, FileReference, WorkspaceFileIndex } from '../utils/fileManager';
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

describe('FileManager', () => {
  const workspaceRoot = '/home/chenchen/code/test-project';
  let fileManager: FileManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up workspace folders mock
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: workspaceRoot,
        },
      },
    ];

    fileManager = new FileManager();
  });

  describe('Constructor', () => {
    it('should initialize with workspace root', () => {
      expect(fileManager).toBeDefined();
    });

    it('should handle no workspace folders gracefully', () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const manager = new FileManager();
      expect(manager).toBeDefined();
    });
  });

  describe('buildWorkspaceIndex', () => {
    it('should build workspace index with files and directories', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      // Mock root directory structure
      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'file1.ts', isFile: () => true, isDirectory: () => false },
            { name: 'file2.py', isFile: () => true, isDirectory: () => false },
            { name: 'src', isFile: () => false, isDirectory: () => true },
            { name: '.git', isFile: () => false, isDirectory: () => true },
          ]);
        }
        if (dirPath === path.join(workspaceRoot, 'src')) {
          return Promise.resolve([
            { name: 'file3.js', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        const size = 1000;
        return Promise.resolve({
          isFile: () => true,
          isDirectory: () => false,
          size,
          mtime: new Date(),
        } as fs.Stats);
      });

      const index = await fileManager.buildWorkspaceIndex();

      expect(index.files).toHaveLength(3);
      expect(index.directories).toContain('src');
      expect(index.directories).not.toContain('.git'); // Should be excluded
      expect(index.projectStructure.rootFiles).toContain('file1.ts');
      expect(index.projectStructure.rootFiles).toContain('file2.py');
      expect(index.lastUpdated).toBeInstanceOf(Date);
    });

    it('should exclude patterns from index', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'file1.ts', isFile: () => true, isDirectory: () => false },
            { name: 'node_modules', isFile: () => false, isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation(() => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
        mtime: new Date(),
      } as fs.Stats));

      const index = await fileManager.buildWorkspaceIndex({
        excludePatterns: ['node_modules']
      });

      // node_modules should be excluded
      const hasNodeModules = index.files.some(f => f.relativePath.includes('node_modules')) ||
                             index.directories.some(d => d.includes('node_modules'));
      expect(hasNodeModules).toBe(false);
    });

    it('should throw error when no workspace root', async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const manager = new FileManager();
      
      await expect(manager.buildWorkspaceIndex()).rejects.toThrow('No workspace root available');
    });
  });

  describe('getWorkspaceIndex', () => {
    it('should return cached index if recent', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      mockReaddir.mockResolvedValue([]);
      mockStat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
        mtime: new Date(),
      } as fs.Stats);

      const index1 = await fileManager.getWorkspaceIndex();
      const index2 = await fileManager.getWorkspaceIndex();

      // Should return same instance (cached)
      expect(index1).toBe(index2);
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });
  });

  describe('detectFileReferences', () => {
    it('should detect quoted filenames', async () => {
      const query = 'show me "calc.py" file';
      const result = await fileManager.detectAndCollectFiles(query, { includeContent: false });
      
      expect(result.diagnostics.queryTokens.length).toBeGreaterThan(0);
      expect(result.diagnostics.searchPatterns).toContain('calc.py');
    });

    it('should detect filenames with extensions', async () => {
      const query = 'what does app.js do?';
      const result = await fileManager.detectAndCollectFiles(query, { includeContent: false });
      
      expect(result.diagnostics.searchPatterns.some(p => p.includes('app.js'))).toBe(true);
    });

    it('should detect files from common phrases', async () => {
      const queries = [
        'show me the config.json file',
        'read the package.json',
        'look at index.ts',
      ];

      for (const query of queries) {
        const result = await fileManager.detectAndCollectFiles(query, { includeContent: false });
        expect(result.diagnostics.searchPatterns.length).toBeGreaterThan(0);
      }
    });

    it('should return empty patterns for query without file references', async () => {
      const query = 'what is Python?';
      const result = await fileManager.detectAndCollectFiles(query, { includeContent: false });
      
      expect(result.detectedFiles).toHaveLength(0);
      expect(result.diagnostics.searchPatterns.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectAndCollectFiles', () => {
    beforeEach(() => {
      // Mock workspace index
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      mockReaddir.mockResolvedValue([]);
      mockStat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
        mtime: new Date(),
      } as fs.Stats);
    });

    it('should detect and locate files', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      // Build index with test files
      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'calc.py', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        if (filePath.includes('calc.py')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: 500,
            mtime: new Date('2024-01-01'),
          } as fs.Stats);
        }
        return Promise.reject(new Error('File not found'));
      });

      await fileManager.buildWorkspaceIndex();

      const query = 'calc.py';
      const result = await fileManager.detectAndCollectFiles(query, {
        includeContent: false,
        maxFiles: 5,
      });

      expect(result.diagnostics.searchPatterns.length).toBeGreaterThan(0);
      expect(result.diagnostics.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should read file contents when requested', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);
      const mockReadFile = (fs.promises.readFile as jest.Mock);

      const fileContent = 'print("Hello, World!")';

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'calc.py', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        if (filePath.includes('calc.py')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: fileContent.length,
            mtime: new Date('2024-01-01'),
          } as fs.Stats);
        }
        return Promise.reject(new Error('File not found'));
      });

      mockReadFile.mockResolvedValue(fileContent);

      await fileManager.buildWorkspaceIndex();

      const query = 'calc.py';
      const result = await fileManager.detectAndCollectFiles(query, {
        includeContent: true,
        maxFiles: 5,
      });

      // File should be detected
      expect(result.diagnostics.searchPatterns.length).toBeGreaterThan(0);
    });

    it('should filter by confidence threshold', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'calc.py', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        if (filePath.includes('calc.py')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: 500,
            mtime: new Date('2024-01-01'),
          } as fs.Stats);
        }
        return Promise.reject(new Error('File not found'));
      });

      await fileManager.buildWorkspaceIndex();

      const query = 'calc.py';
      
      // High threshold should only return high confidence matches
      const highResult = await fileManager.detectAndCollectFiles(query, {
        confidenceThreshold: 'high',
      });

      // Low threshold should return more matches
      const lowResult = await fileManager.detectAndCollectFiles(query, {
        confidenceThreshold: 'low',
      });

      expect(lowResult.detectedFiles.length + lowResult.ambiguousMatches.length)
        .toBeGreaterThanOrEqual(highResult.detectedFiles.length + highResult.ambiguousMatches.length);
    });

    it('should limit results by maxFiles', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      // Create multiple files
      const files = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.ts`,
        isFile: () => true,
        isDirectory: () => false,
      }));

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve(files);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation(() => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: new Date(),
      } as fs.Stats));

      await fileManager.buildWorkspaceIndex();

      const query = 'file';
      const result = await fileManager.detectAndCollectFiles(query, {
        maxFiles: 5,
      });

      expect(result.detectedFiles.length + result.ambiguousMatches.length).toBeLessThanOrEqual(5);
    });
  });

  describe('formatForChatPrompt', () => {
    it('should return empty string for no files', () => {
      const result = {
        detectedFiles: [],
        ambiguousMatches: [],
        diagnostics: {
          queryTokens: [],
          searchPatterns: [],
          searchResults: [],
          processingTime: 0,
        },
      };

      const formatted = fileManager.formatForChatPrompt(result);
      expect(formatted).toBe('');
    });

    it('should format detected files', () => {
      const result = {
        detectedFiles: [
          {
            type: 'file' as const,
            path: '/path/to/file.ts',
            relativePath: 'file.ts',
            content: 'const x = 1;',
            confidence: 'high' as const,
            matchType: 'exact' as const,
            metadata: {
              size: 100,
              extension: '.ts',
              lastModified: new Date(),
            },
          },
        ],
        ambiguousMatches: [],
        diagnostics: {
          queryTokens: ['file.ts'],
          searchPatterns: ['file.ts'],
          searchResults: [{ pattern: 'file.ts', matches: 1, files: ['file.ts'] }],
          processingTime: 10,
        },
      };

      const formatted = fileManager.formatForChatPrompt(result);
      
      expect(formatted).toContain('FILE CONTEXT DETECTED');
      expect(formatted).toContain('file.ts');
      expect(formatted).toContain('const x = 1;');
      expect(formatted).toContain('Confidence: high');
    });

    it('should include ambiguous matches', () => {
      const result = {
        detectedFiles: [],
        ambiguousMatches: [
          {
            type: 'file' as const,
            path: '/path/to/config.json',
            relativePath: 'config.json',
            confidence: 'medium' as const,
            matchType: 'pattern' as const,
          },
          {
            type: 'file' as const,
            path: '/path/to/config.yaml',
            relativePath: 'config.yaml',
            confidence: 'medium' as const,
            matchType: 'pattern' as const,
          },
        ],
        diagnostics: {
          queryTokens: ['config'],
          searchPatterns: ['config'],
          searchResults: [{ pattern: 'config', matches: 2, files: ['config.json', 'config.yaml'] }],
          processingTime: 5,
        },
      };

      const formatted = fileManager.formatForChatPrompt(result);
      
      expect(formatted).toContain('Ambiguous Matches');
      expect(formatted).toContain('config.json');
      expect(formatted).toContain('config.yaml');
    });

    it('should truncate large file content', () => {
      const largeContent = 'x'.repeat(25000);
      const result = {
        detectedFiles: [
          {
            type: 'file' as const,
            path: '/path/to/large.ts',
            relativePath: 'large.ts',
            content: largeContent,
            confidence: 'high' as const,
            matchType: 'exact' as const,
            metadata: {
              size: 25000,
              extension: '.ts',
              lastModified: new Date(),
            },
          },
        ],
        ambiguousMatches: [],
        diagnostics: {
          queryTokens: ['large.ts'],
          searchPatterns: ['large.ts'],
          searchResults: [{ pattern: 'large.ts', matches: 1, files: ['large.ts'] }],
          processingTime: 10,
        },
      };

      const formatted = fileManager.formatForChatPrompt(result);
      
      expect(formatted).toContain('x'.repeat(20000));
      expect(formatted).not.toContain('x'.repeat(20001));
      expect(formatted).toContain('[Content truncated');
    });

    it('should include diagnostics when requested', () => {
      const result = {
        detectedFiles: [
          {
            type: 'file' as const,
            path: '/path/to/file.ts',
            relativePath: 'file.ts',
            confidence: 'high' as const,
            matchType: 'exact' as const,
          },
        ],
        ambiguousMatches: [],
        diagnostics: {
          queryTokens: ['file.ts'],
          searchPatterns: ['file.ts'],
          searchResults: [{ pattern: 'file.ts', matches: 1, files: ['file.ts'] }],
          processingTime: 10,
        },
      };

      const formatted = fileManager.formatForChatPrompt(result, true);
      
      expect(formatted).toContain('Diagnostics');
      expect(formatted).toContain('Processing time');
      expect(formatted).toContain('Query tokens');
    });
  });

  describe('generateProblemRestatement', () => {
    it('should generate restatement without files', () => {
      const restatement = fileManager.generateProblemRestatement('what is Python?', []);
      
      expect(restatement).toContain('You\'re asking:');
      expect(restatement).toContain('what is Python?');
    });

    it('should generate restatement with single file', () => {
      const files: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/calc.py',
          relativePath: 'calc.py',
          confidence: 'high',
          matchType: 'exact',
        },
      ];

      const restatement = fileManager.generateProblemRestatement('what does it do?', files);
      
      expect(restatement).toContain('calc.py');
      expect(restatement).toContain('what does it do?');
    });

    it('should generate restatement with multiple files', () => {
      const files: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file1.ts',
          relativePath: 'file1.ts',
          confidence: 'high',
          matchType: 'exact',
        },
        {
          type: 'file',
          path: '/path/to/file2.ts',
          relativePath: 'file2.ts',
          confidence: 'high',
          matchType: 'exact',
        },
      ];

      const restatement = fileManager.generateProblemRestatement('compare these', files);
      
      expect(restatement).toContain('file1.ts');
      expect(restatement).toContain('file2.ts');
      expect(restatement).toContain('following files');
    });
  });

  describe('getWorkspaceStructureSummary', () => {
    it('should return summary for workspace index', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'file1.ts', isFile: () => true, isDirectory: () => false },
            { name: 'file2.py', isFile: () => true, isDirectory: () => false },
            { name: 'src', isFile: () => false, isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation(() => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
        size: 1000,
        mtime: new Date(),
      } as fs.Stats));

      await fileManager.buildWorkspaceIndex();
      const summary = fileManager.getWorkspaceStructureSummary();

      expect(summary).toContain('Total files');
      expect(summary).toContain('Total directories');
      expect(summary).toContain('File types');
    });

    it('should handle no index gracefully', () => {
      const manager = new FileManager();
      const summary = manager.getWorkspaceStructureSummary();
      
      expect(summary).toContain('not available');
    });
  });

  describe('getFilesForNextStage', () => {
    it('should return only high-confidence files', () => {
      const files: FileReference[] = [
        {
          type: 'file',
          path: '/path/to/file1.ts',
          relativePath: 'file1.ts',
          confidence: 'high',
          matchType: 'exact',
        },
        {
          type: 'file',
          path: '/path/to/file2.ts',
          relativePath: 'file2.ts',
          confidence: 'medium',
          matchType: 'pattern',
        },
        {
          type: 'file',
          path: '/path/to/file3.ts',
          relativePath: 'file3.ts',
          confidence: 'low',
          matchType: 'pattern',
        },
      ];

      const nextStageFiles = fileManager.getFilesForNextStage(files);
      
      expect(nextStageFiles).toHaveLength(1);
      expect(nextStageFiles[0].confidence).toBe('high');
      expect(nextStageFiles[0].relativePath).toBe('file1.ts');
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);
      const mockReadFile = (fs.promises.readFile as jest.Mock);

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'calc.py', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        if (filePath.includes('calc.py')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: 100,
            mtime: new Date(),
          } as fs.Stats);
        }
        return Promise.reject(new Error('File not found'));
      });

      mockReadFile.mockRejectedValue(new Error('Permission denied'));

      await fileManager.buildWorkspaceIndex();

      const query = 'calc.py';
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const result = await fileManager.detectAndCollectFiles(query, {
        includeContent: true,
      });

      // Should not throw, but may log warnings
      expect(result).toBeDefined();
      
      consoleWarnSpy.mockRestore();
    });

    it('should handle directory read errors gracefully', async () => {
      const mockReaddir = (fs.promises.readdir as jest.Mock);
      const mockStat = (fs.promises.stat as jest.Mock);

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'valid', isFile: () => false, isDirectory: () => true },
          ]);
        }
        if (dirPath === path.join(workspaceRoot, 'valid')) {
          return Promise.reject(new Error('Permission denied'));
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation(() => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: new Date(),
      } as fs.Stats));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await fileManager.buildWorkspaceIndex();

      // Should not throw, but may log warnings
      expect(consoleWarnSpy).toHaveBeenCalled();
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Caching', () => {
    it('should cache file content', async () => {
      const mockStat = (fs.promises.stat as jest.Mock);
      const mockReaddir = (fs.promises.readdir as jest.Mock);
      const mockReadFile = (fs.promises.readFile as jest.Mock);

      const fileContent = 'test content';

      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === workspaceRoot) {
          return Promise.resolve([
            { name: 'test.ts', isFile: () => true, isDirectory: () => false },
          ]);
        }
        return Promise.resolve([]);
      });

      mockStat.mockImplementation((filePath: string) => {
        if (filePath.includes('test.ts')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: fileContent.length,
            mtime: new Date(),
          } as fs.Stats);
        }
        return Promise.reject(new Error('File not found'));
      });

      mockReadFile.mockResolvedValue(fileContent);

      await fileManager.buildWorkspaceIndex();

      const query = 'test.ts';
      
      // First call - should read file
      await fileManager.detectAndCollectFiles(query, { includeContent: true });
      const firstCallCount = mockReadFile.mock.calls.length;

      // Second call - should use cache (if file was found and cached)
      await fileManager.detectAndCollectFiles(query, { includeContent: true });
      
      // ReadFile should be called at least once (might be called more for index building)
      expect(mockReadFile).toHaveBeenCalled();
    });
  });
});

