import { transcribeWithSpeakersTool } from './dist/tools/transcribe-with-speakers.js';
import { resolve } from 'path';

async function testDiarization() {
  try {
    const audioPath = resolve('../input/sample_meeting_5min.wav');
    console.log('Testing speaker diarization with:', audioPath);
    
    const result = await transcribeWithSpeakersTool.handler({
      audio_file_path: audioPath,
      options: {
        model: 'pyannote',
        min_speakers: 2,
        max_speakers: 5,
        whisper_model: 'base.en',
        output_format: 'txt',
        use_mps: true
      },
      auto_convert: true
    });
    
    console.log('\n=== SPEAKER DIARIZATION RESULTS ===');
    console.log(result.content[0].text);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDiarization();