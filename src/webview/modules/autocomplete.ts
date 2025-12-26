/**
 * Autocomplete functionality for file references
 */

import { AutocompleteFile, WebviewToExtensionMessage } from '../types';

declare const vscode: {
    postMessage: (message: WebviewToExtensionMessage) => void;
};

const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
const autocompleteDropdown = document.getElementById('autocompleteDropdown') as HTMLDivElement;

let autocompleteItems: AutocompleteFile[] = [];
let selectedAutocompleteIndex = -1;
let autocompleteTimer: ReturnType<typeof setTimeout> | null = null;

export function showAutocomplete(): void {
    autocompleteDropdown.style.display = 'block';
    selectedAutocompleteIndex = -1;
    updateAutocompleteSelection();
}

export function hideAutocomplete(): void {
    autocompleteDropdown.style.display = 'none';
    selectedAutocompleteIndex = -1;
}

function updateAutocompleteSelection(): void {
    const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
        if (index === selectedAutocompleteIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

function selectAutocompleteItem(index: number): void {
    if (index >= 0 && index < autocompleteItems.length) {
        const item = autocompleteItems[index];
        insertFileReference(item.path);
        hideAutocomplete();
    }
}

export function insertFileReference(filePath: string): void {
    const cursorPos = messageInput.selectionStart;
    const textBefore = messageInput.value.substring(0, cursorPos);
    const textAfter = messageInput.value.substring(cursorPos);
    
    // Check if we're in the middle of typing @file
    const atFileMatch = textBefore.match(/@(?:file|file_context)[:(\s]*$/);
    if (atFileMatch) {
        // Replace the @file reference with complete reference
        const beforeAtFile = textBefore.substring(0, textBefore.lastIndexOf('@'));
        messageInput.value = beforeAtFile + `@file:${filePath} ` + textAfter;
        messageInput.selectionStart = beforeAtFile.length + `@file:${filePath} `.length;
        messageInput.selectionEnd = messageInput.selectionStart;
    } else {
        // Insert new @file reference
        messageInput.value = textBefore + ` @file:${filePath} ` + textAfter;
        messageInput.selectionStart = cursorPos + ` @file:${filePath} `.length;
        messageInput.selectionEnd = messageInput.selectionStart;
    }
    
    messageInput.focus();
}

export function checkForAutocomplete(): void {
    const value = messageInput.value;
    const cursorPos = messageInput.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);
    
    // Check if user typed @file
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    if (lastAtSymbol !== -1) {
        const textAfterAt = textBeforeCursor.substring(lastAtSymbol);
        if (textAfterAt.startsWith('@file') || textAfterAt.startsWith('@file_context')) {
            // Request file list for autocomplete
            if (autocompleteTimer) {
                clearTimeout(autocompleteTimer);
            }
            autocompleteTimer = setTimeout(() => {
                vscode.postMessage({
                    command: 'requestFileList'
                });
            }, 300);
            return;
        }
    }
    
    // Hide autocomplete if not typing @file
    hideAutocomplete();
}

export function populateAutocomplete(files: AutocompleteFile[]): void {
    autocompleteItems = files || [];
    autocompleteDropdown.innerHTML = '';
    
    if (autocompleteItems.length === 0) {
        hideAutocomplete();
        return;
    }
    
    // Add header
    const header = document.createElement('div');
    header.className = 'autocomplete-header';
    header.textContent = `Select a file (${autocompleteItems.length} found)`;
    autocompleteDropdown.appendChild(header);
    
    // Add file items
    autocompleteItems.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `<span class="file-icon">📄</span> ${file.label}`;
        item.dataset.index = index.toString();
        
        item.addEventListener('click', () => {
            selectAutocompleteItem(index);
        });
        
        autocompleteDropdown.appendChild(item);
    });
    
    showAutocomplete();
}

export function handleAutocompleteKeyboard(e: KeyboardEvent): boolean {
    // Handle autocomplete navigation when dropdown is open
    if (autocompleteDropdown.style.display === 'block') {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, autocompleteItems.length - 1);
                updateAutocompleteSelection();
                return true;
            case 'ArrowUp':
                e.preventDefault();
                selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
                updateAutocompleteSelection();
                return true;
            case 'Enter':
                e.preventDefault();
                if (selectedAutocompleteIndex >= 0) {
                    selectAutocompleteItem(selectedAutocompleteIndex);
                    return true;
                } else {
                    // If no item selected, close autocomplete
                    hideAutocomplete();
                    // Return false so caller can handle sending the message
                    return false;
                }
            case 'Escape':
                e.preventDefault();
                hideAutocomplete();
                return true;
        }
    }
    return false;
}

