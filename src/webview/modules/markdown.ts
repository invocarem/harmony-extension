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

export function formatMarkdown(text: string): string {
    if (!text) return '';
    
    let formatted = text;
    
    // Store code blocks with placeholders to protect them from markdown processing
    const codeBlocks: Array<{ lang?: string; code: string }> = [];
    let codeBlockIndex = 0;
    
    // Store C-style comments (/* ... */) to protect them from italic processing
    const comments: string[] = [];
    let commentIndex = 0;
    
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
        const language = lang || 'text';
        const languageClass = `language-${language}`;
        
        // Use Prism.js to highlight the code
        let highlightedCode: string;
        if (Prism.languages[language]) {
            highlightedCode = Prism.highlight(code.trim(), Prism.languages[language], language);
        } else {
            // Fallback: escape HTML if language not supported
            highlightedCode = escapeHtml(code.trim());
        }
        
        // Add copy button for JSON code blocks (inline with language label)
        const isJson = language === 'json';
        // Properly escape code for data attribute
        const escapedCode = escapeHtmlAttribute(code.trim());
        const copyButton = isJson ? `
            <button class="code-action-btn" data-action="copy" data-code="${escapedCode}" title="Copy JSON">
                📋
            </button>
        ` : '';
        
        const codeBlockHtml = `<div class="code-block ${isJson ? 'code-block-json' : ''}">
                          ${lang ? `<div class="code-lang">${lang}${copyButton}</div>` : (copyButton ? `<div class="code-lang">${copyButton}</div>` : '')}
                          <pre><code class="${languageClass}">${highlightedCode}</code></pre>
                        </div>`;
        formatted = formatted.replace(placeholder, codeBlockHtml);
    }
    
    // Line breaks (after code blocks are restored)
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

