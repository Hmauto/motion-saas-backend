# Motion SaaS Backend

Express.js backend that handles:
- Video generation requests
- Supabase database operations
- Video pipeline orchestration

## Deploy to Railway

1. Push to GitHub
2. Connect Railway to GitHub repo
3. Set environment variables in Railway dashboard

## Environment Variables

```
SUPABASE_URL=https://kjkvsiegfzywrtsptgpl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
PORT=3001
```

## API Endpoints

- `GET /` - Health check
- `GET /health` - Supabase connection test
- `POST /api/generate` - Create new video
- `GET /api/status/:videoId` - Check video status
