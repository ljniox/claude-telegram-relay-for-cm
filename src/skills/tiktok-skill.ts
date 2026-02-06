#!/usr/bin/env bun
/**
 * TikTok Skill CLI
 *
 * Usage: bun run src/skills/tiktok-skill.ts <action> <args>
 */

import { uploadVideo, initUpload, uploadChunks, checkStatus } from '../platforms/tiktok.js';
import type { SkillResult, TikTokUploadOptions } from '../platforms/types.js';

const args = process.argv.slice(2);
const action = args[0];
const argsJson = args[1] || '{}';

async function main(): Promise<void> {
  let result: SkillResult;

  try {
    switch (action) {
      case 'upload': {
        const options: TikTokUploadOptions = JSON.parse(argsJson);
        if (!options.filePath || !options.title) {
          result = {
            success: false,
            platform: 'tiktok',
            action: 'upload',
            error: 'Missing required fields: filePath, title',
          };
        } else {
          result = await uploadVideo(options);
        }
        break;
      }

      case 'init': {
        const { filePath, title } = JSON.parse(argsJson);
        if (!filePath || !title) {
          result = {
            success: false,
            platform: 'tiktok',
            action: 'init',
            error: 'Missing required fields: filePath, title',
          };
        } else {
          result = await initUpload(filePath, title);
        }
        break;
      }

      case 'upload-chunks': {
        const { uploadUrl, filePath } = JSON.parse(argsJson);
        if (!uploadUrl || !filePath) {
          result = {
            success: false,
            platform: 'tiktok',
            action: 'upload-chunks',
            error: 'Missing required fields: uploadUrl, filePath',
          };
        } else {
          result = await uploadChunks(uploadUrl, filePath);
        }
        break;
      }

      case 'status': {
        const { publishId } = JSON.parse(argsJson);
        if (!publishId) {
          result = {
            success: false,
            platform: 'tiktok',
            action: 'status',
            error: 'Missing required field: publishId',
          };
        } else {
          result = await checkStatus(publishId);
        }
        break;
      }

      case 'check_auth': {
        const { isAuthenticated } = await import('../platforms/tiktok.js');
        const authed = await isAuthenticated();
        result = {
          success: authed,
          platform: 'tiktok',
          action: 'check_auth',
          message: authed ? 'Authenticated' : 'Not authenticated',
          needsAuth: !authed,
        };
        break;
      }

      default:
        result = {
          success: false,
          platform: 'tiktok',
          action: action || 'unknown',
          error: `Unknown action: ${action}. Available: upload, init, upload-chunks, status, check_auth`,
        };
    }
  } catch (error) {
    result = {
      success: false,
      platform: 'tiktok',
      action: action || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Output JSON result to stdout
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

main();
