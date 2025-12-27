import { MCPManager } from '../mcpManager';
import { MCPClient, MCPServerConfig, MCPTool } from '../mcpClient';
import * as vscode from 'vscode';

// Mock MCPClient
jest.mock('../mcpClient', () => {
  const actual = jest.requireActual('../mcpClient');
  return {
    ...actual,
    MCPClient: jest.fn(),
  };
});

// Mock vscode
jest.mock('vscode', () => ({
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
}));

describe('MCPManager', () => {
  let manager: MCPManager;
  let mockMCPClient: jest.Mocked<MCPClient>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MCPManager();

    // Setup mock MCPClient instance
    mockMCPClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      getAvailableTools: jest.fn().mockReturnValue([]),
      callTool: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    } as any;

    // Make MCPClient constructor return our mock
    (MCPClient as jest.MockedClass<typeof MCPClient>).mockImplementation(() => mockMCPClient);

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initializeServers', () => {
    describe('enabled servers', () => {
      it('should initialize enabled servers', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'server1',
            command: 'node',
            args: ['server.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).toHaveBeenCalledTimes(1);
        expect(MCPClient).toHaveBeenCalledWith(configs[0]);
        expect(mockMCPClient.connect).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "server1" connected successfully'
        );
      });

      it('should initialize servers when enabled field is not specified (defaults to true)', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'server1',
            command: 'node',
            args: ['server.js'],
            type: 'stdio',
            // enabled not specified
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).toHaveBeenCalledTimes(1);
        expect(mockMCPClient.connect).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "server1" connected successfully'
        );
      });

      it('should initialize multiple enabled servers', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'server1',
            command: 'node',
            args: ['server1.js'],
            type: 'stdio',
            enabled: true,
          },
          {
            name: 'server2',
            command: 'node',
            args: ['server2.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).toHaveBeenCalledTimes(2);
        expect(mockMCPClient.connect).toHaveBeenCalledTimes(2);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "server1" connected successfully'
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "server2" connected successfully'
        );
      });
    });

    describe('disabled servers', () => {
      it('should skip disabled servers', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'disabled-server',
            command: 'node',
            args: ['server.js'],
            type: 'stdio',
            enabled: false,
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).not.toHaveBeenCalled();
        expect(mockMCPClient.connect).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith('[MCP] Skipping disabled server: "disabled-server"');
      });

      it('should skip multiple disabled servers', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'disabled-server1',
            command: 'node',
            args: ['server1.js'],
            type: 'stdio',
            enabled: false,
          },
          {
            name: 'disabled-server2',
            command: 'node',
            args: ['server2.js'],
            type: 'stdio',
            enabled: false,
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).not.toHaveBeenCalled();
        expect(mockMCPClient.connect).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith('[MCP] Skipping disabled server: "disabled-server1"');
        expect(consoleLogSpy).toHaveBeenCalledWith('[MCP] Skipping disabled server: "disabled-server2"');
      });
    });

    describe('mixed enabled and disabled servers', () => {
      it('should initialize only enabled servers when mixed with disabled ones', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'enabled-server1',
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
            name: 'enabled-server2',
            command: 'node',
            args: ['server3.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        await manager.initializeServers(configs);

        // Should only initialize 2 servers (the enabled ones)
        expect(MCPClient).toHaveBeenCalledTimes(2);
        expect(mockMCPClient.connect).toHaveBeenCalledTimes(2);
        expect(consoleLogSpy).toHaveBeenCalledWith('[MCP] Skipping disabled server: "disabled-server"');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "enabled-server1" connected successfully'
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'MCP server "enabled-server2" connected successfully'
        );
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
          expect.stringContaining('disabled-server')
        );
      });

      it('should handle all servers disabled', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'disabled-server1',
            command: 'node',
            args: ['server1.js'],
            type: 'stdio',
            enabled: false,
          },
          {
            name: 'disabled-server2',
            command: 'node',
            args: ['server2.js'],
            type: 'stdio',
            enabled: false,
          },
        ];

        await manager.initializeServers(configs);

        expect(MCPClient).not.toHaveBeenCalled();
        expect(mockMCPClient.connect).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('error handling', () => {
      it('should handle connection errors for enabled servers', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'failing-server',
            command: 'node',
            args: ['server.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        const error = new Error('Connection failed');
        mockMCPClient.connect.mockRejectedValue(error);

        await manager.initializeServers(configs);

        expect(MCPClient).toHaveBeenCalledTimes(1);
        expect(mockMCPClient.connect).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          'Failed to connect to MCP server "failing-server": Connection failed'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to connect to MCP server failing-server:',
          error
        );
      });

      it('should not attempt to connect disabled servers even if they would fail', async () => {
        const configs: MCPServerConfig[] = [
          {
            name: 'disabled-server',
            command: 'node',
            args: ['server.js'],
            type: 'stdio',
            enabled: false,
          },
        ];

        // Even if we set up a failure, it shouldn't be called
        mockMCPClient.connect.mockRejectedValue(new Error('Connection failed'));

        await manager.initializeServers(configs);

        expect(MCPClient).not.toHaveBeenCalled();
        expect(mockMCPClient.connect).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      });
    });

    describe('disconnectAll', () => {
      it('should disconnect all existing servers before initializing new ones', async () => {
        // First, initialize a server
        const configs1: MCPServerConfig[] = [
          {
            name: 'server1',
            command: 'node',
            args: ['server1.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        await manager.initializeServers(configs1);
        expect(MCPClient).toHaveBeenCalledTimes(1);

        // Clear the mock to track new calls
        jest.clearAllMocks();

        // Initialize with different servers
        const configs2: MCPServerConfig[] = [
          {
            name: 'server2',
            command: 'node',
            args: ['server2.js'],
            type: 'stdio',
            enabled: true,
          },
        ];

        await manager.initializeServers(configs2);

        // Should have disconnected the old server
        expect(mockMCPClient.disconnect).toHaveBeenCalled();
        // Should have initialized the new server
        expect(MCPClient).toHaveBeenCalledTimes(1);
        expect(MCPClient).toHaveBeenCalledWith(configs2[0]);
      });
    });
  });

  describe('getAllTools', () => {
    it('should return tools only from enabled and connected servers', async () => {
      const tool1: MCPTool = {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
      };
      const tool2: MCPTool = {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object' },
      };

      mockMCPClient.getAvailableTools
        .mockReturnValueOnce([tool1])
        .mockReturnValueOnce([tool2]);

      const configs: MCPServerConfig[] = [
        {
          name: 'server1',
          command: 'node',
          args: ['server1.js'],
          type: 'stdio',
          enabled: true,
        },
        {
          name: 'server2',
          command: 'node',
          args: ['server2.js'],
          type: 'stdio',
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);

      const tools = manager.getAllTools();

      expect(tools).toHaveLength(2);
      expect(tools).toContainEqual(tool1);
      expect(tools).toContainEqual(tool2);
    });

    it('should not return tools from disabled servers', async () => {
      const configs: MCPServerConfig[] = [
        {
          name: 'disabled-server',
          command: 'node',
          args: ['server.js'],
          type: 'stdio',
          enabled: false,
        },
      ];

      await manager.initializeServers(configs);

      const tools = manager.getAllTools();

      expect(tools).toHaveLength(0);
      expect(MCPClient).not.toHaveBeenCalled();
    });
  });

  describe('getConnectedServers', () => {
    it('should return only enabled and connected servers', async () => {
      const configs: MCPServerConfig[] = [
        {
          name: 'server1',
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
          name: 'server2',
          command: 'node',
          args: ['server3.js'],
          type: 'stdio',
          enabled: true,
        },
      ];

      await manager.initializeServers(configs);

      const connectedServers = manager.getConnectedServers();

      expect(connectedServers).toHaveLength(2);
      expect(connectedServers).toContain('server1');
      expect(connectedServers).toContain('server2');
      expect(connectedServers).not.toContain('disabled-server');
    });
  });
});

