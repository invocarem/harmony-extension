import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { promisify } from "util";

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
        description: "Read the contents of a file. Returns the file content as text.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the file to read. Can be relative to workspace root or absolute.",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "create_file",
        description: "Create a new file with the specified content. Creates parent directories if they don't exist.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the file to create. Can be relative to workspace root or absolute.",
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
        description: "Replace the entire contents of a file with new content. Creates the file if it doesn't exist.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the file to replace. Can be relative to workspace root or absolute.",
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
        description: "List files and directories in a directory. Returns file names, types (file/directory), and sizes.",
        inputSchema: {
          type: "object",
          properties: {
            directory_path: {
              type: "string",
              description: "Path to the directory to list. Can be relative to workspace root or absolute. Defaults to workspace root if not provided.",
            },
            recursive: {
              type: "boolean",
              description: "Whether to list files recursively. Defaults to false.",
            },
            include_hidden: {
              type: "boolean",
              description: "Whether to include hidden files (starting with '.'). Defaults to false.",
            },
          },
          required: [],
        },
      },
      {
        name: "grep_files",
        description: "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The search pattern (regular expression).",
            },
            directory_path: {
              type: "string",
              description: "Directory to search in. Can be relative to workspace root or absolute. Defaults to workspace root if not provided.",
            },
            file_pattern: {
              type: "string",
              description: "Optional glob pattern to filter files (e.g., '*.ts', '**/*.js'). Searches all files if not provided.",
            },
            case_sensitive: {
              type: "boolean",
              description: "Whether the search should be case sensitive. Defaults to false.",
            },
          },
          required: ["pattern"],
        },
      },
    ];
  }

  async callTool(toolName: string, arguments_: Record<string, any>): Promise<NativeToolResult> {
    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(arguments_.file_path);
        case "create_file":
          return await this.createFile(arguments_.file_path, arguments_.content);
        case "replace_file":
          return await this.replaceFile(arguments_.file_path, arguments_.content);
        case "list_files":
          return await this.listFiles(
            arguments_.directory_path,
            arguments_.recursive || false,
            arguments_.include_hidden || false
          );
        case "grep_files":
          return await this.grepFiles(
            arguments_.pattern,
            arguments_.directory_path,
            arguments_.file_pattern,
            arguments_.case_sensitive || false
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

  private resolvePath(filePath: string): string {
    // If absolute path, use as-is
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    // Otherwise, resolve relative to workspace root
    if (this.workspaceRoot) {
      return path.resolve(this.workspaceRoot, filePath);
    }
    // Fallback: resolve relative to current working directory
    return path.resolve(filePath);
  }

  private async readFile(filePath: string): Promise<NativeToolResult> {
    try {
      const resolvedPath = this.resolvePath(filePath);
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
      return {
        content: [
          {
            type: "text",
            text: `Error reading file ${filePath}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async createFile(filePath: string, content: string): Promise<NativeToolResult> {
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

  private async replaceFile(filePath: string, content: string): Promise<NativeToolResult> {
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
        ? this.resolvePath(directoryPath)
        : this.workspaceRoot || process.cwd();

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
        await this.listFilesRecursive(resolvedPath, resolvedPath, results, includeHidden);
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
            text: `Files in ${directoryPath || "workspace root"}:\n\n${formatted}`,
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
    results: Array<{ name: string; type: "file" | "directory"; size?: number; path: string }>,
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
      if (relativePath.includes("node_modules") || relativePath.includes(".git")) {
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
        await this.listFilesRecursive(rootPath, entryPath, results, includeHidden);
      }
    }
  }

  private async grepFiles(
    pattern: string,
    directoryPath?: string,
    filePattern?: string,
    caseSensitive: boolean = false
  ): Promise<NativeToolResult> {
    try {
      const resolvedPath = directoryPath
        ? this.resolvePath(directoryPath)
        : this.workspaceRoot || process.cwd();

      const results: Array<{
        file: string;
        line: number;
        content: string;
      }> = [];

      // Get all files to search
      const filesToSearch: string[] = [];
      await this.collectFiles(resolvedPath, filesToSearch, filePattern);

      // Search in each file
      for (const file of filesToSearch) {
        try {
          const content = await readFile(file, "utf-8");
          const lines = content.split("\n");
          const relativePath = path.relative(resolvedPath, file);

          lines.forEach((line, index) => {
            // Create a fresh regex for each test to avoid global flag issues
            const testRegex = new RegExp(pattern, caseSensitive ? "g" : "gi");
            if (testRegex.test(line)) {
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
        if (entry.startsWith(".") || entry === "node_modules" || entry === ".git") {
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
}

