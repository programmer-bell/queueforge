/**
 * Exponential backoff for retries: `base * 2^attempts` seconds, capped at
 * `max`. `attempts` is the post-claim count (claiming already increments it),
 * so the first retry waits `2 * base`.
 */
export function computeBackoffSeconds(
  attempts: number,
  baseDelaySec: number,
  maxDelaySec: number,
): number {
  return Math.min(baseDelaySec * 2 ** attempts, maxDelaySec);
}
