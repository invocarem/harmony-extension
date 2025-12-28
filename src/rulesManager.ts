import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RuleConfig } from "./config";

export interface Rule {
  id: string;
  filePath: string;
  description?: string;
  triggers?: string[];
  content: string;
  lastModified: number;
}

export interface RuleFrontmatter {
  description?: string;
  triggers?: string[];
  outputFormat?: string;
  toolRequirements?: string[];
}

export class RulesManager {
  private rules: Map<string, Rule> = new Map();
  private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

  /**
   * Load rules from configured file paths
   */
  async loadRules(rulesPaths: RuleConfig[]): Promise<void> {
    // Clear existing rules and watchers
    this.clearRules();

    if (!rulesPaths || rulesPaths.length === 0) {
      console.log("[Rules] No rules paths configured");
      return;
    }

    // Filter out disabled rules
    const enabledRules = rulesPaths.filter(rule => rule.enabled);
    const disabledCount = rulesPaths.length - enabledRules.length;

    if (disabledCount > 0) {
      console.log(`[Rules] ${disabledCount} rule(s) disabled, skipping`);
    }

    if (enabledRules.length === 0) {
      console.log("[Rules] No enabled rules to load");
      return;
    }

    console.log(`[Rules] Loading rules from ${enabledRules.length} path(s)`);

    for (const ruleConfig of enabledRules) {
      try {
        const resolvedPath = this.resolvePath(ruleConfig.path);
        await this.loadRuleFromPath(resolvedPath);
      } catch (error: any) {
        console.error(`[Rules] Failed to load rule from path "${ruleConfig.path}":`, error.message);
        vscode.window.showWarningMessage(
          `Failed to load rule from "${ruleConfig.path}": ${error.message}`
        );
      }
    }

    console.log(`[Rules] Loaded ${this.rules.size} rule(s)`);
  }

