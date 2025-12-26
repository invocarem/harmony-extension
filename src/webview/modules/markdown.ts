/**
 * Markdown formatting utilities
 */

export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatMarkdown(text: string): string {
    if (!text) return '';
    
    let formatted = text;
    
    // Store code blocks with placeholders to protect them from markdown processing
    const codeBlocks: Array<{ lang?: string; code: string }> = [];
    let codeBlockIndex = 0;
    
    // Extract code blocks first (before processing headers)
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, 
        function(match, lang, code) {
            const placeholder = `__CODE_BLOCK_${codeBlockIndex}__`;
            codeBlocks[codeBlockIndex] = { lang, code };
            codeBlockIndex++;
            return placeholder;
        }
    );
    
    // Now process markdown (headers, etc.) - code blocks are protected
    // Headers
    formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold and Italic
    formatted = formatted.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Inline code (but not code blocks which are already replaced)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Links
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Lists
    formatted = formatted.replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
    
    // Blockquotes
    formatted = formatted.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    
    // Restore code blocks with proper HTML formatting
    for (let i = 0; i < codeBlocks.length; i++) {
        const placeholder = `__CODE_BLOCK_${i}__`;
        const { lang, code } = codeBlocks[i];
        const languageClass = lang ? `language-${lang}` : '';
        const codeBlockHtml = `<div class="code-block">
                          ${lang ? `<div class="code-lang">${lang}</div>` : ''}
                          <pre><code class="${languageClass}">${escapeHtml(code)}</code></pre>
                        </div>`;
        formatted = formatted.replace(placeholder, codeBlockHtml);
    }
    
    // Line breaks (after code blocks are restored)
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

