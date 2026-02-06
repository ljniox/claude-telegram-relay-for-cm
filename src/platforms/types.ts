/**
 * Shared TypeScript interfaces for all social media platforms
 */

// ============================================================================
// PLATFORM-SPECIFIC CONFIGURATIONS
// ============================================================================

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface FacebookConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface TokenData {
  platform: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  updatedAt?: Date;
}

export interface OAuthState {
  platform: string;
  userId: string;
  codeVerifier?: string;
  redirectPath?: string;
}

// ============================================================================
// SKILL RESULTS
// ============================================================================

export interface SkillResult {
  success: boolean;
  platform: string;
  action: string;
  // On success
  postId?: string;
  videoId?: string;
  url?: string;
  message?: string;
  jobId?: number;
  // On error
  error?: string;
  needsAuth?: boolean;
}

// ============================================================================
// POST/CONTENT DATA
// ============================================================================

export interface PostContent {
  title?: string;
  description?: string;
  message?: string;
  caption?: string;
  tags?: string[];
  privacy?: 'public' | 'unlisted' | 'private';
  scheduledAt?: string;
  filePath?: string;
  imageUrl?: string;
  link?: string;
}

export interface ScheduledJob {
  id?: number;
  platform: string;
  action: string;
  status: 'pending' | 'completed' | 'failed';
  scheduledAt: Date;
  contentJson: string;
  filePath?: string;
  resultJson?: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// PLATFORM-SPECIFIC UPLOAD OPTIONS
// ============================================================================

export interface YouTubeUploadOptions {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  privacy?: 'public' | 'unlisted' | 'private';
  categoryId?: string;
}

export interface FacebookPostOptions {
  pageId: string;
  message?: string;
  link?: string;
  filePath?: string;
  scheduledTime?: Date;
}

export interface InstagramPostOptions {
  igUserId: string;
  imageUrl: string;
  caption?: string;
}

export interface TikTokUploadOptions {
  filePath: string;
  title: string;
  privacy?: 'public' | 'private' | 'friends';
}

// ============================================================================
// EDITORIAL RECOMMENDATIONS
// ============================================================================

export interface PlatformRecommendation {
  days: string[];
  hours: number[];
  frequency: string;
}

export interface PostingGuidelines {
  platform: string;
  bestDays: string;
  bestHours: string;
  frequency: string;
}

// ============================================================================
// QUEUE OPERATIONS
// ============================================================================

export interface QueueAddRequest {
  platform: string;
  action: string;
  content: PostContent;
  scheduledAt: string;
  filePath?: string;
}

export interface QueueListOptions {
  status?: 'pending' | 'completed' | 'failed';
  platform?: string;
  limit?: number;
}

export interface QueueCancelRequest {
  jobId: number;
}

export interface QueueRetryRequest {
  jobId: number;
}