  /**
   * Resolve a path to an absolute path
   * Supports workspace-relative paths with ${workspaceFolder}
   */
  private resolvePath(rulePath: string): string {
    // Handle ${workspaceFolder} variable
    if (rulePath.includes("${workspaceFolder}")) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }
      return rulePath.replace(/\${workspaceFolder}/g, workspaceFolder);
    }

    // Handle absolute paths
    if (path.isAbsolute(rulePath)) {
      return rulePath;
    }

    // Handle relative paths (relative to workspace)
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      return path.resolve(workspaceFolder, rulePath);
    }

    // Fallback to relative to current working directory
    return path.resolve(rulePath);
  }

  /**
   * Load a single rule from a file path
   */
  private async loadRuleFromPath(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    // Check if already loaded and unchanged
    const existingRule = Array.from(this.rules.values()).find(r => r.filePath === filePath);
    if (existingRule && existingRule.lastModified >= stats.mtimeMs) {
      return; // Already up to date
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    const { frontmatter, body } = this.parseMarkdownWithFrontmatter(content);

    const ruleId = this.generateRuleId(filePath);
    const rule: Rule = {
      id: ruleId,
      filePath,
      description: frontmatter.description,
      triggers: frontmatter.triggers,
      content: body.trim(),
      lastModified: stats.mtimeMs,
    };

    this.rules.set(ruleId, rule);

    // Set up file watcher for auto-reload
    this.setupFileWatcher(filePath);

    console.log(`[Rules] Loaded rule: ${ruleId}${rule.description ? ` (${rule.description})` : ""}`);
  }

  /**
   * Parse markdown file with optional frontmatter
   */
  private parseMarkdownWithFrontmatter(content: string): {
    frontmatter: RuleFrontmatter;
    body: string;
  } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      // No frontmatter, return entire content as body
      return { frontmatter: {}, body: content };
    }

    const frontmatterText = match[1];
    const body = match[2];

    // Parse frontmatter (simple YAML-like parsing)
    const frontmatter: RuleFrontmatter = {};
    const lines = frontmatterText.split("\n");

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      switch (key) {
        case "description":
          frontmatter.description = value;
          break;
        case "triggers":
          // Parse array format: triggers: ["keyword1", "keyword2"]
          const arrayMatch = value.match(/\[(.*?)\]/);
          if (arrayMatch) {
            frontmatter.triggers = arrayMatch[1]
              .split(",")
              .map(t => t.trim().replace(/^["']|["']$/g, ""));
          }
          break;
        case "outputFormat":
          frontmatter.outputFormat = value;
          break;
        case "toolRequirements":
          const toolArrayMatch = value.match(/\[(.*?)\]/);
          if (toolArrayMatch) {
            frontmatter.toolRequirements = toolArrayMatch[1]
              .split(",")
              .map(t => t.trim().replace(/^["']|["']$/g, ""));
          }
          break;
      }
    }

    return { frontmatter, body };
  }

  /**
   * Generate a unique rule ID from file path
   */
  private generateRuleId(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    // Make it URL-safe
    return basename.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }

  /**
   * Set up file watcher for auto-reload
   */
  private setupFileWatcher(filePath: string): void {
    // Remove existing watcher if any
    const existingWatcher = this.fileWatchers.get(filePath);
    if (existingWatcher) {
      existingWatcher.dispose();
    }

    const pattern = new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidChange(async () => {
      console.log(`[Rules] Rule file changed: ${filePath}, reloading...`);
      try {
        await this.loadRuleFromPath(filePath);
        vscode.window.showInformationMessage(`Rule "${path.basename(filePath)}" reloaded`);
      } catch (error: any) {
        console.error(`[Rules] Failed to reload rule:`, error);
        vscode.window.showErrorMessage(`Failed to reload rule: ${error.message}`);
      }
    });

    watcher.onDidDelete(() => {
      console.log(`[Rules] Rule file deleted: ${filePath}`);
      const ruleId = this.generateRuleId(filePath);
      this.rules.delete(ruleId);
      this.fileWatchers.delete(filePath);
      watcher.dispose();
    });

    this.fileWatchers.set(filePath, watcher);
  }

  /**
   * Get applicable rules based on query text
   * Returns rules that match keywords in the query
   */
  getApplicableRules(query: string): Rule[] {
    if (!query || this.rules.size === 0) {
      return [];
    }

    const queryLower = query.toLowerCase().trim();
    const applicableRules: Rule[] = [];

    // Skip very short queries that are likely greetings
    if (queryLower.length < 5) {
      return [];
    }

    for (const rule of this.rules.values()) {
      // If rule has explicit triggers, check if any match
      if (rule.triggers && rule.triggers.length > 0) {
        const matches = rule.triggers.some(trigger => {
          const triggerLower = trigger.toLowerCase();
          // Require that trigger appears as a word boundary, not just substring
          const regex = new RegExp(`\\b${triggerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          return regex.test(queryLower);
        });
        if (matches) {
          applicableRules.push(rule);
          console.log(`[Rules] Rule "${rule.id}" matched via trigger keyword`);
          continue;
        }
      }

      // If no explicit triggers, check if rule description or content keywords match query
      // Extract meaningful keywords from description (words longer than 3 chars, excluding common words)
      const commonWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'way', 'use', 'her', 'she', 'man', 'say', 'did', 'set', 'put', 'end', 'why', 'let', 'has', 'been', 'call', 'find', 'know', 'take', 'come', 'make', 'give', 'work', 'seem', 'feel', 'look', 'play', 'move', 'live', 'think', 'turn', 'become', 'leave', 'meet', 'keep', 'help', 'show', 'hear', 'believe', 'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'add', 'change', 'send', 'build', 'stay', 'cut', 'reach', 'pay', 'speak', 'read', 'allow', 'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remains', 'suggest', 'raise', 'pass', 'sell', 'decide', 'return', 'accept', 'require', 'argue', 'prove', 'realize', 'catch', 'spend', 'agree', 'understand']);
      
      if (rule.description) {
        const descriptionWords = rule.description
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 3 && !commonWords.has(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 0);
        
        // Check if any description keyword appears in query
        const descriptionMatches = descriptionWords.some(word => 
          queryLower.includes(word)
        );
        
        if (descriptionMatches) {
          applicableRules.push(rule);
          console.log(`[Rules] Rule "${rule.id}" matched via description keywords`);
          continue;
        }
      }

      // As a fallback, check rule content for keywords (but be more conservative)
      // Only match if there's clear intent (words like analyze, parse, examine, etc.)
      const analysisIntentKeywords = /\b(analyze|analysis|parse|examine|evaluate|process|format|generate)\b/i;
      const hasAnalysisIntent = analysisIntentKeywords.test(queryLower);
      
      if (hasAnalysisIntent && rule.content) {
        // Extract topic words from rule content (first 200 chars to avoid noise)
        const contentPreview = rule.content.toLowerCase().substring(0, 200);
        const contentWords = contentPreview
          .split(/\s+/)
          .filter(w => w.length > 4 && !commonWords.has(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 0)
          .slice(0, 5); // Limit to first 5 meaningful words
        
        // Check if any content keyword matches query
        const contentMatches = contentWords.some(word => 
          queryLower.includes(word)
        );
        
        if (contentMatches) {
          applicableRules.push(rule);
          console.log(`[Rules] Rule "${rule.id}" matched via content keywords + analysis intent`);
        }
      }
    }

    return applicableRules;
  }

  /**
   * Get applicable rules based on conversation history
   * Checks rules against all user messages in the conversation to ensure
   * rules triggered earlier continue to apply in follow-up messages
   */
  getApplicableRulesFromHistory(conversationHistory: readonly { role: string; content: string }[]): Rule[] {
    if (!conversationHistory || conversationHistory.length === 0 || this.rules.size === 0) {
      return [];
    }

    // Collect all user messages from history
    const userMessages = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .filter(content => content && content.trim().length >= 5); // Skip very short messages

    if (userMessages.length === 0) {
      return [];
    }

    // Combine all user messages into a single text for rule matching
    // This ensures rules triggered in earlier messages continue to apply
    const combinedText = userMessages.join(' ').toLowerCase();
    
    // Use the existing getApplicableRules logic but with combined text
    // We'll create a temporary method that checks against combined text
    const applicableRules: Rule[] = [];
    const matchedRuleIds = new Set<string>();

    for (const rule of this.rules.values()) {
      // Skip if already matched
      if (matchedRuleIds.has(rule.id)) {
        continue;
      }

      // If rule has explicit triggers, check if any match in any user message
      if (rule.triggers && rule.triggers.length > 0) {
        const matches = rule.triggers.some(trigger => {
          const triggerLower = trigger.toLowerCase();
          const regex = new RegExp(`\\b${triggerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          return userMessages.some(msg => regex.test(msg.toLowerCase()));
        });
        if (matches) {
          applicableRules.push(rule);
          matchedRuleIds.add(rule.id);
          console.log(`[Rules] Rule "${rule.id}" matched via trigger keyword in conversation history`);
          continue;
        }
      }

      // Check description keywords against all user messages
      const commonWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'way', 'use', 'her', 'she', 'man', 'say', 'did', 'set', 'put', 'end', 'why', 'let', 'has', 'been', 'call', 'find', 'know', 'take', 'come', 'make', 'give', 'work', 'seem', 'feel', 'look', 'play', 'move', 'live', 'think', 'turn', 'become', 'leave', 'meet', 'keep', 'help', 'show', 'hear', 'believe', 'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'add', 'change', 'send', 'build', 'stay', 'cut', 'reach', 'pay', 'speak', 'read', 'allow', 'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remains', 'suggest', 'raise', 'pass', 'sell', 'decide', 'return', 'accept', 'require', 'argue', 'prove', 'realize', 'catch', 'spend', 'agree', 'understand']);
      
      if (rule.description) {
        const descriptionWords = rule.description
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 3 && !commonWords.has(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 0);
        
        // Check if any description keyword appears in any user message
        const descriptionMatches = descriptionWords.some(word => 
          userMessages.some(msg => msg.toLowerCase().includes(word))
        );
        
        if (descriptionMatches) {
          applicableRules.push(rule);
          matchedRuleIds.add(rule.id);
          console.log(`[Rules] Rule "${rule.id}" matched via description keywords in conversation history`);
          continue;
        }
      }

      // Check content keywords with analysis intent
      const analysisIntentKeywords = /\b(analyze|analysis|parse|examine|evaluate|process|format|generate)\b/i;
      const hasAnalysisIntent = userMessages.some(msg => analysisIntentKeywords.test(msg.toLowerCase()));
      
      if (hasAnalysisIntent && rule.content) {
        const contentPreview = rule.content.toLowerCase().substring(0, 200);
        const contentWords = contentPreview
          .split(/\s+/)
          .filter(w => w.length > 4 && !commonWords.has(w))
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length > 0)
          .slice(0, 5);
        
        const contentMatches = contentWords.some(word => 
          userMessages.some(msg => msg.toLowerCase().includes(word))
        );
        
        if (contentMatches) {
          applicableRules.push(rule);
          matchedRuleIds.add(rule.id);
          console.log(`[Rules] Rule "${rule.id}" matched via content keywords + analysis intent in conversation history`);
        }
      }
    }

    return applicableRules;
  }

  /**
   * Get rules that are applicable based on tool names called
   * This helps when tools are called but the query didn't explicitly match rule triggers
   */
  getRulesForTools(toolNames: string[]): Rule[] {
    if (toolNames.length === 0) {
      return [];
    }

    const applicableRules: Rule[] = [];
    const toolNamesLower = toolNames.map(name => name.toLowerCase());

    for (const rule of this.rules.values()) {
      // Check if rule content mentions any of the tools
      const ruleContentLower = rule.content.toLowerCase();
      const ruleDescriptionLower = rule.description?.toLowerCase() || "";
      
      // Check if any tool name appears in rule content or description
      const toolMatches = toolNamesLower.some(toolName => {
        // Check for tool name in content (e.g., "analyze_latin" tool -> Latin analysis rule)
        if (ruleContentLower.includes(toolName) || ruleDescriptionLower.includes(toolName)) {
          return true;
        }
        
        // Check for partial matches (e.g., "analyze_latin" -> "latin" or "analyze")
        const toolParts = toolName.split(/[_\s-]/);
        return toolParts.some(part => {
          if (part.length > 3) {
            return ruleContentLower.includes(part) || ruleDescriptionLower.includes(part);
          }
          return false;
        });
      });

      if (toolMatches) {
        applicableRules.push(rule);
        console.log(`[Rules] Rule "${rule.id}" matched via tool name: ${toolNames.join(", ")}`);
      }
    }

    return applicableRules;
  }

  /**
   * Get all loaded rules
   */
  getAllRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a rule by ID
   */
  getRule(ruleId: string): Rule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Format rules content for inclusion in prompts
   */
  formatRulesForPrompt(rules: Rule[]): string {
    if (rules.length === 0) {
      return "";
    }

    let formatted = "\n\n## Rules to Follow\n\n";
    formatted += "=".repeat(80) + "\n";
    formatted += "⚠️ CRITICAL: APPLICABLE RULES - YOU MUST FOLLOW THESE RULES EXACTLY\n";
    formatted += "=".repeat(80) + "\n\n";

    for (const rule of rules) {
      formatted += `## Rule: ${rule.id}\n`;
      if (rule.description) {
        formatted += `**Description:** ${rule.description}\n\n`;
      }
      formatted += `${rule.content}\n\n`;
      formatted += "-".repeat(80) + "\n\n";
    }

    formatted += "=".repeat(80) + "\n";
    formatted += "END OF RULES - FOLLOW THE ABOVE SPECIFICATIONS CAREFULLY\n";
    formatted += "=".repeat(80) + "\n\n";

    return formatted;
  }

  /**
   * Clear all rules and watchers
   */
  private clearRules(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose();
    }
    this.fileWatchers.clear();
    this.rules.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clearRules();
  }
}

