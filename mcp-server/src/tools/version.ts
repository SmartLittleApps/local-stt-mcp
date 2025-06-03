import { z } from 'zod';
import { readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VersionArgsSchema = z.object({});

type VersionArgs = z.infer<typeof VersionArgsSchema>;

function getPackageVersion(): string {
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return 'unknown';
  }
}

function getBuildTimestamp(): string {
  try {
    // Get modification time of the compiled index.js file
    const indexPath = join(__dirname, '../index.js');
    const stats = statSync(indexPath);
    return stats.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export const versionTool = {
  name: 'version',
  description: 'Get server version and build information',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  },
  
  async handler(args: VersionArgs) {
    const version = getPackageVersion();
    const buildTime = getBuildTimestamp();
    const serverInfo = {
      name: 'whisper-mcp-server',
      version: version,
      build_timestamp: buildTime,
      description: 'whisper.cpp MCP server for local speech-to-text transcription',
      capabilities: [
        'audio transcription',
        'multiple output formats',
        'M1 optimization',
        'local processing'
      ],
      supported_formats: ['wav', 'mp3', 'm4a', 'flac', 'ogg'],
      output_formats: ['txt', 'vtt', 'srt', 'json', 'csv'],
      whisper_models: ['tiny.en', 'base.en', 'small.en', 'base', 'small', 'medium', 'large-v3'],
      author: 'whisper-mcp-server',
      license: 'MIT'
    };
    
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(serverInfo, null, 2)
      }]
    };
  }
};