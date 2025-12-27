import { MCPClient, MCPServerConfig, MCPTool, MCPToolCall, MCPToolResult } from "./mcpClient";
import * as vscode from "vscode";

export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();

  async initializeServers(serverConfigs: MCPServerConfig[]): Promise<void> {
    // Disconnect existing servers
    await this.disconnectAll();

    // Connect to new servers (skip disabled ones)
    for (const config of serverConfigs) {
      // Skip disabled servers
      if (config.enabled === false) {
        console.log(`[MCP] Skipping disabled server: "${config.name}"`);
        continue;
      }

      try {
        const client = new MCPClient(config);
        await client.connect();
        this.clients.set(config.name, client);
        vscode.window.showInformationMessage(
          `MCP server "${config.name}" connected successfully`
        );
      } catch (error: any) {
        console.error(`Failed to connect to MCP server ${config.name}:`, error);
        vscode.window.showErrorMessage(
          `Failed to connect to MCP server "${config.name}": ${error.message}`
        );
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.values()).map((client) =>
      client.disconnect().catch((error) => {
        console.error("Error disconnecting MCP client:", error);
      })
    );
    await Promise.all(disconnectPromises);
    this.clients.clear();
  }

  getAllTools(): MCPTool[] {
    const allTools: MCPTool[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        allTools.push(...client.getAvailableTools());
      }
    }
    return allTools;
  }

  async callTool(serverName: string, toolName: string, arguments_: Record<string, any>): Promise<MCPToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not found`);
    }
    if (!client.isConnected()) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }
    return await client.callTool(toolName, arguments_);
  }

  findToolServer(toolName: string): string | null {
    for (const [serverName, client] of this.clients.entries()) {
      if (client.isConnected()) {
        const tools = client.getAvailableTools();
        if (tools.some((tool) => tool.name === toolName)) {
          return serverName;
        }
      }
    }
    return null;
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([_, client]) => client.isConnected())
      .map(([name]) => name);
  }

  dispose(): void {
    this.disconnectAll();
  }
}

