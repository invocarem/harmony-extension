import { XmlProcessor } from "../utils/xmlProcessor";

describe("XmlProcessor - Multi-line JSON in attributes", () => {
  it("should parse tool call with multi-line JSON containing newlines and docstrings", () => {
    // This reproduces the real-world case from the logs where the parser failed
    const text = `<tool_call name="edit_file" args='{"file_path": "hello.py", "old_text": "def greet(name: str) -> None:\\n    \\"\\"\\"Print a greeting for *name*.\\n\\n    Args:\\n        name: The name to greet.\\n    \\"\\"\\"\\n    print(f\\"Hello, !\\")", "new_text": "def greet(name: str) -> None:\\n    \\"\\"\\"Print a greeting for *name*.\\n\\n    Args:\\n        name: The name to greet.\\n    \\"\\"\\"\\n    print(f\\"Hello, {name}!\\")"}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("edit_file");
    expect(result[0].args.file_path).toBe("hello.py");
    expect(result[0].args.old_text).toContain("def greet(name: str) -> None:");
    expect(result[0].args.old_text).toContain('"""Print a greeting for *name*.');
    expect(result[0].args.old_text).toContain('print(f"Hello, !")');
    expect(result[0].args.new_text).toContain('print(f"Hello, {name}!")');
  });

  it("should parse tool call with create_file containing multi-line content", () => {
    const text = `<tool_call name="create_file" args='{"file_path": "step_2_log.txt", "content": "Status: __completed__\\nTimestamp: 2023-11-24T12:34:56Z\\n__edited__: hello.py\\n\\nAdded argparse-based CLI parsing with default name \\"World\\" and call to greet(args.name).\\n"}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("step_2_log.txt");
    expect(result[0].args.content).toContain("Status: __completed__");
    expect(result[0].args.content).toContain("Timestamp: 2023-11-24T12:34:56Z");
    expect(result[0].args.content).toContain("__edited__: hello.py");
  });

  it("should parse tool call with complex nested JSON and newlines", () => {
    const jsonContent = JSON.stringify({
      file_path: "test.py",
      old_text: 'def foo():\n    """Docstring\n    with multiple lines\n    """\n    pass',
      new_text: 'def foo():\n    """Updated docstring\n    with multiple lines\n    """\n    return True'
    });
    
    const text = `<tool_call name="edit_file" args='${jsonContent}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("edit_file");
    expect(result[0].args.file_path).toBe("test.py");
    expect(result[0].args.old_text).toContain('"""Docstring');
    expect(result[0].args.old_text).toContain('with multiple lines');
    expect(result[0].args.new_text).toContain('return True');
  });

  it("should parse tool call with single-quoted attribute and double-quoted JSON strings", () => {
    // Single quotes for XML attribute, double quotes for JSON strings
    const text = `<tool_call name="test" args='{"key": "value with \\"nested\\" quotes", "multiline": "line1\\nline2\\nline3"}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test");
    expect(result[0].args.key).toBe('value with "nested" quotes');
    expect(result[0].args.multiline).toBe("line1\nline2\nline3");
  });

  it("should parse tool call with very long multi-line content", () => {
    const longContent = Array(50).fill('def function():\n    """Docstring"""\n    pass\n').join('');
    const jsonContent = JSON.stringify({
      file_path: "large_file.py",
      content: longContent
    });
    
    const text = `<tool_call name="create_file" args='${jsonContent}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("large_file.py");
    expect(result[0].args.content).toBe(longContent);
    expect(result[0].args.content.length).toBeGreaterThan(1000);
  });

  it("should parse the exact failing case from production logs", () => {
    // This is the exact case that was failing in production
    const text = `<tool_call name="edit_file" args='{"file_path": "hello.py", "old_text": "def greet(name):\\n    \\"\\"\\"Print a greeting for the given name.\\n\\n    Args:\\n        name (str): The name to greet.\\n    \\"\\"\\"\\n    print(f\\"Hello, !\\")", "new_text": "def greet(name):\\n    \\"\\"\\"Print a greeting for the given name.\\n\\n    Args:\\n        name (str): The name to greet.\\n    \\"\\"\\"\\n    print(f\\"Hello, {name}!\\")\\n\\n\\nif __name__ == \\"__main__\\":\\n    import sys\\n    # Use the first command-line argument if provided, otherwise default to \\"World\\"\\n    name = sys.argv[1] if len(sys.argv) > 1 else \\"World\\"\\n    greet(name)"}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("edit_file");
    expect(result[0].args.file_path).toBe("hello.py");
    expect(result[0].args.old_text).toContain('def greet(name):');
    expect(result[0].args.old_text).toContain('"""Print a greeting for the given name.');
    expect(result[0].args.old_text).toContain('print(f"Hello, !")');
    expect(result[0].args.new_text).toContain('print(f"Hello, {name}!")');
    expect(result[0].args.new_text).toContain('if __name__ == "__main__":');
    expect(result[0].args.new_text).toContain('import sys');
  });

  it("should handle JSON with literal single quotes in content when XML uses single quotes", () => {
    // JSON doesn't escape single quotes, so they appear literally in JSON strings
    // This can confuse the parser when XML uses args='...'
    const text = `<tool_call name="edit_file" args='{"file_path": "test.py", "content": "print(\\"Don't worry\\")"}' />`;

    const result = XmlProcessor.extractToolCalls(text);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("edit_file");
    expect(result[0].args.file_path).toBe("test.py");
    expect(result[0].args.content).toBe('print("Don\'t worry")');
  });
});
