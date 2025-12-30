/**
 * Role class for Harmony protocol
 * Determines role (User or Assistant) based on <|start|> token
 */
export class Role {
  private static readonly USER_TOKEN = '<|start|>user';
  private static readonly ASSISTANT_TOKEN = '<|start|>assistant';
  private static readonly START_TOKEN_PATTERN = /<\|start\|>(\w+)/i;

  private constructor(private readonly roleType: 'user' | 'assistant') {}

  /**
   * Parse role from a Harmony protocol <|start|> token
   * @param token The token string (e.g., "<|start|>user" or "<|start|>assistant")
   * @returns Role instance or null if token is invalid
   */
  static fromToken(token: string): Role | null {
    const match = token.match(this.START_TOKEN_PATTERN);
    if (!match) {
      return null;
    }

    const roleName = match[1].toLowerCase();
    if (roleName === 'user') {
      return new Role('user');
    } else if (roleName === 'assistant') {
      return new Role('assistant');
    }

    return null;
  }

  /**
   * Parse role from text that may contain a <|start|> token
   * @param text Text that may contain a <|start|> token
   * @returns Role instance or null if no valid token found
   */
  static fromText(text: string): Role | null {
    const match = text.match(this.START_TOKEN_PATTERN);
    if (!match) {
      return null;
    }

    return this.fromToken(match[0]);
  }

  /**
   * Create a User role
   */
  static user(): Role {
    return new Role('user');
  }

  /**
   * Create an Assistant role
   */
  static assistant(): Role {
    return new Role('assistant');
  }

  /**
   * Check if this is a User role
   */
  isUser(): boolean {
    return this.roleType === 'user';
  }

  /**
   * Check if this is an Assistant role
   */
  isAssistant(): boolean {
    return this.roleType === 'assistant';
  }

  /**
   * Get the role type as string
   */
  getType(): 'user' | 'assistant' {
    return this.roleType;
  }

  /**
   * Get the Harmony protocol token for this role
   */
  toToken(): string {
    return this.roleType === 'user' 
      ? Role.USER_TOKEN 
      : Role.ASSISTANT_TOKEN;
  }

  /**
   * Convert to string representation
   */
  toString(): string {
    return this.roleType;
  }

  /**
   * Check equality with another Role
   */
  equals(other: Role): boolean {
    return this.roleType === other.roleType;
  }
}

