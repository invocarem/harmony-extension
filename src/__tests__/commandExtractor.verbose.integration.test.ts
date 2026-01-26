/**
 * Test: Integration test showing the bug where @cmd:verbose is stripped
 * before reaching the state machine
 * 
 * This tests the flow through extension.ts handleCommand -> state machine
 */

import { CommandExtractor } from "../utils/commandExtractor";
import { StageStateMachine } from "../harmony/stageStateMachine";

describe("@cmd:verbose command handling flow (Integration)", () => {
  let stageStateMachine: StageStateMachine;

  beforeEach(() => {
    stageStateMachine = new StageStateMachine();
  });

  describe("Bug: verbose command stripped before state machine", () => {
    it("should show the bug: @cmd:verbose is extracted and removed, leaving empty prompt", () => {
      const userInput = "@cmd:verbose";

      // Step 1: CommandExtractor extracts the command
      const { command, cleanMessage } = CommandExtractor.extractCommand(
        userInput
      );

      // Command should be extracted correctly
      expect(command).not.toBeNull();
      expect(command?.command).toBe("verbose");

      // Clean message is empty (the @cmd:verbose was removed)
      expect(cleanMessage).toBe("");

      // Step 2: In extension.ts handleCommand, this would return:
      // { handled: true, shouldReturn: false }
      // And text would be set to cleanMessage (empty string)

      // Step 3: State machine receives the empty string, not @cmd:verbose
      const trigger = stageStateMachine.detectTrigger(
        cleanMessage, // This is empty!
        "chat",
        undefined
      );

      // BUG: Should detect verbose_info, but instead detects prompt
      // because the @cmd:verbose has been removed
      console.log(`Trigger detected from empty message: ${trigger}`);
      expect(trigger).not.toBe("verbose_info");
      expect(trigger).toBe("prompt"); // This is the bug!
    });

    it("should show the bug at assumptions stage: cleaned message defaults to plan instead of verbose_info", () => {
      const userInput = "@cmd:verbose";

      // Step 1: CommandExtractor extracts the command
      const { command, cleanMessage } = CommandExtractor.extractCommand(
        userInput
      );

      expect(command?.command).toBe("verbose");
      expect(cleanMessage).toBe("");

      // Step 2: State machine receives empty string at assumptions stage
      const trigger = stageStateMachine.detectTrigger(
        cleanMessage, // Empty string
        "assumptions",
        undefined
      );

      // BUG: Should detect verbose_info, but instead detects plan
      // because the @cmd:verbose has been removed
      console.log(
        `Trigger detected at assumptions from empty message: ${trigger}`
      );
      expect(trigger).not.toBe("verbose_info");
      expect(trigger).toBe("plan"); // This is the bug!
    });

    it("should show the bug: @cmd:verbose with trailing text also loses the command", () => {
      const userInput = "@cmd:verbose show me details";

      // Step 1: CommandExtractor extracts the command
      const { command, cleanMessage } = CommandExtractor.extractCommand(
        userInput
      );

      expect(command?.command).toBe("verbose");
      // Only "show me details" remains (the @cmd:verbose is removed)
      expect(cleanMessage).toBe("show me details");

      // Step 2: State machine receives "show me details", not @cmd:verbose
      const trigger = stageStateMachine.detectTrigger(
        cleanMessage,
        "chat",
        undefined
      );

      // BUG: The "show me details" doesn't match the verbose_info pattern
      // because @cmd:verbose was already removed
      console.log(`Trigger from "show me details": ${trigger}`);
      expect(trigger).not.toBe("verbose_info");
      expect(trigger).toBe("prompt"); // This is the bug!
    });
  });

  describe("Expected behavior: preserving @cmd:verbose for state machine", () => {
    it("should NOT strip @cmd:verbose when passing to state machine", () => {
      // The fix would be to NOT remove @cmd:verbose before passing to detectTrigger
      // Instead, handle it AFTER detectTrigger processes it
      const userInput = "@cmd:verbose";

      // If we pass the ORIGINAL input (not cleanMessage) to detectTrigger:
      const trigger = stageStateMachine.detectTrigger(
        userInput, // Keep the @cmd:verbose
        "chat",
        undefined
      );

      // This works correctly
      expect(trigger).toBe("verbose_info");
    });

    it("should detect verbose_info correctly at assumptions if input is preserved", () => {
      const userInput = "@cmd:verbose";

      // If we pass the ORIGINAL input to detectTrigger:
      const trigger = stageStateMachine.detectTrigger(
        userInput, // Keep the @cmd:verbose
        "assumptions",
        undefined
      );

      // This works correctly
      expect(trigger).toBe("verbose_info");
    });
  });

  describe("Command detection patterns", () => {
    it("should extract @cmd:verbose pattern", () => {
      const { command } = CommandExtractor.extractCommand("@cmd:verbose");
      expect(command).not.toBeNull();
      expect(command?.command).toBe("verbose");
    });

    it("should extract @cmd:verbose_info pattern", () => {
      const { command } = CommandExtractor.extractCommand("@cmd:verbose_info");
      expect(command).not.toBeNull();
      // [\w-]+ captures "verbose_info" (underscore is included in \w)
      expect(command?.command).toBe("verbose_info");
    });

    it("should extract @cmd:verbose-info (hyphen variant)", () => {
      const { command } = CommandExtractor.extractCommand("@cmd:verbose-info");
      expect(command).not.toBeNull();
      // [\w-]+ captures "verbose-info" (hyphen is explicitly included)
      expect(command?.command).toBe("verbose-info");
    });

    it("should handle verbose in handleCommand but should preserve for state machine", () => {
      // In extension.ts, when handleCommand receives "verbose", it returns:
      // { handled: true, shouldReturn: false }
      // 
      // The issue is that the command has already been STRIPPED by CommandExtractor
      // before handleCommand is even called
      //
      // FLOW:
      // 1. User types: "@cmd:verbose"
      // 2. CommandExtractor.extractCommand("@cmd:verbose") returns:
      //    { command: "verbose", cleanMessage: "" }
      // 3. handleCommand("verbose", "") is called
      // 4. Returns { handled: true, shouldReturn: false }
      // 5. text = "" (cleanMessage)
      // 6. stageStateMachine.detectTrigger("", "chat") is called
      // 7. Detects "prompt" instead of "verbose_info"
      //
      // FIX: Pass the ORIGINAL prompt to detectTrigger, not the cleanMessage

      const original = "@cmd:verbose";
      const { command, cleanMessage } = CommandExtractor.extractCommand(original);

      expect(command?.command).toBe("verbose");

      // BUG: Using cleanMessage loses the @cmd:verbose
      const buggyTrigger = stageStateMachine.detectTrigger(
        cleanMessage,
        "chat",
        undefined
      );
      expect(buggyTrigger).toBe("prompt");

      // FIX: Use original instead
      const fixedTrigger = stageStateMachine.detectTrigger(
        original,
        "chat",
        undefined
      );
      expect(fixedTrigger).toBe("verbose_info");
    });
  });
});
