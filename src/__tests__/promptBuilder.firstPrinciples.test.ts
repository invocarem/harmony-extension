import { ConversationContextManager } from '../harmony/conversationContext';
import { PromptBuilder } from '../harmony/promptBuilder';
import { StageStateMachine } from '../harmony/stageStateMachine';

describe('PromptBuilder - First Principles Rules', () => {
  let promptBuilder: PromptBuilder;
  let stageStateMachine: StageStateMachine;
  let contextManager: ConversationContextManager;

  beforeEach(() => {
    stageStateMachine = new StageStateMachine();
    contextManager = new ConversationContextManager();
    contextManager.initialize('test prompt');
    
    promptBuilder = new PromptBuilder(
      { 
        harmonyMode: 'standard',
        openRouterApiKey: 'test-key',
        modelName: 'test-model'
      } as any,
      stageStateMachine
    );
  });

  describe('Chat Stage - First Principles Rules', () => {
    it('should include first-principles rules in chat stage when enabled', async () => {
      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        'analyze the problem',
        'chat',
        context,
        false,
        [],
        'chat',
        async (name, ctx) => {
          // Simple mock template that shows the context
          return `stageInstructions: ${ctx.stageInstructions}\n${ctx.firstPrinciplesRules ? 'firstPrinciplesRules: included' : 'firstPrinciplesRules: not included'}`;
        },
        true  // isFirstPrinciplesMode = true
      );

      expect(prompt).toContain('firstPrinciplesRules: included');
    });

    it('should NOT include first-principles rules in chat stage when disabled', async () => {
      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        'analyze the problem',
        'chat',
        context,
        false,
        [],
        'chat',
        async (name, ctx) => {
          return `stageInstructions: ${ctx.stageInstructions}\n${ctx.firstPrinciplesRules ? 'firstPrinciplesRules: included' : 'firstPrinciplesRules: not included'}`;
        },
        false  // isFirstPrinciplesMode = false
      );

      expect(prompt).toContain('firstPrinciplesRules: not included');
    });

    it('should provide firstPrinciplesRules object when enabled', async () => {
      const context = contextManager.getContext();
      let receivedRules: string | undefined;

      await promptBuilder.buildPrompt(
        'test',
        'chat',
        context,
        false,
        [],
        'chat',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        true
      );

      expect(receivedRules).toBeDefined();
      expect(receivedRules).toContain('First Principles Thinking');
      expect(receivedRules).toContain('Ask 6-8 short');
    });

    it('should pass undefined firstPrinciplesRules when disabled', async () => {
      const context = contextManager.getContext();
      let receivedRules: string | undefined;

      await promptBuilder.buildPrompt(
        'test',
        'chat',
        context,
        false,
        [],
        'chat',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        false
      );

      expect(receivedRules).toBeUndefined();
    });
  });

  describe('Assumptions Stage - First Principles Rules NOT Applied', () => {
    it('should NOT include first-principles rules in assumptions stage even when flag is set', async () => {
      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        'create implementation plan',
        'assumptions',
        context,
        false,
        [],
        'assumptions',
        async (name, ctx) => {
          return `stage: ${ctx.stage}\n${ctx.firstPrinciplesRules ? 'firstPrinciplesRules: included' : 'firstPrinciplesRules: not included'}`;
        },
        true  // isFirstPrinciplesMode = true (but should be ignored in assumptions)
      );

      expect(prompt).toContain('stage: assumptions');
      // The key test: firstPrinciplesRules should NOT be included in assumptions stage
      expect(prompt).toContain('firstPrinciplesRules: not included');
    });

    it('should have undefined firstPrinciplesRules in assumptions stage template context', async () => {
      const context = contextManager.getContext();
      let receivedRules: string | undefined = 'initialized';

      await promptBuilder.buildPrompt(
        'create plan',
        'assumptions',
        context,
        false,
        [],
        'assumptions',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        true  // flag is true, but should not be used in assumptions
      );

      expect(receivedRules).toBeUndefined();
    });
  });

  describe('Implementation Stage - First Principles Rules NOT Applied', () => {
    it('should NOT include first-principles rules in implementation stage', async () => {
      const context = contextManager.getContext();

      const prompt = await promptBuilder.buildPrompt(
        'execute the plan',
        'implementation',
        context,
        false,
        [],
        'implementation',
        async (name, ctx) => {
          return `stage: ${ctx.stage}\n${ctx.firstPrinciplesRules ? 'firstPrinciplesRules: included' : 'firstPrinciplesRules: not included'}`;
        },
        true  // isFirstPrinciplesMode = true (but should be ignored)
      );

      expect(prompt).toContain('stage: implementation');
      expect(prompt).toContain('firstPrinciplesRules: not included');
    });

    it('should have undefined firstPrinciplesRules in implementation stage template context', async () => {
      const context = contextManager.getContext();
      let receivedRules: string | undefined = 'initialized';

      await promptBuilder.buildPrompt(
        'implement',
        'implementation',
        context,
        false,
        [],
        'implementation',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        true  // flag is true, but should not be used in implementation
      );

      expect(receivedRules).toBeUndefined();
    });
  });

  describe('First Principles Mode Flag Precedence', () => {
    it('should respect isFirstPrinciplesMode flag parameter (takes precedence)', async () => {
      const context = contextManager.getContext();
      if (context) {
        // Try to set firstPrinciplesMode on context (this should be ignored)
        context.firstPrinciplesMode = true;
      }

      let receivedRules: string | undefined;

      // But we pass isFirstPrinciplesMode = false as parameter
      await promptBuilder.buildPrompt(
        'test',
        'chat',
        context,
        false,
        [],
        'chat',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        false  // This parameter takes precedence over context.firstPrinciplesMode
      );

      // Should be undefined because isFirstPrinciplesMode parameter is false
      expect(receivedRules).toBeUndefined();
    });

    it('should use isFirstPrinciplesMode parameter when context is null', async () => {
      let receivedRules: string | undefined;

      await promptBuilder.buildPrompt(
        'test',
        'chat',
        null,  // No context
        false,
        [],
        'chat',
        async (name, ctx) => {
          receivedRules = ctx.firstPrinciplesRules;
          return 'test';
        },
        true  // Parameter should be used
      );

      expect(receivedRules).toBeDefined();
      expect(receivedRules).toContain('First Principles Thinking');
    });
  });

  describe('Stage-Specific Behavior', () => {
    it('should only apply first-principles rules in chat stage, never in other stages', async () => {
      const stages: ('chat' | 'assumptions' | 'implementation')[] = ['chat', 'assumptions', 'implementation'];
      
      for (const stage of stages) {
        let receivedRules: string | undefined;

        await promptBuilder.buildPrompt(
          'test',
          stage,
          contextManager.getContext(),
          false,
          [],
          stage,
          async (name, ctx) => {
            receivedRules = ctx.firstPrinciplesRules;
            return 'test';
          },
          true  // Always enable, but only chat should get it
        );

        if (stage === 'chat') {
          expect(receivedRules).toBeDefined();
        } else {
          expect(receivedRules).toBeUndefined();
        }
      }
    });
  });
});
