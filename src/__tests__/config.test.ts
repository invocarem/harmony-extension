import { loadConfig } from '../config';
import * as vscode from 'vscode';

// Mock vscode
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(),
    asRelativePath: jest.fn((path: string) => path),
  },
}));

describe('loadConfig', () => {
  let mockGetConfiguration: jest.MockedFunction<typeof vscode.workspace.getConfiguration>;
  let mockConfig: {
    get: jest.MockedFunction<(key: string, defaultValue?: any) => any>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      get: jest.fn(),
    };

    mockGetConfiguration = vscode.workspace.getConfiguration as jest.MockedFunction<
      typeof vscode.workspace.getConfiguration
    >;
    mockGetConfiguration.mockReturnValue(mockConfig as any);
  });

  describe('MCP server enabled field', () => {
    it('should default enabled to true when not specified', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'server1',
              command: 'node',
              args: ['server.js'],
              type: 'stdio',
              // enabled not specified
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers).toHaveLength(1);
      expect(config.mcpServers[0].enabled).toBe(true);
    });

    it('should set enabled to true when explicitly set to true', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'server1',
              command: 'node',
              args: ['server.js'],
              type: 'stdio',
              enabled: true,
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers).toHaveLength(1);
      expect(config.mcpServers[0].enabled).toBe(true);
    });

    it('should set enabled to false when explicitly set to false', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'server1',
              command: 'node',
              args: ['server.js'],
              type: 'stdio',
              enabled: false,
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers).toHaveLength(1);
      expect(config.mcpServers[0].enabled).toBe(false);
    });

    it('should handle multiple servers with different enabled states', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'enabled-server',
              command: 'node',
              args: ['server1.js'],
              type: 'stdio',
              enabled: true,
            },
            {
              name: 'disabled-server',
              command: 'node',
              args: ['server2.js'],
              type: 'stdio',
              enabled: false,
            },
            {
              name: 'default-server',
              command: 'node',
              args: ['server3.js'],
              type: 'stdio',
              // enabled not specified
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers).toHaveLength(3);
      expect(config.mcpServers[0].enabled).toBe(true);
      expect(config.mcpServers[1].enabled).toBe(false);
      expect(config.mcpServers[2].enabled).toBe(true); // defaults to true
    });

    it('should handle empty mcpServers array', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers).toHaveLength(0);
    });

    it('should preserve other server configuration fields', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'server1',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem'],
              type: 'stdio',
              enabled: false,
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      expect(config.mcpServers[0].name).toBe('server1');
      expect(config.mcpServers[0].command).toBe('npx');
      expect(config.mcpServers[0].args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
      expect(config.mcpServers[0].type).toBe('stdio');
      expect(config.mcpServers[0].enabled).toBe(false);
    });

    it('should handle enabled field as undefined (backward compatibility)', () => {
      mockConfig.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'mcpServers') {
          return [
            {
              name: 'server1',
              command: 'node',
              args: ['server.js'],
              type: 'stdio',
              enabled: undefined, // explicitly undefined
            },
          ];
        }
        return defaultValue;
      });

      const config = loadConfig();

      // When enabled is explicitly undefined, it should default to true
      expect(config.mcpServers[0].enabled).toBe(true);
    });
  });
});

