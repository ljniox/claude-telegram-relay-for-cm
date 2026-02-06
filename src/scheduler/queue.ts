/**
 * Job queue management for scheduled posts
 */

import {
  addPost,
  getPendingJobs,
  getJobById,
  listJobs,
  markComplete,
  markFailed,
  cancelJob,
  retryJob,
  deleteOldPosts,
} from '../storage/db.js';
import type { QueueAddRequest, ScheduledJob, QueueListOptions } from '../platforms/types.js';

/**
 * Add a job to the queue
 */
export function addJob(request: QueueAddRequest): number {
  const scheduledAt = request.scheduledAt ? new Date(request.scheduledAt) : new Date();

  return addPost(
    request.platform,
    request.action,
    JSON.stringify(request.content),
    scheduledAt,
    request.filePath
  );
}

/**
 * Get pending jobs that are ready to execute
 */
export function getReadyJobs(): ScheduledJob[] {
  return getPendingJobs();
}

/**
 * Get a specific job by ID
 */
export function getJob(id: number): ScheduledJob | null {
  return getJobById(id);
}

/**
 * List jobs with optional filtering
 */
export function listQueue(options?: QueueListOptions): ScheduledJob[] {
  return listJobs(options);
}

/**
 * Mark a job as completed
 */
export function completeJob(id: number, result: unknown): void {
  markComplete(id, JSON.stringify(result));
}

/**
 * Mark a job as failed
 */
export function failJob(id: number, error: string): void {
  markFailed(id, error);
}

/**
 * Cancel a pending job
 */
export function cancel(id: number): boolean {
  return cancelJob(id);
}

/**
 * Retry a failed job
 */
export function retry(id: number): boolean {
  return retryJob(id);
}

/**
 * Clean up old completed/failed jobs
 */
export function cleanup(days: number): number {
  return deleteOldPosts(days);
}

/**
 * Get queue statistics
 */
export function getStats(): {
  total: number;
  pending: number;
  completed: number;
  failed: number;
} {
  const all = listJobs();
  return {
    total: all.length,
    pending: all.filter((j) => j.status === 'pending').length,
    completed: all.filter((j) => j.status === 'completed').length,
    failed: all.filter((j) => j.status === 'failed').length,
  };
}
