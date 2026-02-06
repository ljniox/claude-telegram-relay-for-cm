#!/usr/bin/env bun
/**
 * YouTube Skill CLI
 *
 * Usage: bun run src/skills/youtube-skill.ts <action> <args>
 */

import { uploadVideo, getChannelInfo } from '../platforms/youtube.js';
import type { SkillResult, YouTubeUploadOptions } from '../platforms/types.js';

const args = process.argv.slice(2);
const action = args[0];
const argsJson = args[1] || '{}';

async function main(): Promise<void> {
  let result: SkillResult;

  try {
    switch (action) {
      case 'upload': {
        const options: YouTubeUploadOptions = JSON.parse(argsJson);
        if (!options.filePath || !options.title) {
          result = {
            success: false,
            platform: 'youtube',
            action: 'upload',
            error: 'Missing required fields: filePath, title',
          };
        } else {
          result = await uploadVideo(options);
        }
        break;
      }

      case 'channel_info':
        result = await getChannelInfo();
        break;

      case 'check_auth': {
        const { isAuthenticated } = await import('../platforms/youtube.js');
        const authed = await isAuthenticated();
        result = {
          success: authed,
          platform: 'youtube',
          action: 'check_auth',
          message: authed ? 'Authenticated' : 'Not authenticated',
          needsAuth: !authed,
        };
        break;
      }

      default:
        result = {
          success: false,
          platform: 'youtube',
          action: action || 'unknown',
          error: `Unknown action: ${action}. Available: upload, channel_info, check_auth`,
        };
    }
  } catch (error) {
    result = {
      success: false,
      platform: 'youtube',
      action: action || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Output JSON result to stdout
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

main();
