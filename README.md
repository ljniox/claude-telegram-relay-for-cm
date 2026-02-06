# Claude Code Telegram Relay - Social Media Agent

**A multi-platform social media publishing agent powered by Claude Code.**

Publish to YouTube, Facebook, Instagram, and TikTok directly from Telegram using natural language commands.

## What This Is

A social media publishing agent that:
- **Preserves the core relay pattern**: Telegram → Claude → Skills
- **Adds platform-specific skills**: YouTube, Facebook, Instagram, TikTok
- **Uses natural language**: Claude decides which platform/skill to use
- **Supports scheduled posting**: Persistent queue with cron-based execution
- **Handles OAuth2 authentication**: Silent refresh + manual fallback

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────────────────────────┐
│   Telegram   │────▶│    Relay     │────▶│  Claude CLI (decides action)       │
│    (you)     │◀────│  (relay.ts)  │◀────│                                     │
└──────────────┘     └──────────────┘     └─────────────────────────────────────┘
                                                          │
                                                          ▼
                                    ┌─────────────────────────────────────────┐
                                    │  Claude outputs structured commands:   │
                                    │  - "SKILL:youtube:upload <json>"       │
                                    │  - "SKILL:facebook:post <json>"        │
                                    │  - "SKILL:scheduler:queue <json>"      │
                                    └─────────────────────────────────────────┘
                                                          │
                                                          ▼
                                    ┌─────────────────────────────────────────┐
                                    │  Relay parses response & spawns skill   │
                                    │  via shell: bun run src/skills/youtube  │
                                    └─────────────────────────────────────────┘
                                                          │
                              ┌───────────────────────────┼───────────────────────────┐
                              ▼                           ▼                           ▼
                     ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
                     │   YouTube    │            │ Facebook/IG  │            │    TikTok    │
                     │   (OAuth2)   │            │  (Graph API) │            │  (API + App) │
                     └──────────────┘            └──────────────┘            └──────────────┘
```

## Features

### Supported Platforms

| Platform | Actions | Authentication |
|----------|---------|----------------|
| **YouTube** | Upload videos, check channel info | OAuth2 (Google) |
| **Facebook** | Post to pages, schedule posts | OAuth2 (Meta) |
| **Instagram** | Post photos (via Facebook connection) | OAuth2 (Meta) |
| **TikTok** | Upload videos (requires mobile confirmation) | OAuth2 (TikTok) |

### Key Capabilities

- **Natural language commands**: "Upload this video to YouTube as 'My Tutorial'"
- **Scheduled posting**: "Schedule this for Friday 6pm on YouTube"
- **Optimal timing recommendations**: "What's the best time to post on Instagram?"
- **Persistent queue**: SQLite-based job queue with automatic retry
- **OAuth2 with auto-refresh**: Tokens refreshed automatically, manual auth fallback
- **Media lifecycle management**: Files cleaned up after posting or retained for scheduled jobs

## Why This Approach?

| Approach | Pros | Cons |
|----------|------|------|
| **This (CLI spawn)** | Simple, uses full Claude Code capabilities, all tools available | Spawns new process per message |
| Claude API direct | Lower latency | No tools, no MCP, no context |
| Claude Agent SDK | Production-ready, streaming | More complex setup |

The CLI spawn approach is the simplest way to get Claude Code's full power (tools, MCP servers, context) accessible via Telegram.

## Requirements

- [Bun](https://bun.sh/) runtime (or Node.js 18+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Your Telegram User ID (from [@userinfobot](https://t.me/userinfobot))

## Quick Start

```bash
# Clone (or fork and customize)
git clone https://github.com/YOUR_USERNAME/claude-telegram-relay
cd claude-telegram-relay

# Install dependencies
bun install

# Copy and edit environment variables
cp .env.example .env
# Edit .env with your tokens (see Configuration section below)

# Run the bot
bun run src/relay.ts

# In another terminal, run the scheduler (for scheduled posts)
bun run src/scheduler/cron.ts
```

## Cross-Platform "Always On" Setup

The relay needs to run continuously. Here's how on each platform:

### macOS (LaunchAgent)

LaunchAgent keeps the bot running and restarts it if it crashes.

```bash
# Copy the template
cp daemon/launchagent.plist ~/Library/LaunchAgents/com.claude.telegram-relay.plist

# Edit paths in the plist to match your setup
nano ~/Library/LaunchAgents/com.claude.telegram-relay.plist

# Load it
launchctl load ~/Library/LaunchAgents/com.claude.telegram-relay.plist

# Check status
launchctl list | grep claude

# View logs
tail -f ~/Library/Logs/claude-telegram-relay.log
```

**To stop:** `launchctl unload ~/Library/LaunchAgents/com.claude.telegram-relay.plist`

### Linux (systemd)

```bash
# Copy the template
sudo cp daemon/claude-relay.service /etc/systemd/system/

