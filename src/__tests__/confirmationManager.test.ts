import { ConfirmationManager, PendingConfirmation } from '../harmony/confirmationManager';
import { WorkflowStage } from '../harmony/stageStateMachine';
import { ChatMessage } from '../conversationManager';

describe('ConfirmationManager', () => {
  let manager: ConfirmationManager;

  beforeEach(() => {
    manager = new ConfirmationManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('detectAndStoreConfirmation', () => {
    const conversationHistory: ChatMessage[] = [
      { role: 'user', content: 'analyze latin: invenietur' },
      { role: 'assistant', content: 'Would you like me to proceed to assumptions stage?' },
    ];

    describe('chat to assumptions', () => {
      it('should detect "would you like me to proceed to assumptions"', () => {
        const content = 'Would you like me to proceed to assumptions stage to use the analyze_latin tool?';
        manager.detectAndStoreConfirmation(content, 'chat', conversationHistory);

        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation).toBeDefined();
        expect(confirmation?.action).toBe('move_to_assumptions');
        expect(confirmation?.targetStage).toBe('assumptions');
        expect(confirmation?.sourceStage).toBe('chat');
        expect(confirmation?.originalQuery).toBe('analyze latin: invenietur');
      });

      it('should detect "reply yes to proceed to assumptions"', () => {
        const content = 'This tool is not available in Chat stage. Reply "yes" to proceed to assumptions stage.';
        manager.detectAndStoreConfirmation(content, 'chat', conversationHistory);

        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation?.action).toBe('move_to_assumptions');
      });

      it('should detect "move to assumptions stage"', () => {
        const content = 'I can proceed to the Assumptions stage to invoke it. Would you like me to continue?';
        manager.detectAndStoreConfirmation(content, 'chat', conversationHistory);

        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation?.action).toBe('move_to_assumptions');
      });

      it('should detect "to use tools in assumptions"', () => {
        const content = 'To use the analyze_latin tool, I need to move to assumptions stage. Should I proceed?';
        manager.detectAndStoreConfirmation(content, 'chat', conversationHistory);

        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation?.action).toBe('move_to_assumptions');
      });

      it('should not detect confirmation in implementation stage', () => {
        const content = 'Would you like me to proceed to assumptions stage?';
        manager.detectAndStoreConfirmation(content, 'implementation', conversationHistory);

        const confirmation = manager.getPendingConfirmation('implementation');
        expect(confirmation).toBeNull();
      });

      it('should not detect confirmation in init stage', () => {
        const content = 'Would you like me to proceed to assumptions stage?';
        manager.detectAndStoreConfirmation(content, 'init', conversationHistory);

        const confirmation = manager.getPendingConfirmation('init');
        expect(confirmation).toBeNull();
      });
    });

    describe('assumptions to implementation', () => {
      const assumptionsHistory: ChatMessage[] = [
        { role: 'user', content: 'create hello.py' },
        { role: 'assistant', content: 'Here is the code snippet...' },
      ];

      it('should detect "would you like me to proceed to implementation"', () => {
        const content = 'Would you like me to proceed to implementation stage to create the files?';
        manager.detectAndStoreConfirmation(content, 'assumptions', assumptionsHistory);

        const confirmation = manager.getPendingConfirmation('assumptions');
        expect(confirmation).toBeDefined();
        expect(confirmation?.action).toBe('move_to_implementation');
        expect(confirmation?.targetStage).toBe('implementation');
        expect(confirmation?.sourceStage).toBe('assumptions');
      });

      it('should detect "reply yes to proceed to implementation"', () => {
        const content = 'Code snippets are ready. Reply "yes" to proceed to implementation stage.';
        manager.detectAndStoreConfirmation(content, 'assumptions', assumptionsHistory);

        const confirmation = manager.getPendingConfirmation('assumptions');
        expect(confirmation?.action).toBe('move_to_implementation');
      });

      it('should detect "move to implementation stage"', () => {
        const content = 'I can now move to implementation stage to create the files. Should I proceed?';
        manager.detectAndStoreConfirmation(content, 'assumptions', assumptionsHistory);

        const confirmation = manager.getPendingConfirmation('assumptions');
        expect(confirmation?.action).toBe('move_to_implementation');
      });

      it('should detect "create files in implementation"', () => {
        const content = 'To create the files, I need to move to implementation stage. Do you want me to proceed?';
        manager.detectAndStoreConfirmation(content, 'assumptions', assumptionsHistory);

        const confirmation = manager.getPendingConfirmation('assumptions');
        expect(confirmation?.action).toBe('move_to_implementation');
      });

      it('should not detect confirmation from chat stage for implementation', () => {
        const content = 'Would you like me to proceed to implementation stage?';
        manager.detectAndStoreConfirmation(content, 'chat', assumptionsHistory);

        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle empty content', () => {
        manager.detectAndStoreConfirmation('', 'chat', conversationHistory);
        expect(manager.hasPendingConfirmation()).toBe(false);
      });

      it('should handle null/undefined content', () => {
        manager.detectAndStoreConfirmation(null as any, 'chat', conversationHistory);
        expect(manager.hasPendingConfirmation()).toBe(false);
      });

      it('should clear confirmation when stage changes', () => {
        const content = 'Would you like me to proceed to assumptions stage?';
        manager.detectAndStoreConfirmation(content, 'chat', conversationHistory);
        expect(manager.hasPendingConfirmation()).toBe(true);

        // Simulate stage change - detect in different stage
        manager.detectAndStoreConfirmation('Some other content', 'assumptions', conversationHistory);
        
        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation).toBeNull();
      });

      it('should extract original query from conversation history', () => {
        const history: ChatMessage[] = [
          { role: 'user', content: 'analyze latin: invenietur' },
          { role: 'assistant', content: 'Would you like me to proceed?' },
        ];
        
        manager.detectAndStoreConfirmation('Would you like me to proceed to assumptions?', 'chat', history);
        
        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation?.originalQuery).toBe('analyze latin: invenietur');
      });

      it('should handle missing conversation history', () => {
        const content = 'Would you like me to proceed to assumptions stage?';
        manager.detectAndStoreConfirmation(content, 'chat', undefined);
        
        const confirmation = manager.getPendingConfirmation('chat');
        expect(confirmation).toBeDefined();
        expect(confirmation?.originalQuery).toBeUndefined();
      });
    });
  });

  describe('isConfirmationResponse', () => {
    it('should recognize simple affirmatives', () => {
      expect(manager.isConfirmationResponse('yes')).toBe(true);
      expect(manager.isConfirmationResponse('yep')).toBe(true);
      expect(manager.isConfirmationResponse('yeah')).toBe(true);
      expect(manager.isConfirmationResponse('y')).toBe(true);
      expect(manager.isConfirmationResponse('ok')).toBe(true);
      expect(manager.isConfirmationResponse('okay')).toBe(true);
      expect(manager.isConfirmationResponse('sure')).toBe(true);
      expect(manager.isConfirmationResponse('certainly')).toBe(true);
      expect(manager.isConfirmationResponse('absolutely')).toBe(true);
    });

    it('should recognize action confirmations', () => {
      expect(manager.isConfirmationResponse('proceed')).toBe(true);
      expect(manager.isConfirmationResponse('continue')).toBe(true);
      expect(manager.isConfirmationResponse('go ahead')).toBe(true);
      expect(manager.isConfirmationResponse("let's go")).toBe(true);
      expect(manager.isConfirmationResponse('do it')).toBe(true);
      expect(manager.isConfirmationResponse("let's do it")).toBe(true);
    });

    it('should recognize casual confirmations', () => {
      expect(manager.isConfirmationResponse('sounds good')).toBe(true);
      expect(manager.isConfirmationResponse('that works')).toBe(true);
      expect(manager.isConfirmationResponse('good idea')).toBe(true);
      expect(manager.isConfirmationResponse('agreed')).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(manager.isConfirmationResponse('YES')).toBe(true);
      expect(manager.isConfirmationResponse('Ok')).toBe(true);
      expect(manager.isConfirmationResponse('Proceed')).toBe(true);
    });

    it('should reject non-confirmations', () => {
      expect(manager.isConfirmationResponse('no')).toBe(false);
      expect(manager.isConfirmationResponse('maybe')).toBe(false);
      expect(manager.isConfirmationResponse('later')).toBe(false);
      expect(manager.isConfirmationResponse('analyze latin: invenietur')).toBe(false);
      expect(manager.isConfirmationResponse('create hello.py')).toBe(false);
    });

    it('should handle empty or whitespace-only responses', () => {
      expect(manager.isConfirmationResponse('')).toBe(false);
      expect(manager.isConfirmationResponse('   ')).toBe(false);
      expect(manager.isConfirmationResponse('\n\t')).toBe(false);
    });
  });

  describe('getPendingConfirmation', () => {
    it('should return null when no confirmation is pending', () => {
      expect(manager.getPendingConfirmation('chat')).toBeNull();
    });

    it('should return confirmation for matching stage', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      const confirmation = manager.getPendingConfirmation('chat');
      expect(confirmation).toBeDefined();
      expect(confirmation?.action).toBe('move_to_assumptions');
    });

    it('should return null for non-matching stage', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      const confirmation = manager.getPendingConfirmation('assumptions');
      expect(confirmation).toBeNull();
    });

    it('should expire old confirmations (5 minutes)', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      // Manually set timestamp to 6 minutes ago
      const oldConfirmation: PendingConfirmation = {
        action: 'move_to_assumptions',
        targetStage: 'assumptions',
        sourceStage: 'chat',
        timestamp: Date.now() - (6 * 60 * 1000), // 6 minutes ago
      };
      (manager as any).pendingConfirmation = oldConfirmation;
      
      const confirmation = manager.getPendingConfirmation('chat');
      expect(confirmation).toBeNull();
    });
  });

  describe('consumeConfirmation', () => {
    it('should return and clear confirmation for matching stage', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      expect(manager.hasPendingConfirmation()).toBe(true);
      
      const confirmation = manager.consumeConfirmation('chat');
      expect(confirmation).toBeDefined();
      expect(confirmation?.action).toBe('move_to_assumptions');
      
      expect(manager.hasPendingConfirmation()).toBe(false);
    });

    it('should return null for non-matching stage', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      const confirmation = manager.consumeConfirmation('assumptions');
      expect(confirmation).toBeNull();
      expect(manager.hasPendingConfirmation()).toBe(true); // Still pending
    });

    it('should return null when no confirmation is pending', () => {
      const confirmation = manager.consumeConfirmation('chat');
      expect(confirmation).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear pending confirmation', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      expect(manager.hasPendingConfirmation()).toBe(true);
      
      manager.clear();
      
      expect(manager.hasPendingConfirmation()).toBe(false);
      expect(manager.getPendingConfirmation('chat')).toBeNull();
    });

    it('should handle clear when no confirmation is pending', () => {
      expect(() => manager.clear()).not.toThrow();
      expect(manager.hasPendingConfirmation()).toBe(false);
    });
  });

  describe('hasPendingConfirmation', () => {
    it('should return false when no confirmation is pending', () => {
      expect(manager.hasPendingConfirmation()).toBe(false);
    });

    it('should return true when confirmation is pending', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      expect(manager.hasPendingConfirmation()).toBe(true);
    });

    it('should return false after clearing', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      manager.clear();
      
      expect(manager.hasPendingConfirmation()).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full chat to assumptions flow', () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'analyze latin: invenietur' },
      ];
      
      // Assistant asks for confirmation
      const assistantResponse = 'Would you like me to continue and analyze *invenietur* using the required tool? (Reply "yes" to proceed.)';
      manager.detectAndStoreConfirmation(assistantResponse, 'chat', history);
      
      // User confirms
      expect(manager.isConfirmationResponse('yes')).toBe(true);
      const confirmation = manager.getPendingConfirmation('chat');
      expect(confirmation?.action).toBe('move_to_assumptions');
      
      // Consume confirmation
      const consumed = manager.consumeConfirmation('chat');
      expect(consumed).toBeDefined();
      expect(manager.hasPendingConfirmation()).toBe(false);
    });

    it('should handle assumptions to implementation flow', () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'create hello.py' },
        { role: 'assistant', content: 'Here is the code snippet:\n```python\nprint("Hello")\n```' },
      ];
      
      // Assistant asks for confirmation
      const assistantResponse = 'Code snippets are ready. Would you like me to proceed to implementation stage to create the files?';
      manager.detectAndStoreConfirmation(assistantResponse, 'assumptions', history);
      
      // User confirms
      expect(manager.isConfirmationResponse('proceed')).toBe(true);
      const confirmation = manager.getPendingConfirmation('assumptions');
      expect(confirmation?.action).toBe('move_to_implementation');
      
      // Consume confirmation
      const consumed = manager.consumeConfirmation('assumptions');
      expect(consumed).toBeDefined();
      expect(manager.hasPendingConfirmation()).toBe(false);
    });

    it('should handle user saying no (rejection)', () => {
      const content = 'Would you like me to proceed to assumptions stage?';
      manager.detectAndStoreConfirmation(content, 'chat', []);
      
      expect(manager.isConfirmationResponse('no')).toBe(false);
      expect(manager.isConfirmationResponse('not yet')).toBe(false);
      
      // Confirmation should still be pending
      expect(manager.hasPendingConfirmation()).toBe(true);
    });
  });
});

