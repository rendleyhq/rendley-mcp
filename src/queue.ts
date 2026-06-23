import PQueue from "p-queue";
import { config } from "@/config";

export const jobQueue = new PQueue({ concurrency: config.queueConcurrency });

export class QueueFullError extends Error {
  constructor(stats: ReturnType<typeof getQueueStats>) {
    super(
      `queue is saturated (running=${stats.running}, queued=${stats.queued}, max_queued=${stats.maxQueued})`,
    );
    this.name = "QueueFullError";
  }
}

const totalCap = () => config.queueConcurrency + config.queueMaxQueued;

export function getQueueStats() {
  const admitted = jobQueue.size + jobQueue.pending;
  return {
    concurrency: config.queueConcurrency,
    running: jobQueue.pending,
    queued: jobQueue.size,
    maxQueued: config.queueMaxQueued,
    isSaturated: admitted >= totalCap(),
  };
}

export function isQueueFull(): boolean {
  return jobQueue.size + jobQueue.pending >= totalCap();
}

export async function runQueued<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const result = await jobQueue.add(task, signal ? { signal } : undefined);
  return result as T;
}

export async function tryRunQueued<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (isQueueFull()) {
    throw new QueueFullError(getQueueStats());
  }
  return runQueued(task, signal);
}
