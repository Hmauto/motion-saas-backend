const express = require('express');
const cors = require('cors');
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

// Forward video generation request
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, sessionId, ip } = req.body;
    
    console.log('[GENERATE] Starting video generation:', { prompt: prompt.slice(0, 50), sessionId, ip });

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
        credits_used: 1
      })
      .select()
      .single();

    if (videoError) throw videoError;

    // Start video generation pipeline (async)
    generateVideoPipeline(video.id, prompt);

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
      errorMessage: video.error_message
    });

  } catch (error) {
    console.error('[STATUS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Video generation pipeline
async function generateVideoPipeline(videoId, prompt) {
  console.log(`[PIPELINE ${videoId}] Starting pipeline...`);
  
  try {
    // Update status to analyzing
    await supabase.from('videos').update({ status: 'analyzing' }).eq('id', videoId);
    await new Promise(r => setTimeout(r, 2000)); // Simulate AI processing
    
    // Update to directing
    await supabase.from('videos').update({ status: 'directing' }).eq('id', videoId);
    await new Promise(r => setTimeout(r, 2000));
    
    // Update to generating voice
    await supabase.from('videos').update({ status: 'generating_voice' }).eq('id', videoId);
    await new Promise(r => setTimeout(r, 3000));
    
    // Update to rendering
    await supabase.from('videos').update({ status: 'rendering' }).eq('id', videoId);
    await new Promise(r => setTimeout(r, 5000));
    
    // Complete - generate placeholder video URL
    const videoUrl = `https://storage.example.com/videos/${videoId}.mp4`;
    await supabase.from('videos').update({ 
      status: 'completed', 
      video_url: videoUrl,
      completed_at: new Date().toISOString()
    }).eq('id', videoId);
    
    console.log(`[PIPELINE ${videoId}] Completed!`);
    
  } catch (error) {
    console.error(`[PIPELINE ${videoId}] Error:`, error);
    await supabase.from('videos').update({ 
      status: 'failed',
      error_message: error.message 
    }).eq('id', videoId);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Motion SaaS Backend running on port ${PORT}`);
});
