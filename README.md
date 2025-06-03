# Local Speech-to-Text MCP Server

A high-performance Model Context Protocol (MCP) server providing local speech-to-text transcription using whisper.cpp, optimized for Apple Silicon.

## 🎯 Features

- **🏠 100% Local Processing**: No cloud APIs, complete privacy
- **🚀 Apple Silicon Optimized**: 15x+ real-time transcription speed
- **🎤 Speaker Diarization**: Identify and separate multiple speakers
- **📝 Multiple Output Formats**: txt, json, vtt, srt, csv
- **💾 Low Memory Footprint**: <2GB memory usage
- **🔧 TypeScript**: Full type safety and modern development

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- whisper.cpp (`brew install whisper-cpp`)
- **For speaker diarization**: Python 3.8+ and HuggingFace token (free)

### Installation

```bash
git clone https://github.com/your-username/local-stt-mcp.git
cd local-stt-mcp/mcp-server
npm install
npm run build

# Download whisper models
npm run setup:models

# For speaker diarization, set HuggingFace token
export HF_TOKEN="your_token_here"  # Get free token from huggingface.co
```

**Speaker Diarization Note**: Requires HuggingFace account and accepting [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) license.

### MCP Client Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "whisper-mcp": {
      "command": "node",
      "args": ["path/to/local-stt-mcp/mcp-server/dist/index.js"]
    }
  }
}
```

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `transcribe` | Basic audio transcription |
| `transcribe_long` | Long audio file processing with chunking |
| `transcribe_with_speakers` | Speaker diarization and transcription |
| `list_models` | Show available whisper models |
| `health_check` | System diagnostics |
| `version` | Server version information |

## 📊 Performance

**Apple Silicon Benchmarks:**
- **Processing Speed**: 15.8x real-time (vs WhisperX 5.5x)
- **Memory Usage**: <2GB (vs WhisperX ~4GB)
- **GPU Acceleration**: ✅ Apple Neural Engine
- **Setup**: Medium complexity but superior performance

See `/benchmarks/` for detailed performance comparisons.

## 🏗️ Project Structure

```
mcp-server/
├── src/                    # TypeScript source code
│   ├── tools/             # MCP tool implementations
│   ├── whisper/           # whisper.cpp integration
│   ├── utils/             # Speaker diarization & utilities
│   └── types/             # Type definitions
├── dist/                  # Compiled JavaScript
└── python/                # Python dependencies
```

## 🔧 Development

```bash
# Build
npm run build

# Development mode (watch)
npm run dev

# Linting & formatting
npm run lint
npm run format

# Type checking
npm run type-check
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for optimized inference
- [OpenAI Whisper](https://github.com/openai/whisper) for the original models
- [Model Context Protocol](https://modelcontextprotocol.io/) for the framework
- [Pyannote.audio](https://github.com/pyannote/pyannote-audio) for speaker diarization