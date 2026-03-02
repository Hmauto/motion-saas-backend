# Motion SaaS Backend

Express.js backend that handles:
- Video generation requests
- Supabase database operations
- **ElevenLabs voice generation**
- Video pipeline orchestration

## Deploy to Railway

1. Push to GitHub
2. Connect Railway to GitHub repo
3. Set environment variables in Railway dashboard

## Environment Variables

```
SUPABASE_URL=https://kjkvsiegfzywrtsptgpl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ELEVENLABS_API_KEY=sk_a53288b5acae83fbe9fb3fea7410fa97cbecb82f62511e9e
PORT=3001
```

## API Endpoints

- `GET /` - Health check
- `GET /health` - Supabase connection test
- `GET /health/elevenlabs` - ElevenLabs connection test
- `GET /api/voices` - List available ElevenLabs voices
- `POST /api/generate` - Create new video (supports `voiceId` parameter)
- `GET /api/status/:videoId` - Check video status

## Pipeline Stages

1. **analyzing** - AI analyzes the prompt
2. **directing** - Generates voiceover script
3. **generating_voice** - ElevenLabs generates audio
4. **rendering** - Video rendering (placeholder)
5. **completed** - Video ready

## Voice Options

- `Adam` (default) - Deep, powerful
- `Bella` - Warm, inspiring
- `Antoni` - Calm, well-rounded
- `Josh` - Young, energetic
- `Rachel` - Clear, professional

## Request Example

```json
POST /api/generate
{
  "prompt": "Create a motivational video about success",
  "sessionId": "abc123",
  "ip": "192.168.1.1",
  "voiceId": "Adam"
}
```
