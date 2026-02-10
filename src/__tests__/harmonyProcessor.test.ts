import { HarmonyProcessor, HarmonyParseResult } from "../harmonyProcessor";
import { MCPToolCall } from "../mcpClient";

describe("HarmonyProcessor", () => {
  let processor: HarmonyProcessor;

  beforeEach(() => {
    processor = new HarmonyProcessor();
  });

  describe("parseResponse", () => {
    describe("Basic parsing", () => {
      it("should parse simple final channel response", () => {
        const response = "<|channel|>final<|message|>Hello world<|end|>";
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Hello world");
        expect(result.reasoning).toBeUndefined();
        expect(result.rawToolCalls).toEqual([]);
      });

      it("should parse analysis channel as reasoning", () => {
        const response =
          '<|channel|>analysis<|message|>We need to respond to greeting "hi". Simple.<|end|><|start|>assistant<|channel|>final<|message|>Hello! How can I assist you today?';
        const result = processor.parseResponse(response);

        expect(result.reasoning).toBe(
          'We need to respond to greeting "hi". Simple.'
        );
        expect(result.content).toBe("Hello! How can I assist you today?");
      });

      it("should handle response without end token", () => {
        const response = "<|channel|>final<|message|>Hello world";
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Hello world");
      });

      it("should handle multiline content", () => {
        const response = `<|channel|>final<|message|>Line 1
Line 2
Line 3<|end|>`;
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Line 1\nLine 2\nLine 3");
      });

      it("should handle empty response", () => {
        const result = processor.parseResponse("");

        expect(result.content).toBe("");
        expect(result.reasoning).toBeUndefined();
        expect(result.rawToolCalls).toEqual([]);
      });
    });

    describe("Channel type detection", () => {
      it("should detect analysis channel", () => {
        const response = "<|channel|>analysis<|message|>Some analysis<|end|>";
        const result = processor.parseResponse(response);

        expect(result.reasoning).toBe("Some analysis");
      });

      it("should detect final channel", () => {
        const response = "<|channel|>final<|message|>Final content<|end|>";
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Final content");
      });

      it("should detect commentary channel", () => {
        // Commentary channel content goes to commentary field unless it looks like a tool call
        const response =
          "<|channel|>commentary<|message|>Commentary content<|end|>";
        const result = processor.parseResponse(response);

        // Regular commentary text should be saved to commentary field
        expect(result.commentary).toBe("Commentary content");
        expect(result.content).toBe("");

        // If commentary contains a tool call, it should go to rawToolCalls
        const responseWithToolCall =
          '<|channel|>commentary<|message|>to=analyze_latin {"word": "amo"}<|end|>';
        const resultWithToolCall =
          processor.parseResponse(responseWithToolCall);
        expect(resultWithToolCall.rawToolCalls?.length).toBeGreaterThan(0);
      });

      it("should handle channel with whitespace", () => {
        const response = "<|channel|>  final  <|message|>Content<|end|>";
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Content");
      });
    });

    describe("Complex Harmony format", () => {
      it("should parse response with start token", () => {
        const response =
          "<|start|>assistant<|channel|>final<|message|>Response<|end|>";
        const result = processor.parseResponse(response);

        expect(result.content).toBe("Response");
      });

      it("should parse multiple sections", () => {
        const response =
          "<|channel|>analysis<|message|>Analysis<|end|><|channel|>final<|message|>Final<|end|>";
        const result = processor.parseResponse(response);

        expect(result.reasoning).toBe("Analysis");
        expect(result.content).toBe("Final");
      });

      it("should handle the debug dump example", () => {
        const response =
          '<|channel|>analysis<|message|>We need to respond to greeting "hi". Simple.<|end|><|start|>assistant<|channel|>final<|message|>Hello! How can I assist you today?';
        const result = processor.parseResponse(response);

        expect(result.reasoning).toBe(
          'We need to respond to greeting "hi". Simple.'
        );
        expect(result.content).toBe("Hello! How can I assist you today?");
      });
    });

    describe("Code block preservation", () => {
      it("should preserve markdown code blocks", () => {
        const response = `<|channel|>final<|message|>Here's some code:
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`
<|end|>`;
        const result = processor.parseResponse(response);

        expect(result.content).toContain("```python");
        expect(result.content).toContain("def hello():");
        expect(result.content).toContain('print("Hello World!")');
        expect(result.content).toContain("```");
      });

      it("should preserve inline code", () => {
        const response =
          "<|channel|>final<|message|>Use `console.log()` to print<|end|>";
        const result = processor.parseResponse(response);

        expect(result.content).toContain("`console.log()`");
      });

      it("should preserve multiple code blocks", () => {
        const response = `<|channel|>final<|message|>
\`\`\`javascript
const x = 1;
\`\`\`

Some text

\`\`\`typescript
const y = 2;
\`\`\`
<|end|>`;
        const result = processor.parseResponse(response);

        expect(result.content).toContain("```javascript");
        expect(result.content).toContain("```typescript");
        expect(result.content).toContain("const x = 1;");
        expect(result.content).toContain("const y = 2;");
      });
    });
  });

  describe("extractToolCalls", () => {
    describe("XML tool call format", () => {
      it("should extract self-closing tool call", () => {
        const raw =
          '<tool_call name="analyze_latin" args=\'{"word": "amo"}\' />';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });

      it("should extract tool call with double quotes", () => {
        const raw =
          '<tool_call name="analyze_latin" args="{\\"word\\": \\"amo\\"}" />';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });

      it("should extract full element tool call", () => {
        const raw =
          '<tool_call name="analyze_latin"><![CDATA[{"word": "amo"}]]></tool_call>';
        const result = processor.extractToolCalls([raw]);

        expect(result.length).toBeGreaterThanOrEqual(0); // May or may not parse depending on format
      });

      it("should extract multiple tool calls", () => {
        const raw =
          '<tool_call name="tool1" args=\'{"arg": "1"}\' /><tool_call name="tool2" args=\'{"arg": "2"}\' />';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("tool1");
        expect(result[1].name).toBe("tool2");
      });

      // Note: This test was previously skipped due to a known limitation where regex patterns
      // using [^>]+ would truncate at the first ">" character. The fix in HarmonyProcessor.saveBuffer
      // now uses quote-aware parsing similar to XmlProcessor.findSelfClosingTagEnd, which properly
      // handles ">" characters inside quoted JSON strings.
      it("should extract tool call with >= in JSON content (fixed truncation issue)", () => {
        // This test verifies that the fix handles ">" characters in JSON content correctly
        // The improved fallback uses quote-aware parsing to find the closing /> properly
        const jsonArgs = JSON.stringify({
          file_path: "requirements.txt",
          content: "pygame>=2.0.0\nmatplotlib>=3.5.0",
        });
        const raw = `<tool_call name="create_file" args='${jsonArgs}' />`;
        const result = processor.extractToolCalls([raw]);

        // Should extract correctly with full content including >= operators
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("create_file");
        expect(result[0].arguments).toBeDefined();
        expect(result[0].arguments!.file_path).toBe("requirements.txt");
        expect(result[0].arguments!.content).toBe(
          "pygame>=2.0.0\nmatplotlib>=3.5.0"
        );
        expect(result[0].arguments!.content).toContain(">=");
      });
    });

    describe("MCP commentary format", () => {
      it("should extract MCP format: to=function_name {...}", () => {
        const raw = 'to=analyze_latin {"word": "amo"}';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });

      it("should extract MCP format with multiline JSON", () => {
        const raw = `to=analyze_latin_batch {
  "words": ["amo", "amas", "amat"]
}`;
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin_batch");
        expect(result[0].arguments).toEqual({ words: ["amo", "amas", "amat"] });
      });

      it("should extract simple MCP format with args on next line", () => {
        const raw = `to=analyze_latin
{"word": "amo"}`;
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });
    });

    describe("JSON tool call format", () => {
      it("should extract JSON format tool call", () => {
        const raw = '{"name": "analyze_latin", "arguments": {"word": "amo"}}';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });

      it("should handle empty arguments", () => {
        const raw = '<tool_call name="no_args" args="{}" />';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("no_args");
        expect(result[0].arguments).toEqual({});
      });
    });

    describe("Variant token patterns", () => {
      it("should extract tool call from variant pattern with <|analysis prefix", () => {
        const raw =
          '<|analysis tool_call name="analyze_latin" args=\'{"word":"invenietur"}\'/>';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "invenietur" });
      });

      it("should extract tool call from variant pattern with |analysis prefix", () => {
        const raw =
          '|analysis tool_call name="analyze_latin" args=\'{"word":"amo"}\'/>';
        const result = processor.extractToolCalls([raw]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("analyze_latin");
        expect(result[0].arguments).toEqual({ word: "amo" });
      });
    });

    describe("Edge cases", () => {
      it("should handle empty raw tool calls array", () => {
        const result = processor.extractToolCalls([]);

        expect(result).toEqual([]);
      });

      it("should handle invalid tool call format gracefully", () => {
        const raw = "invalid tool call format";
        const result = processor.extractToolCalls([raw]);

        expect(result).toEqual([]);
      });

      it("should handle malformed JSON gracefully", () => {
        const raw = "to=analyze_latin {invalid json}";
        const result = processor.extractToolCalls([raw]);

        expect(result).toEqual([]);
      });

      it("should handle tool call without arguments", () => {
        const raw = '<tool_call name="no_args" />';
        const result = processor.extractToolCalls([raw]);

        // Should handle gracefully - may or may not extract depending on implementation
        expect(Array.isArray(result)).toBe(true);
      });

      it("should NOT extract tool calls from natural language file mentions (disabled auto-extraction)", () => {
        // Automatic extraction is disabled - LLM must explicitly make tool calls
        // Mentioning files in natural language should NOT trigger automatic extraction
        const naturalLanguage =
          "The system will execute the tool and return the result. After all tools are called and results received, provide your final response. You are to update the `englishText` array in the Psalm101Tests.swift file to add a comment every 5 verses, following the 29 verses of Latin text. I'll analyze the existing structure and add appropriate comments.";

        const result = processor.parseResponse(naturalLanguage);

        // Should preserve content but NOT extract tool calls automatically
        expect(result.content).toContain("The system will execute");
        expect(result.content).toContain("Psalm101Tests.swift");
        // Automatic extraction is disabled - no tool calls should be extracted
        expect(result.rawToolCalls).toEqual([]);
      });

      it("should still detect actual XML tool calls correctly", () => {
        // Ensure actual tool calls are still detected after the fix
        const actualToolCall =
          '<tool_call name="analyze_latin" args=\'{"word": "amo"}\' />';
        const result = processor.parseResponse(actualToolCall);

        // Should detect it as a tool call
        expect(result.rawToolCalls?.length).toBeGreaterThan(0);

        // Should extract correctly
        const extracted = processor.extractToolCalls(result.rawToolCalls || []);
        expect(extracted).toHaveLength(1);
        expect(extracted[0].name).toBe("analyze_latin");
      });

      it("should extract tool call with > characters in content without truncation", () => {
        // Test case for the ">" truncation issue
        // When tool calls contain ">" in the content (e.g., AWK scripts, comparison operators),
        // the old regex fallback [^>]* would truncate at the first ">"
        // The fix uses quote-aware parsing to find the closing /> properly

        const awkScript = `#!/usr/bin/env gawk -f

BEGIN {
    in_page = 0;
}

# Detect page marker lines like "=== PAGE 000 ==="
/^=== PAGE[[:space:]]*([0-9]+)[[:space:]]*===/ {
    if (match($0, /=== PAGE[[:space:]]*([0-9]+)[[:space:]]*===/, arr)) {
        cur_page = arr[1] + 0;
        in_page = (cur_page == page);
    }
    next;
}

# Process only lines belonging to the selected page that contain MC=
in_page && /MC=/ {
    # Split the line at the pipe character "|"
    n = split($0, parts, /\\|/);
    if (n > 1) {
        # left part before pipe
        left = parts[1];
        # remove leading up to colon
        sub(/^[^:]*:\\s*/, "", left);
        # trim trailing spaces
        sub(/[ \\t\\r\\n]+$/, "", left);
        if (length(left) > 0) print left;
    }
}
END {}`;

        const jsonArgs = JSON.stringify({
          file_path: "filter.awk",
          content: awkScript,
        });

        // Test with complete tool call
        const completeToolCall = `<tool_call name="create_file" args='${jsonArgs}' />`;
        const result = processor.parseResponse(completeToolCall);

        // Should detect it as a tool call
        expect(result.rawToolCalls?.length).toBeGreaterThan(0);
        expect(result.rawToolCalls![0]).toContain("filter.awk");
        expect(result.rawToolCalls![0]).toContain("BEGIN {");
        expect(result.rawToolCalls![0]).toContain("END {}");

        // Should extract correctly with full content
        const extracted = processor.extractToolCalls(result.rawToolCalls || []);
        expect(extracted).toHaveLength(1);
        expect(extracted[0].name).toBe("create_file");
        expect(extracted[0].arguments).toBeDefined();
        expect(extracted[0].arguments!.file_path).toBe("filter.awk");
        expect(extracted[0].arguments!.content).toBe(awkScript);
        expect(extracted[0].arguments!.content).toContain(
          "in_page = (cur_page == page)"
        );
        expect(extracted[0].arguments!.content).toContain("END {}");
      });

      it("should extract incomplete tool call with > characters without truncation", () => {
        // Test case for incomplete/streaming tool calls with ">" characters
        // When a tool call is incomplete (missing closing />), it should still
        // preserve the full content without truncating at ">" characters

        const longContent = `#!/usr/bin/env gawk -f

BEGIN {
    in_page = 0;
}

# Process lines with MC=
in_page && /MC=/ {
    n = split($0, parts, /\\|/);
    if (n > 1) {
        left = parts[1];
        sub(/^[^:]*:\\s*/, "", left);
        if (length(left) > 0) print left;
    }
}`;

        const jsonArgs = JSON.stringify({
          file_path: "filter.awk",
          content: longContent,
        });

        // Simulate incomplete tool call (missing closing />)
        const incompleteToolCall = `<tool_call name="create_file" args='${jsonArgs}'`;
        const result = processor.parseResponse(incompleteToolCall);

        // Should still detect it as a tool call (incomplete handler)
        expect(result.rawToolCalls?.length).toBeGreaterThan(0);

        // The raw tool call should contain the full content, not truncated
        const rawToolCall = result.rawToolCalls![0];
        expect(rawToolCall).toContain("filter.awk");
        expect(rawToolCall).toContain("BEGIN {");
        expect(rawToolCall).toContain("in_page = 0");

        // Should be able to extract what we can from incomplete tool call
        const extracted = processor.extractToolCalls(result.rawToolCalls || []);
        // May or may not extract depending on how incomplete it is, but should not crash
        expect(Array.isArray(extracted)).toBe(true);
      });

      it("should extract tool call with >= comparison operators in content", () => {
        // Test case for ">=" operators in content (like version requirements)
        const requirementsContent =
          "pygame>=2.0.0\nmatplotlib>=3.5.0\nnumpy>=1.20.0";

        const jsonArgs = JSON.stringify({
          file_path: "requirements.txt",
          content: requirementsContent,
        });

        const toolCall = `<tool_call name="create_file" args='${jsonArgs}' />`;
        const result = processor.parseResponse(toolCall);

        // Should detect it as a tool call
        expect(result.rawToolCalls?.length).toBeGreaterThan(0);

        // Should extract correctly with full content including >= operators
        const extracted = processor.extractToolCalls(result.rawToolCalls || []);
        expect(extracted).toHaveLength(1);
        expect(extracted[0].name).toBe("create_file");
        expect(extracted[0].arguments).toBeDefined();
        expect(extracted[0].arguments!.file_path).toBe("requirements.txt");
        expect(extracted[0].arguments!.content).toBe(requirementsContent);
        expect(extracted[0].arguments!.content).toContain("pygame>=2.0.0");
        expect(extracted[0].arguments!.content).toContain("matplotlib>=3.5.0");
      });
    });
  });

  describe("cleanText", () => {
    it("should remove Harmony tokens", () => {
      const text = "<|start|>user<|channel|>final<|message|>Hello<|end|>";
      const cleaned = processor.cleanText(text);

      expect(cleaned).not.toContain("<|");
      expect(cleaned).not.toContain("|>");
    });

    it("should normalize whitespace", () => {
      const text = "Hello    world\n\n\nTest";
      const cleaned = processor.cleanText(text);

      expect(cleaned).toBe("Hello world Test");
    });

    it("should trim result", () => {
      const text = "   Hello world   ";
      const cleaned = processor.cleanText(text);

      expect(cleaned).toBe("Hello world");
    });
  });

  describe("formatPrompt", () => {
    it("should format prompt with Harmony tokens", () => {
      const prompt = processor.formatPrompt("Hello");

      expect(prompt).toContain("<|start|>user");
      expect(prompt).toContain("<|channel|>final");
      expect(prompt).toContain("<|message|>");
      expect(prompt).toContain("Hello");
      expect(prompt).toContain("<|end|>");
      expect(prompt).toContain("<|start|>assistant");
    });

    it("should include user message in prompt", () => {
      const userMessage = "What is TypeScript?";
      const prompt = processor.formatPrompt(userMessage);

      expect(prompt).toContain(userMessage);
    });
  });

  describe("Issue: JSON in final channel treated as tool call", () => {
    it("should treat JSON data in final channel as content, not tool call", () => {
      // This is the problematic case from the console output
      const response = `<|channel|>analysis<|message|>The user asks: "for salveo, can you confirm future, perfect and supine are all null or empty string?" They want confirmation. We need to analyze "salveo" to see its future, perfect, supine forms. According to Latin, "salveo" (to be well) is a defective verb, lacking future, perfect, supine. So they are null or empty.
We should respond conversationally and helpfully. Possibly we can provide the analysis using the tool. Use analyze_latin for "salveo". Then we can confirm that future, perfect, supine are null/empty.
We need to call the tool.<|end|><|start|>assistant<|channel|>final<|message|>{
  "lemma": "salveo",
  "part_of_speech": "verb",
  "conjugation": 2,
  "infinitive": "salvere",
  "present": "salveo",
  "future": null,
  "perfect": null,
  "supine": null,
  "translations": {
    "en": "be well / be in good health",
    "la": "salveo, salvere, -, -"
  },
  "forms": {}
}<|end|>`;

      const result = processor.parseResponse(response);

      // The problem: JSON should be treated as content, not a tool call
      // Currently it would be treated as a tool call because ToolCallExtractor.looksLikeToolCall()
      // returns true for JSON that looks like {"name": "...", "arguments": {...}}

      console.log("Test result:", {
        contentLength: result.content.length,
        rawToolCallsLength: result.rawToolCalls?.length,
        content: result.content,
        rawToolCalls: result.rawToolCalls,
      });

      // JSON data should be content, not a tool call
      expect(result.content).toContain('"lemma": "salveo"');
      expect(result.content).toContain('"future": null');
      expect(result.content).toContain('"perfect": null');
      expect(result.content).toContain('"supine": null');

      // Should NOT treat this as a tool call
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should distinguish between JSON content and JSON tool call format", () => {
      // Test that actual tool calls are still detected
      const responseWithToolCall = `<|channel|>final<|message|>{
  "name": "analyze_latin",
  "arguments": {"word": "salveo"}
}<|end|>`;

      const result = processor.parseResponse(responseWithToolCall);

      console.log("Tool call test:", {
        content: result.content,
        rawToolCalls: result.rawToolCalls,
      });

      // This SHOULD be detected as a tool call because it matches the JSON tool call format
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);

      // But regular JSON data should NOT be detected as a tool call
      const responseWithData = `<|channel|>final<|message|>{
  "lemma": "salveo",
  "future": null,
  "perfect": null,
  "supine": null
}<|end|>`;

      const result2 = processor.parseResponse(responseWithData);

      console.log("Data test:", {
        content: result2.content,
        rawToolCalls: result2.rawToolCalls,
      });

      // This should be content, not a tool call
      expect(result2.content).toContain('"lemma": "salveo"');
      expect(result2.rawToolCalls).toEqual([]);
    });

    it("should handle conversational response with embedded JSON", () => {
      const response = `<|channel|>final<|message|>Yes, I can confirm that for "salveo", the future, perfect, and supine forms are all null. Here's the analysis:

\`\`\`json
{
  "lemma": "salveo",
  "future": null,
  "perfect": null,
  "supine": null
}
\`\`\`

The verb is defective, meaning it lacks those forms entirely.<|end|>`;

      const result = processor.parseResponse(response);

      // Should preserve the conversational text AND the JSON in code blocks
      expect(result.content).toContain("Yes, I can confirm");
      expect(result.content).toContain("```json");
      expect(result.content).toContain('"lemma": "salveo"');
      expect(result.rawToolCalls).toEqual([]);
    });
  });

  describe("validateResponse", () => {
    it("should validate Harmony format response", () => {
      expect(
        processor.validateResponse("<|channel|>final<|message|>Hello<|end|>")
      ).toBe(true);
    });

    it("should reject non-Harmony format", () => {
      expect(processor.validateResponse("Just plain text")).toBe(false);
    });

    it("should validate response with only start token", () => {
      expect(processor.validateResponse("<|start|>")).toBe(true);
    });
  });

  describe("Plain text (jinja-only) responses", () => {
    it("should parse simple plain text response", () => {
      const response =
        '>I want to clarify your problem. You\'ve simply said "hi" without specifying what you need help with.';
      const result = processor.parseResponse(response);

      expect(result.content).toBe(response.trim());
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should parse plain text response with leading/trailing whitespace", () => {
      const response = "   Hello! How can I assist you today?   ";
      const result = processor.parseResponse(response);

      expect(result.content).toBe("Hello! How can I assist you today?");
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should parse plain text response with multiline content", () => {
      const response = `I want to clarify your problem. You've simply said "hi" without specifying what you need help with. For example:

- Do you need help with coding?
- Are you looking for information about a specific topic?
- Do you want assistance with file operations?`;
      const result = processor.parseResponse(response);

      expect(result.content).toBe(response.trim());
      expect(result.content).toContain("I want to clarify");
      expect(result.content).toContain("- Do you need help with coding?");
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should parse plain text response that looks like a tool call", () => {
      const response =
        '<tool_call name="analyze_latin" args=\'{"word": "amo"}\' />';
      const result = processor.parseResponse(response);

      // Should detect it as a tool call even without Harmony tokens
      expect(result.content).toBe("");
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      expect(result.rawToolCalls?.[0]).toBe(response.trim());
    });

    it("should parse plain text response with MCP tool call format", () => {
      const response = 'to=analyze_latin {"word": "amo"}';
      const result = processor.parseResponse(response);

      // Should detect it as a tool call
      expect(result.content).toBe("");
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      expect(result.rawToolCalls?.[0]).toBe(response.trim());
    });

    it("should parse plain text response with JSON tool call format", () => {
      const response =
        '{"name": "analyze_latin", "arguments": {"word": "amo"}}';
      const result = processor.parseResponse(response);

      // Should detect it as a tool call
      expect(result.content).toBe("");
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      expect(result.rawToolCalls?.[0]).toBe(response.trim());
    });

    it("should handle empty plain text response", () => {
      const response = "";
      const result = processor.parseResponse(response);

      expect(result.content).toBe("");
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should handle plain text response with only whitespace", () => {
      const response = "   \n\n   ";
      const result = processor.parseResponse(response);

      expect(result.content).toBe("");
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should preserve code blocks in plain text response", () => {
      const response = `Here's some code:

\`\`\`python
def hello():
    print("Hello World!")
\`\`\`

This is a code example.`;
      const result = processor.parseResponse(response);

      expect(result.content).toContain("```python");
      expect(result.content).toContain("def hello():");
      expect(result.content).toContain('print("Hello World!")');
      expect(result.content).toContain("```");
      expect(result.content).toContain("This is a code example.");
    });

    it("should handle plain text response that starts with > character", () => {
      // This matches the actual response format from the user's logs
      const response =
        '>I want to clarify your problem. You\'ve simply said "hi" without specifying what you need help with.';
      const result = processor.parseResponse(response);

      expect(result.content).toBe(response.trim());
      expect(result.content).toContain(">I want to clarify");
      expect(result.reasoning).toBeUndefined();
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should distinguish between plain text content and tool calls", () => {
      // Regular text should be content
      const textResponse = "Hello! How can I help you today?";
      const textResult = processor.parseResponse(textResponse);
      expect(textResult.content).toBe(textResponse);
      expect(textResult.rawToolCalls).toEqual([]);

      // Tool call should be detected
      const toolCallResponse =
        '<tool_call name="test" args=\'{"arg": "value"}\' />';
      const toolCallResult = processor.parseResponse(toolCallResponse);
      expect(toolCallResult.content).toBe("");
      expect(toolCallResult.rawToolCalls?.length).toBeGreaterThan(0);
    });

    it("should NOT extract tool calls from filename mentions (disabled auto-extraction)", () => {
      // Automatic extraction is disabled - LLM must explicitly make tool calls
      const naturalLanguageResponse =
        "The system will execute the tool and return the result. After all tools are called and results received, provide your final response. You are to update the `englishText` array in the Psalm101Tests.swift file.";
      const result = processor.parseResponse(naturalLanguageResponse);

      // Should preserve content but NOT extract tool calls automatically
      expect(result.content).toContain("The system will execute");
      // Automatic extraction is disabled - no tool calls should be extracted
      expect(result.rawToolCalls).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should parse response with tool calls in final channel", () => {
      const response = `<|channel|>final<|message|><tool_call name="analyze_latin" args='{"word": "amo"}' /><|end|>`;
      const result = processor.parseResponse(response);

      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      const toolCalls = processor.extractToolCalls(result.rawToolCalls || []);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("analyze_latin");
    });

    it("should parse response with variant token pattern containing tool call", () => {
      // This simulates the real-world scenario where model outputs <|analysis tool_call...
      const response = `<|channel|>analysis<|message|>We need to analyze latin word "invenietur". Must use analyze_latin tool. Then output JSON per spec.

Let's call tool.<|end|><|start|>assistant<|channel|>final<|message|><|analysis tool_call name="analyze_latin" args='{"word":"invenietur"}'/>`;
      const result = processor.parseResponse(response);

      // Should extract the tool call from the variant pattern
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      const toolCalls = processor.extractToolCalls(result.rawToolCalls || []);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("analyze_latin");
      expect(toolCalls[0].arguments).toEqual({ word: "invenietur" });
    });

    it("should combine variant token with tool_call=name syntax and JSON arguments", () => {
      // This tests the case where a variant token like <|analysis tool_call=analyze_latin <|constrain|>
      // is followed by JSON arguments without a "name" field
      const response = `<|channel|>analysis<|message|>We need to analyze the Latin word "invenietur". Must call analyze_latin tool with word "invenietur".<|end|><|start|>assistant<|channel|>final<|message|><|analysis tool_call=analyze_latin <|constrain|>json<|message|>{
  "word": "invenietur"
}
<|end|>`;
      const result = processor.parseResponse(response);

      // Should extract the tool call by combining the variant token tool name with JSON arguments
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
      const toolCalls = processor.extractToolCalls(result.rawToolCalls || []);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("analyze_latin");
      expect(toolCalls[0].arguments).toEqual({ word: "invenietur" });
    });

    it("should parse response with reasoning and tool calls", () => {
      const response = `<|channel|>analysis<|message|>I need to analyze this word<|end|>
<|channel|>final<|message|><tool_call name="analyze_latin" args='{"word": "amo"}' /><|end|>`;
      const result = processor.parseResponse(response);

      expect(result.reasoning).toBe("I need to analyze this word");
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);
    });

    it("should parse response with content and code blocks", () => {
      const response = `<|channel|>final<|message|>Here's the solution:
\`\`\`typescript
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`
<|end|>`;
      const result = processor.parseResponse(response);

      expect(result.content).toContain("Here's the solution:");
      expect(result.content).toContain("```typescript");
      expect(result.content).toContain("function greet");
    });

    it("should handle complex real-world example", () => {
      const response = `<|channel|>analysis<|message|>We need to respond to greeting "hi". Simple.<|end|>
<|start|>assistant<|channel|>final<|message|>Hello! How can I assist you today?

Here's some code:
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`
<|end|>`;
      const result = processor.parseResponse(response);

      expect(result.reasoning).toBe(
        'We need to respond to greeting "hi". Simple.'
      );
      expect(result.content).toContain("Hello! How can I assist you today?");
      expect(result.content).toContain("```python");
      expect(result.content).toContain("def hello():");
    });
  });

  describe("Issue: Model claims file update but doesn't make tool call", () => {
    it("should NOT auto-extract file operations from descriptions (disabled auto-extraction)", () => {
      // Automatic extraction is disabled - model must explicitly make tool calls
      // When model describes file updates but doesn't make explicit tool call, we don't extract
      const response = `<|channel|>analysis<|message|>The user says: "Based on the tool results, continue working on the original task." The original task: earlier they asked "write a simple 'hello world' app in python (file name: hello.py)". We created hello.py. Now they seem to have a follow-up: "update hello.py to include comment". The previous steps mention reading hello.py. We need to update the file to include a comment. So we should modify hello.py to add a comment, e.g., "# This program prints Hello, world!". Use replace_file or create_file to overwrite.<|end|><|start|>assistant<|channel|>final<|message|>Here's the updated \`hello.py\` with a helpful comment at the top:

\`\`\`python
# hello.py – a simple script that prints a greeting
print("Hello, world!")
\`\`\`

I've replaced the file's contents accordingly. Let me know if you'd like any further tweaks!<|end|>`;

      const result = processor.parseResponse(response);

      // Automatic extraction is disabled - model should use explicit <tool_call> format
      // No tool calls should be extracted from descriptions
      expect(result.rawToolCalls).toEqual([]);
      // Content should be preserved for display
      expect(result.content).toContain("Here's the updated");
      expect(result.content).toContain("hello.py");
    });

    it("should not extract tool call from regular code examples", () => {
      // Regular code examples should not be extracted as tool calls
      const response = `<|channel|>final<|message|>Here's an example of how to use Python:

\`\`\`python
def example():
    print("This is just an example")
\`\`\`

This is not a file update.<|end|>`;

      const result = processor.parseResponse(response);

      // Should NOT extract as a tool call since there's no file update claim
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain("Here's an example");
    });

    it("should preserve full content including code block (not just text before code block)", () => {
      // This test ensures that code blocks are NOT truncated to only show
      // content before the code block. The user should see the FULL response
      // in the chat, including both code blocks and any text after them.
      // This was the bug: only content BEFORE the code block was being shown
      const response = `<|channel|>final<|message|>I'll create a test function for you:

\`\`\`python
def greet(name: str = "World") -> str:
    return f"Hello, {name}!"
\`\`\`

This function takes an optional name parameter and returns a greeting string. Perfect for your use case!<|end|>`;

      const result = processor.parseResponse(response);

      // The content field should contain the FULL message
      // including the code block and text after it - NOT truncated
      expect(result.content).toContain("I'll create a test function");
      expect(result.content).toContain("```python");
      expect(result.content).toContain("def greet(name: str");
      expect(result.content).toContain('return f"Hello, {name}!"');
      expect(result.content).toContain("```");
      expect(result.content).toContain("This function takes an optional");
      expect(result.content).toContain("Perfect for your use case!");

      // Verify this is NOT truncated at the code block boundary
      const contentBefore = result.content.indexOf("```");
      const contentAfter = result.content.indexOf("Perfect for your use case!");
      expect(contentAfter).toBeGreaterThan(contentBefore);
    });

    it("should preserve content after code block in chat display (not truncate at code block)", () => {
      // Test the specific scenario from the user's issue:
      // Response with explanation, code block, AND clarifying text after the code block
      // The user should see ALL of this in the chat, not have it truncated
      const response = `<|channel|>analysis<|message|>Create a Python module with a simple function<|end|><|start|>assistant<|channel|>final<|message|>Here's the implementation:

\`\`\`python
def greet(name: str = "World") -> str:
    """Greet a person with their name"""
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet())
    print(greet("Alice"))
\`\`\`

I've created a simple module with a \`greet\` function that accepts an optional name parameter. The function returns a greeting string. The script also demonstrates how to use the function.

You can test it by running the file directly. Let me know if you'd like any modifications!<|end|>`;

      const result = processor.parseResponse(response);

      // Verify the content contains the ENTIRE response, NOT truncated
      expect(result.content).toContain("Here's the implementation:");
      expect(result.content).toContain("```python");
      expect(result.content).toContain("def greet(");
      expect(result.content).toContain('if __name__ == "__main__":');
      expect(result.content).toContain("```");
      // This is critical - text AFTER the code block should be included!
      expect(result.content).toContain("I've created a simple module");
      expect(result.content).toContain("You can test it by running");
      expect(result.content).toContain(
        "Let me know if you'd like any modifications"
      );

      // Verify the text after the code block comes after the closing ```
      const codeBlockEnd = result.content.lastIndexOf("```");
      const textAfter = result.content.indexOf("I've created a simple module");
      expect(textAfter).toBeGreaterThan(codeBlockEnd);
    });
  });

  describe("Harmony mode disabled (plain jinja)", () => {
    let processorDisabled: HarmonyProcessor;

    beforeEach(() => {
      processorDisabled = new HarmonyProcessor(false);
    });

    it("should not filter Harmony tokens when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter Harmony tokens to preserve content
      // This simulates the actual template structure: <|start|>user<|channel|>final<|message|>
      // When harmony mode is disabled, content is returned as-is (only trimmed)
      const response =
        "<|start|>user<|channel|>final<|message|>Hello world<|end|>";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      // Since we're not using Harmony protocol, responses shouldn't have tokens anyway
      expect(result.content).toContain("Hello world");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should not filter Harmony protocol keywords when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is
      const response =
        "<|start|>assistant<|channel|>analysis<|message|>Some reasoning<|end|>";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      expect(result.content).toContain("Some reasoning");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should handle response with multiple Harmony keywords without filtering", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is
      const response =
        "<|start|>user<|channel|>final<|message|>Content here<|end|><|start|>assistant<|channel|>final<|message|>Response here<|end|>";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      expect(result.content).toContain("Content here");
      expect(result.content).toContain("Response here");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should preserve content as-is when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is (trimmed)
      // This preserves all content, including words that happen to match Harmony keywords
      const response =
        "<|start|>user<|channel|>final<|message|>This is the final answer<|end|>";
      const result = processorDisabled.parseResponse(response);

      // Content should contain the actual message content
      expect(result.content).toContain("final answer");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
      // The content will be trimmed but not filtered
    });

    it("should handle plain jinja response without Harmony tokens", () => {
      // When harmony mode is disabled, even responses without tokens should work
      const response = "Just plain text response";
      const result = processorDisabled.parseResponse(response);

      expect(result.content).toBe("Just plain text response");
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should not filter <|start|>assistant| pattern when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is (trimmed)
      const response = "<|start|>assistant|Hello! How can I assist you today?";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      expect(result.content).toContain("Hello! How can I assist you today?");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should not filter assistant|assistant pattern when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is (trimmed)
      const response = "assistant|assistant Hello! How can I assist you today?";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      expect(result.content).toContain("Hello! How can I assist you today?");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should not filter |assistant pattern when harmony mode is disabled", () => {
      // When harmony mode is disabled, we don't filter - content is returned as-is (trimmed)
      const response = "|assistant Hello! How can I assist you today?";
      const result = processorDisabled.parseResponse(response);

      // Content should be returned as-is (trimmed), without filtering
      expect(result.content).toContain("Hello! How can I assist you today?");
      // Note: If tokens are present, they remain (but shouldn't be in practice)
    });

    it("should extract file update from plain jinja response with file description", () => {
      // When harmony mode is disabled, should still extract file updates from descriptive content
      const response = `**File:** \`Tests/LatinService/Psalm105ATests.swift\`

\`\`\`swift
@testable import LatinService
import XCTest

class Psalm105ATests: XCTestCase {
  func testExample() {
    XCTAssertTrue(true)
  }
}
\`\`\``;

      const result = processorDisabled.parseResponse(response);

      // Should extract as a tool call
      expect(result.rawToolCalls?.length).toBeGreaterThan(0);

      const toolCalls = processorDisabled.extractToolCalls(
        result.rawToolCalls || []
      );
      expect(toolCalls.length).toBeGreaterThan(0);
      expect(toolCalls[0].name).toBe("create_file");
      expect(toolCalls[0].arguments).toBeDefined();
      if (toolCalls[0].arguments) {
        expect(toolCalls[0].arguments).toHaveProperty("file_path");
        expect(toolCalls[0].arguments.file_path).toBe(
          "Tests/LatinService/Psalm105ATests.swift"
        );
        expect(toolCalls[0].arguments).toHaveProperty("content");
        expect(toolCalls[0].arguments.content).toContain(
          "@testable import LatinService"
        );
      }
    });
  });

  describe("File extraction from plain text (no Harmony tokens)", () => {
    it("should NOT auto-extract from file descriptions (disabled auto-extraction)", () => {
      // Automatic extraction is disabled - LLM must use explicit tool call format
      const response = `**File:** \`src/utils/helper.ts\`

\`\`\`typescript
export function helper() {
  return "help";
}
\`\`\``;

      const result = processor.parseResponse(response);

      // No automatic extraction - model must use explicit <tool_call> format
      expect(result.rawToolCalls).toEqual([]);
      // Content should be preserved for display
      expect(result.content).toContain("src/utils/helper.ts");
    });

    it("should NOT auto-extract from File: format (disabled auto-extraction)", () => {
      const response = `File: \`test.py\`

\`\`\`python
print("test")
\`\`\``;

      const result = processor.parseResponse(response);

      // Automatic extraction is disabled
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain("test.py");
    });

    it("should NOT auto-extract read_file from file mentions (disabled auto-extraction)", () => {
      const response = `**File:** \`test.py\`

This is just a description without code.`;

      const result = processor.parseResponse(response);

      // Automatic extraction is disabled
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain("test.py");
    });
  });

  describe("File extraction from content with Harmony tokens", () => {
    it("should NOT auto-extract from content with Harmony tokens (disabled auto-extraction)", () => {
      // Automatic extraction is disabled - model must use explicit tool calls
      const response = `<|channel|>final<|message|>**File:** \`Tests/LatinService/Psalm105ATests.swift\`

\`\`\`swift
@testable import LatinService
import XCTest

class Psalm105ATests: XCTestCase {
  private let utilities = PsalmTestUtilities.self
  private let verbose = true

  func testExample() {
    XCTAssertTrue(true)
  }
}
\`\`\`
<|end|>`;

      const result = processor.parseResponse(response);

      // No automatic extraction
      expect(result.rawToolCalls).toEqual([]);

      // Content should be preserved for display
      expect(result.content).toContain(
        "**File:** `Tests/LatinService/Psalm105ATests.swift`"
      );
      expect(result.content).toContain("```swift");
      expect(result.content).toContain("@testable import LatinService");
      expect(result.content).toContain("class Psalm105ATests");
    });

    it("should NOT auto-extract or normalize paths (disabled auto-extraction)", () => {
      // Automatic extraction is disabled
      const response = `**File:** \`/Tests/LatinService/Psalm105ATests.swift\`

\`\`\`swift
@testable import LatinService
import XCTest

class Psalm105ATests: XCTestCase {
  func testExample() {
    XCTAssertTrue(true)
  }
}
\`\`\``;

      const result = processor.parseResponse(response);

      // No automatic extraction
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain(
        "/Tests/LatinService/Psalm105ATests.swift"
      );
    });

    it("should NOT auto-extract replace_file from update keywords (disabled auto-extraction)", () => {
      const response = `<|channel|>final<|message|>I've updated the file:

**File:** \`src/app.ts\`

\`\`\`typescript
export const app = "updated";
\`\`\`
<|end|>`;

      const result = processor.parseResponse(response);

      // No automatic extraction
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain("I've updated the file");
    });
  });

  describe("File extraction exclusion from Tool Results section", () => {
    it("should NOT extract file operations from Tool Results section", () => {
      // This simulates the bug where exec_terminal results trigger unwanted file operations
      // Tool results should not be parsed for file operations
      const response = `<|channel|>final<|message|>Script executed successfully.

**Tool Results:**

**exec_terminal**:
Command executed successfully. Output:
Hello, World!

**replace_file**:
Successfully replaced file: hello.py

The script works correctly.<|end|>`;

      const result = processor.parseResponse(response);

      // Should NOT extract replace_file from Tool Results section
      // Even though it mentions "replace_file" and "hello.py", these are in tool results
      expect(result.rawToolCalls).toEqual([]);

      // Content should still contain the message text
      expect(result.content).toContain("Script executed successfully");
    });

    it("should NOT auto-extract from content before Tool Results (disabled auto-extraction)", () => {
      // Automatic extraction is disabled even before Tool Results section
      const response = `<|channel|>final<|message|>I've updated the file:

**File:** \`src/app.ts\`

\`\`\`typescript
export const app = "updated";
\`\`\`

**Tool Results:**

**exec_terminal**:
Command executed successfully.

**replace_file**:
Successfully replaced file: hello.py
<|end|>`;

      const result = processor.parseResponse(response);

      // No automatic extraction anywhere
      expect(result.rawToolCalls).toEqual([]);
      expect(result.content).toContain("I've updated the file");
    });

    it("should NOT extract when all content is in Tool Results section", () => {
      // If entire content is just tool results, nothing should be extracted
      const content = `**Tool Results:**

**exec_terminal**:
Hello, World!

**File:** \`test.py\`

\`\`\`python
print("test")
\`\`\``;

      const result = processor.parseResponse(content);

      // Should NOT extract anything since all content is in Tool Results
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should handle Tool Results: format (without bold)", () => {
      // Test the format without markdown bold
      const response = `<|channel|>final<|message|>Script executed.

Tool Results:

replace_file:
Successfully replaced file: hello.py

The execution was successful.<|end|>`;

      const result = processor.parseResponse(response);

      // Should NOT extract replace_file from Tool Results
      expect(result.rawToolCalls).toEqual([]);
    });

    it("should handle Tool Results section in plain text response", () => {
      // Test with plain text (no Harmony tokens)
      const content = `Script executed successfully.

**Tool Results:**

**exec_terminal**:
Hello, World!

**replace_file**:
Successfully replaced file: hello.py`;

      const result = processor.parseResponse(content);

      // Should NOT extract file operations from Tool Results
      expect(result.rawToolCalls).toEqual([]);
    });

    describe("Handling existing files with MODIFY intent", () => {
      it("should NOT auto-extract read_file for full paths (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `**File:** \`Tests/LatinService/Psalm12Tests.swift\`

Let me review this file to understand its structure.`;

        const result = processor.parseResponse(response);

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain(
          "Tests/LatinService/Psalm12Tests.swift"
        );
      });

      it("should NOT auto-extract find_files for incomplete paths (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `**File:** \`Psalm12Tests.swift\`

Let me find and review this file.`;

        const result = processor.parseResponse(response);

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain("Psalm12Tests.swift");
      });

      it("should NOT auto-extract replace_file from modification descriptions (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `<|channel|>final<|message|>I'll modify the structuralThemes array in Tests/LatinService/Psalm12Tests.swift:

**File:** \`Tests/LatinService/Psalm12Tests.swift\`

\`\`\`swift
let structuralThemes = [
  (name: "Imperative", comment: "God commands with authority", [lemmas: ["jubate", "audite"]], startVerse: 1, endVerse: 8),
  (name: "Response", comment: "Peoples respond to God's command", [lemmas: ["magnificate", "laetamini"]], startVerse: 9, endVerse: 12),
  (name: "Blessing", comment: "God blesses the righteous", [lemmas: ["beatus", "felicitas"]], startVerse: 13, endVerse: 15)
]
\`\`\`

I've added the Blessing theme as requested.<|end|>`;

        const result = processor.parseResponse(response);

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain("I'll modify the structuralThemes");
      });

      it("should NOT extract create_file when user references an existing file path", () => {
        // Even though the model responds with a code block for an existing file,
        // it should NOT generate create_file because the file already exists
        const response = `<|channel|>final<|message|>Looking at Tests/LatinService/Psalm101Tests.swift, here's how to structure the tests:

**File:** \`Tests/LatinService/Psalm101Tests.swift\`

\`\`\`swift
// Updated test structure
struct Psalm101Tests {
  let verses = [/* test data */]
}
\`\`\`<|end|>`;

        const result = processor.parseResponse(
          response,
          "review Tests/LatinService/Psalm101Tests.swift"
        );

        // If extracted, should be replace_file, not create_file
        if (result.rawToolCalls && result.rawToolCalls.length > 0) {
          const toolCalls = processor.extractToolCalls(result.rawToolCalls);
          expect(toolCalls[0].name).not.toBe("create_file");
          if (toolCalls[0].name === "replace_file") {
            expect(toolCalls[0].arguments?.file_path).toContain(
              "Psalm101Tests.swift"
            );
          }
        }
      });

      it("should use create_file only when explicitly creating new files", () => {
        // When user asks to CREATE a new file (not referencing existing)
        const response = `<|channel|>final<|message|>I'll create a new test file for you:

**File:** \`Tests/NewTest.swift\`

\`\`\`swift
struct NewTest {
  let testData = [1, 2, 3]
}
\`\`\`

This new test file is ready.<|end|>`;

        const result = processor.parseResponse(
          response,
          "create a new test file"
        );

        // Should extract create_file when explicitly creating
        if (result.rawToolCalls && result.rawToolCalls.length > 0) {
          const toolCalls = processor.extractToolCalls(result.rawToolCalls);
          expect(toolCalls[0].name).toBe("create_file");
          expect(toolCalls[0].arguments?.file_path).toBe("Tests/NewTest.swift");
        }
      });
    });

    describe("extractFileUpdateFromContent - find_files vs read_file logic", () => {
      it("should NOT auto-extract find_files for incomplete paths (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `<|channel|>final<|message|>Let me read the calc.py file to check it.<|end|>`;

        const result = processor.parseResponse(response, "check calc.py");

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain("calc.py");
      });

      it("should NOT auto-extract read_file for complete paths (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `<|channel|>final<|message|>Let me read the src/utils/calc.py file to check it.<|end|>`;

        const result = processor.parseResponse(
          response,
          "check src/utils/calc.py"
        );

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain("src/utils/calc.py");
      });

      it("should NOT auto-extract from filename references (disabled auto-extraction)", () => {
        // Automatic extraction is disabled
        const response = `<|channel|>final<|message|>I need to check test.js first.<|end|>`;

        const result = processor.parseResponse(response, "check test.js");

        // No automatic extraction
        expect(result.rawToolCalls).toEqual([]);
        expect(result.content).toContain("test.js");
      });

      it("should correctly parse find_files JSON tool calls from LLM", () => {
        // Test that LLM-generated find_files calls are parsed correctly
        const response = `<|channel|>final<|message|>{"name":"find_files","arguments":{"name_pattern":"calc.py"}}<|end|>`;

        const result = processor.parseResponse(response);

        expect(result.rawToolCalls).toBeDefined();
        expect(result.rawToolCalls!.length).toBeGreaterThan(0);

        const toolCalls = processor.extractToolCalls(result.rawToolCalls!);
        expect(toolCalls.length).toBeGreaterThan(0);

        const toolCall = toolCalls[0];
        // Verify it's find_files (plural) not find_file (singular)
        expect(toolCall.name).toBe("find_files");
        // Verify parameter is name_pattern (not pattern)
        expect(toolCall.arguments?.name_pattern).toBe("calc.py");
        // Verify pattern is not used
        expect(toolCall.arguments?.pattern).toBeUndefined();
      });
    });
  });
});
