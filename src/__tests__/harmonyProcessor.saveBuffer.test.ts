import { HarmonyProcessor } from "../harmonyProcessor";

describe("HarmonyProcessor - SaveBuffer Bug Investigation", () => {
  it("should save all XML tool calls from a single buffer", () => {
    const processor = new HarmonyProcessor(true);

    // Simulate a response with multiple consecutive tool calls in one buffer
    const response = `<|start|>assistant
<|channel|>final
<|message|><tool_call name="create_file" args='{"file_path":"step_1_log.txt","content":"Status: completed"}' />
<tool_call name="create_file" args='{"file_path":"filter.awk","content":"#!/usr/bin/env gawk"}' />
{"name":"find_files","arguments":{"name_pattern":"filter.awk"}}
<|end|>`;

    const result = processor.parseResponse(response);

    console.log(`\n========== SAVEBUFFER BUG TEST ==========`);
    console.log(
      `Response parsed, rawToolCalls: ${result.rawToolCalls?.length ?? 0}`
    );
    result.rawToolCalls?.forEach((raw, idx) => {
      console.log(`  [${idx}] ${raw.substring(0, 80)}...`);
    });
    console.log(`========== SAVEBUFFER BUG TEST END ==========\n`);

    // BUG: If saveBuffer doesn't push all 3 tool calls, this will fail
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(3);
    expect(result.rawToolCalls![0]).toContain("step_1_log.txt");
    expect(result.rawToolCalls![1]).toContain("filter.awk");
    expect(result.rawToolCalls![2]).toContain("find_files");
  });

  it("should handle multiple XML tool calls extracted via XmlProcessor", () => {
    const processor = new HarmonyProcessor(true);

    // This mimics what happens when XmlProcessor extracts multiple tool calls from one buffer
    const response = `<|start|>assistant
<|channel|>final
<|message|><tool_call name="create_file" args='{"file_path":"file1.txt","content":"content1"}' /><tool_call name="create_file" args='{"file_path":"file2.txt","content":"content2"}' /><tool_call name="create_file" args='{"file_path":"file3.txt","content":"content3"}' />
<|end|>`;

    const result = processor.parseResponse(response);

    console.log(`\nParsed ${result.rawToolCalls?.length ?? 0} raw tool calls`);

    // All 3 should be in rawToolCalls
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(3);
    expect(result.rawToolCalls![0]).toContain("file1.txt");
    expect(result.rawToolCalls![1]).toContain("file2.txt");
    expect(result.rawToolCalls![2]).toContain("file3.txt");
  });

  it("should handle mixed XML and JSON tool calls in one buffer", () => {
    const processor = new HarmonyProcessor(true);

    const response = `<|start|>assistant
<|channel|>final
<|message|><tool_call name="create_file" args='{"file_path":"test.txt","content":"hello"}' />
{"name":"read_file","arguments":{"file_path":"test.txt"}}
<tool_call name="edit_file" args='{"file_path":"test.txt","old_text":"hello","new_text":"world"}' />
<|end|>`;

    const result = processor.parseResponse(response);

    console.log(
      `\nMixed format: ${result.rawToolCalls?.length ?? 0} tool calls`
    );

    // Should extract all 3 (2 XML + 1 JSON)
    expect(result.rawToolCalls).toBeDefined();
    expect(result.rawToolCalls!.length).toBe(3);
  });
});
