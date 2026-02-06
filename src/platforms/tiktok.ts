/**
 * TikTok Content Posting API integration
 *
 * Note: TikTok requires mobile confirmation for direct posting.
 * This implementation provides the upload flow and returns a preview URL.
 */

import axios from 'axios';
import { createReadStream, statSync } from 'fs';
import { getValidToken, storeToken, createTokenData } from '../auth/token-manager.js';
import type { TikTokUploadOptions, TokenData, SkillResult } from './types.js';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * Get TikTok access token
 */
async function getAccessToken(): Promise<string | null> {
  const token = await getValidToken('tiktok', refreshTikTokToken);
  return token?.accessToken || null;
}

/**
 * Refresh TikTok access token
 */
async function refreshTikTokToken(token: TokenData): Promise<TokenData | null> {
  if (!token.refreshToken) return null;

  try {
    const response = await axios.post(`${TIKTOK_API_BASE}/oauth/token/`, {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });

    const { access_token, refresh_token, expires_in } = response.data.data;
    return createTokenData('tiktok', access_token, refresh_token, expires_in);
  } catch (error) {
    console.error('Failed to refresh TikTok token:', error);
    return null;
  }
}

/**
 * Initialize video upload
 * Returns upload URL for chunked upload
 */
export async function initUpload(
  filePath: string,
  title: string
): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'tiktok',
      action: 'init_upload',
      needsAuth: true,
      error: 'TikTok authentication required. Run /auth tiktok',
    };
  }

  try {
    // Get file size
    const stats = statSync(filePath);
    const fileSize = stats.size;

    // Initialize upload
    const response = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`,
      {
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize, // Single chunk for simplicity
          total_chunk_count: 1,
        },
        title,
        privacy_level: 'PUBLIC',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { data } = response.data;

    return {
      success: true,
      platform: 'tiktok',
      action: 'init_upload',
      message: 'Upload initialized',
      url: data.upload_url,
    };
  } catch (error) {
    console.error('TikTok init upload error:', error);
    return {
      success: false,
      platform: 'tiktok',
      action: 'init_upload',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Upload video chunks to TikTok
 */
export async function uploadChunks(
  uploadUrl: string,
  filePath: string
): Promise<SkillResult> {
  try {
    const fileStream = createReadStream(filePath);
    const stats = statSync(filePath);
    const fileSize = stats.size;

    await axios.put(uploadUrl, fileStream, {
      headers: {
        'Content-Length': fileSize,
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Type': 'video/mp4',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return {
      success: true,
      platform: 'tiktok',
      action: 'upload_chunks',
      message: 'Video uploaded successfully',
    };
  } catch (error) {
    console.error('TikTok upload chunks error:', error);
    return {
      success: false,
      platform: 'tiktok',
      action: 'upload_chunks',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check upload status
 */
export async function checkStatus(publishId: string): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'tiktok',
      action: 'check_status',
      needsAuth: true,
      error: 'TikTok authentication required',
    };
  }

  try {
    const response = await axios.post(
      `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      {
        publish_id: publishId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { data } = response.data;
    const status = data.status;

    // Status can be: PUBLISH_FAILED, PUBLISH_SUCCESS, PUBLISH_PENDING
    if (status === 'PUBLISH_SUCCESS') {
      return {
        success: true,
        platform: 'tiktok',
        action: 'check_status',
        message: 'Video published successfully',
        url: data.share_url,
      };
    } else if (status === 'PUBLISH_FAILED') {
      return {
        success: false,
        platform: 'tiktok',
        action: 'check_status',
        error: data.fail_reason || 'Publishing failed',
      };
    } else {
      return {
        success: true,
        platform: 'tiktok',
        action: 'check_status',
        message: 'Publishing in progress...',
      };
    }
  } catch (error) {
    console.error('TikTok check status error:', error);
    return {
      success: false,
      platform: 'tiktok',
      action: 'check_status',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Full upload workflow for TikTok
 *
 * Note: TikTok requires mobile confirmation for direct publishing.
 * This returns a preview URL that the user must confirm on mobile.
 */
export async function uploadVideo(options: TikTokUploadOptions): Promise<SkillResult> {
  // Step 1: Initialize upload
  const initResult = await initUpload(options.filePath, options.title);
  if (!initResult.success) {
    return initResult;
  }

  // Step 2: Upload video chunks
  const uploadResult = await uploadChunks(initResult.url!, options.filePath);
  if (!uploadResult.success) {
    return uploadResult;
  }

  // Note: TikTok requires mobile confirmation for the final publish step
  // The video will be in a "pending confirmation" state
  return {
    success: true,
    platform: 'tiktok',
    action: 'upload',
    message:
      'Video uploaded to TikTok. Please check the TikTok mobile app to confirm and publish.',
    url: 'https://www.tiktok.com/upload',
  };
}

/**
 * Check if TikTok is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}
