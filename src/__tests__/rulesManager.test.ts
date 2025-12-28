import { RulesManager } from '../rulesManager';
import { RuleConfig } from '../config';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Mock vscode
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: '/workspace',
        },
      },
    ],
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    })),
  },
  window: {
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
  RelativePattern: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

describe('RulesManager', () => {
  let rulesManager: RulesManager;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    rulesManager = new RulesManager();
    mockFs.existsSync.mockReturnValue(true);
  });

  describe('loadRules with enabled flag', () => {
    it('should load only enabled rules', async () => {
      const rulePath1 = '/workspace/rules/rule1.md';
      const rulePath2 = '/workspace/rules/rule2.md';
      const rulePath3 = '/workspace/rules/rule3.md';

      // Mock file stats
      mockFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        return {
          isFile: () => true,
          mtimeMs: 1000,
        } as fs.Stats;
      });

      // Mock file contents
      (fs.promises.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === rulePath1) {
          return Promise.resolve('---\ndescription: Rule 1\n---\nContent of rule 1');
        }
        if (filePath === rulePath2) {
          return Promise.resolve('---\ndescription: Rule 2\n---\nContent of rule 2');
        }
        if (filePath === rulePath3) {
          return Promise.resolve('---\ndescription: Rule 3\n---\nContent of rule 3');
        }
        return Promise.resolve('');
      });

      const rulesPaths: RuleConfig[] = [
        { path: rulePath1, enabled: true },
        { path: rulePath2, enabled: false }, // disabled
        { path: rulePath3, enabled: true },
      ];

      await rulesManager.loadRules(rulesPaths);

      const allRules = rulesManager.getAllRules();
      // Only 2 rules should be loaded (rule1 and rule3)
      expect(allRules).toHaveLength(2);
      expect(allRules.find(r => r.filePath === rulePath1)).toBeDefined();
      expect(allRules.find(r => r.filePath === rulePath2)).toBeUndefined();
      expect(allRules.find(r => r.filePath === rulePath3)).toBeDefined();
    });

    it('should skip all rules when all are disabled', async () => {
      const rulePath1 = '/workspace/rules/rule1.md';
      const rulePath2 = '/workspace/rules/rule2.md';

      mockFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        return {
          isFile: () => true,
          mtimeMs: 1000,
        } as fs.Stats;
      });

      (fs.promises.readFile as jest.Mock).mockImplementation(() => {
        return Promise.resolve('---\ndescription: Rule\n---\nContent');
      });

      const rulesPaths: RuleConfig[] = [
        { path: rulePath1, enabled: false },
        { path: rulePath2, enabled: false },
      ];

      await rulesManager.loadRules(rulesPaths);

      const allRules = rulesManager.getAllRules();
      expect(allRules).toHaveLength(0);
    });

    it('should load all rules when all are enabled', async () => {
      const rulePath1 = '/workspace/rules/rule1.md';
      const rulePath2 = '/workspace/rules/rule2.md';

      mockFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        return {
          isFile: () => true,
          mtimeMs: 1000,
        } as fs.Stats;
      });

      (fs.promises.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === rulePath1) {
          return Promise.resolve('---\ndescription: Rule 1\n---\nContent 1');
        }
        if (filePath === rulePath2) {
          return Promise.resolve('---\ndescription: Rule 2\n---\nContent 2');
        }
        return Promise.resolve('');
      });

      const rulesPaths: RuleConfig[] = [
        { path: rulePath1, enabled: true },
        { path: rulePath2, enabled: true },
      ];

      await rulesManager.loadRules(rulesPaths);

      const allRules = rulesManager.getAllRules();
      expect(allRules).toHaveLength(2);
      expect(allRules.find(r => r.filePath === rulePath1)).toBeDefined();
      expect(allRules.find(r => r.filePath === rulePath2)).toBeDefined();
    });

    it('should not attempt to read disabled rule files', async () => {
      const rulePath1 = '/workspace/rules/rule1.md';
      const rulePath2 = '/workspace/rules/rule2.md'; // disabled

      mockFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        return {
          isFile: () => true,
          mtimeMs: 1000,
        } as fs.Stats;
      });

      const readFileMock = fs.promises.readFile as jest.Mock;
      readFileMock.mockImplementation((filePath: string) => {
        if (filePath === rulePath1) {
          return Promise.resolve('---\ndescription: Rule 1\n---\nContent 1');
        }
        return Promise.resolve('');
      });

      const rulesPaths: RuleConfig[] = [
        { path: rulePath1, enabled: true },
        { path: rulePath2, enabled: false },
      ];

      await rulesManager.loadRules(rulesPaths);

      // Verify readFile was only called for the enabled rule
      expect(readFileMock).toHaveBeenCalledTimes(1);
      expect(readFileMock).toHaveBeenCalledWith(rulePath1, 'utf-8');
      expect(readFileMock).not.toHaveBeenCalledWith(rulePath2, 'utf-8');
    });

    it('should handle empty rulesPaths array', async () => {
      await rulesManager.loadRules([]);

      const allRules = rulesManager.getAllRules();
      expect(allRules).toHaveLength(0);
    });

    it('should handle rulesPaths with only disabled rules', async () => {
      const rulesPaths: RuleConfig[] = [
        { path: '/workspace/rules/rule1.md', enabled: false },
        { path: '/workspace/rules/rule2.md', enabled: false },
      ];

      await rulesManager.loadRules(rulesPaths);

      const allRules = rulesManager.getAllRules();
      expect(allRules).toHaveLength(0);
      // Should not attempt to read any files
      expect(fs.promises.readFile).not.toHaveBeenCalled();
    });
  });
});

