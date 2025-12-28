// fileContextExtractor.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileReference {
    type: 'file' | 'directory' | 'selection';
    path: string;
    lineStart?: number;
    lineEnd?: number;
    content?: string;
}

export class FileContextExtractor {
    /**
     * Extract file references from a message containing @file mentions
     */
    static async extractFileReferences(message: string): Promise<{
        cleanMessage: string;
        fileContexts: FileReference[];
    }> {
        // Pattern to match @file references like @file:path or @file(path)
        // The capture group stops at whitespace, @ (new reference), ), or end of string
        // Handles both @file:path and @file(path) syntax
        const filePattern = /@(?:file|file_context)(?::\s*([^\s@)]+)|\(\s*([^\s@)]+?)\))/g;
        const matches = Array.from(message.matchAll(filePattern));
        
        const fileContexts: FileReference[] = [];
        let cleanMessage = message;
        
        for (const match of matches) {
            const fullMatch = match[0];
            // match[1] is for @file:path syntax, match[2] is for @file(path) syntax
            const filePath = match[1] || match[2];
            
            if (!filePath) {
                continue; // Skip if no file path captured
            }
            
            try {
                const context = await this.getFileContext(filePath);
                fileContexts.push(context);
                
                // Remove the @file reference from the message
                cleanMessage = cleanMessage.replace(fullMatch, '').trim();
            } catch (error: any) {
                console.warn(`Failed to get file context for ${filePath}:`, error.message);
                // Keep the reference in the message if we can't process it
            }
        }
        
        // Also check for @file without arguments (current file)
        const currentFilePattern = /@(?:file|file_context)(?![:(\w])/g;
        if (currentFilePattern.test(message)) {
            try {
                const context = await this.getCurrentFileContext();
                fileContexts.push(context);
                
                // Remove @file references
                cleanMessage = cleanMessage.replace(currentFilePattern, '').trim();
            } catch (error: any) {
                console.warn('Failed to get current file context:', error.message);
            }
        }
        
        return {
            cleanMessage,
            fileContexts
        };
    }
    
    /**
     * Get context for a specific file path
     */
    private static async getFileContext(filePath: string): Promise<FileReference> {
        // Resolve path
        const resolvedPath = this.resolvePath(filePath);
        
        // Check if file exists
        const stats = await fs.promises.stat(resolvedPath).catch(() => null);
        if (!stats) {
            throw new Error(`File not found: ${filePath} (resolved to: ${resolvedPath})`);
        }
        
        if (stats.isDirectory()) {
            const content = await this.readDirectoryContents(resolvedPath);
            return {
                type: 'directory',
                path: resolvedPath,
                content
            };
        } else {
            const content = await fs.promises.readFile(resolvedPath, 'utf-8');
            return {
                type: 'file',
                path: resolvedPath,
                content
            };
        }
    }
    
    /**
     * Get context for the currently active file in the editor
     */
    private static async getCurrentFileContext(): Promise<FileReference> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }
        
        const document = editor.document;
        const selection = editor.selection;
        
        let content: string;
        if (selection && !selection.isEmpty) {
            // If there's a selection, include only selected lines
            content = document.getText(selection);
            return {
                type: 'selection',
                path: document.fileName,
                lineStart: selection.start.line + 1,
                lineEnd: selection.end.line + 1,
                content
            };
        } else {
            // Include entire file
            content = document.getText();
            return {
                type: 'file',
                path: document.fileName,
                content
            };
        }
    }
    
    /**
     * Resolve a file path (supports relative paths and workspace folder)
     */
    private static resolvePath(filePath: string): string {
        // If absolute path, use as-is
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        
        // Resolve relative to workspace if available
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            return path.resolve(workspaceRoot, filePath);
        }
        
        // Fallback: resolve relative to current working directory (shouldn't happen in normal usage)
        return path.resolve(filePath);
    }
    
    /**
     * Read directory contents for context
     */
    private static async readDirectoryContents(dirPath: string): Promise<string> {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const files = entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .slice(0, 20); // Limit to first 20 files
        
        const subdirs = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .slice(0, 10); // Limit to first 10 directories
        
        return `Directory: ${path.basename(dirPath)}
Total files: ${entries.filter(e => e.isFile()).length}
Total subdirectories: ${entries.filter(e => e.isDirectory()).length}

Files (first 20):
${files.map(f => `  - ${f}`).join('\n')}

Subdirectories (first 10):
${subdirs.map(d => `  - ${d}/`).join('\n')}`;
    }
    
    /**
     * Format file contexts for inclusion in prompt
     */
    static formatFileContexts(fileContexts: FileReference[]): string {
        if (fileContexts.length === 0) {
            return '';
        }
        
        let formatted = '\n\n' + '='.repeat(80) + '\n';
        formatted += '📁 FILE CONTEXT INCLUDED WITH REQUEST\n';
        formatted += '='.repeat(80) + '\n\n';
        
        fileContexts.forEach((context, index) => {
            const relativePath = vscode.workspace.asRelativePath(context.path, false);
            
            formatted += `## File ${index + 1}: ${relativePath}\n`;
            formatted += `Type: ${context.type}\n`;
            
            if (context.type === 'selection' && context.lineStart && context.lineEnd) {
                formatted += `Lines: ${context.lineStart}-${context.lineEnd}\n`;
            }
            
            if (context.content) {
                formatted += '\n```\n';
                
                // Truncate very large files, but don't truncate selections (they're intentionally selected)
                const maxLength = context.type === 'selection' ? 50000 : 20000;
                if (context.content.length > maxLength) {
                    formatted += context.content.substring(0, maxLength);
                    formatted += `\n\n... [Content truncated. Full ${context.type === 'selection' ? 'selection' : 'file'} is ${context.content.length} characters.] ...`;
                } else {
                    formatted += context.content;
                }
                
                formatted += '\n```\n';
            }
            
            formatted += '\n' + '-'.repeat(60) + '\n\n';
        });
        
        formatted += '='.repeat(80) + '\n';
        formatted += 'END OF FILE CONTEXT\n';
        formatted += '='.repeat(80) + '\n';
        
        return formatted;
    }
}