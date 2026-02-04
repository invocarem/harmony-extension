// commandExtractor.ts
/**
 * Command Extractor
 * Extracts @cmd: commands from user messages (similar to @file: syntax)
 * Commands are system-level directives that should not be sent to LLMs
 */

export interface ExtractedCommand {
  command: string;          // e.g., "move_to_implementation" (lowercase, normalized)
  originalText: string;     // e.g., "@cmd:move_to_implementation"
  position: number;         // Position in original message
  hasTextBefore: boolean;   // True if there is non-whitespace text before the command
}

export class CommandExtractor {
  /**
   * Extract @cmd: commands from a message
   * Pattern: @cmd:command_name (case-insensitive, supports spaces after colon)
   * 
   * Returns the extracted command (first one if multiple) and the cleaned message (with @cmd: removed)
   */
  static extractCommand(message: string): {
    command: ExtractedCommand | null;
    cleanMessage: string;
  } {
    // Pattern: @cmd:command_name
    // Supports: @cmd:command, @cmd: command (with space), @CMD:COMMAND (case-insensitive)
    // Uses [\w-]+ to match word characters (letters, digits, underscores) and hyphens
    const commandPattern = /@cmd:\s*([\w-]+)/gi;
    const matches = Array.from(message.matchAll(commandPattern));
    
    if (matches.length === 0) {
      return { command: null, cleanMessage: message };
    }
    
    // Take first command if multiple found (log warning if multiple)
    if (matches.length > 1) {
      console.warn(`[CommandExtractor] Multiple @cmd: commands found, using first: ${matches[0][1]}`);
    }
    
    const firstMatch = matches[0];
    const fullMatch = firstMatch[0];  // e.g., "@cmd:move_to_implementation"
    let commandName = firstMatch[1].toLowerCase().trim();  // e.g., "move_to_implementation"
    if (/^next[_-]?step$/.test(commandName)) {
      commandName = "step";
    }
    const position = firstMatch.index || 0;
    
    // Check if there's non-whitespace text before the command
    const textBeforeCommand = message.substring(0, position).trim();
    const hasTextBefore = textBeforeCommand.length > 0;
    
    // Remove command from message (only the first occurrence)
    const cleanMessage = message.replace(fullMatch, '').trim();
    
    return {
      command: {
        command: commandName,
        originalText: fullMatch,
        position: position,
        hasTextBefore: hasTextBefore
      },
      cleanMessage: cleanMessage
    };
  }
}

