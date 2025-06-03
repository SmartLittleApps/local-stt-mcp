#!/usr/bin/env node

/**
 * whisper.cpp MCP Server
 * 
 * A Model Context Protocol server that provides speech-to-text transcription
 * using whisper.cpp optimized for M1 MacBook Pro performance.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import tools
import { transcribeTool } from './tools/transcribe.js';
import { transcribeLongTool } from './tools/transcribe-long.js';
import { transcribeWithSpeakersTool } from './tools/transcribe-with-speakers.js';
import { listModelsTool } from './tools/list-models.js';
import { healthCheckTool } from './tools/health-check.js';
import { versionTool } from './tools/version.js';

// Tool registry
const tools = {
  [transcribeTool.name]: transcribeTool,
  [transcribeLongTool.name]: transcribeLongTool,
  [transcribeWithSpeakersTool.name]: transcribeWithSpeakersTool,
  [listModelsTool.name]: listModelsTool,
  [healthCheckTool.name]: healthCheckTool,
  [versionTool.name]: versionTool
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPackageVersion(): string {
  try {
    const packageJsonPath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '1.0.1';
  }
}

/**
 * Create and configure the MCP server
 */
function createServer() {
  const version = getPackageVersion();
  const server = new Server(
    {
      name: 'whisper-mcp-server',
      version: version
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Error handling
  server.onerror = (error) => console.error('[MCP Error]', error);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.values(tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    const tool = tools[name];
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      // Execute tool with provided arguments
      const result = await tool.handler(args as any);
      
      // Ensure result is in proper MCP format
      if (typeof result === 'string') {
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      }
      
      // If result already has proper format, return as-is
      if (result && typeof result === 'object' && 'content' in result) {
        return result;
      }
      
      // Convert other formats to text
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
    }
  });

  return server;
}

/**
 * Main server startup
 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  // Error handling
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  // Start server
  try {
    await server.connect(transport);
    console.error('whisper.cpp MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
}