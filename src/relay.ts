/**
 * Claude Code Telegram Relay - Social Media Agent Edition
 *
 * Multi-platform social media publishing agent that:
 * - Preserves the core relay pattern: Telegram → Claude → Skills
 * - Adds platform-specific skills (YouTube, Facebook, Instagram, TikTok)
 * - Uses natural language commands (Claude decides which platform/skill to use)
 * - Supports scheduled posting with persistent queue
 * - Handles OAuth2 authentication with silent refresh + manual fallback
 *
 * Run: bun run src/relay.ts
 */

import { Bot, Context } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join } from "path";
import { generateAuthUrl, startOAuthServer } from "./auth/oauth-server.js";
import { formatRecommendations } from "./editorial/recommendations.js";
import type { SkillResult } from "./platforms/types.js";

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const RELAY_DIR = process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");

// Directories
const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");

// Session tracking for conversation continuity
const SESSION_FILE = join(RELAY_DIR, "session.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function loadSession(): Promise<SessionState> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { sessionId: null, lastActivity: new Date().toISOString() };
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

let session = await loadSession();

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

const LOCK_FILE = join(RELAY_DIR, "bot.lock");

async function acquireLock(): Promise<boolean> {
  try {
    const existingLock = await readFile(LOCK_FILE, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(LOCK_FILE, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

// Cleanup on exit
process.on("exit", () => {
  try {
    require("fs").unlinkSync(LOCK_FILE);
  } catch {}
});
process.on("SIGINT", async () => {
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await releaseLock();
  process.exit(0);
});

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

// Create directories
await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

// Acquire lock
if (!(await acquireLock())) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

// Start OAuth server for authentication callbacks
await startOAuthServer();

const bot = new Bot(BOT_TOKEN);

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  // If ALLOWED_USER_ID is set, enforce it
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    await ctx.reply("This bot is private.");
    return;
  }

  await next();
});

// ============================================================
// CORE: Call Claude CLI
// ============================================================

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string }
): Promise<string> {
  const args = [CLAUDE_PATH, "-p", prompt];

  // Resume previous session if available and requested
  if (options?.resume && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push("--output-format", "text");

  console.log(`Calling Claude: ${prompt.substring(0, 50)}...`);

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Pass through any env vars Claude might need
      },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      return `Error: ${stderr || "Claude exited with code " + exitCode}`;
    }

    // Extract session ID from output if present (for --resume)
    const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
    if (sessionMatch) {
      session.sessionId = sessionMatch[1];
      session.lastActivity = new Date().toISOString();
      await saveSession(session);
    }

    return output.trim();
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// SKILL PARSING AND EXECUTION
// ============================================================

