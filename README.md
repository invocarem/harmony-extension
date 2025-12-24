# Harmony - VS Code AI Assistant

## Overview

Harmony is a powerful VS Code extension that integrates AI assistance directly into your development workflow. It connects to Harmony AI servers to provide code explanations, refactoring suggestions, code generation, and interactive chat capabilities.

## Features

### 🤖 AI-Powered Code Assistance
- **Explain Code**: Get detailed explanations of selected code snippets
- **Refactor Code**: Receive optimized, more efficient versions of your code
- **Generate Code**: Create code from natural language descriptions
- **Interactive Chat**: Have conversations with the AI assistant about your code

### 🔧 MCP (Model Context Protocol) Integration
- Connect to multiple MCP servers for extended functionality
- Access external tools and services directly from the chat
- Automatic tool discovery and execution
- JSON-RPC communication with MCP servers

### 📝 Smart Templates
- Customizable Jinja2 templates for different use cases
- Automatic prompt formatting
- Support for Harmony's special token format

### 💬 Modern Chat Interface
- Clean, VS Code-themed webview interface
- Markdown rendering with syntax highlighting
- Reasoning display for model thought processes
- Code context sharing from active editor

## Installation

### Prerequisites
- VS Code 1.60.0 or higher
- Access to a Harmony AI server (or compatible OpenAI API server)

### Installation Steps
1. Install the extension from VS Code Marketplace (coming soon)
2. Configure your Harmony server settings
3. Set up any desired MCP servers

## Configuration

### Basic Configuration
Add the following to your VS Code settings (`settings.json`):

```json
{
  "harmony.serverUrl": "http://localhost:8000",
  "harmony.apiKey": "your-api-key-here",
  "harmony.model": "gpt-oss-120b",
  "harmony.temperature": 0.7,
  "harmony.maxTokens": 2048
}
```

### MCP Server Configuration
Configure MCP servers in your settings:

```json
{
  "harmony.mcpServers": [

    {
      "name": "whitaker",
      "command": "docker-compose",
      "args": [
        "-f",
        "c:/code/github/ai-coder/docker-compose.yml",
        "exec",
        "-T",
        "whitaker-mcp",
        "python3",
        "/app/whitaker_server.py"
      ],
      "type": "stdio"
    }
    
  ]
}
```

## Usage

### Commands
Access Harmony through the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- `Harmony: Open Chat` - Open interactive chat panel
- `Harmony: Explain Code` - Explain selected code
- `Harmony: Refactor Code` - Refactor selected code
- `Harmony: Generate Code` - Generate code from description
- `Harmony: Test Format` - Test response formatting (debug)

### Chat Interface
1. Open the chat panel using the command or click the Harmony icon
2. Type your questions or requests in the input field
3. Use the 📄 button to send current file context
4. View AI responses with reasoning and formatted output

### Code Actions
1. Select code in the editor
2. Right-click and choose:
   - "Harmony: Explain this code"
   - "Harmony: Refactor this code"
3. Or use the Command Palette commands

### MCP Tool Usage
When MCP servers are configured, the AI can automatically use available tools. Example interactions:

```
User: What's the weather in San Francisco?
AI: <tool_call name="weather" args='{"location": "San Francisco"}' />
Tool Result: 72°F, Sunny
AI: It's 72°F and sunny in San Francisco!
```

## Architecture

### Core Components
- **`HarmonyAssistant`**: Main extension class coordinating all components
- **`HarmonyClient`**: Handles communication with AI servers
- **`TemplateRenderer`**: Manages Jinja2 template rendering
- **`CodeActions`**: Implements code-specific functionality
- **`WebviewManager`**: Manages chat interface webview
- **`MCPManager`**: Coordinates MCP server connections

### File Structure
```
harmony-extension/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── config.ts             # Configuration management
│   ├── llamaClient.ts        # AI server communication
│   ├── templateRenderer.ts   # Template system
│   ├── codeActions.ts        # Code-specific actions
│   ├── webviewManager.ts     # Chat interface management
│   ├── mcpManager.ts         # MCP server coordination
│   └── mcpClient.ts          # MCP protocol implementation
├── templates/                # Jinja2 templates
├── media/                   # Icons and assets
├── package.json            # Extension manifest
└── README.md              # This file
```

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Verify server URL is correct
   - Check if the Harmony server is running
   - Ensure API key is valid

2. **MCP Server Issues**
   - Check server commands are installed and executable
   - Verify MCP server configuration
   - Check console for MCP initialization errors

3. **Response Format Issues**
   - Ensure server is compatible with Harmony format
   - Check template files exist in templates directory
   - Verify model supports expected response format

### Debug Mode
Enable debug logging by checking the VS Code Developer Tools console:
- Open Developer Tools (Help → Toggle Developer Tools)
- Look for `[DEBUG]` and `[Harmony]` logs

## Development

### Building from Source
```bash
git clone <repository-url>
cd harmony-extension
npm install
npm run compile
```

### Testing
```bash
npm test
# or
npm run test-watch
```

### Debugging
1. Open the extension in VS Code
2. Press F5 to launch extension development host
3. Use the test commands in the new window

## API Compatibility

### Supported AI Servers
- Harmony AI servers
- OpenAI-compatible APIs
- Llama.cpp servers with OpenAI compatibility

### MCP Compatibility
- MCP protocol version: 2024-11-05
- Supports stdio-based MCP servers
- Compatible with official MCP servers

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

Please ensure code follows the existing style and includes appropriate documentation.

## License

[Specify your license here]

## Support

For issues, questions, or feature requests:
- [GitHub Issues](link-to-issues)
- [Documentation](link-to-docs)
- [Discord/Slack Community](link-to-community)

---

**Note**: This extension requires an active connection to an AI server. Performance and capabilities depend on the underlying model and server configuration.