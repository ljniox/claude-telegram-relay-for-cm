/**
 * YouTube Data API v3 integration
 */

import { google, type youtube_v3 } from 'googleapis';
import { createReadStream } from 'fs';
import { getValidToken, storeToken, createTokenData } from '../auth/token-manager.js';
import type { YouTubeUploadOptions, TokenData, SkillResult } from './types.js';

const YOUTUBE_API_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/**
 * Get authenticated YouTube client
 */
async function getYouTubeClient(): Promise<youtube_v3.Youtube | null> {
  const token = await getValidToken('youtube', refreshYouTubeToken);
  if (!token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt?.getTime(),
  });

  return google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });
}

/**
 * Refresh YouTube access token
 */
async function refreshYouTubeToken(token: TokenData): Promise<TokenData | null> {
  if (!token.refreshToken) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: token.refreshToken,
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();

    return createTokenData(
      'youtube',
      credentials.access_token!,
      credentials.refresh_token || token.refreshToken,
      credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : undefined
    );
  } catch (error) {
    console.error('Failed to refresh YouTube token:', error);
    return null;
  }
}

/**
 * Upload a video to YouTube
 */
export async function uploadVideo(options: YouTubeUploadOptions): Promise<SkillResult> {
  const youtube = await getYouTubeClient();
  if (!youtube) {
    return {
      success: false,
      platform: 'youtube',
      action: 'upload',
      needsAuth: true,
      error: 'YouTube authentication required. Run /auth youtube',
    };
  }

  try {
    const videoStream = createReadStream(options.filePath);

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: options.title,
          description: options.description || '',
          tags: options.tags || [],
          categoryId: options.categoryId || '22', // People & Blogs
        },
        status: {
          privacyStatus: options.privacy || 'private',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: videoStream,
      },
    });

    const videoId = response.data.id;
    if (!videoId) {
      throw new Error('Upload succeeded but no video ID returned');
    }

    return {
      success: true,
      platform: 'youtube',
      action: 'upload',
      videoId,
      url: `https://youtube.com/watch?v=${videoId}`,
      message: `Video uploaded successfully: ${options.title}`,
    };
  } catch (error) {
    console.error('YouTube upload error:', error);
    return {
      success: false,
      platform: 'youtube',
      action: 'upload',
      error: error instanceof Error ? error.message : 'Unknown upload error',
    };
  }
}

/**
 * Get channel info (for testing auth)
 */
export async function getChannelInfo(): Promise<SkillResult> {
  const youtube = await getYouTubeClient();
  if (!youtube) {
    return {
      success: false,
      platform: 'youtube',
      action: 'channel_info',
      needsAuth: true,
      error: 'YouTube authentication required',
    };
  }

  try {
    const response = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) {
      return {
        success: false,
        platform: 'youtube',
        action: 'channel_info',
        error: 'No channel found',
      };
    }

    return {
      success: true,
      platform: 'youtube',
      action: 'channel_info',
      message: `Channel: ${channel.snippet?.title}\nSubscribers: ${channel.statistics?.subscriberCount || 0}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: 'youtube',
      action: 'channel_info',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if YouTube is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const youtube = await getYouTubeClient();
  return youtube !== null;
}
