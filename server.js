const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ElevenLabs config
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'motion-saas-backend' });
});

// Test Supabase connection
app.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('count');
    if (error) throw error;
    res.json({ status: 'ok', supabase: 'connected', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Test ElevenLabs connection
app.get('/health/elevenlabs', async (req, res) => {
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/user`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    const data = await response.json();
    res.json({ status: 'ok', elevenlabs: 'connected', subscription: data.subscription });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Get available voices
app.get('/api/voices', async (req, res) => {
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    const data = await response.json();
    res.json(data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url,
      category: v.category
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Forward video generation request
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, sessionId, ip, voiceId = 'Adam' } = req.body;
    
    console.log('[GENERATE] Starting video generation:', { prompt: prompt.slice(0, 50), sessionId, ip, voiceId });

    // Get or create user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (!user) {
      // Check IP
      const { data: ipUser } = await supabase
        .from('users')
        .select('*')
        .eq('ip_address', ip)
        .eq('is_anonymous', true)
        .single();

      if (ipUser) {
        await supabase.from('users').update({ session_id: sessionId }).eq('id', ipUser.id);
        user = ipUser;
      } else {
        // Create new user
        const { data: newUser, error } = await supabase
          .from('users')
          .insert({ session_id: sessionId, ip_address: ip, credits: 5, is_anonymous: true })
          .select()
          .single();
        
        if (error) throw error;
        user = newUser;

        // Add credits transaction
        await supabase.from('credit_transactions').insert({
          user_id: user.id,
          amount: 5,
          type: 'free_signup',
          description: 'Initial free credits'
        });
      }
    }

    // Check credits
    if (user.credits < 1) {
      return res.status(403).json({ error: 'No credits remaining' });
    }

    // Deduct credit
    await supabase.from('users').update({ credits: user.credits - 1 }).eq('id', user.id);
    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      amount: -1,
      type: 'video_generation',
      description: 'Video generation'
    });

    // Create video record
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        session_id: sessionId,
        prompt: prompt.trim(),
        status: 'pending',
        credits_used: 1,
        voice_id: voiceId
      })
      .select()
      .single();

    if (videoError) throw videoError;

    // Start video generation pipeline (async)
    generateVideoPipeline(video.id, prompt, voiceId);

    res.json({
      success: true,
      videoId: video.id,
      status: 'pending',
      creditsRemaining: user.credits - 1,
      estimatedTime: '3-5 minutes'
    });

  } catch (error) {
    console.error('[GENERATE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get video status
app.get('/api/status/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();

    if (error || !video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({
      status: video.status,
      videoUrl: video.video_url,
      audioUrl: video.audio_url,
      script: video.script,
      errorMessage: video.error_message,
      progress: video.progress || 0
    });

  } catch (error) {
    console.error('[STATUS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate voiceover using ElevenLabs
async function generateVoiceover(text, voiceId = 'Adam') {
  console.log(`[ELEVENLABS] Generating voiceover with voice: ${voiceId}`);
  
  // Map voice names to IDs
  const voiceMap = {
    'Adam': 'pNInz6obpgDQGcFmaJgB',
    'Bella': 'EXAVITQu4vr4xnSDxMaL',
    'Antoni': 'ErXwobaYiN019PkySvjV',
    'Josh': 'TxGEqnHWrfWFTfGW9XjX',
    'Rachel': '21m00Tcm4TlvDq8ikWAM'
  };
  
  const voice_id = voiceMap[voiceId] || voiceId;
  
  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voice_id}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${error}`);
  }

  const audioBuffer = await response.buffer();
  return audioBuffer;
}

// AI Sub-agent: Analyze prompt and generate script
async function analyzePrompt(prompt) {
  console.log('[AI] Analyzing prompt...');
  
  // For now, simulate AI analysis with a structured script
  // In production, this would call Kimi/OpenAI API
  const script = {
    title: prompt.slice(0, 50),
    hook: `What if I told you that ${prompt.slice(0, 30)}...`,
    body: [
      `Let me break this down for you.`,
      `First, understand the core concept.`,
      `Then, apply it to your situation.`,
      `Finally, see the results for yourself.`
    ],
    cta: `Subscribe for more insights like this!`,
    duration: 30
  };
  
  return script;
}

// AI Sub-agent: Generate voiceover script with emotion tags
async function generateVoiceScript(analysis) {
  console.log('[AI] Generating voice script...');
  
  const parts = [
    `<emphasis level="strong">${analysis.hook}</emphasis>`,
    `<break time="500ms"/>`,
    ...analysis.body,
    `<break time="300ms"/>`,
    `<prosody rate="slow" pitch="+10%">${analysis.cta}</prosody>`
  ];
  
  return parts.join('\n\n');
}

// Upload file to Supabase Storage
async function uploadToStorage(buffer, filename, contentType) {
  const { data, error } = await supabase.storage
    .from('videos')
    .upload(filename, buffer, {
      contentType: contentType,
      upsert: true
    });
  
  if (error) throw error;
  
  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('videos')
    .getPublicUrl(filename);
  
  return publicUrl;
}

// Video generation pipeline
async function generateVideoPipeline(videoId, prompt, voiceId) {
  console.log(`[PIPELINE ${videoId}] Starting pipeline...`);
  
  try {
    // Update status to analyzing
    await supabase.from('videos').update({ 
      status: 'analyzing',
      progress: 10 
    }).eq('id', videoId);
    
    // Step 1: AI Analysis
    const analysis = await analyzePrompt(prompt);
    console.log(`[PIPELINE ${videoId}] Analysis complete:`, analysis.title);
    
    await supabase.from('videos').update({ 
      status: 'directing',
      progress: 25,
      script: analysis
    }).eq('id', videoId);
    
    // Step 2: Generate Voice Script
    const voiceScript = await generateVoiceScript(analysis);
    
    // Step 3: Generate Voiceover with ElevenLabs
    await supabase.from('videos').update({ 
      status: 'generating_voice',
      progress: 40 
    }).eq('id', videoId);
    
    const audioBuffer = await generateVoiceover(voiceScript, voiceId);
    console.log(`[PIPELINE ${videoId}] Voiceover generated: ${audioBuffer.length} bytes`);
    
    // Upload audio to Supabase Storage
    const audioFilename = `audio/${videoId}.mp3`;
    const audioUrl = await uploadToStorage(audioBuffer, audioFilename, 'audio/mpeg');
    console.log(`[PIPELINE ${videoId}] Audio uploaded: ${audioUrl}`);
    
    await supabase.from('videos').update({ 
      status: 'rendering',
      progress: 70,
      audio_url: audioUrl
    }).eq('id', videoId);
    
    // Step 4: Render Video (placeholder - would use Remotion here)
    await new Promise(r => setTimeout(r, 3000));
    
    // For now, return the audio URL as the video URL
    // In production, this would be the actual rendered video
    await supabase.from('videos').update({ 
      status: 'completed', 
      video_url: audioUrl, // Temporary: using audio as video placeholder
      progress: 100,
      completed_at: new Date().toISOString()
    }).eq('id', videoId);
    
    console.log(`[PIPELINE ${videoId}] Completed!`);
    
  } catch (error) {
    console.error(`[PIPELINE ${videoId}] Error:`, error);
    await supabase.from('videos').update({ 
      status: 'failed',
      error_message: error.message,
      progress: 0
    }).eq('id', videoId);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Motion SaaS Backend running on port ${PORT}`);
  console.log(`ElevenLabs API: ${ELEVENLABS_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
});
