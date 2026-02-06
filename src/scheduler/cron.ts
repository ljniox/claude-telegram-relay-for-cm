#!/usr/bin/env bun
/**
 * Cron-based job runner for scheduled posts
 *
 * Usage: bun run src/scheduler/cron.ts
 */

import cron from 'node-cron';
import { spawn } from 'bun';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { getReadyJobs, completeJob, failJob, getStats, cleanup } from './queue.js';
import type { ScheduledJob, SkillResult } from '../platforms/types.js';

const CHECK_INTERVAL = parseInt(process.env.SCHEDULER_CHECK_INTERVAL || '60000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);

/**
 * Execute a skill for a job
 */
async function executeSkill(job: ScheduledJob): Promise<SkillResult> {
  const skillPath = join(process.cwd(), 'src/skills', `${job.platform}-skill.ts`);

  // Parse content to get skill arguments
  const content = JSON.parse(job.contentJson);
  const argsJson = JSON.stringify({
    ...content,
    filePath: job.filePath,
  });

  console.log(`[Scheduler] Executing ${job.platform}:${job.action} for job ${job.id}`);

  const proc = spawn(['bun', 'run', skillPath, job.action, argsJson], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`[Scheduler] Skill error: ${stderr}`);
    return {
      success: false,
      platform: job.platform,
      action: job.action,
      error: stderr || `Skill exited with code ${exitCode}`,
    };
  }

  try {
    return JSON.parse(output) as SkillResult;
  } catch {
    return {
      success: false,
      platform: job.platform,
      action: job.action,
      error: `Invalid JSON output: ${output}`,
    };
  }
}

/**
 * Process pending jobs
 */
async function processJobs(): Promise<void> {
  const jobs = getReadyJobs();

  if (jobs.length === 0) {
    return;
  }

  console.log(`[Scheduler] Processing ${jobs.length} jobs`);

  for (const job of jobs) {
    // Check retry count
    if (job.retryCount >= MAX_RETRIES) {
      console.log(`[Scheduler] Job ${job.id} exceeded max retries, marking as failed`);
      failJob(job.id, 'Max retries exceeded');
      continue;
    }

    try {
      const result = await executeSkill(job);

      if (result.success) {
        console.log(`[Scheduler] Job ${job.id} completed successfully`);
        completeJob(job.id, result);

        // Clean up file if it exists
        if (job.filePath) {
          await unlink(job.filePath).catch(() => {
            // File may already be deleted
          });
        }
      } else if (result.needsAuth) {
        // Auth errors shouldn't count as retries
        console.log(`[Scheduler] Job ${job.id} needs authentication`);
        failJob(job.id, `Authentication required: ${result.error}`);
      } else {
        console.log(`[Scheduler] Job ${job.id} failed: ${result.error}`);
        failJob(job.id, result.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`[Scheduler] Error processing job ${job.id}:`, error);
      failJob(job.id, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

/**
 * Clean up old files and database entries
 */
async function runCleanup(): Promise<void> {
  console.log('[Scheduler] Running cleanup...');
  const deleted = cleanup(RETENTION_DAYS);
  console.log(`[Scheduler] Cleaned up ${deleted} old posts`);
}

/**
 * Main scheduler loop
 */
async function startScheduler(): Promise<void> {
  console.log('[Scheduler] Starting...');
  console.log(`[Scheduler] Check interval: ${CHECK_INTERVAL}ms`);
  console.log(`[Scheduler] Max retries: ${MAX_RETRIES}`);

  // Print initial stats
  const stats = getStats();
  console.log('[Scheduler] Initial stats:', stats);

  // Process jobs immediately on start
  await processJobs();

  // Schedule regular checks
  const task = cron.schedule(`*/${Math.max(1, Math.floor(CHECK_INTERVAL / 60000))} * * * *`, async () => {
    await processJobs();
  });

  // Daily cleanup at midnight
  cron.schedule('0 0 * * *', runCleanup);

  console.log('[Scheduler] Running. Press Ctrl+C to stop.');

  // Keep process alive
  process.stdin.resume();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Scheduler] Shutting down...');
    task.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Scheduler] Shutting down...');
    task.stop();
    process.exit(0);
  });
}

// Run if called directly
if (import.meta.main) {
  startScheduler().catch((error) => {
    console.error('[Scheduler] Fatal error:', error);
    process.exit(1);
  });
}

export { processJobs, startScheduler };
