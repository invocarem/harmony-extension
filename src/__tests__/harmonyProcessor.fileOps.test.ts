// Test for file operations extraction preserving content

import { HarmonyProcessor } from "../harmonyProcessor";

describe("HarmonyProcessor - File Operations Extraction", () => {
  let processor: HarmonyProcessor;

  beforeEach(() => {
    processor = new HarmonyProcessor(true); // harmonyMode enabled
  });

  test("should preserve content when read_file operations are only described", () => {
    // Simulate AI response that describes task and mentions files
    const response = `<|start|>assistant<|message|><|channel|>final<|message|>I understand that you need a gawk script for CRC16 calculation. Let me read the files crc16.md and test_input.txt to understand the requirements better.<|end|>`;

    const result = processor.parseResponse(response);

    // Auto-extraction of read_file is disabled; no tool calls should be produced
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(0);

    // Should preserve the AI's explanation as content
    expect(result.content).toBeDefined();
    expect(result.content!.length).toBeGreaterThan(0);
    expect(result.content).toContain("gawk script");
    expect(result.content).toContain("CRC16");
  });

  test("should preserve final content when read_file operations are only described", () => {
    // Test with final channel content that mentions files
    // Use text that matches the extraction patterns
    const response = `<|start|>assistant<|message|><|channel|>final<|message|>I'll help you with that. First, let me read the file setup.py to understand the current setup.<|end|>`;

    const result = processor.parseResponse(response);

    // Auto-extraction of read_file is disabled; no tool calls should be produced
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(0);

    // Should preserve content or final
    const displayText = result.final || result.content;
    expect(displayText).toBeDefined();
    expect(displayText!.length).toBeGreaterThan(0);
    expect(displayText).toContain("help you with that");
    expect(displayText).toContain("read the file");
  });

  test("should handle multiple file references while preserving content", () => {
    const response = `<|start|>assistant<|message|><|channel|>final<|message|>To complete this task, I need to review both src/main.ts and tests/main.test.ts files to understand the current implementation.<|end|>`;

    const result = processor.parseResponse(response);

    // Auto-extraction of read_file is disabled; no tool calls should be produced
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(0);

    // Should preserve content
    const displayText = result.final || result.content;
    expect(displayText).toBeDefined();
    expect(displayText!.length).toBeGreaterThan(0);
    expect(displayText).toContain("complete this task");
    expect(displayText).toContain("review");
  });

  test("should preserve content with read operations in plain text (no Harmony tokens)", () => {
    // Without Harmony tokens, but mentions file to read
    const response =
      "I understand you need help with the CRC calculation. Let me check the test_input.txt file to see the input format.";

    const result = processor.parseResponse(response);

    // In plain text mode (no harmony tokens), it might not extract automatically
    // but if it does, content should still be preserved
    expect(result.content || result.final).toBeDefined();
    const displayText = (result.content || result.final)!;
    expect(displayText.length).toBeGreaterThan(0);
    expect(displayText).toContain("CRC calculation");
  });
});
