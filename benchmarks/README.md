# Performance Benchmarks

This directory contains performance benchmark data comparing our whisper.cpp MCP server with WhisperX, a popular alternative speech-to-text solution.

## Test Environment

- **Test Date**: June 2025
- **Hardware**: Apple Silicon (M1) MacBook Pro
- **Test Audio**: 5-minute meeting recording with two speakers
- **Python Version**: 3.12.2

## Benchmark Results Summary

| Metric | whisper.cpp MCP Server | WhisperX | Advantage |
|--------|------------------------|----------|-----------|
| **Processing Speed** | 15.8x real-time | 5.5x real-time | **3x faster** |
| **Memory Usage** | <2GB | ~3-4GB | **2x more efficient** |
| **Apple Silicon GPU** | ✅ Apple Neural Engine | ❌ CPU only | **Hardware optimized** |
| **Speaker Diarization** | 38 seconds total | >2 minutes | **3x+ faster** |
| **Installation** | Medium (2 tools) | Simple (1 package) | WhisperX simpler |

## Key Performance Highlights

### ⚡ **Speed Advantage**
- **15.8x real-time processing** vs WhisperX's 5.5x
- Complete speaker diarization in 38 seconds vs 2+ minutes
- Optimized for Apple Silicon architecture

### 💾 **Memory Efficiency** 
- **<2GB memory usage** vs WhisperX's ~4GB
- Suitable for resource-constrained environments
- Better performance on MacBooks with limited RAM

### 🔧 **Apple Silicon Optimization**
- Native Apple Neural Engine support
- Hardware-accelerated transcription
- Designed specifically for M1/M2/M3/M4 performance

## Test Methodology

### Our MCP Server
```bash
# Using MCP tool for speaker diarization
transcribe_with_speakers sample_meeting_5min.wav
```

### WhisperX Comparison
```bash
# Standard WhisperX installation and testing
pip install whisperx
time whisperx sample_meeting_5min.wav --model base.en --diarize --device cpu --compute_type int8
```

## Important Notes

### 📊 **Benchmark Scope**
These benchmarks represent testing on Apple Silicon hardware with specific audio characteristics. Performance may vary based on:

- **Hardware**: Different chips (Intel, AMD, NVIDIA) may show different results
- **Audio Quality**: File length, speakers, background noise, language
- **Configuration**: Model selection and parameter tuning can impact performance
- **System Resources**: Available memory and CPU load affect results

### 🔄 **Reproducibility**
We encourage the community to:
- Test with their own audio samples
- Try different hardware configurations  
- Share results to build a comprehensive performance picture
- Report any significantly different findings

### 📁 **Benchmark Files**
- `performance-results.md`: Detailed performance analysis
- `installation-results.md`: WhisperX compatibility findings on Apple Silicon

## Contributing Your Results

Found different performance characteristics on your system? We'd love to hear about it! Please open an issue with:

- Your hardware specifications
- Test audio details (length, speakers, quality)
- Performance measurements
- Any configuration differences

This helps us understand real-world performance across diverse setups and improve our benchmarks.

---

*Last updated: June 2025*