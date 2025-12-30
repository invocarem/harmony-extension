import { Role } from '../harmony/role';

describe('Role', () => {
  describe('fromToken', () => {
    it('should parse user token', () => {
      const role = Role.fromToken('<|start|>user');
      expect(role).not.toBeNull();
      expect(role?.isUser()).toBe(true);
      expect(role?.isAssistant()).toBe(false);
      expect(role?.getType()).toBe('user');
    });

    it('should parse assistant token', () => {
      const role = Role.fromToken('<|start|>assistant');
      expect(role).not.toBeNull();
      expect(role?.isUser()).toBe(false);
      expect(role?.isAssistant()).toBe(true);
      expect(role?.getType()).toBe('assistant');
    });

    it('should handle case insensitive tokens', () => {
      const role1 = Role.fromToken('<|start|>USER');
      const role2 = Role.fromToken('<|start|>Assistant');
      expect(role1?.isUser()).toBe(true);
      expect(role2?.isAssistant()).toBe(true);
    });

    it('should return null for invalid tokens', () => {
      expect(Role.fromToken('<|start|>invalid')).toBeNull();
      expect(Role.fromToken('<|channel|>final')).toBeNull();
      expect(Role.fromToken('not a token')).toBeNull();
    });
  });

  describe('fromText', () => {
    it('should extract role from text with token', () => {
      const text = '<|start|>user<|channel|>final<|message|>Hello';
      const role = Role.fromText(text);
      expect(role).not.toBeNull();
      expect(role?.isUser()).toBe(true);
    });

    it('should extract assistant role from text', () => {
      const text = '<|start|>assistant<|channel|>final<|message|>Response';
      const role = Role.fromText(text);
      expect(role).not.toBeNull();
      expect(role?.isAssistant()).toBe(true);
    });

    it('should return null if no token found', () => {
      expect(Role.fromText('plain text')).toBeNull();
    });
  });

  describe('factory methods', () => {
    it('should create user role', () => {
      const role = Role.user();
      expect(role.isUser()).toBe(true);
      expect(role.getType()).toBe('user');
    });

    it('should create assistant role', () => {
      const role = Role.assistant();
      expect(role.isAssistant()).toBe(true);
      expect(role.getType()).toBe('assistant');
    });
  });

  describe('toToken', () => {
    it('should generate user token', () => {
      const role = Role.user();
      expect(role.toToken()).toBe('<|start|>user');
    });

    it('should generate assistant token', () => {
      const role = Role.assistant();
      expect(role.toToken()).toBe('<|start|>assistant');
    });
  });

  describe('toString', () => {
    it('should return role type as string', () => {
      expect(Role.user().toString()).toBe('user');
      expect(Role.assistant().toString()).toBe('assistant');
    });
  });

  describe('equals', () => {
    it('should return true for same roles', () => {
      const role1 = Role.user();
      const role2 = Role.user();
      expect(role1.equals(role2)).toBe(true);
    });

    it('should return false for different roles', () => {
      const role1 = Role.user();
      const role2 = Role.assistant();
      expect(role1.equals(role2)).toBe(false);
    });
  });
});

