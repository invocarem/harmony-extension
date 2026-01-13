import { ChatManager, ChatState } from '../harmony/chatManager';
import { FileReference } from '../utils/fileContextExtractor';
import { FileExtractionResult } from '../utils/verboseInfo';
import * as vscode from 'vscode';

// Mock vscode.workspace.asRelativePath
jest.mock('vscode', () => ({
  workspace: {
    asRelativePath: jest.fn((path: string) => {
      // Simulate converting absolute paths to relative
      if (path.includes('C:\\') || path.includes('/')) {
        // Extract filename or relative path
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1] || path;
      }
      return path;
    }),
  },
}));

describe('ChatManager', () => {
  let manager: ChatManager;

  beforeEach(() => {
    manager = new ChatManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('initialize', () => {
    it('should initialize chat state', () => {
      manager.initialize();

      const state = manager.getState();
      expect(state).toBeDefined();
      expect(state?.queries).toEqual([]);
      expect(state?.referredFiles).toEqual([]);
      expect(state?.lastUpdated).toBeDefined();
    });

    it('should initialize automatically when adding first query', () => {
      manager.addQuery('test query');

      const state = manager.getState();
      expect(state).toBeDefined();
      expect(state?.queries.length).toBe(1);
    });
  });

  describe('addQuery', () => {
    it('should add a query without files', () => {
      manager.initialize();
      manager.addQuery('test query');

      expect(manager.getAllQueries()).toEqual(['test query']);
      expect(manager.getAllRelatedFiles()).toEqual([]);
    });

    it('should add a query with related files', () => {
      manager.initialize();
      manager.addQuery('analyze file.txt', ['file.txt', 'helper.ts']);

      const queries = manager.getAllQueries();
      expect(queries).toEqual(['analyze file.txt']);
      expect(manager.getAllRelatedFiles()).toEqual(['file.txt', 'helper.ts']);
    });

    it('should trim query text', () => {
      manager.initialize();
      manager.addQuery('  test query  ');

      expect(manager.getAllQueries()).toEqual(['test query']);
    });

    it('should track multiple queries', () => {
      manager.initialize();
      manager.addQuery('first query');
      manager.addQuery('second query');
      manager.addQuery('third query');

      expect(manager.getAllQueries()).toHaveLength(3);
      expect(manager.getAllQueries()).toEqual(['first query', 'second query', 'third query']);
    });

    it('should accumulate files across queries', () => {
      manager.initialize();
      manager.addQuery('query 1', ['file1.txt']);
      manager.addQuery('query 2', ['file2.txt']);
      manager.addQuery('query 3', ['file1.txt', 'file3.txt']);

      const allFiles = manager.getAllRelatedFiles();
      expect(allFiles).toContain('file1.txt');
      expect(allFiles).toContain('file2.txt');
      expect(allFiles).toContain('file3.txt');
      expect(allFiles.length).toBe(3);
    });
  });

  describe('updateProblemSummary', () => {
    it('should update problem summary', () => {
      manager.initialize();
      manager.updateProblemSummary('You want to analyze Latin words');

      expect(manager.getProblemSummary()).toBe('You want to analyze Latin words');
    });

    it('should trim problem summary', () => {
      manager.initialize();
      manager.updateProblemSummary('  Problem summary  ');

      expect(manager.getProblemSummary()).toBe('Problem summary');
    });

    it('should initialize automatically when updating summary', () => {
      manager.updateProblemSummary('test summary');

      expect(manager.getProblemSummary()).toBe('test summary');
    });
  });

  describe('updateProblemSummaryFromResponse', () => {
    it('should extract problem summary from valid restatement response', () => {
      manager.initialize();
      manager.addQuery('bug fix on @file:calc.py, please fix indentation problem.');
      
      const responseContent = 'You want to fix the indentation bug in calc.py. The issue is in the divide function.';
      manager.updateProblemSummaryFromResponse(responseContent, 'bug fix on @file:calc.py, please fix indentation problem.');

      expect(manager.getProblemSummary()).toBe('You want to fix the indentation bug in calc.py. The issue is in the divide function.');
    });

    it('should NOT use system warning message as problem summary', () => {
      manager.initialize();
      const userQuery = 'bug fix on @file:calc.py, please fix indentation problem.';
      manager.addQuery(userQuery);
      
      // Simulate the system warning message when file modification tools are blocked
      const warningResponse = 'I understand you want to create files.\n\n⚠️ **Note**: File modification tools (create_file) are not available in the Chat stage. To create files, say "move to assumption" to analyze and provide code snippets first, then "move to implementation" to create the files.';
      
      manager.updateProblemSummaryFromResponse(warningResponse, userQuery);

      // Should extract intent from user query instead of using the warning
      const summary = manager.getProblemSummary();
      expect(summary).not.toContain('I understand you want to create files');
      expect(summary).not.toContain('⚠️');
      expect(summary).toMatch(/fix|indentation|bug/i);
    });

    it('should extract problem summary from user query when response is system warning', () => {
      manager.initialize();
      const userQuery = 'bug fix on @file:calc.py, please fix indentation problem.';
      manager.addQuery(userQuery);
      
      const warningResponse = 'I understand you want to create files.\n\n⚠️ **Note**: File modification tools (create_file) are not available in the Chat stage.';
      
      manager.updateProblemSummaryFromResponse(warningResponse, userQuery);

      const summary = manager.getProblemSummary();
      expect(summary).toBeDefined();
      expect(summary).not.toBe('');
      // Should extract meaningful intent about fixing indentation bug
      expect(summary?.toLowerCase()).toMatch(/fix.*indentation|indentation.*bug|fix.*bug.*calc/i);
    });

    it('should handle response with actual content followed by warning', () => {
      manager.initialize();
      const userQuery = 'bug fix on @file:calc.py, please fix indentation problem.';
      manager.addQuery(userQuery);
      
      // Response has actual content, then warning
      const responseWithContent = 'I can see the indentation issue in calc.py. The divide function has incorrect indentation.\n\n⚠️ **Note**: File modification tools (create_file) are not available in the Chat stage.';
      
      manager.updateProblemSummaryFromResponse(responseWithContent, userQuery);

      // Should use the actual content, not the warning
      const summary = manager.getProblemSummary();
      expect(summary).toContain('indentation issue');
      expect(summary).toContain('calc.py');
      expect(summary).not.toContain('⚠️');
    });

    it('should not update summary if response is only generic warning with no user query context', () => {
      manager.initialize();
      // No query added
      
      const warningResponse = 'I understand you want to create files.\n\n⚠️ **Note**: File modification tools are not available.';
      
      manager.updateProblemSummaryFromResponse(warningResponse, '');

      // Should not set a generic warning as problem summary
      expect(manager.getProblemSummary()).toBeUndefined();
    });

    it('should handle assumptions stage warning message', () => {
      manager.initialize();
      const userQuery = 'bug fix on @file:calc.py, please fix indentation problem.';
      manager.addQuery(userQuery);
      
      const assumptionsWarning = 'I understand you want to create files. In the Analysis stage, I should provide code snippets first.\n\n⚠️ **Note**: File modification tools (create_file) are not available in the Analysis stage.';
      
      manager.updateProblemSummaryFromResponse(assumptionsWarning, userQuery);

      const summary = manager.getProblemSummary();
      expect(summary).not.toContain('I understand you want to create files');
      expect(summary).toMatch(/fix|indentation|bug/i);
    });

    it('should extract summary from response that contains user intent', () => {
      manager.initialize();
      const userQuery = 'fix indentation bug in calc.py divide function';
      manager.addQuery(userQuery);
      
      const response = 'You need to fix the indentation error in the divide function of calc.py. The raise ValueError statement is not properly indented.';
      
      manager.updateProblemSummaryFromResponse(response, userQuery);

      expect(manager.getProblemSummary()).toBe('You need to fix the indentation error in the divide function of calc.py. The raise ValueError statement is not properly indented.');
    });
  });

  describe('linkFilesToQuery', () => {
    it('should link files to the last query by default', () => {
      manager.initialize();
      manager.addQuery('first query');
      manager.addQuery('second query');
      manager.linkFilesToQuery(['file1.txt', 'file2.txt']);

      const state = manager.getState();
      expect(state?.queries[1].relatedFiles).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should link files to specific query by index', () => {
      manager.initialize();
      manager.addQuery('first query');
      manager.addQuery('second query');
      manager.addQuery('third query');
      manager.linkFilesToQuery(['file1.txt'], 0);

      const state = manager.getState();
      expect(state?.queries[0].relatedFiles).toEqual(['file1.txt']);
      expect(state?.queries[1].relatedFiles).toEqual([]);
    });

    it('should not link files if no queries exist', () => {
      manager.initialize();
      manager.linkFilesToQuery(['file1.txt']);

      expect(manager.getAllRelatedFiles()).toEqual([]);
    });

    it('should not duplicate files in query', () => {
      manager.initialize();
      manager.addQuery('query', ['file1.txt']);
      manager.linkFilesToQuery(['file1.txt', 'file2.txt']);

      const state = manager.getState();
      expect(state?.queries[0].relatedFiles).toEqual(['file1.txt', 'file2.txt']);
    });
  });

  describe('getMeaningfulQueries', () => {
    it('should filter out simple greetings', () => {
      manager.initialize();
      manager.addQuery('hi');
      manager.addQuery('analyze latin invenietur');
      manager.addQuery('hello');
      manager.addQuery('analyze latin deus');
      manager.addQuery('thanks');

      const meaningful = manager.getMeaningfulQueries();
      expect(meaningful).toEqual(['analyze latin invenietur', 'analyze latin deus']);
    });

    it('should include longer greetings that are meaningful', () => {
      manager.initialize();
      manager.addQuery('hi');
      manager.addQuery('hello there, how are you?');
      manager.addQuery('analyze file.txt');

      const meaningful = manager.getMeaningfulQueries();
      expect(meaningful).toContain('hello there, how are you?');
      expect(meaningful).toContain('analyze file.txt');
    });

    it('should return all queries if none are greetings', () => {
      manager.initialize();
      manager.addQuery('analyze file1.txt');
      manager.addQuery('analyze file2.txt');

      const meaningful = manager.getMeaningfulQueries();
      expect(meaningful).toHaveLength(2);
    });

    it('should return empty array if no queries', () => {
      manager.initialize();

      expect(manager.getMeaningfulQueries()).toEqual([]);
    });
  });

  describe('getAggregatedPrompt', () => {
    it('should return empty string if no queries', () => {
      manager.initialize();

      expect(manager.getAggregatedPrompt()).toBe('');
    });

    it('should return single query as-is', () => {
      manager.initialize();
      manager.addQuery('analyze latin invenietur');

      expect(manager.getAggregatedPrompt()).toBe('analyze latin invenietur');
    });

    it('should aggregate multiple queries', () => {
      manager.initialize();
      manager.addQuery('analyze latin invenietur');
      manager.addQuery('analyze latin deus');

      const aggregated = manager.getAggregatedPrompt();
      expect(aggregated).toContain('Please address the following requests:');
      expect(aggregated).toContain('analyze latin invenietur');
      expect(aggregated).toContain('analyze latin deus');
    });

    it('should filter out greetings when aggregating', () => {
      manager.initialize();
      manager.addQuery('hi');
      manager.addQuery('analyze latin invenietur');
      manager.addQuery('analyze latin deus');

      const aggregated = manager.getAggregatedPrompt();
      expect(aggregated).not.toContain('hi');
      expect(aggregated).toContain('analyze latin invenietur');
      expect(aggregated).toContain('analyze latin deus');
    });

    it('should format aggregated queries with newlines', () => {
      manager.initialize();
      manager.addQuery('first query');
      manager.addQuery('second query');

      const aggregated = manager.getAggregatedPrompt();
      const lines = aggregated.split('\n');
      expect(lines[0]).toBe('Please address the following requests:');
      expect(lines[1]).toBe(''); // Empty line
      expect(lines[2]).toBe('first query');
      expect(lines[3]).toBe(''); // Empty line
      expect(lines[4]).toBe('second query');
    });
  });

  describe('getAllRelatedFiles', () => {
    it('should return empty array if no files', () => {
      manager.initialize();
      manager.addQuery('test query');

      expect(manager.getAllRelatedFiles()).toEqual([]);
    });

    it('should return all unique files', () => {
      manager.initialize();
      manager.addQuery('query 1', ['file1.txt', 'file2.txt']);
      manager.addQuery('query 2', ['file2.txt', 'file3.txt']);

      const files = manager.getAllRelatedFiles();
      expect(files.length).toBe(3);
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).toContain('file3.txt');
    });
  });

  describe('exportForTransition', () => {
    it('should export empty state if no queries', () => {
      manager.initialize();

      const export_ = manager.exportForTransition();
      expect(export_.queries).toEqual([]);
      expect(export_.aggregatedPrompt).toBe('');
      expect(export_.referredFiles).toEqual([]);
      expect(export_.problemSummary).toBeUndefined();
    });

    it('should export all meaningful queries', () => {
      manager.initialize();
      manager.addQuery('hi');
      manager.addQuery('analyze latin invenietur');
      manager.addQuery('analyze latin deus');

      const export_ = manager.exportForTransition();
      expect(export_.queries).toEqual(['analyze latin invenietur', 'analyze latin deus']);
      expect(export_.aggregatedPrompt).toContain('analyze latin invenietur');
      expect(export_.aggregatedPrompt).toContain('analyze latin deus');
    });

    it('should export problem summary if set', () => {
      manager.initialize();
      manager.addQuery('test query');
      manager.updateProblemSummary('You want to analyze Latin words');

      const export_ = manager.exportForTransition();
      expect(export_.problemSummary).toBe('You want to analyze Latin words');
    });

    it('should export referred files', () => {
      manager.initialize();
      manager.addQuery('query 1', ['file1.txt']);
      manager.addQuery('query 2', ['file2.txt']);

      const export_ = manager.exportForTransition();
      expect(export_.referredFiles.map(rf => rf.file)).toContain('file1.txt');
      expect(export_.referredFiles.map(rf => rf.file)).toContain('file2.txt');
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      manager.initialize();
      manager.addQuery('test query', ['file.txt']);
      manager.updateProblemSummary('test summary');

      manager.clear();

      expect(manager.getState()).toBeNull();
      expect(manager.hasContent()).toBe(false);
      expect(manager.getAllQueries()).toEqual([]);
    });

    it('should allow re-initialization after clear', () => {
      manager.initialize();
      manager.addQuery('test query');
      manager.clear();

      manager.initialize();
      manager.addQuery('new query');

      expect(manager.getAllQueries()).toEqual(['new query']);
    });
  });

  describe('hasContent', () => {
    it('should return false if no state', () => {
      expect(manager.hasContent()).toBe(false);
    });

    it('should return false if no queries', () => {
      manager.initialize();
      expect(manager.hasContent()).toBe(false);
    });

    it('should return true if has queries', () => {
      manager.initialize();
      manager.addQuery('test query');
      expect(manager.hasContent()).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return null if not initialized', () => {
      expect(manager.getState()).toBeNull();
    });

    it('should return copy of state', () => {
      manager.initialize();
      manager.addQuery('test query', ['file.txt']);

      const state1 = manager.getState();
      const state2 = manager.getState();

      expect(state1).not.toBe(state2); // Different objects
      expect(state1?.queries).toEqual(state2?.queries);
    });
  });

  describe('Real-world scenario: Multiple queries before transition', () => {
    it('should track and aggregate multiple queries correctly', () => {
      manager.initialize();

      // Simulate multiple queries in chat stage
      manager.addQuery('hi');
      manager.addQuery('analyze latin invenietur', ['latin.txt']);
      manager.addQuery('analyze latin deus', ['latin.txt']);

      // Check state
      expect(manager.getAllQueries()).toHaveLength(3);
      expect(manager.getMeaningfulQueries()).toHaveLength(2);

      // Export for transition
      const export_ = manager.exportForTransition();
      expect(export_.queries).toEqual(['analyze latin invenietur', 'analyze latin deus']);
      expect(export_.aggregatedPrompt).toContain('Please address the following requests:');
      expect(export_.aggregatedPrompt).toContain('analyze latin invenietur');
      expect(export_.aggregatedPrompt).toContain('analyze latin deus');
      expect(export_.referredFiles.map(rf => rf.file)).toContain('latin.txt');

      // Clear after transition
      manager.clear();
      expect(manager.hasContent()).toBe(false);
    });
  });

  describe('extractRelatedFiles', () => {
    it('should extract files from fileContexts', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
        { type: 'file', path: 'C:\\workspace\\utils.py', content: 'def helper(): pass' },
      ];

      const files = manager.extractRelatedFiles(fileContexts);
      
      expect(files).toHaveLength(2);
      expect(files).toContain('calc.py');
      expect(files).toContain('utils.py');
      expect(vscode.workspace.asRelativePath).toHaveBeenCalledTimes(2);
    });

    it('should extract files from fileExtractionResult', () => {
      manager.initialize();

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', extractedAt: Date.now() },
          { path: 'C:\\workspace\\test.py', type: 'file', extractedAt: Date.now() },
        ],
        detectedFiles: [
          { path: 'C:\\workspace\\helper.py', type: 'file', confidence: 'high', extractedAt: Date.now() },
        ],
      };

      const files = manager.extractRelatedFiles([], fileExtractionResult);
      
      expect(files).toHaveLength(3);
      expect(files).toContain('calc.py');
      expect(files).toContain('test.py');
      expect(files).toContain('helper.py');
    });

    it('should combine files from both fileContexts and fileExtractionResult', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [
          { path: 'C:\\workspace\\utils.py', type: 'file', extractedAt: Date.now() },
        ],
        detectedFiles: [
          { path: 'C:\\workspace\\helper.py', type: 'file', confidence: 'medium', extractedAt: Date.now() },
        ],
      };

      const files = manager.extractRelatedFiles(fileContexts, fileExtractionResult);
      
      expect(files).toHaveLength(3);
      expect(files).toContain('calc.py');
      expect(files).toContain('utils.py');
      expect(files).toContain('helper.py');
    });

    it('should deduplicate files from multiple sources', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', extractedAt: Date.now() },
          { path: 'C:\\workspace\\utils.py', type: 'file', extractedAt: Date.now() },
        ],
        detectedFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', confidence: 'high', extractedAt: Date.now() },
        ],
      };

      const files = manager.extractRelatedFiles(fileContexts, fileExtractionResult);
      
      // calc.py appears in all three sources but should only appear once
      expect(files).toHaveLength(2);
      expect(files.filter(f => f === 'calc.py')).toHaveLength(1);
      expect(files).toContain('calc.py');
      expect(files).toContain('utils.py');
    });

    it('should handle relative paths without modification', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'calc.py', content: 'def add(): pass' },
        { type: 'file', path: 'utils.py', content: 'def helper(): pass' },
      ];

      const files = manager.extractRelatedFiles(fileContexts);
      
      expect(files).toHaveLength(2);
      expect(files).toContain('calc.py');
      expect(files).toContain('utils.py');
    });

    it('should handle asRelativePath failures gracefully', () => {
      manager.initialize();

      // Mock asRelativePath to throw an error
      (vscode.workspace.asRelativePath as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Path conversion failed');
      });

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const files = manager.extractRelatedFiles(fileContexts);
      
      // Should fall back to original path
      expect(files).toHaveLength(1);
      expect(files[0]).toBe('C:\\workspace\\calc.py');
    });

    it('should handle empty fileContexts and fileExtractionResult', () => {
      manager.initialize();

      const files = manager.extractRelatedFiles([], undefined);
      
      expect(files).toEqual([]);
    });

    it('should handle directory references', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'directory', path: 'C:\\workspace\\src', content: 'Directory contents' },
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const files = manager.extractRelatedFiles(fileContexts);
      
      expect(files).toHaveLength(2);
      expect(files).toContain('src');
      expect(files).toContain('calc.py');
    });

    it('should handle selection references', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { 
          type: 'selection', 
          path: 'C:\\workspace\\calc.py', 
          lineStart: 10, 
          lineEnd: 15,
          content: 'def divide(): pass' 
        },
      ];

      const files = manager.extractRelatedFiles(fileContexts);
      
      expect(files).toHaveLength(1);
      expect(files).toContain('calc.py');
    });
  });

  describe('addQueryWithFiles', () => {
    it('should add query with files from fileContexts', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
        { type: 'file', path: 'C:\\workspace\\utils.py', content: 'def helper(): pass' },
      ];

      manager.addQueryWithFiles('fix bug in calc.py', fileContexts);

      const state = manager.getState();
      expect(state?.queries).toHaveLength(1);
      expect(state?.queries[0].query).toBe('fix bug in calc.py');
      expect(state?.queries[0].relatedFiles).toContain('calc.py');
      expect(state?.queries[0].relatedFiles).toContain('utils.py');
      expect(manager.getAllRelatedFiles()).toContain('calc.py');
      expect(manager.getAllRelatedFiles()).toContain('utils.py');
    });

    it('should add query with files from fileExtractionResult', () => {
      manager.initialize();

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', extractedAt: Date.now() },
        ],
        detectedFiles: [
          { path: 'C:\\workspace\\test.py', type: 'file', confidence: 'high', extractedAt: Date.now() },
        ],
      };

      manager.addQueryWithFiles('analyze calculator code', [], fileExtractionResult);

      const state = manager.getState();
      expect(state?.queries).toHaveLength(1);
      expect(state?.queries[0].query).toBe('analyze calculator code');
      expect(state?.queries[0].relatedFiles).toContain('calc.py');
      expect(state?.queries[0].relatedFiles).toContain('test.py');
    });

    it('should combine files from both fileContexts and fileExtractionResult', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const fileExtractionResult: FileExtractionResult = {
        detectedFiles: [
          { path: 'C:\\workspace\\utils.py', type: 'file', confidence: 'medium', extractedAt: Date.now() },
        ],
      };

      manager.addQueryWithFiles('refactor calculator', fileContexts, fileExtractionResult);

      const state = manager.getState();
      expect(state?.queries[0].relatedFiles).toContain('calc.py');
      expect(state?.queries[0].relatedFiles).toContain('utils.py');
      expect(state?.queries[0].relatedFiles).toHaveLength(2);
    });

    it('should initialize state automatically if not initialized', () => {
      // Don't call initialize() first

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      manager.addQueryWithFiles('fix bug', fileContexts);

      const state = manager.getState();
      expect(state).toBeDefined();
      expect(state?.queries).toHaveLength(1);
      expect(state?.queries[0].relatedFiles).toContain('calc.py');
    });

    it('should handle query with no files', () => {
      manager.initialize();

      manager.addQueryWithFiles('simple question', [], undefined);

      const state = manager.getState();
      expect(state?.queries).toHaveLength(1);
      expect(state?.queries[0].query).toBe('simple question');
      expect(state?.queries[0].relatedFiles).toEqual([]);
    });

    it('should deduplicate files when combining sources', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'C:\\workspace\\calc.py', content: 'def add(): pass' },
      ];

      const fileExtractionResult: FileExtractionResult = {
        explicitFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', extractedAt: Date.now() },
        ],
        detectedFiles: [
          { path: 'C:\\workspace\\calc.py', type: 'file', confidence: 'high', extractedAt: Date.now() },
        ],
      };

      manager.addQueryWithFiles('fix calc.py', fileContexts, fileExtractionResult);

      const state = manager.getState();
      // calc.py appears in all sources but should only appear once
      expect(state?.queries[0].relatedFiles.filter(f => f === 'calc.py')).toHaveLength(1);
      expect(state?.queries[0].relatedFiles).toContain('calc.py');
    });

    it('should trim query text', () => {
      manager.initialize();

      const fileContexts: FileReference[] = [
        { type: 'file', path: 'calc.py', content: 'def add(): pass' },
      ];

      manager.addQueryWithFiles('  fix bug  ', fileContexts);

      const state = manager.getState();
      expect(state?.queries[0].query).toBe('fix bug');
    });
  });

  describe('referredFiles in exportForTransition', () => {
    it('should include referredFiles in export when files are detected', () => {
      manager.initialize();
      
      // Simulate file detection from "explain calc.py" query
      const fileContexts: FileReference[] = [];
      const fileExtractionResult: FileExtractionResult = {
        detectedFiles: [
          {
            path: 'calc.py',
            type: 'file',
            confidence: 'high',
            extractedAt: Date.now()
          }
        ],
        explicitFiles: [],
        ambiguousMatches: []
      };
      
      manager.addQueryWithFiles('explain calc.py', fileContexts, fileExtractionResult);
      
      const export_ = manager.exportForTransition();
      
      // Verify referredFiles is not empty
      expect(export_.referredFiles).not.toHaveLength(0);
      expect(export_.referredFiles.length).toBe(1);
      expect(export_.referredFiles[0].file).toBe('calc.py');
    });

    it('should include referredFiles from multiple queries', () => {
      manager.initialize();
      
      const fileExtractionResult1: FileExtractionResult = {
        detectedFiles: [
          {
            path: 'calc.py',
            type: 'file',
            confidence: 'high',
            extractedAt: Date.now()
          }
        ],
        explicitFiles: [],
        ambiguousMatches: []
      };
      
      const fileExtractionResult2: FileExtractionResult = {
        detectedFiles: [
          {
            path: 'utils.py',
            type: 'file',
            confidence: 'high',
            extractedAt: Date.now()
          }
        ],
        explicitFiles: [],
        ambiguousMatches: []
      };
      
      manager.addQueryWithFiles('explain calc.py', [], fileExtractionResult1);
      manager.addQueryWithFiles('show utils.py', [], fileExtractionResult2);
      
      const export_ = manager.exportForTransition();
      
      // Verify referredFiles contains both files
      expect(export_.referredFiles.length).toBe(2);
      expect(export_.referredFiles.map(rf => rf.file)).toContain('calc.py');
      expect(export_.referredFiles.map(rf => rf.file)).toContain('utils.py');
    });

    it('should deduplicate referredFiles when same file appears in multiple queries', () => {
      manager.initialize();
      
      const fileExtractionResult: FileExtractionResult = {
        detectedFiles: [
          {
            path: 'calc.py',
            type: 'file',
            confidence: 'high',
            extractedAt: Date.now()
          }
        ],
        explicitFiles: [],
        ambiguousMatches: []
      };
      
      manager.addQueryWithFiles('explain calc.py', [], fileExtractionResult);
      manager.addQueryWithFiles('what does calc.py do?', [], fileExtractionResult);
      
      const export_ = manager.exportForTransition();
      
      // Verify referredFiles contains calc.py only once
      expect(export_.referredFiles.length).toBe(1);
      expect(export_.referredFiles[0].file).toBe('calc.py');
    });
  });
});

