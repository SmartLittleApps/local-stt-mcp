#!/usr/bin/env node

/**
 * Update version and rebuild for testing
 */

import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';

function updateVersion() {
  try {
    // Read current package.json
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    
    // Parse current version and increment patch
    const [major, minor, patch] = packageJson.version.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;
    
    // Update version
    packageJson.version = newVersion;
    
    // Write back to package.json
    writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`📦 Version updated: ${packageJson.version} → ${newVersion}`);
    
    // Rebuild
    console.log('🔨 Rebuilding...');
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    
    build.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Build completed successfully!');
        console.log('🔄 Please restart your MCP client to use the updated server.');
      } else {
        console.error('❌ Build failed with code:', code);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to update version:', error.message);
  }
}

updateVersion();