# Edit paths and user
sudo nano /etc/systemd/system/claude-relay.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable claude-relay
sudo systemctl start claude-relay

# Check status
sudo systemctl status claude-relay

# View logs
journalctl -u claude-relay -f
```

### Windows (Task Scheduler)

**Option 1: Task Scheduler (built-in)**

1. Open Task Scheduler (`taskschd.msc`)
2. Create Basic Task
3. Trigger: "When the computer starts"
4. Action: Start a program
   - Program: `C:\Users\YOU\.bun\bin\bun.exe`
   - Arguments: `run src/relay.ts`
   - Start in: `C:\path\to\claude-telegram-relay`
5. In Properties, check "Run whether user is logged on or not"
6. In Settings, check "Restart if the task fails"

**Option 2: PM2 (recommended)**

PM2 works on all platforms and handles restarts, logs, and monitoring.

```bash
# Install PM2
npm install -g pm2

# Start the relay
pm2 start src/relay.ts --interpreter bun --name claude-relay

# Save the process list
pm2 save

# Setup startup script (run the command it outputs)
pm2 startup
```

**Option 3: NSSM (Windows Service)**

[NSSM](https://nssm.cc/) turns any script into a Windows service.

```bash
# Download NSSM, then:
nssm install claude-relay "C:\Users\YOU\.bun\bin\bun.exe" "run src/relay.ts"
nssm set claude-relay AppDirectory "C:\path\to\claude-telegram-relay"
nssm start claude-relay
```

## Architecture

```
src/
  relay.ts                    # Enhanced relay with skill parsing
  platforms/
    types.ts                  # Shared TypeScript interfaces
    youtube.ts                # YouTube Data API v3
    facebook.ts               # Facebook Graph API (pages + IG)
    tiktok.ts                 # TikTok Content Posting API
  auth/
    token-manager.ts          # OAuth2 token storage & refresh
    oauth-server.ts           # Local callback server for OAuth flow
  skills/
    youtube-skill.ts          # CLI entry point for YouTube operations
    facebook-skill.ts         # CLI entry point for FB/IG operations
    tiktok-skill.ts           # CLI entry point for TikTok operations
    scheduler-skill.ts        # CLI entry point for scheduling
  scheduler/
    queue.ts                  # Job queue management
    cron.ts                   # Cron-based job runner
  storage/
    db.ts                     # SQLite wrapper for posts & tokens
  editorial/
    recommendations.ts        # Optimal posting time recommendations

examples/
  morning-briefing.ts         # Scheduled daily summary
  smart-checkin.ts            # Proactive check-ins
  memory.ts                   # Persistent memory pattern
  supabase-schema.sql         # Optional: cloud persistence

daemon/
  launchagent.plist           # macOS daemon config
  claude-relay.service        # Linux systemd config
```

## Usage Examples

### Authentication

Before posting to any platform, you need to authenticate:

```
/auth youtube
/auth facebook
/auth tiktok
```

Click the provided link to authorize the app.

### Posting Content

**YouTube:**
- Send a video with caption: "Upload this to YouTube as 'My Tutorial' with description 'Learn how to...'"
- "Post this video to YouTube as unlisted"

**Facebook:**
- "Post 'Hello world' to my Facebook page PAGE_ID"
- Send an image with: "Share this on Facebook with caption 'Check this out!'"

**Instagram:**
- Send a photo with: "Post this to Instagram with caption 'Beautiful sunset #nature'"

**TikTok:**
- Send a video with: "Upload this to TikTok with title 'My dance routine'"

### Scheduling Posts

- "Schedule this video for Friday 6pm on YouTube"
- "Queue this post for tomorrow morning on Facebook"

### Recommendations

- "What's the best time to post on Instagram?"
- "When should I post on YouTube?"
- `/recommend all` - Get recommendations for all platforms

### Queue Management

- `/queue` or `/queue status` - Show queue statistics
- `/queue pending` - Show pending jobs

## The Core Pattern

The relay does four things:

1. **Listen** for Telegram messages
2. **Spawn** Claude CLI with the message
3. **Parse** SKILL commands from Claude's response
4. **Execute** the appropriate skill and return results

```typescript
// Simplified core pattern
bot.on("message:text", async (ctx) => {
  const response = await spawnClaude(ctx.message.text);
  const processedResponse = await parseAndExecuteSkill(response, ctx);
  await ctx.reply(processedResponse);
});

