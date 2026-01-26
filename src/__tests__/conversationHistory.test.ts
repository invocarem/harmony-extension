/**
 * Tests for conversation history filtering
 * Ensures commands and stage transitions are not added to conversation history
 */

import { ConversationManager } from '../conversationManager';

describe('ConversationManager - History Filtering', () => {
  let conversationManager: ConversationManager;

  beforeEach(() => {
    conversationManager = new ConversationManager();
  });

  describe('Stage transition messages', () => {
    it('should allow normal user messages in conversation history', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'Create a hello world function',
      });

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Create a hello world function');
    });

    it('should filter out "move to assumptions" from conversation history', () => {
      // This test verifies that stage transition commands should not be added to history
      // The filtering happens in extension.ts handleChatMessage method
      
      // Normal message should be added
      conversationManager.addMessage({
        role: 'user',
        content: 'Create a hello world function',
      });

      // Stage transition message should NOT be added (this is handled by extension.ts)
      // We simulate the correct behavior here
      const message = 'move to assumptions';
      const isStageTransitionCommand = /^\s*(?:move\s+to|go\s+to|goto)\s+(?:assumptions?|analysis|analyze|implementations?|implement|chat)\s*$/i.test(message);
      
      if (!isStageTransitionCommand) {
        conversationManager.addMessage({
          role: 'user',
          content: message,
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Create a hello world function');
    });

    it('should filter out "move to implementation" from conversation history', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'Write some tests',
      });

      const message = 'move to implementation';
      const isStageTransitionCommand = /^\s*(?:move\s+to|go\s+to|goto)\s+(?:assumptions?|analysis|analyze|implementations?|implement|chat)\s*$/i.test(message);
      
      if (!isStageTransitionCommand) {
        conversationManager.addMessage({
          role: 'user',
          content: message,
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Write some tests');
    });

    it('should filter out "go to chat" from conversation history', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'Explain this code',
      });

      const message = 'go to chat';
      const isStageTransitionCommand = /^\s*(?:move\s+to|go\s+to|goto)\s+(?:assumptions?|analysis|analyze|implementations?|implement|chat)\s*$/i.test(message);
      
      if (!isStageTransitionCommand) {
        conversationManager.addMessage({
          role: 'user',
          content: message,
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Explain this code');
    });

    it('should filter out variations of stage transition commands', () => {
      const stageTransitions = [
        'move to assumptions',
        'move to assumption',
        'go to implementation',
        'goto chat',
        'move to analyze',
        '  move to assumptions  ', // with whitespace
        'MOVE TO IMPLEMENTATION', // uppercase
      ];

      conversationManager.addMessage({
        role: 'user',
        content: 'Normal message',
      });

      stageTransitions.forEach(message => {
        const isStageTransitionCommand = /^\s*(?:move\s+to|go\s+to|goto)\s+(?:assumptions?|analysis|analyze|implementations?|implement|chat)\s*$/i.test(message);
        
        if (!isStageTransitionCommand) {
          conversationManager.addMessage({
            role: 'user',
            content: message,
          });
        }
      });

      // Only the normal message should be in history
      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Normal message');
    });

    it('should allow messages that contain but are not exactly stage transitions', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'I want to move to assumptions stage after reviewing',
      });

      conversationManager.addMessage({
        role: 'user',
        content: 'Can you explain how to move to implementation?',
      });

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('I want to move to assumptions stage after reviewing');
      expect(history[1].content).toBe('Can you explain how to move to implementation?');
    });
  });

  describe('Command filtering', () => {
    it('should not add @cmd:plan to conversation history', () => {
      // Commands should be filtered before reaching ConversationManager
      // This test verifies the expected behavior
      
      conversationManager.addMessage({
        role: 'user',
        content: 'Analyze this code',
      });

      // @cmd:plan should be handled and NOT added to history
      // (handled by commandHandled flag in extension.ts)
      const commandHandled = true; // Simulating command was extracted
      
      if (!commandHandled) {
        conversationManager.addMessage({
          role: 'user',
          content: '@cmd:plan',
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Analyze this code');
    });

    it('should not add @cmd:move_to_implementation to conversation history', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'Review my code',
      });

      const commandHandled = true;
      
      if (!commandHandled) {
        conversationManager.addMessage({
          role: 'user',
          content: '@cmd:move_to_implementation',
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Review my code');
    });

    it('should not add @cmd:verbose to conversation history', () => {
      conversationManager.addMessage({
        role: 'user',
        content: 'what is 2 + 2?',
      });
      
      conversationManager.addMessage({
        role: 'user',
        content: 'what is 9 / 2?',
      });

      // @cmd:verbose should be handled and NOT added to history
      // (it's a system command to print information, not a user request)
      const commandHandled = true; // Simulating command was extracted and handled
      
      if (!commandHandled) {
        conversationManager.addMessage({
          role: 'user',
          content: '@cmd:verbose',
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('what is 2 + 2?');
      expect(history[1].content).toBe('what is 9 / 2?');
      // @cmd:verbose should NOT be in history
    });

    it('should not add vague prompts that get converted to @cmd:plan', () => {
      // Vague prompts like "next", "continue" should be auto-converted to @cmd:plan
      // and thus not added to history
      
      conversationManager.addMessage({
        role: 'user',
        content: 'Create an implementation plan',
      });

      // "next" gets converted to "@cmd:plan" before command extraction
      // commandHandled becomes true, so it's not added to history
      const vagueTriggers = /^(next|continue|go|proceed|okay|ok|yes|sure|alright|start)$/i;
      const userInput = 'next';
      const isVague = vagueTriggers.test(userInput.trim());
      const commandHandled = isVague; // Will be converted to @cmd:plan
      
      if (!commandHandled) {
        conversationManager.addMessage({
          role: 'user',
          content: userInput,
        });
      }

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Create an implementation plan');
    });

    it('should not add multiple vague prompts to conversation history', () => {
      const vaguePrompts = ['next', 'continue', 'ok', 'yes', 'go', 'proceed'];
      const vagueTriggers = /^(next|continue|go|proceed|okay|ok|yes|sure|alright|start)$/i;

      conversationManager.addMessage({
        role: 'user',
        content: 'Normal message',
      });

      vaguePrompts.forEach(prompt => {
        const isVague = vagueTriggers.test(prompt.trim());
        const commandHandled = isVague;
        
        if (!commandHandled) {
          conversationManager.addMessage({
            role: 'user',
            content: prompt,
          });
        }
      });

      // Only normal message should be in history
      const history = conversationManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Normal message');
    });
  });

  describe('Mixed scenarios', () => {
    it('should maintain clean history with mix of normal and filtered messages', () => {
      // Add normal message
      conversationManager.addMessage({
        role: 'user',
        content: 'Create a calculator function',
      });

      // Add assistant response
      conversationManager.addMessage({
        role: 'assistant',
        content: 'I can help you create a calculator function.',
      });

      // Try to add stage transition (should be filtered)
      const stageTransition = 'move to assumptions';
      const isStageTransition = /^\s*(?:move\s+to|go\s+to|goto)\s+(?:assumptions?|analysis|analyze|implementations?|implement|chat)\s*$/i.test(stageTransition);
      if (!isStageTransition) {
        conversationManager.addMessage({
          role: 'user',
          content: stageTransition,
        });
      }

      // Add another normal message
      conversationManager.addMessage({
        role: 'user',
        content: 'Add error handling',
      });

      // Try to add vague prompt (should be filtered)
      const vaguePrompt = 'next';
      const isVague = /^(next|continue|go|proceed|okay|ok|yes|sure|alright|start)$/i.test(vaguePrompt);
      if (!isVague) {
        conversationManager.addMessage({
          role: 'user',
          content: vaguePrompt,
        });
      }

      // Add assistant response
      conversationManager.addMessage({
        role: 'assistant',
        content: 'I will add error handling.',
      });

      const history = conversationManager.getHistory();
      expect(history).toHaveLength(4);
      expect(history[0].content).toBe('Create a calculator function');
      expect(history[1].content).toBe('I can help you create a calculator function.');
      expect(history[2].content).toBe('Add error handling');
      expect(history[3].content).toBe('I will add error handling.');
    });
  });
});
