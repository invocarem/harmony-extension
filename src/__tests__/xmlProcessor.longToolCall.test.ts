import { XmlProcessor } from "../utils/xmlProcessor";

describe("XmlProcessor - Long Tool Call Bug", () => {
  it("should extract tool call with content containing internal quotes", () => {
    // Simpler test that reproduces the quote truncation bug
    const content = "Line 1 with 'single quotes'\\nLine 2 with more 'quotes'";
    const toolCall = `<tool_call name="create_file" args='{"file_path": "file.txt", "content": "${content}"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("create_file");
    expect(results[0].args.file_path).toBe("file.txt");
    expect(results[0].args.content).toContain("Line 1 with 'single quotes'");
    expect(results[0].args.content).toContain("Line 2 with more 'quotes'");
  });

  it("should handle tool call with content containing escaped quotes", () => {
    const toolCall = `<tool_call name="create_file" args='{"file_path": "test.txt", "content": "This has \\"quotes\\" and apostrophes"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].args.content).toBe('This has "quotes" and apostrophes');
  });

  it("should handle tool call with content containing backticks", () => {
    const content = `Code with \`backticks\` like in markdown`;
    const toolCall = `<tool_call name="create_file" args='{"file_path": "test.md", "content": "${content}"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].args.content).toBe(content);
  });

  it("should handle tool call with very long content (2000+ chars)", () => {
    // Generate very long content with escaped newlines (like LLM would generate)
    const escapedContent =
      "A".repeat(1000) +
      "\\n" +
      "B".repeat(1000) +
      "\\n# Comment with 'quotes'";
    const toolCall = `<tool_call name="create_file" args='{"file_path": "large.txt", "content": "${escapedContent}"}' />`;

    console.log(`\nVery long tool call: ${toolCall.length} chars`);

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].args.content).toContain("AAAA"); // Check it has the As
    expect(results[0].args.content).toContain("BBBB"); // Check it has the Bs
    expect(results[0].args.content).toContain("# Comment with 'quotes'");
    expect(results[0].raw.length).toBe(toolCall.length);
  });
});
