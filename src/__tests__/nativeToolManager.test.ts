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
      expect(toolNames).toContain("edit_file");
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

    it("should have correct schema for edit_file tool", () => {
      const tools = manager.getAvailableTools();
      const editFileTool = tools.find((t) => t.name === "edit_file");

      expect(editFileTool).toBeDefined();
      expect(editFileTool?.description).toContain(
        "Edit a specific part of a file"
      );
      expect(editFileTool?.inputSchema.properties.file_path).toBeDefined();
      expect(editFileTool?.inputSchema.properties.old_text).toBeDefined();
      expect(editFileTool?.inputSchema.properties.new_text).toBeDefined();
      expect(editFileTool?.inputSchema.required).toContain("file_path");
      expect(editFileTool?.inputSchema.required).toContain("old_text");
      expect(editFileTool?.inputSchema.required).toContain("new_text");
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
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
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

  describe("path resolution with missing workspace root", () => {
    it("should dynamically resolve workspace root when not set in constructor", async () => {
      // Create manager without workspace folders initially
      (mockVscode.workspace as any).workspaceFolders = undefined;
      const manager = new NativeToolsManager();

      // Now set workspace folders (simulating workspace being opened later)
      (mockVscode.workspace as any).workspaceFolders = [
        {
          uri: {
            fsPath: workspaceRoot,
          },
        },
      ];

      // Set up active editor to simulate a file in the workspace
      (mockVscode.window as any).activeTextEditor = {
        document: {
          fileName: path.join(workspaceRoot, "src", "test.ts"),
          isUntitled: false,
        },
      };

      const filePath = "test.txt";
      const content = "Test content";
      const resolvedPath = path.resolve(workspaceRoot, filePath);

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(content);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      // Should resolve relative to workspace root, not process.cwd()
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(content);
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        resolvedPath,
        "utf-8"
      );
    });

    it("should use active editor directory as fallback when workspace root is missing", async () => {
      // Create manager without workspace folders
      (mockVscode.workspace as any).workspaceFolders = undefined;
      const manager = new NativeToolsManager();

      // Set up active editor with a file path
      const editorDir = "/some/editor/directory";
      const editorFile = path.join(editorDir, "file.ts");
      (mockVscode.window as any).activeTextEditor = {
        document: {
          fileName: editorFile,
          isUntitled: false,
        },
      };

      const filePath = "test.txt";
      const content = "Test content";
      const resolvedPath = path.resolve(editorDir, filePath);

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(content);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      // Should resolve relative to editor's directory, not process.cwd()
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(content);
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        resolvedPath,
        "utf-8"
      );
    });

    it("should not resolve to process.cwd() when workspace root becomes available", async () => {
      // Simulate scenario where workspace root is not available at construction
      (mockVscode.workspace as any).workspaceFolders = undefined;
      const manager = new NativeToolsManager();

      // Mock process.cwd() to return a user roaming folder path
      const originalCwd = process.cwd;
      const roamingFolder = "C:\\Users\\TestUser\\AppData\\Roaming";
      (process as any).cwd = jest.fn(() => roamingFolder);

      // Now workspace root becomes available
      (mockVscode.workspace as any).workspaceFolders = [
        {
          uri: {
            fsPath: workspaceRoot,
          },
        },
      ];

      const filePath = "config.json";
      const content = "{}";
      const resolvedPath = path.resolve(workspaceRoot, filePath);

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(content);

      const result = await manager.callTool("read_file", {
        file_path: filePath,
      });

      // Should resolve to workspace root, NOT the roaming folder
      expect(result.isError).toBeUndefined();
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        resolvedPath,
        "utf-8"
      );
      // Verify it's NOT the roaming folder
      expect(mockFs.promises.readFile).not.toHaveBeenCalledWith(
        path.resolve(roamingFolder, filePath),
        "utf-8"
      );

      // Restore original cwd
      (process as any).cwd = originalCwd;
    });
  });

  describe("enhanceCommandWithVenv", () => {
    it("should detect Python commands (python)", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      // Command should have been enhanced but no venv found
      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should detect Python commands (python3)", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "python3 --version",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should detect Python commands (specific version)", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "python3.11 -m pip list",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should detect .py file extensions", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "./script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should detect pipenv commands", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "pipenv install",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should detect poetry commands", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "poetry install",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();
    });

    it("should skip non-Python commands", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "npm install",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      // Should execute npm command as-is
      expect(mockExecAsync).toHaveBeenCalled();
      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe("npm install");
    });

    it("should find and use venv on Unix", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: venv exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });
      // Mock: bin/activate exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // Check that venv activation is present (Unix: source, Windows: direct call)
      expect(command).toMatch(/(source.*activate|activate.*&&)/);
      expect(command).toContain("venv");
      expect(command).toContain("activate");
      expect(command).toContain("python script.py");
    });

    it("should find and use .venv on Unix", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: venv does not exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: .venv exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });
      // Mock: bin/activate exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // Check that venv activation is present (Unix: source, Windows: direct call)
      expect(command).toMatch(/(source.*activate|activate.*&&)/);
      expect(command).toContain(".venv");
      expect(command).toContain("activate");
      expect(command).toContain("python script.py");
    });

    it("should find and use venv on Windows", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: venv exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });
      // Mock: bin/activate does not exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: Scripts/activate exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // On Windows, should call activate script directly
      expect(command).toContain("Scripts");
      expect(command).toContain("activate");
      expect(command).toContain("python script.py");
    });

    it("should try multiple venv paths in order", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: venv does not exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: .venv does not exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: env exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });
      // Mock: bin/activate exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // Check that env venv activation is present
      expect(command).toMatch(/(source.*activate|activate.*&&)/);
      expect(command).toMatch(/[/\\]env[/\\]/);
      expect(command).toContain("activate");
      expect(command).toContain("python script.py");
    });

    it("should fall back to system Python when no venv found", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: all venv paths do not exist
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // Should be the original command without venv activation
      expect(command).toBe("python script.py");
    });

    it("should handle invalid venv directory (not a directory)", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: venv path exists but is not a directory
      mockStat.mockResolvedValueOnce({ isDirectory: () => false });
      // Mock: .venv exists and is a directory
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });
      // Mock: bin/activate exists
      mockStat.mockResolvedValueOnce({ isDirectory: () => true });

      const result = await manager.callTool("exec_terminal", {
        command: "python script.py",
        working_directory: "/workspace",
      });

      expect(result.isError).toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalled();

      const callArgs = (mockExecAsync as jest.Mock).mock.calls[0];
      const command = callArgs[0];
      // Should skip invalid venv and find .venv
      expect(command).toMatch(/(source.*activate|activate.*&&)/);
      expect(command).toContain(".venv");
      expect(command).toContain("activate");
    });
  });

  describe("create_file with directory creation", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should create parent directories if they don't exist", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      const mockMkdir = mockFs.promises.mkdir as jest.Mock;
      const mockWriteFile = mockFs.promises.writeFile as jest.Mock;

      // Mock: file doesn't exist (stat throws)
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: mkdir succeeds
      mockMkdir.mockResolvedValueOnce(undefined);
      // Mock: writeFile succeeds
      mockWriteFile.mockResolvedValueOnce(undefined);

      const manager = new NativeToolsManager();
      const result = await manager.callTool("create_file", {
        file_path: "src/__tests__/nested/deep/test.ts",
        content: "test content",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully created file");
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringMatching(/src[/\\]__tests__[/\\]nested[/\\]deep/),
        { recursive: true }
      );
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should handle existing parent directories gracefully", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      const mockMkdir = mockFs.promises.mkdir as jest.Mock;
      const mockWriteFile = mockFs.promises.writeFile as jest.Mock;

      // Mock: file doesn't exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: mkdir rejects with EEXIST (directory already exists)
      mockMkdir.mockRejectedValueOnce({
        code: "EEXIST",
        message: "Directory already exists",
      });
      // Mock: writeFile succeeds
      mockWriteFile.mockResolvedValueOnce(undefined);

      const manager = new NativeToolsManager();
      const result = await manager.callTool("create_file", {
        file_path: "src/__tests__/nested/test.ts",
        content: "test content",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully created file");
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should fail if mkdir fails with non-EEXIST error", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      const mockMkdir = mockFs.promises.mkdir as jest.Mock;

      // Mock: file doesn't exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: mkdir fails with permission error
      mockMkdir.mockRejectedValueOnce(new Error("EACCES: permission denied"));

      const manager = new NativeToolsManager();
      const result = await manager.callTool("create_file", {
        file_path: "src/__tests__/nested/test.ts",
        content: "test content",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating file");
    });

    it("should fail if file already exists", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;

      // Mock: file already exists
      mockStat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
      });

      const manager = new NativeToolsManager();
      const result = await manager.callTool("create_file", {
        file_path: "src/__tests__/existing.ts",
        content: "test content",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already exists");
      expect(result.content[0].text).toContain("replace_file");
    });

    it("should create deeply nested directories in one call", async () => {
      const mockStat = mockFs.promises.stat as jest.Mock;
      const mockMkdir = mockFs.promises.mkdir as jest.Mock;
      const mockWriteFile = mockFs.promises.writeFile as jest.Mock;

      // Mock: file doesn't exist
      mockStat.mockRejectedValueOnce(new Error("ENOENT"));
      // Mock: mkdir succeeds (recursive: true handles all levels)
      mockMkdir.mockResolvedValueOnce(undefined);
      // Mock: writeFile succeeds
      mockWriteFile.mockResolvedValueOnce(undefined);

      const manager = new NativeToolsManager();
      const result = await manager.callTool("create_file", {
        file_path:
          "src/__tests__/level1/level2/level3/level4/deeply/nested/test.ts",
        content: "test content",
      });

      expect(result.isError).toBeUndefined();
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringMatching(
          /level1[/\\]level2[/\\]level3[/\\]level4[/\\]deeply[/\\]nested/
        ),
        { recursive: true }
      );
    });
  });

  describe("edit_file", () => {
    it("should edit a file by replacing exact text match", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `function hello() {
  console.log("Hello");
}

function goodbye() {
  console.log("Goodbye");
}`;
      const oldText = `function hello() {
  console.log("Hello");
}`;
      const newText = `function hello(name) {
  console.log("Hello, " + name);
}`;
      const expectedContent = `function hello(name) {
  console.log("Hello, " + name);
}

function goodbye() {
  console.log("Goodbye");
}`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain("Successfully edited");
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(
        resolvedPath,
        "utf-8"
      );
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        resolvedPath,
        expectedContent,
        "utf-8"
      );
    });

    it("should handle edits with surrounding context", async () => {
      const filePath = "example.py";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `import os
import sys

def main():
    print("Running")
    x = 5
    print(x)

if __name__ == "__main__":
    main()`;
      const oldText = `def main():
    print("Running")
    x = 5
    print(x)`;
      const newText = `def main():
    print("Running")
    x = 10
    y = 20
    print(x + y)`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
    });

    it("should error when old_text is not found", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `function hello() {
  console.log("Hello");
}`;
      const oldText = `function goodbye() {
  console.log("Goodbye");
}`;
      const newText = `function goodbye(name) {
  console.log("Goodbye, " + name);
}`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Could not find");
      expect(result.content[0].text).toContain("must match exactly");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("should error when old_text matches multiple times", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `function hello() {
  console.log("Hello");
}

function hello() {
  console.log("Hello");
}`;
      const oldText = `function hello() {
  console.log("Hello");
}`;
      const newText = `function hello(name) {
  console.log("Hello, " + name);
}`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Found 2 matches");
      expect(result.content[0].text).toContain(
        "include more surrounding context"
      );
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("should handle file read errors", async () => {
      const filePath = "nonexistent.js";
      const error = new Error("ENOENT: no such file or directory");

      (mockFs.promises.readFile as jest.Mock).mockRejectedValue(error);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: "something",
        new_text: "something else",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error editing file");
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("should handle file write errors", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `console.log("test");`;
      const oldText = `console.log("test");`;
      const newText = `console.log("updated");`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockRejectedValue(
        new Error("Permission denied")
      );

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error editing file");
      expect(result.content[0].text).toContain("Permission denied");
    });

    it("should work with absolute file paths", async () => {
      const filePath = "/absolute/path/test.js";
      const originalContent = `const x = 1;`;
      const oldText = `const x = 1;`;
      const newText = `const x = 2;`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
      expect(mockFs.promises.readFile).toHaveBeenCalledWith(filePath, "utf-8");
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        filePath,
        newText,
        "utf-8"
      );
    });

    it("should handle edits with special regex characters", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `const regex = /test.*pattern/;`;
      const oldText = `const regex = /test.*pattern/;`;
      const newText = `const regex = /test[0-9]+pattern/;`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
    });

    it("should preserve whitespace and indentation", async () => {
      const filePath = "test.py";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `class MyClass:
    def __init__(self):
        self.value = 5
        
    def get_value(self):
        return self.value`;
      const oldText = `    def get_value(self):
        return self.value`;
      const newText = `    def get_value(self):
        # Return the stored value
        return self.value`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
    });

    it("should handle empty string replacement", async () => {
      const filePath = "test.js";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `console.log("debug");
console.log("Hello");`;
      const oldText = `console.log("debug");
`;
      const newText = ``;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        resolvedPath,
        `console.log("Hello");`,
        "utf-8"
      );
    });

    it("should handle multiline edits with different line counts", async () => {
      const filePath = "config.json";
      const resolvedPath = path.resolve(workspaceRoot, filePath);
      const originalContent = `{
  "name": "test",
  "version": "1.0.0"
}`;
      const oldText = `  "version": "1.0.0"`;
      const newText = `  "version": "2.0.0",
  "description": "Updated version",
  "author": "Test Author"`;

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        originalContent
      );
      (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await manager.callTool("edit_file", {
        file_path: filePath,
        old_text: oldText,
        new_text: newText,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Successfully edited");
    });
  });
});
