# Coolify Deployment Guide

This guide walks you through deploying the Claude Social Media Agent on [Coolify](https://coolify.io/) - a self-hosted Heroku/Netlify alternative.

## Overview

The deployment consists of:
1. **Main Bot Service** - Handles Telegram messages and OAuth callbacks
2. **Scheduler Service** - Runs cron jobs for scheduled posts
3. **Persistent Storage** - SQLite database and uploaded media

## Prerequisites

- A Coolify instance (self-hosted or managed)
- A Git repository with your code pushed
- A domain/subdomain pointing to your Coolify instance
- OAuth credentials configured for remote redirect URIs

---

## Step 1: Prepare Your Repository

### Update OAuth Redirect URIs

Since Coolify runs remotely, you need to update OAuth redirect URIs from `localhost` to your actual domain.

#### Option A: Dynamic Redirect URI (Recommended)

Update `src/auth/oauth-server.ts` to use an environment variable:

```typescript
// In generateYouTubeAuthUrl, generateFacebookAuthUrl, generateTikTokAuthUrl
const redirectUri = process.env[`${platform.toUpperCase()}_REDIRECT_URI`];
```

#### Option B: Environment-Specific Config

Create `src/config.ts`:

```typescript
export const getRedirectUri = (platform: string): string => {
  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.OAUTH_PORT || 3000}`;
  return `${baseUrl}/auth/${platform}/callback`;
};
```

Then update OAuth server to use this config.

### Create Coolify Configuration Files

#### `coolify.json` (in repository root)

```json
{
  "name": "claude-social-media-agent",
  "services": [
    {
      "name": "bot",
      "dockerfile": "Dockerfile.bot",
      "ports": ["3000:3000"],
      "environment": ["NODE_ENV=production"],
      "volumes": ["data:/app/data"]
    },
    {
      "name": "scheduler",
      "dockerfile": "Dockerfile.scheduler",
      "environment": ["NODE_ENV=production"],
      "volumes": ["data:/app/data"]
    }
  ]
}
```

#### `Dockerfile.bot`

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies
COPY package.json .
RUN bun install

# Copy source
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data/uploads

# Expose OAuth server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run the bot
CMD ["bun", "run", "src/relay.ts"]
```

#### `Dockerfile.scheduler`

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies
COPY package.json .
RUN bun install

# Copy source
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data/uploads

# Run the scheduler
CMD ["bun", "run", "src/scheduler/cron.ts"]
```

#### `.dockerignore`

```
node_modules
.git
.env
.env.local
data/
*.db
*.log
```

---

## Step 2: Configure OAuth Providers

### Google Cloud Console (YouTube)

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add authorized redirect URIs:
   - `https://your-domain.com/auth/youtube/callback`
   - `https://bot.your-domain.com/auth/youtube/callback` (if using subdomain)

### Meta for Developers (Facebook/Instagram)

