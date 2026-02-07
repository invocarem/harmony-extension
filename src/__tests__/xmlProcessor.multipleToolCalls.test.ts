import { XmlProcessor } from "../utils/xmlProcessor";

describe("XmlProcessor - Multiple Tool Calls Bug", () => {
  it("should extract all 3 tool calls (2 XML + 1 JSON in sequence)", () => {
    // This reproduces the bug from the logs where filter.awk wasn't created
    const text = `<tool_call name="create_file" args='{"file_path":"step_1_log.txt","content":"Status: __completed__"}' />
<tool_call name="create_file" args='{"file_path":"filter.awk","content":"#!/usr/bin/env gawk -f\\n\\n# filter.awk"}' />
{"name":"find_files","arguments":{"name_pattern":"filter.awk"}}`;

    const results = XmlProcessor.extractToolCalls(text);

    // Should find 2 XML tool calls (the JSON one won't be extracted by XmlProcessor)
    expect(results.length).toBe(2);
    expect(results[0].name).toBe("create_file");
    expect(results[0].args.file_path).toBe("step_1_log.txt");
    expect(results[1].name).toBe("create_file");
    expect(results[1].args.file_path).toBe("filter.awk");
  });

  it("should extract two consecutive XML tool calls with complex JSON args", () => {
    const text = `<tool_call name="create_file" args='{"file_path":"file1.txt","content":"Line 1\\nLine 2\\nLine 3"}' />
<tool_call name="create_file" args='{"file_path":"file2.js","content":"console.log(\\"hello\\");"}' />`;

    const results = XmlProcessor.extractToolCalls(text);

    expect(results.length).toBe(2);
    expect(results[0].name).toBe("create_file");
    expect(results[0].args.file_path).toBe("file1.txt");
    expect(results[0].args.content).toContain("Line 1");

    expect(results[1].name).toBe("create_file");
    expect(results[1].args.file_path).toBe("file2.js");
    expect(results[1].args.content).toContain("console.log");
  });

  it("should extract three consecutive XML tool calls", () => {
    const text = `<tool_call name="read_file" args='{"file_path":"test.txt"}' />
<tool_call name="edit_file" args='{"file_path":"test.txt","old_text":"hello","new_text":"world"}' />
<tool_call name="create_file" args='{"file_path":"new.txt","content":"new content"}' />`;

    const results = XmlProcessor.extractToolCalls(text);

    expect(results.length).toBe(3);
    expect(results[0].name).toBe("read_file");
    expect(results[1].name).toBe("edit_file");
    expect(results[2].name).toBe("create_file");
  });

  it("should handle tool calls with newlines between them", () => {
    const text = `<tool_call name="create_file" args='{"file_path":"file1.txt","content":"content1"}' />

<tool_call name="create_file" args='{"file_path":"file2.txt","content":"content2"}' />

<tool_call name="create_file" args='{"file_path":"file3.txt","content":"content3"}' />`;

    const results = XmlProcessor.extractToolCalls(text);

    expect(results.length).toBe(3);
    expect(results[0].args.file_path).toBe("file1.txt");
    expect(results[1].args.file_path).toBe("file2.txt");
    expect(results[2].args.file_path).toBe("file3.txt");
  });

  it("should extract tool calls from the actual failing scenario", () => {
    // Simplified version without complex escape sequences
    const rawToolCall1 =
      '<tool_call name="create_file" args=\'{"file_path":"step_1_log.txt","content":"Status: completed"}\' />';
    const rawToolCall2 =
      '<tool_call name="create_file" args=\'{"file_path":"filter.awk","content":"#!/usr/bin/env gawk -f\\n\\n# filter.awk"}\' />';

    // Extract from first tool call
    const results1 = XmlProcessor.extractToolCalls(rawToolCall1);
    expect(results1.length).toBe(1);
    expect(results1[0].name).toBe("create_file");
    expect(results1[0].args.file_path).toBe("step_1_log.txt");

    // Extract from second tool call
    const results2 = XmlProcessor.extractToolCalls(rawToolCall2);
    expect(results2.length).toBe(1);
    expect(results2[0].name).toBe("create_file");
    expect(results2[0].args.file_path).toBe("filter.awk");

    // Extract from both combined - THIS IS THE KEY TEST THAT SHOWS THE BUG
    const resultsCombined = XmlProcessor.extractToolCalls(
      rawToolCall1 + "\n" + rawToolCall2
    );
    expect(resultsCombined.length).toBe(2);
    expect(resultsCombined[0].args.file_path).toBe("step_1_log.txt");
    expect(resultsCombined[1].args.file_path).toBe("filter.awk");
  });
});

