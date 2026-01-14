import {
  NativeToolsManager,
  NativeTool,
  NativeToolResult,
} from "../nativeToolManager";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
jest.useFakeTimers();
// Mock vscode
jest.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: "/workspace",
        },
      },
    ],
  },
  window: {
    activeTextEditor: undefined,
  },
}));

// Mock fs - provide both callback and promises versions
jest.mock("fs", () => {
  // Create promise-based mocks
  const mockPromisesReadFile = jest.fn();
  const mockPromisesWriteFile = jest.fn();
  const mockPromisesMkdir = jest.fn();
  const mockPromisesStat = jest.fn();
  const mockPromisesReaddir = jest.fn();

  // Create callback versions that promisify will map to promises
  const mockReadFile = jest.fn();
  const mockWriteFile = jest.fn();
  const mockMkdir = jest.fn();
  const mockStat = jest.fn();
  const mockReaddir = jest.fn();

  // Store mappings for promisify
  (mockReadFile as any)._promisesVersion = mockPromisesReadFile;
  (mockWriteFile as any)._promisesVersion = mockPromisesWriteFile;
  (mockMkdir as any)._promisesVersion = mockPromisesMkdir;
  (mockStat as any)._promisesVersion = mockPromisesStat;
  (mockReaddir as any)._promisesVersion = mockPromisesReaddir;

  return {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    stat: mockStat,
    readdir: mockReaddir,
    promises: {
      readFile: mockPromisesReadFile,
      writeFile: mockPromisesWriteFile,
      mkdir: mockPromisesMkdir,
      stat: mockPromisesStat,
      readdir: mockPromisesReaddir,
    },
  };
});

// Create a shared mock for exec that will be used by promisify
const mockExecAsync = jest.fn();

// Mock child_process.exec - define mock inside factory to avoid hoisting issues
jest.mock("child_process", () => {
  const mockExec = jest.fn();
  (mockExec as any).__isMockExec = true;
  // Store reference globally so promisify mock can access it
  (global as any).__mockExec = mockExec;
  return {
    exec: mockExec,
  };
});

// Mock util.promisify - map fs callback functions to promises versions
// Also handle exec from child_process
jest.mock("util", () => {
  return {
    promisify: jest.fn((fn: any) => {
      // If the function has a _promisesVersion property, return that
      if (fn && fn._promisesVersion) {
        return fn._promisesVersion;
      }
      // Check if it's our mock exec function
      const mockExec = (global as any).__mockExec;
      if (fn && fn === mockExec) {
        return mockExecAsync;
      }
      // Otherwise return as-is
      return fn;
    }),
  };
});