1. Go to [Meta App Dashboard](https://developers.facebook.com/apps/)
2. Navigate to Facebook Login → Settings
3. Add Valid OAuth Redirect URIs:
   - `https://your-domain.com/auth/facebook/callback`

### TikTok for Developers

1. Go to [TikTok Developer Portal](https://developers.tiktok.com/)
2. Edit your app
3. Add redirect URI:
   - `https://your-domain.com/auth/tiktok/callback`

---

## Step 3: Deploy on Coolify

### Create New Resource

1. In Coolify Dashboard, click **New Resource**
2. Select **Application**
3. Choose **Git Repository**
4. Enter your repository URL: `https://github.com/YOUR_USERNAME/claude-telegram-relay`
5. Select branch: `master`
6. Click **Continue**

### Configure Build

1. **Build Pack**: Select `Dockerfile`
2. **Dockerfile**: Choose `Dockerfile.bot` (for the main bot)
3. Click **Continue**

### Environment Variables

Add these environment variables in Coolify:

#### Required
```
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_USER_ID=your_telegram_user_id
```

#### OAuth Configuration
```
PUBLIC_URL=https://your-domain.com
OAUTH_PORT=3000

# YouTube
YOUTUBE_CLIENT_ID=your_google_client_id
YOUTUBE_CLIENT_SECRET=your_google_client_secret
YOUTUBE_REDIRECT_URI=https://your-domain.com/auth/youtube/callback

# Facebook
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_REDIRECT_URI=https://your-domain.com/auth/facebook/callback

# TikTok
TIKTOK_CLIENT_KEY=your_tiktok_client_key
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret
TIKTOK_REDIRECT_URI=https://your-domain.com/auth/tiktok/callback
```

#### Paths (Updated for Container)
```
RELAY_DIR=/app/data
```

#### Scheduler Settings
```
SCHEDULER_CHECK_INTERVAL=60000
MAX_RETRIES=3
RETENTION_DAYS=7
```

### Persistent Storage

1. In **Storage** tab, add a volume:
   - **Name**: `data`
   - **Mount Path**: `/app/data`
   - **Host Path**: (leave empty for Docker volume)

2. This ensures SQLite database and uploaded media persist across restarts.

### Networking

1. **Port**: Expose port `3000`
2. **Domain**: Configure your domain
   - Use Coolify's automatic subdomain: `bot.uuid.coolify.io`
   - Or custom domain: `bot.your-domain.com`
3. Enable **HTTPS** (automatic with Let's Encrypt)

### Deploy Bot Service

Click **Deploy** and wait for the build to complete.

---

## Step 4: Deploy Scheduler Service

The scheduler needs to be a separate service sharing the same storage.

### Create Second Application

1. **New Resource** → **Application** → **Git Repository**
2. Same repository and branch
3. **Dockerfile**: Choose `Dockerfile.scheduler`

### Environment Variables

Use the same environment variables as the bot, except:
- No need to expose ports
- No `PUBLIC_URL` required (unless tokens need refresh)

### Persistent Storage

Mount the **same volume** as the bot:
- **Name**: `data`
- **Mount Path**: `/app/data`

This allows both services to share the SQLite database.

### Deploy Scheduler

Click **Deploy**.

---

## Step 5: Verify Deployment

### Health Check

Visit `https://your-domain.com/health`

You should see:
```json
{"status": "ok"}
```

### Test Bot

1. Send `/help` to your Telegram bot
2. You should receive the help message

### Test Authentication

1. Send `/auth youtube` to the bot
2. Click the provided link
3. Complete OAuth flow
4. You should be redirected to a success page at `https://your-domain.com/auth/youtube/callback`

---

## Step 6: Alternative - Single Service Deployment

If you want to run both bot and scheduler in one container:

#### `Dockerfile.combined`

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies
COPY package.json .
RUN bun install

# Copy source
COPY . .

# Create data directory
RUN mkdir -p /app/data/uploads

# Install process manager
RUN apk add --no-cache supervisor

# Create supervisord config
COPY supervisord.conf /etc/supervisord.conf

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run both services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
```

#### `supervisord.conf`

```ini
[supervisord]
nodaemon=true
user=root

[program:bot]
command=bun run src/relay.ts
directory=/app
autostart=true
autorestart=true
stderr_logfile=/var/log/bot.err.log
stdout_logfile=/var/log/bot.out.log

[program:scheduler]
command=bun run src/scheduler/cron.ts
directory=/app
autostart=true
autorestart=true
stderr_logfile=/var/log/scheduler.err.log
stdout_logfile=/var/log/scheduler.out.log
```

---

## Step 7: Backup Strategy

### Automated Backups

Add a backup script that runs periodically:

#### `backup.sh`

```bash
#!/bin/bash
BACKUP_DIR="/app/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup SQLite database
cp /app/data/social-media-agent.db $BACKUP_DIR/db_$TIMESTAMP.db

# Backup uploads (optional, can be large)
# tar -czf $BACKUP_DIR/uploads_$TIMESTAMP.tar.gz /app/data/uploads

# Keep only last 7 backups
ls -t $BACKUP_DIR/db_*.db | tail -n +8 | xargs -r rm

echo "Backup completed: $TIMESTAMP"
```

#### Add to Dockerfile.combined or run as separate cron job

```dockerfile
# Add to Dockerfile
COPY backup.sh /app/backup.sh
RUN chmod +x /app/backup.sh

# Run backup daily at 2 AM
RUN echo "0 2 * * * /app/backup.sh >> /var/log/backup.log 2>&1" | crontab -
```

---

## Troubleshooting

### OAuth Callback Fails

**Symptom**: "Invalid redirect URI" error during auth

**Solution**:
- Verify `*_REDIRECT_URI` env vars match exactly what's configured in OAuth providers
- Check protocol (http vs https)
- No trailing slashes

### Database Locked

**Symptom**: "database is locked" errors

**Solution**:
- SQLite with WAL mode (already configured)
- Ensure only one scheduler instance runs
- Check for zombie processes

### Scheduler Not Running

**Symptom**: Scheduled posts never execute

**Solution**:
- Check scheduler logs: `docker logs <scheduler-container>`
- Verify both services share the same volume
- Check `SCHEDULER_CHECK_INTERVAL` is reasonable

### File Uploads Fail

**Symptom**: "ENOENT: no such file or directory" for uploads

**Solution**:
- Verify volume is mounted at `/app/data`
- Check `RELAY_DIR=/app/data` is set
- Ensure directory permissions: `mkdir -p /app/data/uploads`

---

## Security Considerations

1. **Use Secrets**: Store OAuth credentials in Coolify Secrets, not plain env vars
2. **HTTPS Only**: Always use HTTPS for OAuth callbacks
3. **IP Whitelist**: Consider restricting OAuth callbacks to Coolify's IP
4. **Token Storage**: Tokens are encrypted at rest in SQLite (file permissions)
5. **Regular Updates**: Keep Bun and dependencies updated

---

## Monitoring

### Coolify Logs

Access logs in Coolify Dashboard:
- **Application** → **Your Service** → **Logs**

### Health Endpoint

Set up uptime monitoring:
- URL: `https://your-domain.com/health`
- Expected response: `{"status": "ok"}`

### Telegram Bot Check

Send periodic `/queue` commands to verify bot responsiveness.

---

## Updates

To update after code changes:

1. Push changes to Git repository
2. In Coolify, click **Redeploy** on the service
3. Both services will pull latest code

---

## Cost Optimization

For low-traffic personal use:

- Use a small VPS (2GB RAM, 1 CPU)
- Share SQLite database (no separate DB server)
- Use Coolify's built-in reverse proxy (no separate nginx)
- Set `RETENTION_DAYS=3` to limit storage

Estimated cost: $5-10/month on Hetzner/DigitalOcean.
