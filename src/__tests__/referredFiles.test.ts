import { ConversationContextManager } from '../harmony/conversationContext';
import { ChatManager } from '../harmony/chatManager';
import { TransitionHandler } from '../harmony/transitionHandler';
import { AssumptionsManager } from '../harmony/assumptionsManager';
import { ImplementationManager } from '../harmony/implementationManager';
import { ProgressPlanManager } from '../progressPlanManager';
import { PromptBuilder } from '../harmony/promptBuilder';
import { StageStateMachine } from '../harmony/stageStateMachine';

describe('Referred Files Flow', () => {
  let contextManager: ConversationContextManager;
  let chatManager: ChatManager;
  let assumptionsManager: AssumptionsManager;
  let implementationManager: ImplementationManager;
  let transitionHandler: TransitionHandler;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    contextManager = new ConversationContextManager();
    chatManager = new ChatManager();
    progressPlanManager = new ProgressPlanManager();
    assumptionsManager = new AssumptionsManager(progressPlanManager);
    implementationManager = new ImplementationManager(progressPlanManager);
    transitionHandler = new TransitionHandler(
      contextManager,
      chatManager,
      assumptionsManager,
      implementationManager
    );

    // Initialize context
    contextManager.initialize('test prompt');
    chatManager.initialize();
  });

  describe('ConversationContextManager - referred files', () => {
    it('should set and get referred files', () => {
      const referredFiles = [
        { file: 'src/test.ts', description: 'Test file' },
        { file: 'package.json', description: 'Package configuration' }
      ];

      contextManager.setReferredFiles(referredFiles);
      const retrieved = contextManager.getReferredFiles();

      expect(retrieved).toEqual(referredFiles);
      expect(retrieved.length).toBe(2);
    });

    it('should return empty array when no referred files set', () => {
      const referred = contextManager.getReferredFiles();
      expect(referred).toEqual([]);
    });

    it('should preserve referred files when updating context stage', () => {
      const referredFiles = [{ file: 'index.ts' }];
      contextManager.setReferredFiles(referredFiles);
      
      contextManager.updateStage('assumptions');
      const retrieved = contextManager.getReferredFiles();

      expect(retrieved).toEqual(referredFiles);
    });

    it('should override previous referred files when setting new ones', () => {
      const files1 = [{ file: 'file1.ts' }];
      const files2 = [{ file: 'file2.ts' }, { file: 'file3.ts' }];

      contextManager.setReferredFiles(files1);
      expect(contextManager.getReferredFiles()).toEqual(files1);

      contextManager.setReferredFiles(files2);
      expect(contextManager.getReferredFiles()).toEqual(files2);
    });
  });

  describe('ChatManager - referred files population', () => {
    it('should populate referredFiles from explicit file contexts', () => {
      // Add a query with related files
      chatManager.addQuery('test query', ['src/test.ts', 'src/utils.ts']);

      const export_ = chatManager.exportForTransition();
      expect(export_.referredFiles.length).toBeGreaterThan(0);
      expect(export_.referredFiles.some(rf => rf.file === 'src/test.ts')).toBe(true);
    });

    it('should handle detected files in referredFiles', () => {
      // Mock file extraction result with detected files
      chatManager.addQueryWithFiles(
        'analyze this code',
        [],
        {
          explicitFiles: [],
          detectedFiles: [
            { path: 'src/main.ts', type: 'file', confidence: 'high', extractedAt: Date.now() },
            { path: 'src/utils.ts', type: 'file', confidence: 'medium', extractedAt: Date.now() }
          ]
        }
      );

      const export_ = chatManager.exportForTransition();
      expect(export_.referredFiles.length).toBeGreaterThanOrEqual(2);
    });

    it('should deduplicate referred files', () => {
      chatManager.addQuery('query1', ['src/test.ts']);
      chatManager.addQuery('query2', ['src/test.ts', 'src/utils.ts']);

      const export_ = chatManager.exportForTransition();
      const testTsCount = export_.referredFiles.filter(rf => rf.file === 'src/test.ts').length;
      
      // Should only appear once despite being added twice
      expect(testTsCount).toBe(1);
    });
  });

  describe('TransitionHandler - referred files preservation', () => {
    it('should store referred files in context when transitioning to assumptions', async () => {
      // Setup chat manager with referred files
      chatManager.addQuery('test query', ['src/test.ts', 'package.json']);

      // Transition to assumptions
      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');

      // Verify referred files are stored in context
      const referred = contextManager.getReferredFiles();
      expect(referred.length).toBeGreaterThan(0);
      expect(referred.some(rf => rf.file === 'src/test.ts')).toBe(true);
    });

    it('should handle empty referred files gracefully', async () => {
      // Don't add any queries, so no referred files
      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');

      const referred = contextManager.getReferredFiles();
      expect(referred).toEqual([]);
    });

    it('should preserve referred files across multiple transitions', async () => {
      chatManager.addQuery('test', ['src/test.ts']);
      
      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');
      let referred = contextManager.getReferredFiles();
      expect(referred.length).toBeGreaterThan(0);

      // Move to implementation
      contextManager.updateStage('implementation');
      referred = contextManager.getReferredFiles();
      expect(referred.length).toBeGreaterThan(0);
    });
  });

  describe('PromptBuilder - referred files in prompt', () => {
    let promptBuilder: PromptBuilder;
    let stageStateMachine: StageStateMachine;

    beforeEach(() => {
      stageStateMachine = new StageStateMachine();
      promptBuilder = new PromptBuilder(
        { 
          harmonyMode: 'standard',
          openRouterApiKey: 'test-key',
          modelName: 'test-model'
        } as any,
        stageStateMachine
      );
    });

    it('should include referred files in assumptions stage prompt', async () => {
      const context = contextManager.getContext();
      if (context) {
        contextManager.setReferredFiles([
          { file: 'src/test.ts', description: 'Test file' }
        ]);
      }

      const prompt = await promptBuilder.buildPrompt(
        'analyze the code',
        'assumptions',
        contextManager.getContext(),
        false
      );

      expect(prompt).toContain('IDENTIFIED FILES');
      expect(prompt).toContain('src/test.ts');
      expect(prompt).toContain('read_file');
    });

    it('should include referred files in implementation stage prompt', async () => {
      const context = contextManager.getContext();
      if (context) {
        contextManager.setReferredFiles([
          { file: 'src/main.ts', description: 'Main entry point' }
        ]);
      }

      const prompt = await promptBuilder.buildPrompt(
        'implement the changes',
        'implementation',
        contextManager.getContext(),
        false
      );

      expect(prompt).toContain('IDENTIFIED FILES');
      expect(prompt).toContain('src/main.ts');
    });

    it('should not include files section when no referred files in assumptions', async () => {
      const context = contextManager.getContext();
      if (context) {
        contextManager.setReferredFiles([]);
      }

      const prompt = await promptBuilder.buildPrompt(
        'analyze the code',
        'assumptions',
        contextManager.getContext(),
        false
      );

      // Should not have the files section if no files
      expect(prompt).not.toContain('IDENTIFIED FILES');
    });

    it('should format multiple referred files correctly', async () => {
      const context = contextManager.getContext();
      if (context) {
        contextManager.setReferredFiles([
          { file: 'src/test.ts', description: 'Test file' },
          { file: 'src/utils.ts', description: 'Utility functions' },
          { file: 'package.json' }
        ]);
      }

      const prompt = await promptBuilder.buildPrompt(
        'analyze everything',
        'assumptions',
        contextManager.getContext(),
        false
      );

      expect(prompt).toContain('src/test.ts');
      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('package.json');
      expect(prompt).toContain('Test file');
      expect(prompt).toContain('Utility functions');
    });

    it('should include guidance to use read_file instead of find_files', async () => {
      const context = contextManager.getContext();
      if (context) {
        contextManager.setReferredFiles([
          { file: 'src/test.ts' }
        ]);
      }

      const prompt = await promptBuilder.buildPrompt(
        'analyze',
        'assumptions',
        contextManager.getContext(),
        false
      );

      expect(prompt).toContain('read_file');
      expect(prompt).toContain('IDENTIFIED FILES');
    });
  });

  describe('Chat to Assumptions stage with referred files', () => {
    it('should flow referred files from chat -> context -> assumptions', async () => {
      // Simulate chat stage file detection
      chatManager.addQuery('show me test.ts', ['src/test.ts']);
      chatManager.addQuery('also package.json', ['package.json']);

      const chatExport = chatManager.exportForTransition();
      expect(chatExport.referredFiles.length).toBeGreaterThan(0);

      // Transition
      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');

      // Verify files are in context
      const contextReferred = contextManager.getReferredFiles();
      expect(contextReferred.length).toBeGreaterThan(0);
      expect(contextReferred.some(rf => rf.file === 'src/test.ts')).toBe(true);
    });

    it('should make referred files available to assumptions prompt', async () => {
      chatManager.addQuery('check src/index.ts', ['src/index.ts']);

      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');

      const context = contextManager.getContext();
      expect(context?.referredFiles).toBeDefined();
      expect(context?.referredFiles?.length).toBeGreaterThan(0);
      expect(context?.referredFiles?.[0].file).toContain('index.ts');
    });
  });

  describe('Integration - avoiding file re-detection', () => {
    it('should provide referred files so AI does not need to call find_files', async () => {
      // Setup
      chatManager.addQuery('analyze src/main.ts and src/utils.ts', [
        'src/main.ts',
        'src/utils.ts'
      ]);

      // Transition to assumptions
      await transitionHandler.handleChatToAssumptionsTransition('move to assumptions');

      // Build assumptions prompt
      const promptBuilder = new PromptBuilder(
        { 
          harmonyMode: 'standard',
          openRouterApiKey: 'test-key',
          modelName: 'test-model'
        } as any,
        new StageStateMachine()
      );

      const prompt = await promptBuilder.buildPrompt(
        'create implementation plan',
        'assumptions',
        contextManager.getContext(),
        false
      );

      // Verify prompt includes files and guidance to use them directly
      expect(prompt).toContain('src/main.ts');
      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('read_file');
      expect(prompt).toContain('IDENTIFIED FILES');
    });
  });
});
