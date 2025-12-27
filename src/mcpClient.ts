import * as child_process from "child_process";
import { EventEmitter } from "events";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  type: "stdio";
  enabled?: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCall {
  name: string;
  arguments?: Record<string, any>;
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class MCPClient extends EventEmitter {
  private process: child_process.ChildProcess | null = null;
  private requestIdCounter = 1;
  private pendingRequests = new Map<number | string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  private initialized = false;
  private tools: MCPTool[] = [];
  private buffer = "";

  constructor(private config: MCPServerConfig) {
    super();
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error(`MCP server ${this.config.name} is already connected`);
    }

    console.log(`[MCP] Starting server: ${this.config.name}`);
    console.log(`[MCP] Command: ${this.config.command} ${this.config.args.join(" ")}`);

    this.process = child_process.spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    // Handle stdout (responses)
    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (errors)
    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      console.log(`[MCP ${this.config.name}] Process exited with code ${code}, signal ${signal}`);
      this.process = null;
      this.initialized = false;
      this.emit("disconnected");
    });

    // Handle process errors
    this.process.on("error", (error) => {
      console.error(`[MCP ${this.config.name}] Process error:`, error);
      this.emit("error", error);
    });

    // Initialize the MCP connection
    await this.initialize();
  }

  private processBuffer(): void {
    // Process NDJSON (newline-delimited JSON) messages from buffer
    // Each line is a complete JSON-RPC message
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: JSONRPCResponse = JSON.parse(trimmed);
        // Only handle responses (they have an id)
        if (message.id !== undefined) {
          this.handleResponse(message);
        }
      } catch (error) {
        console.error(`[MCP ${this.config.name}] Failed to parse JSON-RPC message:`, trimmed, error);
      }
    }
  }

  private handleResponse(message: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`MCP Error: ${message.error.message} (code: ${message.error.code})`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error(`MCP server ${this.config.name} is not connected`);
    }

    const id = this.requestIdCounter++;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + "\n";
      this.process!.stdin!.write(requestStr, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, 30000);
    });
  }

  private async initialize(): Promise<void> {
    try {
      // Send initialize request
      const initResult = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: "harmony-extension",
          version: "1.0.0",
        },
      });

      console.log(`[MCP ${this.config.name}] Initialized:`, initResult);

      // Send initialized notification (no response expected)
      this.sendNotification("initialized", {});

      this.initialized = true;

      // List available tools
      await this.listTools();
    } catch (error: any) {
      console.error(`[MCP ${this.config.name}] Initialization failed:`, error);
      throw error;
    }
  }

  private sendNotification(method: string, params?: any): void {
    if (!this.process || !this.process.stdin) {
      console.warn(`[MCP ${this.config.name}] Cannot send notification: not connected`);
      return;
    }

    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const notificationStr = JSON.stringify(notification) + "\n";
    this.process.stdin.write(notificationStr, (error) => {
      if (error) {
        console.error(`[MCP ${this.config.name}] Failed to send notification:`, error);
      }
    });
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.initialized) {
      throw new Error(`MCP server ${this.config.name} is not initialized`);
    }

    try {
      const result = await this.sendRequest("tools/list");
      this.tools = result.tools || [];
      console.log(`[MCP ${this.config.name}] Available tools:`, this.tools.map(t => t.name));
      return this.tools;
    } catch (error: any) {
      console.error(`[MCP ${this.config.name}] Failed to list tools:`, error);
      return [];
    }
  }

  async callTool(toolName: string, arguments_: Record<string, any> = {}): Promise<MCPToolResult> {
    if (!this.initialized) {
      throw new Error(`MCP server ${this.config.name} is not initialized`);
    }

    try {
      const result = await this.sendRequest("tools/call", {
        name: toolName,
        arguments: arguments_,
      });

      return result;
    } catch (error: any) {
      console.error(`[MCP ${this.config.name}] Tool call failed:`, error);
      throw error;
    }
  }

  getAvailableTools(): MCPTool[] {
    return this.tools;
  }

  isConnected(): boolean {
    return this.process !== null && this.initialized;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.initialized = false;
      this.pendingRequests.clear();
      this.buffer = "";
    }
  }
}

