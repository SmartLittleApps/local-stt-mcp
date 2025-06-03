import { execa } from 'execa';
import { promises as fs } from 'fs';
import path from 'path';
import { DiarizationError, DiarizationSegment, DiarizationOptions } from '../types/index.js';

export interface DiarizationParams {
  audio_file_path: string;
  model: string;
  min_speakers: number;
  max_speakers: number;
  tempDir: string;
}

export class DiarizationPythonManager {
  private pythonExecutable?: string;
  private pythonEnvironment?: NodeJS.ProcessEnv;
  private initialized = false;

  constructor() {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.error('[Diarization] Starting Python environment detection...');
    
    try {
      // Step 1: Find working Python executable
      this.pythonExecutable = await this.findPythonExecutable();
      console.error(`[Diarization] Found Python: ${this.pythonExecutable}`);
      
      // Step 2: Set up environment variables
      this.pythonEnvironment = this.buildEnvironment();
      
      // Step 3: Verify diarization packages
      await this.verifyDiarizationPackages();
      
      this.initialized = true;
      console.error('[Diarization] ✓ Python environment ready');
    } catch (error) {
      console.error('[Diarization] ✗ Python environment setup failed:', error);
      throw new DiarizationError(
        'SETUP_ERROR',
        `Python environment setup failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check Python availability first
      const pythonResult = await this.checkPythonAvailability();
      if (!pythonResult.success) {
        console.error(`[Diarization] Python check failed: ${pythonResult.error}`);
        return false;
      }
      
      // Check PyTorch and pyannote import
      const packageResult = await this.checkDiarizationPackages(pythonResult.executable!);
      if (!packageResult.success) {
        console.error(`[Diarization] Package check failed: ${packageResult.error}`);
        return false;
      }
      
      console.error('[Diarization] ✓ All dependencies available');
      return true;
    } catch (error) {
      console.error(`[Diarization] ✗ Availability check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async findPythonExecutable(): Promise<string> {
    // HARDCODED APPROACH FIRST (proven pattern from TTS implementation)
    const KNOWN_WORKING_PYTHON = '/opt/miniconda3/bin/python3';
    
    console.error(`[Diarization] Trying known working Python: ${KNOWN_WORKING_PYTHON}`);
    try {
      await this.testPythonExecutable(KNOWN_WORKING_PYTHON);
      console.error(`[Diarization] Success: Using hardcoded Python path`);
      return KNOWN_WORKING_PYTHON;
    } catch (error) {
      console.error(`[Diarization] Hardcoded Python failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Environment variable fallback
    if (process.env.PYTHON_EXECUTABLE) {
      console.error(`[Diarization] Trying PYTHON_EXECUTABLE: ${process.env.PYTHON_EXECUTABLE}`);
      try {
        await this.testPythonExecutable(process.env.PYTHON_EXECUTABLE);
        return process.env.PYTHON_EXECUTABLE;
      } catch (error) {
        console.error(`[Diarization] Environment Python failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Standard detection fallback
    const candidates = ['python3', '/opt/homebrew/bin/python3', '/usr/bin/python3'];
    console.error(`[Diarization] Fallback detection: ${candidates.join(', ')}`);
    
    for (const candidate of candidates) {
      try {
        await this.testPythonExecutable(candidate);
        return candidate;
      } catch (error) {
        console.error(`[Diarization] Failed: ${candidate}`);
      }
    }
    
    throw new Error(`No Python executable works. Install miniconda3 at /opt/miniconda3/ or set PYTHON_EXECUTABLE.`);
  }

  private async testPythonExecutable(executable: string): Promise<void> {
    try {
      const result = await execa(executable, ['--version'], {
        timeout: 5000,
        reject: false,
        encoding: 'utf8'
      });
      
      if (result.exitCode !== 0) {
        throw new Error(`Python executable ${executable} failed with code ${result.exitCode}`);
      }
    } catch (error) {
      throw new Error(`Python test failed for ${executable}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    const env = {
      ...process.env,
      // Critical Python environment variables (from TTS lessons learned)
      PYTHONUNBUFFERED: '1',              // Real-time output
      PYTHONIOENCODING: 'utf-8',          // Prevent encoding issues
      PYTHONDONTWRITEBYTECODE: '1',       // Avoid .pyc files
      PYTHONWARNINGS: 'ignore',           // Reduce noise
      
      // Inherit existing PYTHONPATH, don't override
      ...(process.env.PYTHONPATH && { PYTHONPATH: process.env.PYTHONPATH }),
      PATH: process.env.PATH || '/opt/miniconda3/bin:/usr/bin:/bin',
      
      // MCP desktop applications - inherit user environment
      HOME: process.env.HOME || '',
      USER: process.env.USER || '',
      
      // HuggingFace token for model access
      ...(process.env.HF_TOKEN && { HF_TOKEN: process.env.HF_TOKEN }),
      
      // Locale settings (prevents Unicode issues)
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8'
    };
    
    return env;
  }

  private async checkPythonAvailability(): Promise<{success: boolean, executable?: string, error?: string}> {
    const pythonCandidates = [
      '/opt/miniconda3/bin/python3',
      'python3',
      'python',
      '/usr/bin/python3',
      '/opt/homebrew/bin/python3'
    ];

    for (const python of pythonCandidates) {
      try {
        console.error(`[Diarization] Testing Python: ${python}`);
        const result = await execa(python, ['--version'], {
          timeout: 5000,
          reject: false,
          encoding: 'utf8',
          env: this.buildEnvironment()
        });

        if (result.exitCode === 0) {
          console.error(`[Diarization] Python found: ${python} - ${result.stdout.trim()}`);
          return { success: true, executable: python };
        }
      } catch (error) {
        console.error(`[Diarization] Python test failed for ${python}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    return { success: false, error: 'No working Python executable found' };
  }

  private async checkDiarizationPackages(pythonExecutable: string): Promise<{success: boolean, error?: string}> {
    const importScript = `
import sys
import os
try:
    # Check PyTorch with MPS support
    import torch
    print(f"PyTorch version: {torch.__version__}")
    print(f"MPS available: {torch.backends.mps.is_available()}")
    
    # Check pyannote.audio
    import pyannote.audio
    print(f"Pyannote version: {pyannote.audio.__version__}")
    
    # Check HuggingFace token
    hf_token = os.environ.get('HF_TOKEN')
    if hf_token:
        print("HuggingFace token available")
    else:
        print("WARNING: HF_TOKEN not set - may need for model access")
    
    print("SUCCESS: All diarization packages available")
    sys.exit(0)
except ImportError as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    print("Install with: pip install torch torchaudio pyannote.audio", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"OTHER_ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;

    try {
      console.error(`[Diarization] Testing package imports with: ${pythonExecutable}`);
      const result = await execa(pythonExecutable, ['-c', importScript], {
        timeout: 30000,
        reject: false,
        encoding: 'utf8',
        env: this.buildEnvironment() // Build environment fresh each time
      });

      console.error(`[Diarization] Package test completed: exitCode=${result.exitCode}`);
      console.error(`[Diarization] STDOUT: ${result.stdout.trim()}`);
      
      if (result.stderr) {
        console.error(`[Diarization] STDERR: ${result.stderr.trim()}`);
      }

      if (result.exitCode === 0 && result.stdout.includes('SUCCESS')) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: result.stderr || `Exit code ${result.exitCode}`
        };
      }
    } catch (error) {
      console.error(`[Diarization] Package test exception: ${error instanceof Error ? error.message : String(error)}`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async verifyDiarizationPackages(): Promise<void> {
    if (!this.pythonExecutable) {
      throw new Error('Python executable not detected');
    }

    const verificationResult = await this.checkDiarizationPackages(this.pythonExecutable);
    if (!verificationResult.success) {
      throw new Error(`Package verification failed: ${verificationResult.error}`);
    }
  }

  // Main diarization execution method
  async runDiarization(params: DiarizationParams): Promise<DiarizationSegment[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pythonExecutable) {
      throw new DiarizationError(
        'SETUP_ERROR', 
        'Python executable not available - initialization failed'
      );
    }

    // Generate Python script
    const script = this.generateDiarizationScript(params);
    const scriptPath = path.join(params.tempDir, `diarization_${Date.now()}.py`);
    
    try {
      // Write script to temp file
      await fs.writeFile(scriptPath, script);
      console.error(`[Diarization] Script written to: ${scriptPath}`);
      
      // Execute script with execa (more reliable than spawn)
      const result = await this.executeDiarizationScript(scriptPath, params);
      
      // Clean up script
      await fs.unlink(scriptPath).catch(() => {}); // Ignore cleanup errors
      
      return result;
    } catch (error) {
      // Clean up script on error
      await fs.unlink(scriptPath).catch(() => {});
      throw error;
    }
  }

  private async executeDiarizationScript(scriptPath: string, params: DiarizationParams): Promise<DiarizationSegment[]> {
    console.error(`[Diarization] Executing script with: ${this.pythonExecutable}`);
    console.error(`[Diarization] Audio file: ${params.audio_file_path}`);
    
    try {
      const result = await execa(this.pythonExecutable!, [scriptPath], {
        timeout: 300000, // 5 minute timeout for long audio
        reject: false,
        encoding: 'utf8',
        env: this.buildEnvironment(), // Build environment fresh each time
        cwd: path.dirname(scriptPath)
      });

      console.error(`[Diarization] Process completed: exitCode=${result.exitCode}`);
      console.error(`[Diarization] STDOUT: ${result.stdout.slice(0, 500)}...`); // First 500 chars
      
      if (result.stderr) {
        console.error(`[Diarization] STDERR: ${result.stderr.slice(0, 500)}...`);
      }

      if (result.exitCode === 0) {
        try {
          const output = JSON.parse(result.stdout);
          if (output.error) {
            throw new DiarizationError('PROCESSING_ERROR', output.error);
          }
          return output.segments || [];
        } catch (parseError) {
          throw new DiarizationError(
            'PROCESSING_ERROR',
            `Failed to parse diarization output: ${parseError instanceof Error ? parseError.message : String(parseError)}`
          );
        }
      } else {
        throw new DiarizationError(
          'PROCESSING_ERROR',
          `Diarization script failed (exit code ${result.exitCode}): ${result.stderr || result.stdout}`
        );
      }
    } catch (error) {
      if (error instanceof DiarizationError) {
        throw error;
      }
      
      throw new DiarizationError(
        'PROCESSING_ERROR',
        `Script execution failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  private generateDiarizationScript(params: DiarizationParams): string {
    return `#!/usr/bin/env python3
"""
Generated diarization script for SpeechToText-MCP
"""

import sys
import json
import os

def setup_device():
    """Configure PyTorch device for M1 optimization"""
    try:
        import torch
        if torch.backends.mps.is_available():
            print("Using MPS (Apple Silicon) acceleration", file=sys.stderr)
            return torch.device("mps")
        elif torch.cuda.is_available():
            print("Using CUDA acceleration", file=sys.stderr)
            return torch.device("cuda")
        else:
            print("Using CPU (no acceleration available)", file=sys.stderr)
            return torch.device("cpu")
    except ImportError:
        print("PyTorch not available, falling back to CPU", file=sys.stderr)
        return "cpu"

def diarize_with_pyannote(audio_path, min_speakers, max_speakers):
    """Run diarization using Pyannote.audio 3.1+"""
    try:
        from pyannote.audio import Pipeline
        
        device = setup_device()
        print(f"Processing: {audio_path}", file=sys.stderr)
        print(f"Speaker range: {min_speakers}-{max_speakers}", file=sys.stderr)
        
        # Get HuggingFace token
        hf_token = os.environ.get('HF_TOKEN')
        if not hf_token:
            print("WARNING: HF_TOKEN not set - may fail for private models", file=sys.stderr)
        
        # Load pipeline
        print("Loading pyannote diarization pipeline...", file=sys.stderr)
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )
        
        # Move to device
        if hasattr(pipeline, 'to') and device != "cpu":
            pipeline.to(device)
        
        print("Running diarization...", file=sys.stderr)
        
        # Run diarization
        diarization = pipeline(
            audio_path, 
            min_speakers=min_speakers, 
            max_speakers=max_speakers
        )
        
        # Convert to standardized format
        segments = []
        for segment, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": float(segment.start),
                "end": float(segment.end), 
                "speaker": str(speaker)
            })
        
        print(f"Diarization complete: {len(segments)} segments, {len(set(seg['speaker'] for seg in segments))} speakers", file=sys.stderr)
        
        return {
            "segments": segments,
            "num_speakers": len(set(seg["speaker"] for seg in segments)),
            "model": "pyannote-3.1",
            "device": str(device)
        }
        
    except Exception as e:
        import traceback
        print(f"Diarization error: {e}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return {"error": str(e)}

def main():
    try:
        # Parameters from TypeScript
        audio_path = "${params.audio_file_path}"
        model = "${params.model}"
        min_speakers = ${params.min_speakers}
        max_speakers = ${params.max_speakers}
        
        print(f"Starting diarization with {model} model", file=sys.stderr)
        
        if model == "pyannote":
            result = diarize_with_pyannote(audio_path, min_speakers, max_speakers)
        else:
            result = {"error": f"Unsupported model: {model}"}
        
        # Output result as JSON
        print(json.dumps(result))
        
        if "error" in result:
            sys.exit(1)
        else:
            sys.exit(0)
            
    except Exception as e:
        import traceback
        error_result = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
  }
}