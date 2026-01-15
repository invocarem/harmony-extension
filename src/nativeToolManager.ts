import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { promisify } from "util";
import { exec } from "child_process";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

export interface NativeTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface NativeToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

export class NativeToolsManager {
  private workspaceRoot: string | undefined;

  constructor() {
    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  getAvailableTools(): NativeTool[] {
    return [
      {
        name: "read_file",
        description:
          "Read the contents of a file. Returns the file content as text.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "Path to the file to read. Can be relative to workspace root or absolute.",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "create_file",
        description:
          "Create a new file with the specified content. Creates parent directories if they don't exist. If the file already exists, the system will automatically use replace_file instead. Use this when you want to create a new file or update an existing one.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "Path to the file to create. Can be relative to workspace root or absolute.",
            },
            content: {
              type: "string",
              description: "Content to write to the file.",
            },
          },
          required: ["file_path", "content"],
        },
      },
      {
        name: "replace_file",
        description:
          "Replace the entire contents of a file with new content. Creates the file if it doesn't exist. Use this when you explicitly want to overwrite an existing file. Note: create_file will automatically fall back to replace_file if the file exists, so you can use either tool for updating files.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "Path to the file to replace. Can be relative to workspace root or absolute.",
            },
            content: {
              type: "string",
              description: "New content to write to the file.",
            },
          },
          required: ["file_path", "content"],
        },
      },
      {
        name: "list_files",
        description:
          "List files and directories in a directory. Returns file names, types (file/directory), and sizes.",
        inputSchema: {
          type: "object",
          properties: {
            directory_path: {
              type: "string",
              description:
                "Path to the directory to list. Can be relative to workspace root or absolute. Defaults to workspace root if not provided.",
            },
            recursive: {
              type: "boolean",
              description:
                "Whether to list files recursively. Defaults to false.",
            },
            include_hidden: {
              type: "boolean",
              description:
                "Whether to include hidden files (starting with '.'). Defaults to false.",
            },
          },
          required: [],
        },
      },
      {
        name: "find_files",
        description:
          "Find files by name pattern. Searches for files whose name contains or matches the given pattern. Useful for finding files when you know part of the filename (e.g., 'Psalm105ATests'). Returns matching file paths.",
        inputSchema: {
          type: "object",
          properties: {
            name_pattern: {
              type: "string",
              description:
                "The name pattern to search for. Can be a partial filename (e.g., 'Psalm105ATests'), full filename, or regex pattern. The search matches if the pattern appears anywhere in the filename.",
            },
            directory_path: {
              type: "string",
              description:
                "Directory to search in. Can be relative to workspace root or absolute. If not provided, defaults to the current editor's directory (if a file is open) or workspace root.",
            },
            case_sensitive: {
              type: "boolean",
              description:
                "Whether the search should be case sensitive. Defaults to false.",
            },
            use_regex: {
              type: "boolean",
              description:
                "Whether to treat the name_pattern as a regular expression. Defaults to false (simple substring match).",
            },
          },
          required: ["name_pattern"],
        },
      },
      {
        name: "grep_files",
        description:
          "Search for a text pattern in file contents. Returns matching lines with file paths and line numbers. Use this to find text content within files.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The search pattern (regular expression).",
            },
            directory_path: {
              type: "string",
              description:
                "Directory to search in. Can be relative to workspace root or absolute. If not provided, defaults to the current editor's directory (if a file is open) or workspace root.",
            },
            file_pattern: {
              type: "string",
              description:
                "Optional glob pattern to filter files (e.g., '*.ts', '**/*.js'). Searches all files if not provided.",
            },
            case_sensitive: {
              type: "boolean",
              description:
                "Whether the search should be case sensitive. Defaults to false.",
            },
          },
          required: ["pattern"],
        },
      },
      {
        name: "exec_terminal",
        description:
          "Execute a shell command in the terminal. Use this to run scripts, execute programs, change directories, or run any command-line operations. Supports command chaining with && (e.g., 'cd /path/to/folder && python calc.py'). Returns the command output. The command runs in the workspace root directory by default, or in the specified working_directory.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The command to execute (e.g., 'cd /path/to/dir && python calc.py', 'python calc.py', 'npm install', etc.). Supports command chaining with &&, ;, and | operators.",
            },
            working_directory: {
              type: "string",
              description:
                "Optional working directory for the command. If not provided, uses workspace root or current file's directory.",
            },
          },
          required: ["command"],
        },
      },
    ];
  }

  async callTool(
    toolName: string,
    arguments_: Record<string, any>
  ): Promise<NativeToolResult> {
    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(arguments_.file_path);
        case "create_file":
          return await this.createFile(
            arguments_.file_path,
            arguments_.content
          );
        case "replace_file":
          return await this.replaceFile(
            arguments_.file_path,
            arguments_.content
          );
        case "list_files":
          return await this.listFiles(
            arguments_.directory_path,
            arguments_.recursive || false,
            arguments_.include_hidden || false
          );
        case "find_files":
          return await this.findFiles(
            arguments_.name_pattern,
            arguments_.directory_path,
            arguments_.case_sensitive || false,
            arguments_.use_regex || false
          );
        case "grep_files":
          return await this.grepFiles(
            arguments_.pattern,
            arguments_.directory_path,
            arguments_.file_pattern,
            arguments_.case_sensitive || false
          );
        case "exec_terminal":
          return await this.executeTerminalCommand(
            arguments_.command,
            arguments_.working_directory
          );
        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${toolName}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${toolName}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private resolvePath(
    filePath: string,
    useCurrentEditor: boolean = false
  ): string {
    // If absolute path, use as-is (treat /Tests as absolute)
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // Get workspace root - check dynamically if not set in constructor
    let workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        workspaceRoot = workspaceFolders[0].uri.fsPath;
        // Update instance variable for future calls
        this.workspaceRoot = workspaceRoot;
      }
    }

    // Handle "." as current directory - use current editor's directory if available
    if (filePath === "." || filePath === "./") {
      if (useCurrentEditor) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document && !editor.document.isUntitled) {
          return path.dirname(editor.document.fileName);
        }
      }
      // Fall back to workspace root or editor directory
      if (workspaceRoot) {
        return workspaceRoot;
      }
      // Try to use active editor's directory as fallback
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document && !editor.document.isUntitled) {
        return path.dirname(editor.document.fileName);
      }
      // Last resort: use process.cwd() but log a warning
      console.warn(
        `[NativeTools] No workspace root found, using process.cwd(): ${process.cwd()}`
      );
      return process.cwd();
    }

    // Otherwise, resolve relative to workspace root
    if (workspaceRoot) {
      return path.resolve(workspaceRoot, filePath);
    }

    // Try to use active editor's directory as fallback
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document && !editor.document.isUntitled) {
      const editorDir = path.dirname(editor.document.fileName);
      return path.resolve(editorDir, filePath);
    }

    // Last resort: use process.cwd() but log a warning
    console.warn(
      `[NativeTools] No workspace root found, resolving "${filePath}" relative to process.cwd(): ${process.cwd()}`
    );
    return path.resolve(filePath);
  }

  private resolveDirectoryPath(directoryPath?: string): string {
    if (!directoryPath) {
      // If no path specified, try to use current editor's directory as a smart default
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document && !editor.document.isUntitled) {
        return path.dirname(editor.document.fileName);
      }
      // Get workspace root - check dynamically if not set in constructor
      let workspaceRoot = this.workspaceRoot;
      if (!workspaceRoot) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          workspaceRoot = workspaceFolders[0].uri.fsPath;
          this.workspaceRoot = workspaceRoot;
        }
      }
      // Fall back to workspace root or process.cwd() with warning
      if (workspaceRoot) {
        return workspaceRoot;
      }
      console.warn(
        `[NativeTools] No workspace root found, using process.cwd(): ${process.cwd()}`
      );
      return process.cwd();
    }
    return this.resolvePath(directoryPath, true);
  }

  private async readFile(filePath: string): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      console.log(
        `[NativeTools] Reading file: "${filePath}" -> resolved to: "${resolvedPath}" (workspaceRoot: ${
          this.workspaceRoot || "undefined"
        })`
      );

      // Block binary files - they cannot be read as text
      const ext = path.extname(filePath).toLowerCase();
      const binaryExtensions = [
        ".docx",
        ".pdf",
        ".doc",
        ".xlsx",
        ".xls",
        ".ppt",
        ".pptx",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".bmp",
        ".tiff",
        ".ico",
        ".svg",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".bin",
      ];
      if (binaryExtensions.includes(ext)) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot read binary file "${filePath}". Binary files (${ext}) cannot be read as text.${
                ext === ".docx" || ext === ".pdf"
                  ? ' To convert DOCX/PDF files to markdown, use the conversion command: "convert ' +
                    filePath +
                    ' to markdown"'
                  : ""
              }`,
            },
          ],
          isError: true,
        };
      }

      const content = await readFile(resolvedPath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error: any) {
      const resolvedPath = this.resolvePath(filePath);
      console.error(
        `[NativeTools] Error reading file "${filePath}" (resolved to "${resolvedPath}"):`,
        error.message
      );
      return {
        content: [
          {
            type: "text",
            text: `Error reading file ${filePath}: ${error.message} (resolved path: ${resolvedPath})`,
          },
        ],
        isError: true,
      };
    }
  }

  private async createFile(
    filePath: string,
    content: string
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolvePath(filePath);

      // Check if file already exists
      try {
        await stat(resolvedPath);
        return {
          content: [
            {
              type: "text",
              text: `Error: File ${filePath} already exists. Use replace_file to overwrite it.`,
            },
          ],
          isError: true,
        };
      } catch {
        // File doesn't exist, which is what we want
      }

      // Create parent directories if they don't exist
      const dir = path.dirname(resolvedPath);
      try {
        await mkdir(dir, { recursive: true });
      } catch (error: any) {
        // Directory might already exist, which is fine
        if (error.code !== "EEXIST") {
          throw error;
        }
      }

      await writeFile(resolvedPath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Successfully created file: ${filePath}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating file ${filePath}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async replaceFile(
    filePath: string,
    content: string
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolvePath(filePath);

      // Create parent directories if they don't exist
      const dir = path.dirname(resolvedPath);
      try {
        await mkdir(dir, { recursive: true });
      } catch (error: any) {
        if (error.code !== "EEXIST") {
          throw error;
        }
      }

      await writeFile(resolvedPath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Successfully replaced file: ${filePath}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error replacing file ${filePath}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async listFiles(
    directoryPath?: string,
    recursive: boolean = false,
    includeHidden: boolean = false
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = directoryPath
        ? this.resolvePath(directoryPath, true)
        : this.resolveDirectoryPath();

      const stats = await stat(resolvedPath);
      if (!stats.isDirectory()) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${directoryPath || "path"} is not a directory`,
            },
          ],
          isError: true,
        };
      }

      const results: Array<{
        name: string;
        type: "file" | "directory";
        size?: number;
        path: string;
      }> = [];

      if (recursive) {
        await this.listFilesRecursive(
          resolvedPath,
          resolvedPath,
          results,
          includeHidden
        );
      } else {
        const entries = await readdir(resolvedPath);
        for (const entry of entries) {
          if (!includeHidden && entry.startsWith(".")) {
            continue;
          }
          const entryPath = path.join(resolvedPath, entry);
          const entryStats = await stat(entryPath);
          results.push({
            name: entry,
            type: entryStats.isDirectory() ? "directory" : "file",
            size: entryStats.isFile() ? entryStats.size : undefined,
            path: path.relative(resolvedPath, entryPath),
          });
        }
      }

      // Format results
      const formatted = results
        .map(
          (item) =>
            `${item.type === "directory" ? "📁" : "📄"} ${item.path}${
              item.size !== undefined ? ` (${this.formatSize(item.size)})` : ""
            }`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Files in ${
              directoryPath || "workspace root"
            }:\n\n${formatted}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing files: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async listFilesRecursive(
    rootPath: string,
    currentPath: string,
    results: Array<{
      name: string;
      type: "file" | "directory";
      size?: number;
      path: string;
    }>,
    includeHidden: boolean
  ): Promise<void> {
    const entries = await readdir(currentPath);
    for (const entry of entries) {
      if (!includeHidden && entry.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(currentPath, entry);
      const relativePath = path.relative(rootPath, entryPath);

      // Skip node_modules and other common build/dependency directories
      if (
        relativePath.includes("node_modules") ||
        relativePath.includes(".git")
      ) {
        continue;
      }

      const entryStats = await stat(entryPath);
      results.push({
        name: entry,
        type: entryStats.isDirectory() ? "directory" : "file",
        size: entryStats.isFile() ? entryStats.size : undefined,
        path: relativePath,
      });

      if (entryStats.isDirectory()) {
        await this.listFilesRecursive(
          rootPath,
          entryPath,
          results,
          includeHidden
        );
      }
    }
  }

  private async findFiles(
    namePattern: string,
    directoryPath?: string,
    caseSensitive: boolean = false,
    useRegex: boolean = false
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolveDirectoryPath(directoryPath);

      const results: Array<{
        file: string;
        path: string;
      }> = [];

      // Get all files to search
      const filesToSearch: string[] = [];
      await this.collectFiles(resolvedPath, filesToSearch);

      // Create matching function
      let matchesPattern: (filename: string) => boolean;
      if (useRegex) {
        // Use regex matching
        try {
          const regex = new RegExp(namePattern, caseSensitive ? "" : "i");
          matchesPattern = (filename: string) => regex.test(filename);
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Invalid regex pattern "${namePattern}": ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        // Simple substring matching
        const searchPattern = caseSensitive
          ? namePattern
          : namePattern.toLowerCase();
        matchesPattern = (filename: string) => {
          const filenameToSearch = caseSensitive
            ? filename
            : filename.toLowerCase();
          return filenameToSearch.includes(searchPattern);
        };
      }

      // Search for matching files
      for (const file of filesToSearch) {
        const filename = path.basename(file);
        if (matchesPattern(filename)) {
          const relativePath = path.relative(resolvedPath, file);
          results.push({
            file: filename,
            path: relativePath,
          });
        }
      }

      // Format results
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No files found matching pattern "${namePattern}"`,
            },
          ],
        };
      }

      const formatted = results.map((item) => `📄 ${item.path}`).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} file(s) matching "${namePattern}":\n\n${formatted}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error finding files: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async grepFiles(
    pattern: string,
    directoryPath?: string,
    filePattern?: string,
    caseSensitive: boolean = false
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolveDirectoryPath(directoryPath);

      const results: Array<{
        file: string;
        line: number;
        content: string;
      }> = [];

      // Get all files to search
      const filesToSearch: string[] = [];
      await this.collectFiles(resolvedPath, filesToSearch, filePattern);

      // Validate regex pattern
      try {
        new RegExp(pattern);
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Invalid regex pattern "${pattern}": ${error.message}`,
            },
          ],
          isError: true,
        };
      }

      // Search in each file
      for (const file of filesToSearch) {
        try {
          const content = await readFile(file, "utf-8");
          const lines = content.split("\n");
          const relativePath = path.relative(resolvedPath, file);

          lines.forEach((line, index) => {
            // Create a fresh regex for each test to avoid any state issues
            const regex = new RegExp(pattern, caseSensitive ? "" : "i");
            if (regex.test(line)) {
              results.push({
                file: relativePath,
                line: index + 1,
                content: line.trim(),
              });
            }
          });
        } catch (error: any) {
          // Skip files that can't be read (binary files, etc.)
          console.warn(`Skipping file ${file}: ${error.message}`);
        }
      }

      // Format results
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matches found for pattern "${pattern}"`,
            },
          ],
        };
      }

      const formatted = results
        .map((item) => `${item.file}:${item.line}: ${item.content}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} match(es) for pattern "${pattern}":\n\n${formatted}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching files: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async collectFiles(
    directoryPath: string,
    files: string[],
    filePattern?: string
  ): Promise<void> {
    try {
      const entries = await readdir(directoryPath);
      for (const entry of entries) {
        // Skip hidden files and common build/dependency directories
        if (
          entry.startsWith(".") ||
          entry === "node_modules" ||
          entry === ".git"
        ) {
          continue;
        }

        const entryPath = path.join(directoryPath, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          await this.collectFiles(entryPath, files, filePattern);
        } else if (stats.isFile()) {
          // Apply file pattern filter if provided (simple glob matching)
          if (filePattern) {
            if (!this.matchesPattern(entry, filePattern)) {
              continue;
            }
          }
          files.push(entryPath);
        }
      }
    } catch (error: any) {
      // Skip directories we can't read
      console.warn(`Cannot read directory ${directoryPath}: ${error.message}`);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    // Simple glob matching - convert pattern to regex
    // Supports * (any chars) and ** (any chars including path separators)
    // For more complex patterns, consider using a library
    let regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DOUBLESTAR___/g, ".*");
    regexStr = `^${regexStr}$`;
    const regex = new RegExp(regexStr);
    return regex.test(filename);
  }

  private async executeTerminalCommand(
    command: string,
    workingDirectory?: string
  ): Promise<NativeToolResult> {
    try {
      // Resolve working directory
      const cwd = workingDirectory
        ? this.resolvePath(workingDirectory, true)
        : this.resolveDirectoryPath();

      console.log(
        `[NativeTools] Executing command: "${command}" in directory: "${cwd}"`
      );

      // Use promisify to convert exec to promise-based
      const execAsync = promisify(exec);

      // Execute command with timeout (30 seconds default)
      const timeout = 30000; // 30 seconds
      const execPromise = execAsync(command, {
        cwd: cwd,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for output
        timeout: timeout,
      });

      // Add timeout handling
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Command timeout after ${timeout}ms`)),
          timeout
        );
      });

      let stdout: string = "";
      let stderr: string = "";
      let hasError = false;

      try {
        const result = await Promise.race([execPromise, timeoutPromise]);
        stdout = result.stdout || "";
        stderr = result.stderr || "";
        // If we got here, command executed (exit code 0)
        hasError = false;
      } catch (error: any) {
        // Handle timeout
        if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
          return {
            content: [
              {
                type: "text",
                text: `Command timed out after ${timeout}ms. The command may still be running.`,
              },
            ],
            isError: true,
          };
        }

        // For exec errors, the error object contains stdout and stderr
        // Non-zero exit codes throw an error, but we still want to show the output
        stdout = error.stdout || "";
        stderr = error.stderr || error.message || "";
        // If command exited with non-zero code, it's an error
        hasError = error.code !== undefined || !stdout;
      }

      // Format output
      let output = "";
      if (stdout) {
        output += stdout.trim();
      }
      if (stderr) {
        if (output) output += "\n\n";
        // Only label as STDERR if there's also stdout, otherwise it might be normal output
        if (stdout) {
          output += `STDERR:\n${stderr.trim()}`;
        } else {
          output += stderr.trim();
        }
      }
      if (!output) {
        output = "Command executed successfully (no output)";
      }

      // Only include isError when it's true
      const result: NativeToolResult = {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };

      if (hasError) {
        result.isError = true;
      }

      return result;
    } catch (error: any) {
      console.error(`[NativeTools] Error executing terminal command:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing command: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
