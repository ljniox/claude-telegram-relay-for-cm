/**
 * Local OAuth callback server for handling OAuth flows
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { randomBytes, createHash } from 'crypto';
import open from 'open';
import { storeToken, createTokenData } from './token-manager.js';
import type { OAuthState } from '../platforms/types.js';

const PORT = parseInt(process.env.OAUTH_PORT || '3000', 10);

// In-memory state storage (consider Redis for multi-instance setups)
const oauthStates = new Map<string, OAuthState>();

// ============================================================================
// PKCE UTILITIES
// ============================================================================

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateState(platform: string, userId: string): string {
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, { platform, userId });
  // Clean up state after 10 minutes
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
  return state;
}

export function verifyState(state: string): OAuthState | null {
  const data = oauthStates.get(state);
  if (data) {
    oauthStates.delete(state);
    return data;
  }
  return null;
}

// ============================================================================
// AUTH URL GENERATORS
// ============================================================================

export function generateYouTubeAuthUrl(userId: string): string {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('YouTube OAuth credentials not configured');
  }

  const { codeChallenge } = generatePKCE();
  const state = generateState('youtube', userId);

  // Store code verifier with state for later
  const stateData = oauthStates.get(state);
  if (stateData) {
    stateData.codeVerifier = generatePKCE().codeVerifier;
    oauthStates.set(state, stateData);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    access_type: 'offline',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function generateFacebookAuthUrl(userId: string): string {
  const appId = process.env.FACEBOOK_APP_ID;
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI;

  if (!appId || !redirectUri) {
    throw new Error('Facebook OAuth credentials not configured');
  }

  const state = generateState('facebook', userId);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish',
    state,
  });

  return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
}

export function generateTikTokAuthUrl(userId: string): string {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!clientKey || !redirectUri) {
    throw new Error('TikTok OAuth credentials not configured');
  }

  const state = generateState('tiktok', userId);

  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'video.upload,video.publish',
    state,
  });

  return `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
}

export async function generateAuthUrl(platform: string, userId: string): Promise<string> {
  switch (platform) {
    case 'youtube':
      return generateYouTubeAuthUrl(userId);
    case 'facebook':
      return generateFacebookAuthUrl(userId);
    case 'tiktok':
      return generateTikTokAuthUrl(userId);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// ============================================================================
// TOKEN EXCHANGE
// ============================================================================

async function exchangeYouTubeCode(code: string, state: string): Promise<void> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('YouTube OAuth credentials not configured');
  }

  const stateData = oauthStates.get(state);
  const codeVerifier = stateData?.codeVerifier;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(codeVerifier && { code_verifier: codeVerifier }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  const tokenData = createTokenData(
    'youtube',
    data.access_token,
    data.refresh_token,
    data.expires_in
  );
  storeToken(tokenData);
}

async function exchangeFacebookCode(code: string): Promise<void> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    throw new Error('Facebook OAuth credentials not configured');
  }

  const response = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
    method: 'GET',
  });

  const url = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('redirect_uri', redirectUri);

  const tokenResponse = await fetch(url.toString());

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await tokenResponse.json();

  // Facebook tokens don't expire by default, but may have short-lived tokens
  // that need to be exchanged for long-lived tokens
  let expiresIn: number | undefined;
  if (data.expires_in) {
    expiresIn = data.expires_in;
  }

  const tokenData = createTokenData(
    'facebook',
    data.access_token,
    undefined,
    expiresIn
  );
  storeToken(tokenData);
}

async function exchangeTikTokCode(code: string): Promise<void> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error('TikTok OAuth credentials not configured');
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  const tokenData = createTokenData(
    'tiktok',
    data.access_token,
    data.refresh_token,
    data.expires_in
  );
  storeToken(tokenData);
}

// ============================================================================
// HTTP SERVER
// ============================================================================

let server: ReturnType<typeof createServer> | null = null;

export function startOAuthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve();
      return;
    }

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // OAuth callback handlers
      const platformMatch = url.pathname.match(/^\/auth\/(\w+)\/callback$/);
      if (platformMatch) {
        const platform = platformMatch[1];
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window and return to Telegram.</p>
              </body>
            </html>
          `);
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Invalid Request</h1>
                <p>Missing code or state parameter.</p>
              </body>
            </html>
          `);
          return;
        }

        // Verify state
        const stateData = verifyState(state);
        if (!stateData) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Invalid State</h1>
                <p>The authentication session has expired. Please try again.</p>
              </body>
            </html>
          `);
          return;
        }

        try {
          // Exchange code for token
          switch (platform) {
            case 'youtube':
              await exchangeYouTubeCode(code, state);
              break;
            case 'facebook':
              await exchangeFacebookCode(code);
              break;
            case 'tiktok':
              await exchangeTikTokCode(code);
              break;
            default:
              throw new Error(`Unknown platform: ${platform}`);
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #27ae60;">Authentication Successful!</h1>
                <p>You have successfully authenticated with ${platform}.</p>
                <p>You can close this window and return to Telegram.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
        } catch (err) {
          console.error(`OAuth error for ${platform}:`, err);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Authentication Error</h1>
                <p>Failed to complete authentication: ${err instanceof Error ? err.message : 'Unknown error'}</p>
                <p>Please try again.</p>
              </body>
            </html>
          `);
        }
        return;
      }

      // 404 for unknown paths
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(PORT, () => {
      console.log(`OAuth server listening on port ${PORT}`);
      resolve();
    });

    server.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.log(`Port ${PORT} already in use, assuming another instance is running`);
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

export function stopOAuthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      server = null;
      resolve();
    });
  });
}

// ============================================================================
// HELPER: Open browser for auth
// ============================================================================

export async function openAuthUrl(platform: string, userId: string): Promise<void> {
  const url = await generateAuthUrl(platform, userId);
  await open(url);
}
