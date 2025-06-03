import { z } from 'zod';
import { WhisperIntegration } from '../whisper/integration.js';
import { HealthCheckResult } from '../types/index.js';
import { platform, arch } from 'os';
import { cpus } from 'os';

const HealthCheckArgsSchema = z.object({});

type HealthCheckArgs = z.infer<typeof HealthCheckArgsSchema>;

export const healthCheckTool = {
  name: 'health_check',
  description: 'Check whisper.cpp installation and system configuration',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  },
  zodSchema: HealthCheckArgsSchema,
  
  async handler(args: HealthCheckArgs) {
    const whisper = new WhisperIntegration();
    
    try {
      // Check whisper installation
      const installation = await whisper.checkInstallation();
      
      // Get available models
      const availableModels = whisper.getAvailableModels();
      
      // Determine recommended model
      const recommendedModel = determineRecommendedModel(availableModels);
      
      // Get system info
      const systemInfo = {
        platform: platform(),
        arch: arch(),
        threads_available: cpus().length
      };

      const result: HealthCheckResult = {
        whisper_installed: installation.installed,
        whisper_version: installation.version,
        models_available: availableModels,
        recommended_model: recommendedModel,
        system_info: systemInfo
      };

      // Add diagnostics and recommendations
      const diagnostics = generateDiagnostics(result, installation.error);
      
      const response = {
        status: installation.installed ? 'healthy' : 'needs_setup',
        ...result,
        diagnostics,
        installation_error: installation.error
      };
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

function determineRecommendedModel(availableModels: string[]): string {
  // Priority order for recommendations
  const priorities = ['base.en', 'tiny.en', 'small.en', 'base', 'small'];
  
  for (const model of priorities) {
    if (availableModels.includes(model)) {
      return model;
    }
  }
  
  return availableModels.length > 0 ? availableModels[0] : 'base.en';
}

function generateDiagnostics(result: HealthCheckResult, installationError?: string): any {
  const diagnostics: any = {
    overall_status: 'unknown',
    issues: [],
    recommendations: []
  };

  // Check whisper installation
  if (!result.whisper_installed) {
    diagnostics.overall_status = 'critical';
    diagnostics.issues.push('whisper.cpp not installed or not in PATH');
    diagnostics.recommendations.push('Install whisper.cpp: brew install whisper-cpp');
    
    if (installationError) {
      diagnostics.installation_details = installationError;
    }
  }

  // Check models
  if (result.models_available.length === 0) {
    if (diagnostics.overall_status !== 'critical') {
      diagnostics.overall_status = 'warning';
    }
    diagnostics.issues.push('No whisper models found');
    diagnostics.recommendations.push('Download models: npm run setup:models or manually download to models/ directory');
  }

  // Check M1 optimization
  if (result.system_info.arch === 'arm64' && result.system_info.platform === 'darwin') {
    diagnostics.m1_optimization = 'available';
    diagnostics.recommended_threads = Math.min(4, result.system_info.threads_available);
    diagnostics.recommendations.push(`Optimal thread count for M1: ${diagnostics.recommended_threads}`);
  }

  // Set overall status if no issues found
  if (diagnostics.overall_status === 'unknown') {
    diagnostics.overall_status = result.models_available.length > 0 ? 'healthy' : 'warning';
  }

  return diagnostics;
}