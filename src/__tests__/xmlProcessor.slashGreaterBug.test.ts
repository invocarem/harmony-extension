import { XmlProcessor } from "../utils/xmlProcessor";

describe("XmlProcessor - Slash-Greater Inside JSON Bug", () => {
  it("should handle JSON content containing /> sequence", () => {
    // This simulates content with HTML-like patterns or comments containing />
    // The JSON string has escaped \n which becomes real newlines when parsed
    const jsonString = "Step 1: Check if x > 5\\n<div class='test' />\\nStep 2: Continue";
    const toolCall = `<tool_call name="create_file" args='{"file_path": "test.txt", "content": "${jsonString}"}' />`;
    
    // After JSON parsing, \n becomes actual newlines
    const expectedContent = "Step 1: Check if x > 5\n<div class='test' />\nStep 2: Continue";

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("create_file");
    expect(results[0].args.file_path).toBe("test.txt");
    expect(results[0].args.content).toBe(expectedContent);
  });

  it("should handle edit_file with /> in old_text", () => {
    // JSON strings with escaped \n and escaped single quotes
    const oldTextJson = "const template = \\'<div />\\n  <span />\\n</div>\\'";
    const newTextJson = "const template = \\'<div>\\n  <span>text</span>\\n</div>\\'";
    
    // Expected values after JSON parsing (real newlines, unescaped quotes)
    const expectedOldText = "const template = '<div />\n  <span />\n</div>'";
    const expectedNewText = "const template = '<div>\n  <span>text</span>\n</div>'";
    
    const toolCall = `<tool_call name="edit_file" args='{"file_path": "test.js", "old_text": "${oldTextJson}", "new_text": "${newTextJson}"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("edit_file");
    expect(results[0].args.old_text).toBe(expectedOldText);
    expect(results[0].args.new_text).toBe(expectedNewText);
  });

  it("should handle large code block with multiple /> sequences (CRC table bug reproduction)", () => {
    // This reproduces the actual bug from the logs where a CRC lookup table
    // with 7000+ chars and containing patterns that look like /> caused failure
    
    // JSON representation (for the XML args attribute) - uses \\n
    const largeContentJson = 
      "#!/usr/bin/gawk -f\\n\\n" +
      "BEGIN {\\n" +
      "    # CRC table initialization\\n" +
      "    crc_table[0] = 0x0000; crc_table[1] = 0xC0C1;\\n" +
      "    crc_table[2] = 0xC181; crc_table[3] = 0x0140;\\n" +
      // Simulate a large table with many entries
      Array(100).fill(null).map((_, i) => 
        `    crc_table[${i + 4}] = 0x${(i * 37 % 0xFFFF).toString(16).toUpperCase().padStart(4, '0')};`
      ).join("\\n") + "\\n" +
      "    # Pattern that might confuse parser: <div />\\n" +
      "    # Another pattern: Check if x > y then y />= z\\n" +
      "}\\n" +
      "# Process bytes\\n" +
      "END {\\n" +
      "    for (i = 0; i < byte_index; i++) {\\n" +
      "        # Self-closing tag comment: <tag />\\n" +
      "        x = and(xor(Crc, bytes[i]), 0xFF);\\n" +
      "    }\\n" +
      "}";

    // Expected parsed result - \\n becomes real newlines
    const expectedContent = 
      "#!/usr/bin/gawk -f\n\n" +
      "BEGIN {\n" +
      "    # CRC table initialization\n" +
      "    crc_table[0] = 0x0000; crc_table[1] = 0xC0C1;\n" +
      "    crc_table[2] = 0xC181; crc_table[3] = 0x0140;\n" +
      Array(100).fill(null).map((_, i) => 
        `    crc_table[${i + 4}] = 0x${(i * 37 % 0xFFFF).toString(16).toUpperCase().padStart(4, '0')};`
      ).join("\n") + "\n" +
      "    # Pattern that might confuse parser: <div />\n" +
      "    # Another pattern: Check if x > y then y />= z\n" +
      "}\n" +
      "# Process bytes\n" +
      "END {\n" +
      "    for (i = 0; i < byte_index; i++) {\n" +
      "        # Self-closing tag comment: <tag />\n" +
      "        x = and(xor(Crc, bytes[i]), 0xFF);\n" +
      "    }\n" +
      "}";

    const toolCall = `<tool_call name="create_file" args='{"file_path": "crc16.awk", "content": "${largeContentJson}"}' />`;

    console.log(`\n[Test] Tool call length: ${toolCall.length} chars`);
    console.log(`[Test] Content length: ${largeContentJson.length} chars`);
    console.log(`[Test] Content contains /> sequences: ${largeContentJson.includes('/>')}`);

    const results = XmlProcessor.extractToolCalls(toolCall);

    // Before the fix, this would fail:
    // - Only 16 chars of attributes would be extracted
    // - The regex would match the first /> inside the content string
    // After the fix:
    // - Full attributes should be extracted
    // - The /> inside quotes should be ignored
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("create_file");
    expect(results[0].args.file_path).toBe("crc16.awk");
    expect(results[0].args.content).toBe(expectedContent);
    expect(results[0].args.content).toContain("crc_table[0] = 0x0000");
    expect(results[0].args.content).toContain("# Pattern that might confuse parser: <div />");
    expect(results[0].args.content).toContain("# Self-closing tag comment: <tag />");
  });

  it("should handle edit_file with /> in new_text containing CRC table", () => {
    // JSON strings with \\n
    const oldTextJson = "# The END block (placeholder for later steps)\\nEND {\\n    # Placeholder\\n}";
    
    // Simulate the actual failing case: new_text with large CRC table
    const newTextJson = 
      "# Initialize CRC table (256 entries)\\n" +
      "    crc_table[0] = 0x0000; crc_table[1] = 0xC0C1; crc_table[2] = 0xC181; crc_table[3] = 0x0140;\\n" +
      Array(60).fill(null).map((_, i) => 
        `    crc_table[${i + 4}] = 0x${((i * 37 + 123) % 0xFFFF).toString(16).toUpperCase().padStart(4, '0')};`
      ).join("\\n") + "\\n" +
      "    # Comment with /> pattern\\n" +
      "\\n# Compute CRC\\n" +
      "    for (i = 0; i < byte_index; i++) {\\n" +
      "        byte = bytes[i];\\n" +
      "        x = and(xor(Crc, byte), 0xFF);\\n" +
      "        Crc = and(xor(crc_table[x], rshift(Crc, 8)), 0xFFFF);\\n" +
      "    }\\n" +
      "}";

    // Expected parsed values (\\n becomes real newlines)
    const expectedOldText = "# The END block (placeholder for later steps)\nEND {\n    # Placeholder\n}";
    const expectedNewText = 
      "# Initialize CRC table (256 entries)\n" +
      "    crc_table[0] = 0x0000; crc_table[1] = 0xC0C1; crc_table[2] = 0xC181; crc_table[3] = 0x0140;\n" +
      Array(60).fill(null).map((_, i) => 
        `    crc_table[${i + 4}] = 0x${((i * 37 + 123) % 0xFFFF).toString(16).toUpperCase().padStart(4, '0')};`
      ).join("\n") + "\n" +
      "    # Comment with /> pattern\n" +
      "\n# Compute CRC\n" +
      "    for (i = 0; i < byte_index; i++) {\n" +
      "        byte = bytes[i];\n" +
      "        x = and(xor(Crc, byte), 0xFF);\n" +
      "        Crc = and(xor(crc_table[x], rshift(Crc, 8)), 0xFFFF);\n" +
      "    }\n" +
      "}";

    const toolCall = `<tool_call name="edit_file" args='{"file_path":"crc16.awk","old_text":"${oldTextJson}","new_text":"${newTextJson}"}' />`;

    console.log(`\n[Test] Tool call length: ${toolCall.length} chars`);
    console.log(`[Test] new_text length: ${newTextJson.length} chars`);

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("edit_file");
    expect(results[0].args.file_path).toBe("crc16.awk");
    expect(results[0].args.old_text).toBe(expectedOldText);
    expect(results[0].args.new_text).toBe(expectedNewText);
    expect(results[0].args.new_text).toContain("crc_table[0] = 0x0000");
    expect(results[0].args.new_text).toContain("# Comment with /> pattern");
  });

  it("should handle tool call where /> appears near beginning of content", () => {
    // Edge case: /> appears very early in the content
    const content = "<tag /> This is the actual content that continues for a while...";
    const toolCall = `<tool_call name="create_file" args='{"file_path": "test.txt", "content": "${content}"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].args.content).toBe(content);
  });

  it("should handle multiple /> sequences in content", () => {
    // JSON string with escaped single quotes
    const contentJson = 
      "Line 1: <input />\\n" +
      "Line 2: <br />\\n" +
      "Line 3: <img src=\\'x\\' />\\n" +
      "Line 4: Normal text\\n" +
      "Line 5: <meta />\\n" +
      "Line 6: Done";
    
    // Expected parsed value (\\n becomes real newlines, \\' becomes ')
    const expectedContent = 
      "Line 1: <input />\n" +
      "Line 2: <br />\n" +
      "Line 3: <img src='x' />\n" +
      "Line 4: Normal text\n" +
      "Line 5: <meta />\n" +
      "Line 6: Done";
    
    const toolCall = `<tool_call name="create_file" args='{"file_path": "html.txt", "content": "${contentJson}"}' />`;

    const results = XmlProcessor.extractToolCalls(toolCall);

    expect(results.length).toBe(1);
    expect(results[0].args.content).toBe(expectedContent);
    // Verify all /> sequences are preserved (4 self-closing tags)
    expect((results[0].args.content.match(/<[^>]+\/>/g) || []).length).toBe(4);
  });
});
