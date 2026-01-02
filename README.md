# Harmony VS Code Extension

## Overview
Harmony is a VS Code extension that provides AI‑assisted code generation, refactoring, and conversational assistance. It integrates with a custom LLM server (or compatible OpenAI API) to offer context‑aware suggestions directly within the editor.

## Features
- **AI‑powered code generation** using large language models.
- **Conversation‑based assistance** for debugging, refactoring, and exploring code.
- **Multi‑Component Processor (MCP)** framework for extensible tool integrations.
- **Webview UI** for rich, interactive responses.
- **Comprehensive test suite** covering core functionality.

## Project Structure
```
.
├─ src                     # Extension source code (TypeScript)
│  ├─ harmony              # Core Harmony logic (stage handling, token filtering, etc.)
│  ├─ utils                # Helper utilities (file management, logging, etc.)
│  ├─ webview              # Webview UI source (HTML, TS modules, styles)
│  └─ extension.ts         # VS Code activation entry point
├─ out                     # Compiled JavaScript output (used by the extension)
├─ dist                    # Bundled extension package (VSIX, webview bundle)
├─ templates               # Jinja2 templates for AI‑generated content
├─ coverage                # Test coverage reports
├─ media                   # Extension icons and assets
├─ test‑webpack.js         # Webpack test configuration
├─ jest.config.js          # Jest test configuration
└─ package.json            # Extension metadata and dependencies
```

## Installation
1. **Install from the VS Code Marketplace** (search for "Harmony").
2. **Configure the server** in your VS Code settings (`settings.json`):
```json
{
  "harmony.serverUrl": "http://localhost:8000",
  "harmony.apiKey": "your‑api‑key",
  "harmony.model": "gpt-oss-120b",
  "harmony.temperature": 0.7,
  "harmony.maxTokens": 2048
}
```
3. Reload VS Code to activate the extension.

## Usage
- **Command Palette** (`Ctrl+Shift+P`):
  - `Harmony: Ask` – start a conversational session.
  - `Harmony: Generate Code` – generate code snippets based on a prompt.
  - `Harmony: Refactor Selection` – get AI‑driven refactoring suggestions.
- **Inline suggestions** appear as ghost text while you type.
- **Webview panel** shows detailed responses, including formatted code and tool output.

## Contributing
1. Fork the repository.
2. Run `npm install` to install dependencies.
3. Build the extension with `npm run compile`.
4. Run tests using `npm test`.
5. Submit a pull request with a clear description of changes.

## License
This project is licensed under the MIT License – see the `LICENSE` file for details.
