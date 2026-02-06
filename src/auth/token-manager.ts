/**
 * OAuth2 token storage and refresh management
 */

import { getToken, saveToken, deleteToken } from '../storage/db.js';
import type { TokenData } from '../platforms/types.js';

// Token refresh buffer - refresh if expires in less than 5 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check if a token needs refresh
 */
export function needsRefresh(token: TokenData): boolean {
  if (!token.expiresAt) return false;
  return new Date(token.expiresAt).getTime() - Date.now() < REFRESH_BUFFER_MS;
}

/**
 * Check if a token is expired
 */
export function isExpired(token: TokenData): boolean {
  if (!token.expiresAt) return false;
  return new Date(token.expiresAt).getTime() <= Date.now();
}

/**
 * Get valid token for a platform (auto-refreshes if needed)
 */
export async function getValidToken(
  platform: string,
  refreshFn?: (token: TokenData) => Promise<TokenData | null>
): Promise<TokenData | null> {
  const token = getToken(platform);
  if (!token) return null;

  // If token is valid and doesn't need refresh, return it
  if (!needsRefresh(token) && !isExpired(token)) {
    return token;
  }

  // Token needs refresh
  if (!token.refreshToken) {
    console.log(`Token for ${platform} expired but no refresh token available`);
    return null;
  }

  if (!refreshFn) {
    console.log(`Token for ${platform} needs refresh but no refresh function provided`);
    return null;
  }

  try {
    console.log(`Refreshing token for ${platform}...`);
    const newToken = await refreshFn(token);
    if (newToken) {
      saveToken(newToken);
      return newToken;
    }
  } catch (error) {
    console.error(`Failed to refresh token for ${platform}:`, error);
  }

  return null;
}

/**
 * Store a new token
 */
export function storeToken(data: TokenData): void {
  saveToken(data);
}

/**
 * Remove a token
 */
export function removeToken(platform: string): boolean {
  return deleteToken(platform);
}

/**
 * Get token status (for health checks)
 */
export function getTokenStatus(platform: string): {
  exists: boolean;
  expired: boolean;
  needsRefresh: boolean;
  expiresAt?: Date;
} {
  const token = getToken(platform);
  if (!token) {
    return { exists: false, expired: true, needsRefresh: true };
  }

  return {
    exists: true,
    expired: isExpired(token),
    needsRefresh: needsRefresh(token),
    expiresAt: token.expiresAt,
  };
}

/**
 * Calculate expiration date from expires_in seconds
 */
export function calculateExpiration(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000);
}

/**
 * Create token data from OAuth response
 */
export function createTokenData(
  platform: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number
): TokenData {
  return {
    platform,
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? calculateExpiration(expiresIn) : undefined,
  };
}
