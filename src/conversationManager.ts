/**
 * ChatMessage interface for conversation history
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

/**
 * Manages conversation history for the Harmony Assistant
 */
export class ConversationManager {
  private history: ChatMessage[] = [];

  /**
   * Add a message to the conversation history
   */
  addMessage(message: ChatMessage): void {
    this.history.push(message);
  }

  /**
   * Get the full conversation history
   */
  getHistory(): readonly ChatMessage[] {
    return [...this.history];
  }

  /**
   * Get conversation history excluding the last message (useful for template rendering)
   */
  getHistoryForTemplate(): readonly ChatMessage[] {
    return this.history.slice(0, -1);
  }

  /**
   * Get conversation history up to a specific index
   */
  getHistoryUpTo(index: number): readonly ChatMessage[] {
    return this.history.slice(0, index);
  }

  /**
   * Remove a specific message from history (by reference)
   */
  removeMessage(message: ChatMessage): boolean {
    const index = this.history.indexOf(message);
    if (index !== -1) {
      this.history.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all conversation history
   */
  clear(): void {
    this.history = [];
  }

  /**
   * Get the number of messages in history
   */
  getLength(): number {
    return this.history.length;
  }

  /**
   * Check if history is empty
   */
  isEmpty(): boolean {
    return this.history.length === 0;
  }
}

