#!/usr/bin/env bun
/**
 * Scheduler Skill CLI
 *
 * Usage: bun run src/skills/scheduler-skill.ts <action> <args>
 */

import { addJob, getJob, listQueue, cancel, retry, getStats, cleanup } from '../scheduler/queue.js';
import type { SkillResult, QueueAddRequest } from '../platforms/types.js';

const args = process.argv.slice(2);
const action = args[0];
const argsJson = args[1] || '{}';

async function main(): Promise<void> {
  let result: SkillResult;

  try {
    switch (action) {
      case 'add': {
        const request: QueueAddRequest = JSON.parse(argsJson);
        if (!request.platform || !request.action) {
          result = {
            success: false,
            platform: 'scheduler',
            action: 'add',
            error: 'Missing required fields: platform, action',
          };
        } else {
          const jobId = addJob(request);
          result = {
            success: true,
            platform: 'scheduler',
            action: 'add',
            jobId,
            message: `Job ${jobId} added to queue`,
          };
        }
        break;
      }

      case 'list': {
        const options = JSON.parse(argsJson);
        const jobs = listQueue(options);
        result = {
          success: true,
          platform: 'scheduler',
          action: 'list',
          message: JSON.stringify(jobs, null, 2),
        };
        break;
      }

      case 'get': {
        const { id } = JSON.parse(argsJson);
        if (!id) {
          result = {
            success: false,
            platform: 'scheduler',
            action: 'get',
            error: 'Missing required field: id',
          };
        } else {
          const job = getJob(id);
          if (job) {
            result = {
              success: true,
              platform: 'scheduler',
              action: 'get',
              message: JSON.stringify(job, null, 2),
            };
          } else {
            result = {
              success: false,
              platform: 'scheduler',
              action: 'get',
              error: `Job ${id} not found`,
            };
          }
        }
        break;
      }

      case 'cancel': {
        const { id } = JSON.parse(argsJson);
        if (!id) {
          result = {
            success: false,
            platform: 'scheduler',
            action: 'cancel',
            error: 'Missing required field: id',
          };
        } else {
          const success = cancel(id);
          result = {
            success,
            platform: 'scheduler',
            action: 'cancel',
            message: success ? `Job ${id} cancelled` : `Job ${id} not found or already processed`,
          };
        }
        break;
      }

      case 'retry': {
        const { id } = JSON.parse(argsJson);
        if (!id) {
          result = {
            success: false,
            platform: 'scheduler',
            action: 'retry',
            error: 'Missing required field: id',
          };
        } else {
          const success = retry(id);
          result = {
            success,
            platform: 'scheduler',
            action: 'retry',
            message: success ? `Job ${id} queued for retry` : `Job ${id} not found or not failed`,
          };
        }
        break;
      }

      case 'stats': {
        const stats = getStats();
        result = {
          success: true,
          platform: 'scheduler',
          action: 'stats',
          message: `Queue stats:\nTotal: ${stats.total}\nPending: ${stats.pending}\nCompleted: ${stats.completed}\nFailed: ${stats.failed}`,
        };
        break;
      }

      case 'cleanup': {
        const { days } = JSON.parse(argsJson);
        const deleted = cleanup(days || 7);
        result = {
          success: true,
          platform: 'scheduler',
          action: 'cleanup',
          message: `Cleaned up ${deleted} old posts`,
        };
        break;
      }

      default:
        result = {
          success: false,
          platform: 'scheduler',
          action: action || 'unknown',
          error: `Unknown action: ${action}. Available: add, list, get, cancel, retry, stats, cleanup`,
        };
    }
  } catch (error) {
    result = {
      success: false,
      platform: 'scheduler',
      action: action || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Output JSON result to stdout
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

main();
