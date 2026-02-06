#!/usr/bin/env bun
/**
 * Facebook/Instagram Skill CLI
 *
 * Usage: bun run src/skills/facebook-skill.ts <action> <args>
 */

import {
  postToPage,
  postToInstagram,
  getPages,
  getInstagramAccountId,
} from '../platforms/facebook.js';
import type { SkillResult, FacebookPostOptions, InstagramPostOptions } from '../platforms/types.js';

const args = process.argv.slice(2);
const action = args[0];
const argsJson = args[1] || '{}';

async function main(): Promise<void> {
  let result: SkillResult;

  try {
    switch (action) {
      case 'post-page': {
        const options: FacebookPostOptions = JSON.parse(argsJson);
        if (!options.pageId) {
          result = {
            success: false,
            platform: 'facebook',
            action: 'post-page',
            error: 'Missing required field: pageId',
          };
        } else {
          result = await postToPage(options);
        }
        break;
      }

      case 'post-ig': {
        const options: InstagramPostOptions = JSON.parse(argsJson);
        if (!options.igUserId || !options.imageUrl) {
          result = {
            success: false,
            platform: 'instagram',
            action: 'post-ig',
            error: 'Missing required fields: igUserId, imageUrl',
          };
        } else {
          result = await postToInstagram(options);
        }
        break;
      }

      case 'get-pages':
        result = await getPages();
        break;

      case 'get-ig-account': {
        const { pageId } = JSON.parse(argsJson);
        if (!pageId) {
          result = {
            success: false,
            platform: 'instagram',
            action: 'get-ig-account',
            error: 'Missing required field: pageId',
          };
        } else {
          result = await getInstagramAccountId(pageId);
        }
        break;
      }

      case 'check_auth': {
        const { isAuthenticated } = await import('../platforms/facebook.js');
        const authed = await isAuthenticated();
        result = {
          success: authed,
          platform: 'facebook',
          action: 'check_auth',
          message: authed ? 'Authenticated' : 'Not authenticated',
          needsAuth: !authed,
        };
        break;
      }

      default:
        result = {
          success: false,
          platform: 'facebook',
          action: action || 'unknown',
          error: `Unknown action: ${action}. Available: post-page, post-ig, get-pages, get-ig-account, check_auth`,
        };
    }
  } catch (error) {
    result = {
      success: false,
      platform: 'facebook',
      action: action || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Output JSON result to stdout
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

main();
