import { ChatManager, ChatState } from '../harmony/chatManager';

describe('ChatManager', () => {
  let manager: ChatManager;

  beforeEach(() => {
    manager = new ChatManager();
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
      expect(state?.allRelatedFiles.size).toBe(0);
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
      expect(export_.relatedFiles).toEqual([]);
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

    it('should export related files', () => {
      manager.initialize();
      manager.addQuery('query 1', ['file1.txt']);
      manager.addQuery('query 2', ['file2.txt']);

      const export_ = manager.exportForTransition();
      expect(export_.relatedFiles).toContain('file1.txt');
      expect(export_.relatedFiles).toContain('file2.txt');
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
      expect(export_.relatedFiles).toContain('latin.txt');

      // Clear after transition
      manager.clear();
      expect(manager.hasContent()).toBe(false);
    });
  });
});

