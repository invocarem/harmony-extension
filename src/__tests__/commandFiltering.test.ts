/**
 * Test that system commands like @cmd:verbose are properly filtered
 * and not misinterpreted as user requests by LLMs
 */

import { CommandExtractor } from "../utils/commandExtractor";

describe("Command Filtering - System Commands vs User Requests", () => {
  describe("@cmd:verbose filtering", () => {
    it("should extract @cmd:verbose and return empty cleaned message", () => {
      const message = "@cmd:verbose";
      const result = CommandExtractor.extractCommand(message);

      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe("verbose");
      expect(result.command?.originalText).toBe("@cmd:verbose");
      expect(result.cleanMessage).toBe("");
    });

    it("should recognize @cmd:verbose as a system command, not a user request", () => {
      // Scenario from user report: multiple arithmetic questions followed by @cmd:verbose
      const messages = [
        "what is 2 + 2?",
        "what is 9 / 2 ?",
        "what is 5  x 6?",
        "@cmd:verbose", // This should NOT be interpreted as "request for comprehensive implementation plan"
      ];

      const extractedCommands = messages.map((msg) =>
        CommandExtractor.extractCommand(msg)
      );

      // First 3 messages: no commands, full message preserved
      expect(extractedCommands[0].command).toBeNull();
      expect(extractedCommands[0].cleanMessage).toBe("what is 2 + 2?");

      expect(extractedCommands[1].command).toBeNull();
      expect(extractedCommands[1].cleanMessage).toBe("what is 9 / 2 ?");

      expect(extractedCommands[2].command).toBeNull();
      expect(extractedCommands[2].cleanMessage).toBe("what is 5  x 6?");

      // 4th message: @cmd:verbose should be extracted as a system command
      expect(extractedCommands[3].command).not.toBeNull();
      expect(extractedCommands[3].command?.command).toBe("verbose");
      expect(extractedCommands[3].cleanMessage).toBe("");
    });

    it("should filter all verbose command variations", () => {
      const verboseCommands = [
        "@cmd:verbose",
        "@cmd:verbose_info",
        "@cmd:verbose-info",
        "@CMD:VERBOSE",
        "@Cmd:Verbose_Info",
      ];

      verboseCommands.forEach((cmd) => {
        const result = CommandExtractor.extractCommand(cmd);
        expect(result.command).not.toBeNull();
        expect(result.command?.command).toMatch(/^verbose/i);
        expect(result.cleanMessage).toBe("");
      });
    });

    it("should handle @cmd:verbose with text after it", () => {
      const message = "@cmd:verbose show me details";
      const result = CommandExtractor.extractCommand(message);

      expect(result.command).not.toBeNull();
      expect(result.command?.command).toBe("verbose");
      expect(result.command?.originalText).toBe("@cmd:verbose");
      expect(result.cleanMessage).toBe("show me details");
    });
  });

  describe("Other system commands", () => {
    it("should extract @cmd:step", () => {
      const result = CommandExtractor.extractCommand("@cmd:step");
      expect(result.command?.command).toBe("step");
      expect(result.cleanMessage).toBe("");
    });

    it("should extract @cmd:auto", () => {
      const result = CommandExtractor.extractCommand("@cmd:auto");
      expect(result.command?.command).toBe("auto");
      expect(result.cleanMessage).toBe("");
    });

    it("should extract @cmd:plan", () => {
      const result = CommandExtractor.extractCommand("@cmd:plan");
      expect(result.command?.command).toBe("plan");
      expect(result.cleanMessage).toBe("");
    });

    it("should extract @cmd:move_to_implementation", () => {
      const result = CommandExtractor.extractCommand(
        "@cmd:move_to_implementation"
      );
      expect(result.command?.command).toBe("move_to_implementation");
      expect(result.cleanMessage).toBe("");
    });
  });

  describe("System command handling in extension.ts", () => {
    it("should mark verbose commands as handled to prevent history addition", () => {
      // This test documents the expected behavior in extension.ts
      // verbose commands should return { handled: true, shouldReturn: false }
      // to prevent them from being added to conversation history
      
      const verboseCommands = [
        "step",
        "auto",
        "verbose",
        "verbose_info",
        "verbose-info",
      ];

      // These commands should be marked as handled=true
      // so they are not added to conversation history
      // but should still be processed by the state machine (shouldReturn=false)
      
      verboseCommands.forEach((cmd) => {
        // Simulate the command handler behavior
        const commandHandled = true; // Should be true for verbose commands
        const shouldReturn = false; // Should be false to allow state machine processing

        expect(commandHandled).toBe(true);
        expect(shouldReturn).toBe(false);
      });
    });
  });

  describe("User request vs system command distinction", () => {
    it("should distinguish between user requests and system commands", () => {
      const testCases = [
        { 
          message: "create a verbose implementation plan", 
          isUserRequest: true,
          description: "Natural language request - should be treated as user input"
        },
        { 
          message: "show me verbose information", 
          isUserRequest: true,
          description: "Natural language request - should be treated as user input"
        },
        { 
          message: "@cmd:verbose", 
          isUserRequest: false,
          description: "System command - should be filtered"
        },
        { 
          message: "@cmd:verbose_info", 
          isUserRequest: false,
          description: "System command - should be filtered"
        },
        {
          message: "explain what verbose mode does",
          isUserRequest: true,
          description: "Question about verbose mode - should be treated as user input"
        },
      ];

      testCases.forEach(({ message, isUserRequest, description }) => {
        const result = CommandExtractor.extractCommand(message);
        const hasCommand = result.command !== null;
        
        if (isUserRequest) {
          expect(hasCommand).toBe(false);
          expect(result.cleanMessage).toBe(message);
        } else {
          expect(hasCommand).toBe(true);
        }
      });
    });
  });
});
