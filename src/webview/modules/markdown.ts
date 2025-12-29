/**
 * Markdown formatting utilities
 */

import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-xml-doc';
import 'prismjs/components/prism-markup';

export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeHtmlAttribute(text: string): string {
    // Escape characters that are problematic in HTML attributes
    return text
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseTable(tableText: string): string {
    const lines = tableText.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) return escapeHtml(tableText); // Not a valid table
    
    // First line is header
    const headerLine = lines[0];
    // Second line is separator (we'll skip it)
    // Remaining lines are data rows
    
    // Parse header
    const headerCells = headerLine.split('|').map(cell => cell.trim()).filter(cell => cell);
    
    // Parse data rows (skip the separator line at index 1)
    const dataRows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        const cells = lines[i].split('|').map(cell => cell.trim()).filter(cell => cell);
        if (cells.length > 0) {
            dataRows.push(cells);
        }
    }
    
    // Build HTML table
    let html = '<table>';
    
    // Add header row
    html += '<thead><tr>';
    for (const cell of headerCells) {
        html += `<th>${escapeHtml(cell)}</th>`;
    }
    html += '</tr></thead>';
    
    // Add body rows
    if (dataRows.length > 0) {
        html += '<tbody>';
        for (const row of dataRows) {
            html += '<tr>';
            // Ensure we have the same number of cells as headers
            for (let i = 0; i < headerCells.length; i++) {
                const cell = row[i] || '';
                html += `<td>${escapeHtml(cell)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';
    }
    
    html += '</table>';
    return html;
}

export function formatMarkdown(text: string): string {
    if (!text) return '';
    
    let formatted = text;
    
    // Store code blocks with placeholders to protect them from markdown processing
    const codeBlocks: Array<{ lang?: string; code: string }> = [];
    let codeBlockIndex = 0;
    
    // Store C-style comments (/* ... */) to protect them from italic processing
    const comments: string[] = [];
    let commentIndex = 0;
    
    // Store tables with placeholders to protect them from markdown processing
    const tables: string[] = [];
    let tableIndex = 0;
    
    // Extract code blocks first (before processing headers)
    // Updated regex to handle code blocks with or without newline after language identifier
    // Matches: ```lang optional-whitespace optional-newline code-content ```
    formatted = formatted.replace(/```(\w+)?\s*([\s\S]*?)```/g, 
        function(match, lang, code) {
            const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
            codeBlocks[codeBlockIndex] = { lang, code };
            codeBlockIndex++;
            return placeholder;
        }
    );
    
    // Extract markdown tables before other processing
    // Process line by line to identify table blocks
    const lines = formatted.split('\n');
    const processedLines: string[] = [];
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i];
        const isTableRow = /^\s*\|.+\|\s*$/.test(line);
        
        if (isTableRow && i + 1 < lines.length) {
            // Check if next line is a separator (allows multiple columns: |----|----|)
            const nextLine = lines[i + 1];
            const isSeparator = /^\s*\|([\s\-:]+\|)+\s*$/.test(nextLine);
            
            if (isSeparator && i + 2 < lines.length) {
                // Potential table start - collect all consecutive table rows
                const tableRows: string[] = [line, nextLine];
                let j = i + 2;
                
                // Collect data rows
                while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) {
                    tableRows.push(lines[j]);
                    j++;
                }
                
                // Only treat as table if we have at least 3 rows (header + separator + 1+ data)
                if (tableRows.length >= 3) {
                    const tableText = tableRows.join('\n');
                    const placeholder = `__TABLE_${tableIndex}__`;
                    tables[tableIndex] = tableText;
                    processedLines.push(placeholder);
                    i = j; // Skip all table lines
                    tableIndex++;
                    continue;
                }
            }
        }
        
        processedLines.push(line);
        i++;
    }
    
    formatted = processedLines.join('\n');
    
    // Extract C-style comments (/* ... */) to protect them from italic processing
    formatted = formatted.replace(/\/\*([\s\S]*?)\*\//g,
        function(match, comment) {
            const placeholder = `__COMMENT_${commentIndex}__`;
            comments[commentIndex] = match; // Store the full comment including /* and */
            commentIndex++;
            return placeholder;
        }
    );
    
    // Now process markdown (headers, etc.) - code blocks and comments are protected
    // Headers
    formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold and Italic
    formatted = formatted.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Now process italic (comments are already protected)
    formatted = formatted.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    
    // Restore C-style comments (escape HTML to prevent any further processing)
    for (let i = 0; i < comments.length; i++) {
        const placeholder = `__COMMENT_${i}__`;
        formatted = formatted.replace(placeholder, escapeHtml(comments[i]));
    }
    
    // Inline code (but not code blocks which are already replaced)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Links
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Lists
    formatted = formatted.replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
    
    // Blockquotes
    formatted = formatted.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    
    // Restore code blocks with proper HTML formatting and syntax highlighting
    for (let i = 0; i < codeBlocks.length; i++) {
        const placeholder = `__CODE_BLOCK_${i}__`;
        const { lang, code } = codeBlocks[i];
        const originalLang = lang || 'text';
        let prismLanguage = originalLang;
        const languageClass = `language-${originalLang}`;
        
        // Map language aliases to Prism language names for highlighting
        const languageMap: Record<string, string> = {
            'xml': 'markup',
            'html': 'markup',
            'svg': 'markup',
        };
        if (languageMap[prismLanguage.toLowerCase()]) {
            prismLanguage = languageMap[prismLanguage.toLowerCase()];
        }
        
        // Use Prism.js to highlight the code
        let highlightedCode: string;
        if (Prism.languages[prismLanguage]) {
            highlightedCode = Prism.highlight(code.trim(), Prism.languages[prismLanguage], prismLanguage);
        } else {
            // Fallback: escape HTML if language not supported
            highlightedCode = escapeHtml(code.trim());
        }
        
        // Add copy button for JSON code blocks (inline with language label)
        const isJson = originalLang.toLowerCase() === 'json';
        // Properly escape code for data attribute
        const escapedCode = escapeHtmlAttribute(code.trim());
        const copyButton = isJson ? `<button class="code-action-btn" data-action="copy" data-code="${escapedCode}" title="Copy JSON">📋</button>` : '';
        
        const codeBlockHtml = `<div class="code-block ${isJson ? 'code-block-json' : ''}">${originalLang ? `<div class="code-lang">${originalLang}${copyButton}</div>` : (copyButton ? `<div class="code-lang">${copyButton}</div>` : '')}<pre><code class="${languageClass}">${highlightedCode}</code></pre></div>`;
        formatted = formatted.replace(placeholder, codeBlockHtml);
    }
    
    // Restore tables with proper HTML formatting
    for (let i = 0; i < tables.length; i++) {
        const placeholder = `__TABLE_${i}__`;
        const tableHtml = parseTable(tables[i]);
        formatted = formatted.replace(placeholder, tableHtml);
    }
    
    // Line breaks (after code blocks and tables are restored)
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

