// fileReader.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

const readFile = util.promisify(fs.readFile);
const stat = util.promisify(fs.stat);

export interface FileReaderResult {
  base64: string;
  filename: string;
  fileSize: number;
  filePath: string;
}

export class FileReader {
  private workspaceRoot: string | undefined;

  constructor() {
    // Initialize workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * Resolve file path (relative to workspace root or absolute)
   */
  private resolvePath(filePath: string): string {
    // If absolute path, use as-is
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    
    // Resolve relative to workspace root
    if (this.workspaceRoot) {
      return path.resolve(this.workspaceRoot, filePath);
    }
    
    // Fallback: resolve relative to current working directory
    return path.resolve(filePath);
  }

  /**
   * Read a file (PDF or DOCX) and convert to base64 string
   * @param filePath - Path to the file (can be relative to workspace root or absolute)
   * @returns FileReaderResult with base64 content, filename, file size, and file path
   * @throws Error if file cannot be read or doesn't exist
   */
  async readFileToBase64(filePath: string): Promise<FileReaderResult> {
    const resolvedPath = this.resolvePath(filePath);
    
    try {
      // Check if file exists
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }

      // Read file as binary buffer
      const buffer = await readFile(resolvedPath);
      
      // Convert to base64
      const base64 = buffer.toString('base64');
      
      // Get filename from path
      const filename = path.basename(resolvedPath);
      
      return {
        base64,
        filename,
        fileSize: buffer.length,
        filePath: resolvedPath
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath} (resolved to: ${resolvedPath})`);
      }
      throw new Error(`Error reading file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Check if a file exists (without reading its content)
   * @param filePath - Path to the file (can be relative to workspace root or absolute)
   * @returns true if file exists and is a file, false otherwise
   */
  async checkFileExists(filePath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    try {
      const stats = await stat(resolvedPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if a file path has a supported extension (PDF or DOCX)
   * @param filePath - Path to check
   * @returns true if the file extension is supported
   */
  static isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.pdf' || ext === '.docx';
  }
}

