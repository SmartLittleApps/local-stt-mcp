import { z } from 'zod';
import { WhisperIntegration } from '../whisper/integration.js';
import { ModelInfo } from '../types/index.js';

const ListModelsArgsSchema = z.object({});

type ListModelsArgs = z.infer<typeof ListModelsArgsSchema>;

// Model metadata for recommendations
const MODEL_INFO: Record<string, ModelInfo> = {
  'tiny.en': {
    name: 'tiny.en',
    size: '39 MB',
    description: 'Smallest English-only model, fastest processing',
    languages: ['en'],
    speed_rating: 5,
    accuracy_rating: 2,
    recommended_for: ['quick transcription', 'real-time processing', 'low-resource environments']
  },
  'base.en': {
    name: 'base.en',
    size: '142 MB',  
    description: 'Balanced English-only model, good speed/accuracy trade-off',
    languages: ['en'],
    speed_rating: 4,
    accuracy_rating: 3,
    recommended_for: ['general transcription', 'M1 MacBook Pro', 'balanced performance']
  },
  'small.en': {
    name: 'small.en',
    size: '488 MB',
    description: 'Higher accuracy English-only model',
    languages: ['en'],
    speed_rating: 3,
    accuracy_rating: 4,
    recommended_for: ['high accuracy needs', 'clear audio', 'professional transcription']
  },
  'base': {
    name: 'base',
    size: '142 MB',
    description: 'Multilingual base model',
    languages: ['99 languages'],
    speed_rating: 4,
    accuracy_rating: 3,
    recommended_for: ['multilingual content', 'language detection', 'general purpose']
  },
  'small': {
    name: 'small',
    size: '488 MB',
    description: 'Higher accuracy multilingual model',
    languages: ['99 languages'],
    speed_rating: 3,
    accuracy_rating: 4,
    recommended_for: ['multilingual high accuracy', 'professional use', 'diverse content']
  }
};

export const listModelsTool = {
  name: 'list_models',
  description: 'List available whisper models with performance recommendations',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  },
  
  async handler(args: ListModelsArgs) {
    const whisper = new WhisperIntegration();
    
    try {
      const availableModels = whisper.getAvailableModels();
      
      const modelDetails = availableModels.map(model => {
        const info = MODEL_INFO[model];
        return {
          model: model,
          available: true,
          ...info
        };
      });

      // Add info about models not yet downloaded
      const allSupportedModels = Object.keys(MODEL_INFO);
      const notDownloaded = allSupportedModels.filter(model => !availableModels.includes(model));
      
      const notDownloadedDetails = notDownloaded.map(model => ({
        model: model,
        available: false,
        ...MODEL_INFO[model],
        download_note: 'Model not downloaded - use setup:models script or download manually'
      }));

      const response = {
        available_models: modelDetails,
        not_downloaded: notDownloadedDetails,
        recommended_for_m1: 'base.en',
        performance_notes: {
          fastest: 'tiny.en',
          balanced: 'base.en', 
          most_accurate: 'small.en',
          multilingual_balanced: 'base',
          multilingual_accurate: 'small'
        },
        download_instructions: {
          base_en: 'curl -L -O https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
          models_directory: 'Place models in: models/ directory'
        }
      };
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};