describe("NativeToolsManager", () => {
  let manager: NativeToolsManager;
  const mockVscode = vscode as jest.Mocked<typeof vscode>;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const workspaceRoot = "/workspace";

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset workspace folders
    (mockVscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: workspaceRoot,
        },
      },
    ];

    // Reset active editor
    (mockVscode.window as any).activeTextEditor = undefined;

    manager = new NativeToolsManager();
  });

  describe("getAvailableTools", () => {
    it("should return all available tools", () => {
      const tools = manager.getAvailableTools();

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("create_file");
      expect(toolNames).toContain("replace_file");
      expect(toolNames).toContain("list_files");
      expect(toolNames).toContain("find_files");
      expect(toolNames).toContain("grep_files");
      expect(toolNames).toContain("exec_terminal");
    });

    it("should have correct schema for find_files tool", () => {
      const tools = manager.getAvailableTools();
      const findFilesTool = tools.find((t) => t.name === "find_files");

      expect(findFilesTool).toBeDefined();
      expect(findFilesTool?.description).toContain(
        "Find files by name pattern"
      );
      expect(findFilesTool?.inputSchema.properties.name_pattern).toBeDefined();
      expect(findFilesTool?.inputSchema.required).toContain("name_pattern");
      expect(
        findFilesTool?.inputSchema.properties.case_sensitive
      ).toBeDefined();
      expect(findFilesTool?.inputSchema.properties.use_regex).toBeDefined();
    });

    it("should have correct schema for grep_files tool", () => {
      const tools = manager.getAvailableTools();
      const grepTool = tools.find((t) => t.name === "grep_files");

      expect(grepTool).toBeDefined();
      expect(grepTool?.description).toContain("Search for a text pattern");
      expect(grepTool?.inputSchema.properties.pattern).toBeDefined();
      expect(grepTool?.inputSchema.required).toContain("pattern");
      expect(grepTool?.inputSchema.properties.file_pattern).toBeDefined();
      expect(grepTool?.inputSchema.properties.case_sensitive).toBeDefined();
    });

    it("should have correct schema for read_file tool", () => {
      const tools = manager.getAvailableTools();
      const readFileTool = tools.find((t) => t.name === "read_file");

      expect(readFileTool).toBeDefined();
      expect(readFileTool?.description).toContain(
        "Read the contents of a file"
      );
      expect(readFileTool?.inputSchema.properties.file_path).toBeDefined();
      expect(readFileTool?.inputSchema.required).toContain("file_path");
    });

    it("should have correct schema for create_file tool", () => {
      const tools = manager.getAvailableTools();
      const createFileTool = tools.find((t) => t.name === "create_file");

      expect(createFileTool).toBeDefined();
      expect(createFileTool?.description).toContain("Create a new file");
      expect(createFileTool?.inputSchema.properties.file_path).toBeDefined();
      expect(createFileTool?.inputSchema.properties.content).toBeDefined();
      expect(createFileTool?.inputSchema.required).toContain("file_path");
      expect(createFileTool?.inputSchema.required).toContain("content");
    });

    it("should have correct schema for list_files tool", () => {
      const tools = manager.getAvailableTools();
      const listFilesTool = tools.find((t) => t.name === "list_files");

      expect(listFilesTool).toBeDefined();
      expect(listFilesTool?.description).toContain(
        "List files and directories"
      );
      expect(
        listFilesTool?.inputSchema.properties.directory_path
      ).toBeDefined();
      expect(listFilesTool?.inputSchema.properties.recursive).toBeDefined();
      expect(
        listFilesTool?.inputSchema.properties.include_hidden
      ).toBeDefined();
    });

    it("should have correct schema for exec_terminal tool", () => {
      const tools = manager.getAvailableTools();
      const execTool = tools.find((t) => t.name === "exec_terminal");

      expect(execTool).toBeDefined();
      expect(execTool?.description).toContain("Execute a shell command");
      expect(execTool?.inputSchema.properties.command).toBeDefined();
      expect(execTool?.inputSchema.properties.working_directory).toBeDefined();
      expect(execTool?.inputSchema.required).toContain("command");
    });
  });

  describe("read_file", () => {
    it("should read file successfully", async () => {
      const filePath = "test.txt";
      const content = "Hello, world!";
      const resolvedPath = path.resolve(workspaceRoot, filePath);

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(content);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe(content);
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        resolvedPath,
        "utf-8"
      );
    });

    it("should handle absolute paths", async () => {
      const filePath = "/absolute/path/test.txt";
      const content = "Content";

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(content);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(content);
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(filePath, "utf-8");
    });

    it("should handle read errors", async () => {
      const filePath = "nonexistent.txt";
      const error = new Error("File not found");

      (mockFs.promises.readFile as jest.Mock).mockRejectedValue(error);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error reading file");
    });
  });

  describe("exec_terminal", () => {
    beforeEach(() => {
      // Reset the mock before each test
      mockExecAsync.mockClear();
    });

    it("should execute command successfully", async () => {
      const command = 'echo "Hello World"';
      const stdout = "Hello World\n";
      const stderr = "";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe("Hello World");
      expect(mockExecAsync).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          cwd: workspaceRoot,
          maxBuffer: 1024 * 1024 * 10,
          timeout: 30000,
        })
      );
    });

    it("should handle command with output and stderr", async () => {
      const command = "python script.py";
      const stdout = "Output line 1\nOutput line 2";
      const stderr = "Warning: something";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Output line 1");
      expect(result.content[0].text).toContain("STDERR:");
      expect(result.content[0].text).toContain("Warning: something");
    });

    it("should handle command chaining with &&", async () => {
      const command = "cd /path/to/folder && python calc.py";
      const stdout = "Calculation result: 42\n";
      const stderr = "";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Calculation result: 42");
      expect(mockExecAsync).toHaveBeenCalledWith(command, expect.any(Object));
    });

    it("should use specified working directory", async () => {
      const command = "python calc.py";
      const workingDirectory = "/custom/path";
      const stdout = "Result\n";
      const stderr = "";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
        working_directory: workingDirectory,
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          cwd: workingDirectory,
        })
      );
    });

    it("should handle command errors (non-zero exit code)", async () => {
      const command = "python nonexistent.py";
      const stdout = "";
      const stderr = "python: can't open file 'nonexistent.py'";
      const error: any = new Error("Command failed");
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = 1;

      mockExecAsync.mockRejectedValue(error);

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("can't open file");
    });

    it("should handle command timeout", async () => {
      const command = "sleep 60";
      const error: any = new Error("Command timeout after 30000ms");
      error.code = "ETIMEDOUT";

      mockExecAsync.mockRejectedValue(error);

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("timed out");
      expect(result.content[0].text).toContain("30000ms");
    });

    it("should handle command with no output", async () => {
      const command = "touch file.txt";
      const stdout = "";
      const stderr = "";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(
        "Command executed successfully (no output)"
      );
    });

    it("should handle relative working directory", async () => {
      const command = "ls";
      const workingDirectory = "./src";
      const resolvedPath = path.resolve(workspaceRoot, workingDirectory);
      const stdout = "file1.ts\nfile2.ts\n";
      const stderr = "";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
        working_directory: workingDirectory,
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          cwd: resolvedPath,
        })
      );
    });

    it("should handle execution errors gracefully", async () => {
      const command = "invalid-command-that-does-not-exist";
      const error: any = new Error(
        "spawn invalid-command-that-does-not-exist ENOENT"
      );
      error.stdout = "";
      error.stderr = "";
      error.code = undefined; // No exit code, so it will use error.message

      mockExecAsync.mockRejectedValue(error);

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      expect(result.isError).toBe(true);
      // When error.code is undefined and no stdout, hasError = true, and output is error.message
      expect(result.content[0].text).toContain("ENOENT");
    });

    it("should handle stderr-only output", async () => {
      const command =
        "python -c \"import sys; sys.stderr.write('Warning message')\"";
      const stdout = "";
      const stderr = "Warning message";

      mockExecAsync.mockResolvedValue({ stdout, stderr });

      const result = await manager.callTool("exec_terminal", {
        command,
      });

      // When command succeeds (exit code 0), hasError is false even with stderr-only output
      // This is correct behavior - some commands write warnings to stderr but succeed
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe("Warning message");
    });
  });

  describe("constructor", () => {
    it("should initialize with workspace root from vscode", () => {
      const manager = new NativeToolsManager();
      expect(manager).toBeDefined();
    });

    it("should handle missing workspace folders", () => {
      (mockVscode.workspace as any).workspaceFolders = undefined;
      const manager = new NativeToolsManager();
      expect(manager).toBeDefined();
    });
  });
});
