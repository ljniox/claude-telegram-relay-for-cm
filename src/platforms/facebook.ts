/**
 * Facebook Graph API integration (includes Instagram)
 */

import axios from 'axios';
import { getValidToken, storeToken, createTokenData } from '../auth/token-manager.js';
import type { FacebookPostOptions, InstagramPostOptions, TokenData, SkillResult } from './types.js';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Get Facebook access token
 */
async function getAccessToken(): Promise<string | null> {
  const token = await getValidToken('facebook', refreshFacebookToken);
  return token?.accessToken || null;
}

/**
 * Refresh Facebook access token
 * Note: Facebook long-lived tokens don't expire by default, but we handle it anyway
 */
async function refreshFacebookToken(token: TokenData): Promise<TokenData | null> {
  // Facebook doesn't use refresh tokens in the traditional sense
  // Long-lived tokens are valid for 60 days and can be refreshed by making
  // a request to the graph API
  try {
    const response = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: token.accessToken,
      },
    });

    const { access_token, expires_in } = response.data;
    return createTokenData('facebook', access_token, undefined, expires_in);
  } catch (error) {
    console.error('Failed to refresh Facebook token:', error);
    return null;
  }
}

/**
 * Get user's pages
 */
export async function getPages(): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'facebook',
      action: 'get_pages',
      needsAuth: true,
      error: 'Facebook authentication required. Run /auth facebook',
    };
  }

  try {
    const response = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
      params: {
        access_token: token,
        fields: 'id,name,access_token',
      },
    });

    const pages = response.data.data;
    return {
      success: true,
      platform: 'facebook',
      action: 'get_pages',
      message: `Found ${pages.length} pages: ${pages.map((p: { name: string }) => p.name).join(', ')}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: 'facebook',
      action: 'get_pages',
      error: error instanceof Error ? error.message : 'Failed to get pages',
    };
  }
}

/**
 * Post to a Facebook page
 */
export async function postToPage(options: FacebookPostOptions): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'facebook',
      action: 'post_to_page',
      needsAuth: true,
      error: 'Facebook authentication required. Run /auth facebook',
    };
  }

  try {
    // First, get page access token
    const pagesResponse = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
      params: {
        access_token: token,
      },
    });

    const page = pagesResponse.data.data.find(
      (p: { id: string }) => p.id === options.pageId
    );

    if (!page) {
      return {
        success: false,
        platform: 'facebook',
        action: 'post_to_page',
        error: `Page ${options.pageId} not found or no permission to access it`,
      };
    }

    const pageToken = page.access_token;

    // Build post data
    const postData: Record<string, string | undefined> = {
      message: options.message,
      link: options.link,
      access_token: pageToken,
    };

    // If scheduled time is provided, convert to Unix timestamp
    if (options.scheduledTime) {
      postData.published = 'false';
      postData.scheduled_publish_time = Math.floor(
        options.scheduledTime.getTime() / 1000
      ).toString();
    }

    // Remove undefined values
    Object.keys(postData).forEach((key) => {
      if (postData[key] === undefined) delete postData[key];
    });

    const response = await axios.post(
      `${GRAPH_API_BASE}/${options.pageId}/feed`,
      postData
    );

    const postId = response.data.id;

    return {
      success: true,
      platform: 'facebook',
      action: 'post_to_page',
      postId,
      url: `https://facebook.com/${postId}`,
      message: `Posted to page successfully`,
    };
  } catch (error) {
    console.error('Facebook post error:', error);
    return {
      success: false,
      platform: 'facebook',
      action: 'post_to_page',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Post to Instagram (requires Facebook page connected to IG account)
 *
 * Instagram posting is a 2-step process:
 * 1. Create a media container
 * 2. Publish the container
 */
export async function postToInstagram(options: InstagramPostOptions): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'instagram',
      action: 'post_to_ig',
      needsAuth: true,
      error: 'Facebook authentication required. Run /auth facebook',
    };
  }

  try {
    // Step 1: Create media container
    const containerResponse = await axios.post(
      `${GRAPH_API_BASE}/${options.igUserId}/media`,
      {
        image_url: options.imageUrl,
        caption: options.caption || '',
        access_token: token,
      }
    );

    const creationId = containerResponse.data.id;

    // Step 2: Publish the container
    const publishResponse = await axios.post(
      `${GRAPH_API_BASE}/${options.igUserId}/media_publish`,
      {
        creation_id: creationId,
        access_token: token,
      }
    );

    const mediaId = publishResponse.data.id;

    return {
      success: true,
      platform: 'instagram',
      action: 'post_to_ig',
      postId: mediaId,
      url: `https://instagram.com/p/${mediaId}`,
      message: `Posted to Instagram successfully`,
    };
  } catch (error) {
    console.error('Instagram post error:', error);
    return {
      success: false,
      platform: 'instagram',
      action: 'post_to_ig',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get Instagram business account ID for a page
 */
export async function getInstagramAccountId(pageId: string): Promise<SkillResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      success: false,
      platform: 'instagram',
      action: 'get_ig_account',
      needsAuth: true,
      error: 'Facebook authentication required',
    };
  }

  try {
    const response = await axios.get(`${GRAPH_API_BASE}/${pageId}`, {
      params: {
        fields: 'instagram_business_account',
        access_token: token,
      },
    });

    const igAccount = response.data.instagram_business_account;
    if (!igAccount) {
      return {
        success: false,
        platform: 'instagram',
        action: 'get_ig_account',
        error: 'No Instagram business account connected to this page',
      };
    }

    return {
      success: true,
      platform: 'instagram',
      action: 'get_ig_account',
      message: igAccount.id,
    };
  } catch (error) {
    return {
      success: false,
      platform: 'instagram',
      action: 'get_ig_account',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Facebook is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}
