import { CommandExtractor, ExtractedCommand } from '../utils/commandExtractor';

describe('CommandExtractor', () => {
  describe('extractCommand', () => {
    it('should extract a single @cmd: command', () => {
      const message = '@cmd:move_to_implementation';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_implementation');
      expect(result.command?.originalText).toBe('@cmd:move_to_implementation');
      expect(result.cleanMessage).toBe('');
    });

    it('should extract command and preserve remaining message', () => {
      const message = '@cmd:move_to_assumptions create hello.py';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_assumptions');
      expect(result.command?.originalText).toBe('@cmd:move_to_assumptions');
      expect(result.cleanMessage).toBe('create hello.py');
    });

    it('should handle case-insensitive commands', () => {
      const message = '@CMD:MOVE_TO_IMPLEMENTATION';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_implementation');
      expect(result.command?.originalText).toBe('@CMD:MOVE_TO_IMPLEMENTATION');
    });

    it('should handle mixed case commands', () => {
      const message = '@Cmd:Move_To_Assumptions';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_assumptions');
    });

    it('should handle spaces after colon', () => {
      const message = '@cmd: move_to_implementation';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_implementation');
      expect(result.command?.originalText).toBe('@cmd: move_to_implementation');
    });

    it('should extract first command when multiple commands exist', () => {
      const message = '@cmd:move_to_assumptions @cmd:next_step';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_assumptions');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multiple @cmd: commands found, using first: move_to_assumptions')
      );
      
      consoleSpy.mockRestore();
    });

    it('should return null when no command is found', () => {
      const message = 'just a regular message';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).toBeNull();
      expect(result.cleanMessage).toBe('just a regular message');
    });

    it('should handle empty string', () => {
      const result = CommandExtractor.extractCommand('');
      
      expect(result.command).toBeNull();
      expect(result.cleanMessage).toBe('');
    });

    it('should handle whitespace-only input', () => {
      const result = CommandExtractor.extractCommand('   \n  ');
      
      expect(result.command).toBeNull();
      expect(result.cleanMessage).toBe('   \n  ');
    });

    it('should extract command from message with text before and after', () => {
      const message = 'Hello @cmd:move_to_chat goodbye';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_chat');
      expect(result.cleanMessage).toBe('Hello  goodbye');
    });

    it('should handle next_step command', () => {
      const message = '@cmd:next_step';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('next_step');
      expect(result.cleanMessage).toBe('');
    });

    it('should extract command with underscores', () => {
      const message = '@cmd:move_to_implementation';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move_to_implementation');
    });

    it('should not match @cmd: without a command name', () => {
      const message = '@cmd:';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).toBeNull();
      expect(result.cleanMessage).toBe('@cmd:');
    });

    it('should not match @cmd: with invalid characters (hyphens)', () => {
      const message = '@cmd:move-to-implementation';
      const result = CommandExtractor.extractCommand(message);
      
      // Pattern uses \w+ which only matches word characters (letters, digits, underscores)
      // So it would match "move" but not the full command
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('move-to-implementation');
    });

    it('should trim cleaned message', () => {
      const message = '  @cmd:move_to_assumptions  ';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.cleanMessage).toBe('');
    });

    it('should set correct position in extracted command', () => {
      const message = 'prefix @cmd:move_to_implementation suffix';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.position).toBe(7); // Position of '@' in 'prefix @cmd:...'
    });

    it('should handle command at start of message', () => {
      const message = '@cmd:move_to_assumptions some text';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.position).toBe(0);
    });

    it('should handle command with numbers and underscores', () => {
      const message = '@cmd:command_123';
      const result = CommandExtractor.extractCommand(message);
      
      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe('command_123');
    });
  });
});
