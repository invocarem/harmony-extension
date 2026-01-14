import * as vscode from "vscode";
import { MCPServerConfig } from "./mcpClient";

export interface RuleConfig {
  path: string;
  enabled: boolean;
}

export interface LlamaConfig {
  serverUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  mcpServers: MCPServerConfig[];
  rulesPaths: RuleConfig[];
  harmonyMode: boolean;
  verbose: boolean;
  verboseToolExtraction?: boolean; // Control XmlProcessor and ToolCallExtractor logging
  firstPrinciplesMode?: boolean; // Enable first-principles thinking mode by default in assumptions stage
}

/**
 * Normalizes a server URL to ensure proper format.
 * Handles cases like:
 * - http://host/8080 -> http://host:8080
 * - http://host:8080 -> http://host:8080 (no change)
 * - http://host -> http://host (no change)
 */
function normalizeServerUrl(url: string): string {
  if (!url || typeof url !== "string") {
    return url;
  }

  try {
    // Try to parse as URL first
    const urlObj = new URL(url);
    
    // If there's a port in the path (e.g., /8080), move it to the port
    const pathMatch = urlObj.pathname.match(/^\/(\d+)(\/.*)?$/);
    if (pathMatch && !urlObj.port) {
      const port = pathMatch[1];
      const remainingPath = pathMatch[2] || "";
      urlObj.port = port;
      urlObj.pathname = remainingPath;
      return urlObj.toString().replace(/\/$/, ""); // Remove trailing slash
    }
    
    return urlObj.toString().replace(/\/$/, ""); // Remove trailing slash
  } catch (error) {
    // If URL parsing fails, try manual fix for common case: http://host/port
    const malformedMatch = url.match(/^(https?:\/\/[^\/]+)\/(\d+)(\/.*)?$/);
    if (malformedMatch) {
      const base = malformedMatch[1];
      const port = malformedMatch[2];
      const path = malformedMatch[3] || "";
      return `${base}:${port}${path}`;
    }
    
    // Return as-is if we can't fix it
    return url;
  }
}

export function loadConfig(): LlamaConfig {
  const config = vscode.workspace.getConfiguration("harmony");
  const mcpServersConfig = config.get<any[]>("mcpServers", []);
  
  const mcpServers: MCPServerConfig[] = mcpServersConfig.map((server: any) => ({
    name: server.name,
    command: server.command,
    args: server.args || [],
    type: server.type || "stdio",
    enabled: server.enabled !== undefined ? server.enabled : true,
  }));

  const rawServerUrl = config.get("serverUrl", "http://localhost:8000");
  const normalizedServerUrl = normalizeServerUrl(rawServerUrl);
  
  if (rawServerUrl !== normalizedServerUrl) {
    console.log(`[Harmony] Normalized server URL: "${rawServerUrl}" -> "${normalizedServerUrl}"`);
  }

  const rulesPathsConfig = config.get<string[] | any[]>("rulesPaths", []);
  
  // Parse rulesPaths - support both string[] (backward compatibility) and object[] formats
  const rulesPaths: RuleConfig[] = rulesPathsConfig.map((item: string | any) => {
    // If it's a string (backward compatibility), treat as enabled rule
    if (typeof item === "string") {
      return { path: item, enabled: true };
    }
    // If it's an object, parse path and enabled (default true)
    return {
      path: item.path || item,
      enabled: item.enabled !== undefined ? item.enabled : true,
    };
  });

  return {
    serverUrl: normalizedServerUrl,
    apiKey: config.get("apiKey", ""),
    model: config.get("model", "gpt-oss-120b"),
    temperature: config.get("temperature", 0.7),
    maxTokens: config.get("maxTokens", 2048),
    mcpServers,
    rulesPaths,
    harmonyMode: config.get("harmonyMode", true),
    verbose: config.get("verbose", false),
    verboseToolExtraction: config.get("verboseToolExtraction", false), // Control XmlProcessor and ToolCallExtractor logging
    firstPrinciplesMode: config.get("firstPrinciplesMode", false), // Default: disabled
  };
}