async function parseAndExecuteSkill(response: string, ctx: Context): Promise<string> {
  const skillMatch = response.match(/SKILL:(\w+):(\w+)\s*(.*)/);
  if (!skillMatch) return response;

  const [, platform, action, argsJson] = skillMatch;
  const result = await executeSkill(platform, action, argsJson);
  return formatResult(result);
}
```

## Enhancements You Can Add

### Security (Required)
```typescript
// Only respond to your user ID
if (ctx.from?.id.toString() !== process.env.TELEGRAM_USER_ID) {
  return; // Ignore unauthorized users
}
```

### Session Continuity
```typescript
// Resume conversations with --resume
const proc = spawn([
  "claude", "-p", prompt,
  "--resume", sessionId,  // Continue previous conversation
  "--output-format", "text"
]);
```

### Voice Messages
```typescript
// Transcribe with Whisper/Gemini, send to Claude
const transcription = await transcribe(voiceFile);
const response = await spawnClaude(`[Voice message]: ${transcription}`);
```

### Images
```typescript
// Claude Code can see images if you pass the path
const response = await spawnClaude(`Analyze this image: ${imagePath}`);
```

### Persistent Memory
```typescript
// Add context to every prompt
const memory = await loadMemory();
const fullPrompt = `
Context: ${memory.facts.join(", ")}
Goals: ${memory.goals.join(", ")}

User: ${prompt}
`;
```

### Scheduled Tasks
```typescript
// Run briefings via cron/launchd
// See examples/morning-briefing.ts
```

## Examples Included

### Morning Briefing (`examples/morning-briefing.ts`)

Sends a daily summary at a scheduled time:
- Unread emails
- Calendar for today
- Active goals
- Whatever else you want

Schedule it with cron (Linux), launchd (Mac), or Task Scheduler (Windows).

### Smart Check-in (`examples/smart-checkin.ts`)

Proactive assistant that checks in based on context:
- Time since last message
- Pending goals with deadlines
- Calendar events coming up

Claude decides IF and WHAT to say.

### Memory Persistence (`examples/memory.ts`)

Pattern for remembering facts and goals across sessions:
- Local JSON file (simple)
- Supabase (cloud, searchable)
- Any database you prefer

## Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=       # From @BotFather
TELEGRAM_USER_ID=         # From @userinfobot (for security)

# Optional - Paths (defaults work for most setups)
CLAUDE_PATH=claude        # Path to claude CLI (if not in PATH)
RELAY_DIR=~/.claude-relay # Working directory for temp files

# OAuth Server
OAUTH_PORT=3000           # Port for OAuth callback server

# YouTube OAuth2 (get from Google Cloud Console)
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:3000/auth/youtube/callback

# Facebook/Instagram OAuth2 (get from Meta for Developers)
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=http://localhost:3000/auth/facebook/callback

# TikTok OAuth2 (get from TikTok for Developers)
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=http://localhost:3000/auth/tiktok/callback

# Scheduler Settings
SCHEDULER_CHECK_INTERVAL=60000  # 1 minute in ms
MAX_RETRIES=3
RETENTION_DAYS=7                # Days to keep media files after posting

# Optional - Features
SUPABASE_URL=             # For cloud memory persistence
SUPABASE_ANON_KEY=        # For cloud memory persistence
GEMINI_API_KEY=           # For voice transcription
ELEVENLABS_API_KEY=       # For voice responses
```

### Getting OAuth Credentials

**YouTube:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable YouTube Data API v3
4. Create OAuth 2.0 credentials (Desktop application type)
5. Add `http://localhost:3000/auth/youtube/callback` as authorized redirect URI

**Facebook/Instagram:**
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a new app
3. Add Facebook Login and Instagram Graph API products
4. Configure OAuth settings with redirect URI `http://localhost:3000/auth/facebook/callback`

**TikTok:**
1. Go to [TikTok for Developers](https://developers.tiktok.com/)
2. Create a new app
3. Configure OAuth redirect URI as `http://localhost:3000/auth/tiktok/callback`

## FAQ

**Q: Why spawn CLI instead of using the API directly?**

The CLI gives you everything: tools, MCP servers, context management, permissions. The API is just the model. If you want the full Claude Code experience on mobile, you spawn the CLI.

**Q: Isn't spawning a process slow?**

It's ~1-2 seconds overhead. For a personal assistant, that's fine. If you need sub-second responses, use the Agent SDK instead.

**Q: Can I use this with other CLIs?**

Yes. The pattern works with any CLI that accepts prompts and returns text. Swap `claude` for your preferred tool.

**Q: How do I handle long-running tasks?**

Claude Code can take minutes for complex tasks. The relay handles this by streaming or waiting. Set appropriate timeouts.

**Q: What about MCP servers?**

They work. Claude CLI uses your `~/.claude/settings.json` config, so all your MCP servers are available.

## Security Notes

1. **Always verify user ID** - Never run an open bot
2. **Don't commit `.env`** - It's in `.gitignore`
3. **Limit permissions** - Consider `--permission-mode` flag
4. **Review commands** - Claude can execute bash, be aware of what you're allowing

## Credits

Built by [Goda](https://www.youtube.com/@godago) as part of the Personal AI Infrastructure project.

## License

MIT - Take it, customize it, make it yours.