async function parseAndExecuteSkill(response: string, ctx: Context): Promise<string> {
  const skillMatch = response.match(/SKILL:(\w+):(\w+)\s*(.*)/);
  if (!skillMatch) return response; // No skill, return as-is

  const [, platform, action, argsJson] = skillMatch;

  // Handle special case: recommendations
  if (platform === "recommend") {
    return formatRecommendations(action);
  }

  // Handle scheduler skill specially
  const skillFile = platform === "scheduler" ? "scheduler-skill" : `${platform}-skill`;
  const skillPath = join(process.cwd(), "src/skills", `${skillFile}.ts`);

  console.log(`Executing skill: ${platform}:${action}`);
  await ctx.replyWithChatAction("typing");

  try {
    const proc = spawn(["bun", "run", skillPath, action, argsJson || "{}"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`Skill error: ${stderr}`);
      return `❌ Skill execution failed: ${stderr || "Unknown error"}`;
    }

    const result: SkillResult = JSON.parse(output);

    if (result.success) {
      let message = `✅ Success!`;
      if (result.url) message += `\n🔗 ${result.url}`;
      if (result.message) message += `\n📝 ${result.message}`;
      if (result.jobId) message += `\n📋 Job ID: ${result.jobId}`;
      return message;
    } else if (result.needsAuth) {
      return `⚠️ Authentication required. Run: /auth ${platform}`;
    } else {
      return `❌ Error: ${result.error}`;
    }
  } catch (error) {
    console.error("Skill execution error:", error);
    return `❌ Failed to execute skill: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

// ============================================================
// BOT COMMANDS
// ============================================================

// Auth command
bot.command("auth", async (ctx) => {
  const platform = ctx.match?.trim().toLowerCase();
  const validPlatforms = ["youtube", "facebook", "tiktok"];

  if (!platform || !validPlatforms.includes(platform)) {
    return ctx.reply(
      "Usage: /auth <platform>\n\nAvailable platforms:\n• youtube\n• facebook\n• tiktok"
    );
  }

  const userId = ctx.from?.id.toString() || "unknown";

  try {
    const authUrl = await generateAuthUrl(platform, userId);
    await ctx.reply(
      `🔐 Authenticate with ${platform.charAt(0).toUpperCase() + platform.slice(1)}:\n\n${authUrl}\n\nClick the link above to authorize. After authorization, you can use ${platform} features.`
    );
  } catch (error) {
    console.error(`Auth error for ${platform}:`, error);
    await ctx.reply(
      `❌ Failed to generate auth URL for ${platform}. Make sure OAuth credentials are configured in .env`
    );
  }
});

// Recommend command
bot.command("recommend", async (ctx) => {
  const platform = ctx.match?.trim().toLowerCase();

  if (!platform) {
    return ctx.reply(
      "Usage: /recommend <platform>\n\nAvailable platforms:\n• youtube\n• facebook\n• instagram\n• tiktok\n\nOr use /recommend all for all platforms"
    );
  }

  if (platform === "all") {
    return ctx.reply(formatRecommendations());
  }

  const guidelines = formatRecommendations(platform);
  await ctx.reply(guidelines);
});

// Queue command
bot.command("queue", async (ctx) => {
  const subcommand = ctx.match?.trim().toLowerCase() || "list";

  try {
    const skillPath = join(process.cwd(), "src/skills", "scheduler-skill.ts");

    let action: string;
    let argsJson = "{}";

    switch (subcommand) {
      case "list":
      case "status":
        action = "stats";
        break;
      case "pending":
        action = "list";
        argsJson = JSON.stringify({ status: "pending" });
        break;
      default:
        return ctx.reply(
          "Usage: /queue [command]\n\nCommands:\n• list/status - Show queue statistics\n• pending - Show pending jobs"
        );
    }

    const proc = spawn(["bun", "run", skillPath, action, argsJson], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const result: SkillResult = JSON.parse(output);

    if (result.success) {
      await ctx.reply(`📊 Queue Status:\n\n${result.message}`);
    } else {
      await ctx.reply(`❌ Error: ${result.error}`);
    }
  } catch (error) {
    console.error("Queue command error:", error);
    await ctx.reply("❌ Failed to get queue status");
  }
});

// Help command
bot.command("help", async (ctx) => {
  await ctx.reply(
    `🤖 Social Media Agent Commands:

/media <message>
Send a message to Claude for social media actions.

/auth <platform>
Authenticate with a platform (youtube, facebook, tiktok)

/recommend <platform|all>
Get optimal posting time recommendations

/queue [list|pending]
View scheduled post queue status

/help
Show this help message

💡 Tips:
• Send a video with caption "Upload to YouTube as 'My Title'"
• Send an image with "Post this to Instagram with caption..."
• Say "Schedule this for Friday 6pm on YouTube"
• Ask "What's the best time to post on Facebook?"`
  );
});

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// Text messages
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  console.log(`Message: ${text.substring(0, 50)}...`);

  await ctx.replyWithChatAction("typing");

  // Add any context you want here
  const enrichedPrompt = buildPrompt(text, false);

  const response = await callClaude(enrichedPrompt, { resume: true });

  // Check if response contains a skill command
  const processedResponse = await parseAndExecuteSkill(response, ctx);

  await sendResponse(ctx, processedResponse);
});

// Voice messages (optional - requires transcription)
bot.on("message:voice", async (ctx) => {
  console.log("Voice message received");
  await ctx.replyWithChatAction("typing");

  // To handle voice, you need a transcription service
  // Options: Whisper API, Gemini, AssemblyAI, etc.
  //
  // Example flow:
  // 1. Download the voice file
  // 2. Send to transcription service
  // 3. Pass transcription to Claude
  //
  // const transcription = await transcribe(voiceFile);
  // const response = await callClaude(`[Voice]: ${transcription}`);

  await ctx.reply(
    "Voice messages require a transcription service. " +
      "Add Whisper, Gemini, or similar to handle voice."
  );
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  console.log("Image received");
  await ctx.replyWithChatAction("typing");

  let filePath: string | null = null;

  try {
    // Get highest resolution photo
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    // Download the image
    const timestamp = Date.now();
    filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Build prompt with file path context
    const caption = ctx.message.caption || "Analyze this image.";
    const prompt = buildPrompt(caption, true, filePath);

    const claudeResponse = await callClaude(prompt, { resume: true });

    // Check if response contains a skill command
    const processedResponse = await parseAndExecuteSkill(claudeResponse, ctx);

    // Cleanup after processing (unless it was queued)
    if (!processedResponse.includes("Job ID:")) {
      await unlink(filePath).catch(() => {});
    }

    await sendResponse(ctx, processedResponse);
  } catch (error) {
    console.error("Image error:", error);
    await ctx.reply("Could not process image.");
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  }
});

// Videos
bot.on("message:video", async (ctx) => {
  console.log("Video received");
  await ctx.replyWithChatAction("typing");

  let filePath: string | null = null;

  try {
    const video = ctx.message.video;
    const file = await ctx.api.getFile(video.file_id);

    // Download the video
    const timestamp = Date.now();
    const ext = video.file_name?.split(".").pop() || "mp4";
    filePath = join(UPLOADS_DIR, `video_${timestamp}.${ext}`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Build prompt with file path context
    const caption = ctx.message.caption || "Process this video.";
    const prompt = buildPrompt(caption, true, filePath, "video");

    const claudeResponse = await callClaude(prompt, { resume: true });

    // Check if response contains a skill command
    const processedResponse = await parseAndExecuteSkill(claudeResponse, ctx);

    // Cleanup after processing (unless it was queued)
    if (!processedResponse.includes("Job ID:")) {
      await unlink(filePath).catch(() => {});
    }

    await sendResponse(ctx, processedResponse);
  } catch (error) {
    console.error("Video error:", error);
    await ctx.reply("Could not process video.");
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  }
});

// Documents
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  console.log(`Document: ${doc.file_name}`);
  await ctx.replyWithChatAction("typing");

  let filePath: string | null = null;

  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const fileName = doc.file_name || `file_${timestamp}`;
    filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || `Analyze: ${doc.file_name}`;
    const prompt = buildPrompt(caption, true, filePath, "document");

    const claudeResponse = await callClaude(prompt, { resume: true });

    // Check if response contains a skill command
    const processedResponse = await parseAndExecuteSkill(claudeResponse, ctx);

    // Cleanup after processing (unless it was queued)
    if (!processedResponse.includes("Job ID:")) {
      await unlink(filePath).catch(() => {});
    }

    await sendResponse(ctx, processedResponse);
  } catch (error) {
    console.error("Document error:", error);
    await ctx.reply("Could not process document.");
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  }
});

// ============================================================
// HELPERS
// ============================================================

function buildPrompt(
  userMessage: string,
  hasMedia: boolean,
  filePath?: string,
  mediaType: "image" | "video" | "document" = "image"
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let mediaContext = "";
  if (hasMedia && filePath) {
    mediaContext = `\n[Media: ${mediaType} at ${filePath}]`;
  }

  return `
You are a social media publishing assistant. You can publish to YouTube, Facebook, Instagram, and TikTok.

AVAILABLE SKILLS - Output exactly one of these formats when the user wants to post content:

1. YouTube upload:
SKILL:youtube:upload {"filePath": "${filePath || ""}", "title": "...", "description": "...", "privacy": "public|unlisted|private"}

2. Facebook post:
SKILL:facebook:post {"pageId": "...", "message": "...", "link": "..."}

3. Instagram post:
SKILL:instagram:post {"imageUrl": "...", "caption": "..."}

4. Schedule post:
SKILL:scheduler:queue {"platform": "youtube|facebook|instagram|tiktok", "action": "upload|post", "content": {...}, "scheduledAt": "ISO-8601"}

5. List scheduled:
SKILL:scheduler:list

6. Get recommendations:
SKILL:recommend:{platform} (when user asks about best times to post)

RULES:
- If user sends media with caption like "Post this to YouTube as 'My Video'", extract title and use youtube skill
- For scheduling, suggest optimal times based on platform best practices
- If auth required, tell user to run /auth/{platform}
- Always output ONLY the SKILL command, no other text (unless user is just chatting)
- For questions about best posting times, use SKILL:recommend:{platform}

Current time: ${timeStr}${mediaContext}

User: ${userMessage}
`.trim();
}

async function sendResponse(ctx: Context, response: string): Promise<void> {
  // Telegram has a 4096 character limit
  const MAX_LENGTH = 4000;

  if (response.length <= MAX_LENGTH) {
    await ctx.reply(response);
    return;
  }

  // Split long responses
  const chunks = [];
  let remaining = response;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a natural boundary
    let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = MAX_LENGTH;

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude Social Media Agent...");
console.log(`Authorized user: ${ALLOWED_USER_ID || "ANY (not recommended)"}`);

bot.start({
  onStart: () => {
    console.log("Bot is running!");
    console.log("Available commands: /auth, /recommend, /queue, /help");
  },
});