describe("ToolCallExtractor - Multiple Tool Calls Integration", () => {
  it("should extract all tool calls from an array of raw strings - BUGFIX TEST", () => {
    const { ToolCallExtractor } = require("../utils/toolCallExtractor");

    // This is the EXACT scenario from the user's logs where filter.awk was lost
    // 3 raw tool calls in array → should extract all 3
    const rawToolCalls = [
      `<tool_call name="create_file" args='{"file_path":"step_1_log.txt","content":"Status: __completed__"}' />`,
      `<tool_call name="create_file" args='{"file_path":"filter.awk","content":"#!/usr/bin/env gawk"}' />`,
      `{"name":"find_files","arguments":{"name_pattern":"filter.awk"}}`,
    ];

    console.log(`\n========== BUGFIX TEST START ==========`);
    console.log(`Testing with ${rawToolCalls.length} raw tool calls`);
    console.log(`rawToolCalls[0]: ${rawToolCalls[0].substring(0, 80)}...`);
    console.log(`rawToolCalls[1]: ${rawToolCalls[1].substring(0, 80)}...`);
    console.log(`rawToolCalls[2]: ${rawToolCalls[2]}`);

    // Test the filtering logic that happens in responseProcessor.extractToolCalls
    console.log(`\nTesting filtering logic (this might be where the bug is):`);
    const validToolCalls = rawToolCalls.filter((raw) => {
      const looksLikeMcpOrJson = ToolCallExtractor.looksLikeToolCall(raw);
      const looksLikeXml = XmlProcessor.looksLikeXmlToolCall(raw);
      const looksLike = looksLikeMcpOrJson || looksLikeXml;
      console.log(
        `  Checking: looksLike=${looksLike} (MCP/JSON=${looksLikeMcpOrJson}, XML=${looksLikeXml}), preview="${raw.substring(0, 60)}..."`
      );
      return looksLike;
    });
    console.log(
      `After filtering: ${validToolCalls.length} valid tool call(s) out of ${rawToolCalls.length}`
    );

    // BUG: If filtering removes one, we'll see it here
    expect(validToolCalls.length).toBe(3);

    const results = ToolCallExtractor.extractToolCalls(validToolCalls);

    console.log(`\nExtracted ${results.length} tool calls:`);
    results.forEach((r: any, idx: number) => {
      console.log(
        `  [${idx}] ${r.name} - ${JSON.stringify(r.arguments).substring(0, 60)}...`
      );
    });
    console.log(`========== BUGFIX TEST END ==========\n`);

    // BUG: We expect 3 but the code returns 2 (filter.awk is lost)
    expect(results.length).toBe(3);
    expect(results[0].name).toBe("create_file");
    expect(results[0].arguments.file_path).toBe("step_1_log.txt");
    expect(results[1].name).toBe("create_file");
    expect(results[1].arguments.file_path).toBe("filter.awk");
    expect(results[2].name).toBe("find_files");
    expect(results[2].arguments.name_pattern).toBe("filter.awk");
  });

  it("should handle multiple XML tool calls in a single raw string", () => {
    const { ToolCallExtractor } = require("../utils/toolCallExtractor");

    const rawToolCalls = [
      `<tool_call name="create_file" args='{"file_path":"file1.txt","content":"content1"}' />
<tool_call name="create_file" args='{"file_path":"file2.txt","content":"content2"}' />
<tool_call name="create_file" args='{"file_path":"file3.txt","content":"content3"}' />`,
    ];

    const results = ToolCallExtractor.extractToolCalls(rawToolCalls);

    // Should extract all 3 from the single raw string
    expect(results.length).toBe(3);
    expect(results[0].arguments.file_path).toBe("file1.txt");
    expect(results[1].arguments.file_path).toBe("file2.txt");
    expect(results[2].arguments.file_path).toBe("file3.txt");
  });
});
