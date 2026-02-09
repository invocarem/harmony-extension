import { XmlProcessor } from "../utils/xmlProcessor";

describe("XmlProcessor - AWK escape sequences", () => {
  it("should preserve literal \\n in AWK printf statements", () => {
    // This is the actual content from the user's log - AWK code with printf that needs literal \n
    const awkContent =
      'END {\n    # Final XOR with 0x0000 (no effect) and output as 4‑digit uppercase hex\n    printf "%04X\\n", Crc;\n}';

    // Create the JSON as the LLM would generate it
    // In JSON, \\n means backslash+n (literal), \n means newline
    const jsonArgs = JSON.stringify({
      file_path: "crc16.awk",
      content: awkContent,
    });

    const toolCallXml = `<tool_call name="create_file" args='${jsonArgs}' />`;

    const result = XmlProcessor.extractToolCalls(toolCallXml);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("crc16.awk");
    expect(result[0].args.content).toBe(awkContent);

    // Most importantly: the content should have literal \n (backslash+n), not a newline
    expect(result[0].args.content).toContain('printf "%04X\\n", Crc;');
  });

  it("should handle the exact debug log output from user", () => {
    // Simulating the exact raw tool call from debug log
    const rawToolCall =
      '<tool_call name="create_file" args=\'{"file_path": "crc16.awk", "content": "END {\\n    printf \\"%04X\\\\n\\", Crc;\\n}"}\' />';

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    const content = result[0].args.content;

    // The content should have literal \n in the printf, not a newline character
    expect(content).toContain('printf "%04X\\n", Crc;');

    // Verify character codes: backslash (92) followed by 'n' (110), not newline (10)
    const printfMatch = content.match(/printf "([^"]+)"/);
    expect(printfMatch).not.toBeNull();
    const formatString = printfMatch![1];
    const lastTwoChars = formatString.slice(-2);
    expect(lastTwoChars.charCodeAt(0)).toBe(92); // backslash
    expect(lastTwoChars.charCodeAt(1)).toBe(110); // 'n'
  });

  it("should preserve other escape sequences like \\t, \\r correctly", () => {
    const content = 'print "Column1\\tColumn2\\r\\nRow1\\tData1";';
    const jsonArgs = JSON.stringify({
      file_path: "test.txt",
      content: content,
    });

    const toolCallXml = `<tool_call name="create_file" args='${jsonArgs}' />`;
    const result = XmlProcessor.extractToolCalls(toolCallXml);

    expect(result).toHaveLength(1);
    expect(result[0].args.content).toContain("\\t");
    expect(result[0].args.content).toContain("\\r");
    expect(result[0].args.content).toContain("\\n");
  });
});
