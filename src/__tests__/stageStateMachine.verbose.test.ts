/**
 * Test: verbose_info trigger detection and handling
 * Bug: @cmd:verbose is being stripped before reaching detectTrigger,
 * causing it to default to "prompt" (chat) or "plan" (assumptions)
 */

import { StageStateMachine } from "../harmony/stageStateMachine";
import { ChatManager } from "../harmony/chatManager";
import { AssumptionsManager } from "../harmony/assumptionsManager";
import { ProgressPlanManager } from "../progressPlanManager";

describe("StageStateMachine verbose_info trigger", () => {
  let stageStateMachine: StageStateMachine;
  let chatManager: ChatManager;
  let assumptionsManager: AssumptionsManager;
  let progressPlanManager: ProgressPlanManager;

  beforeEach(() => {
    stageStateMachine = new StageStateMachine();
    chatManager = new ChatManager();
    progressPlanManager = new ProgressPlanManager();
    assumptionsManager = new AssumptionsManager(progressPlanManager);
  });

  describe("@cmd:verbose detection", () => {
    it("should detect @cmd:verbose as verbose_info trigger at chat stage", () => {
      // This is the prompt that SHOULD reach detectTrigger
      // But currently the @cmd:verbose is stripped in extension.ts before it reaches here
      const prompt = "@cmd:verbose";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should detect @cmd:verbose as verbose_info trigger at assumptions stage", () => {
      const prompt = "@cmd:verbose";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "assumptions",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should detect @cmd:verbose_info as verbose_info trigger", () => {
      const prompt = "@cmd:verbose_info";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should detect @cmd:verbose-info (hyphen variant) as verbose_info trigger", () => {
      const prompt = "@cmd:verbose-info";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should NOT detect empty string as verbose_info (should default to prompt at chat)", () => {
      // This is what currently happens - the @cmd:verbose is removed before reaching detectTrigger
      const prompt = "";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      // Bug: This returns "prompt" instead of "verbose_info"
      expect(trigger).toBe("prompt");
    });

    it("should NOT detect empty string as verbose_info (should default to plan at assumptions)", () => {
      // This is what currently happens - the @cmd:verbose is removed before reaching detectTrigger
      const prompt = "";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "assumptions",
        undefined
      );

      // Bug: This returns "plan" instead of "verbose_info"
      expect(trigger).toBe("plan");
    });
  });

  describe("verbose_info trigger handling", () => {
    it("should have transition rule for verbose_info in chat stage", async () => {
      const prompt = "@cmd:verbose";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");

      // Try to determine next stage - should stay in chat
      const nextStage = await stageStateMachine.determineNextStage(
        "chat",
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        chatManager
      );

      expect(nextStage).toBe("chat");
    });

    it("should have transition rule for verbose_info in assumptions stage", async () => {
      const prompt = "@cmd:verbose";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "assumptions",
        undefined
      );

      expect(trigger).toBe("verbose_info");

      // Try to determine next stage - should stay in assumptions
      const nextStage = await stageStateMachine.determineNextStage(
        "assumptions",
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        assumptionsManager
      );

      expect(nextStage).toBe("assumptions");
    });

    it("should have transition rule for verbose_info in implementation stage", async () => {
      const prompt = "@cmd:verbose";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "implementation",
        undefined
      );

      expect(trigger).toBe("verbose_info");

      // Try to determine next stage - should stay in implementation
      const nextStage = await stageStateMachine.determineNextStage(
        "implementation",
        prompt
      );

      expect(nextStage).toBe("implementation");
    });
  });

  describe("Bug scenario: verbose stripped before state machine", () => {
    it("should demonstrate the bug: empty prompt after @cmd:verbose is stripped defaults to prompt at chat", () => {
      // This is what happens in extension.ts:
      // 1. @cmd:verbose is extracted
      // 2. Command is handled with handled=true, shouldReturn=false
      // 3. text = messageAfterCommand (empty string)
      // 4. Then state machine.detectTrigger(text, "chat") is called
      // Result: prompt instead of verbose_info

      const strippedPrompt = ""; // This is what remains after @cmd:verbose is removed
      const trigger = stageStateMachine.detectTrigger(
        strippedPrompt,
        "chat",
        undefined
      );

      // BUG: returns "prompt" instead of "verbose_info"
      expect(trigger).not.toBe("verbose_info");
      expect(trigger).toBe("prompt");
    });

    it("should demonstrate the bug: empty prompt after @cmd:verbose is stripped defaults to plan at assumptions", () => {
      // Same issue but at assumptions stage

      const strippedPrompt = ""; // This is what remains after @cmd:verbose is removed
      const trigger = stageStateMachine.detectTrigger(
        strippedPrompt,
        "assumptions",
        undefined
      );

      // BUG: returns "plan" instead of "verbose_info"
      expect(trigger).not.toBe("verbose_info");
      expect(trigger).toBe("plan");
    });
  });

  describe("verbose trigger variations", () => {
    it("should detect 'verbose info' (natural language) as verbose_info", () => {
      const prompt = "verbose info";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should detect 'show info' (natural language) as verbose_info", () => {
      const prompt = "show info";
      const trigger = stageStateMachine.detectTrigger(
        prompt,
        "chat",
        undefined
      );

      expect(trigger).toBe("verbose_info");
    });

    it("should be case-insensitive for @cmd:verbose", () => {
      const prompts = ["@CMD:VERBOSE", "@Cmd:Verbose", "@cmd:VERBOSE"];

      prompts.forEach((prompt) => {
        const trigger = stageStateMachine.detectTrigger(
          prompt,
          "chat",
          undefined
        );
        expect(trigger).toBe("verbose_info");
      });
    });
  });
});
