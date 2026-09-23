import type { JobStatus } from '../jobs/types.js';

/** Shared HTML helpers — every interpolated value goes through `escapeHtml`. */

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const STATUS_BADGE: Record<JobStatus, string> = {
  queued: 'text-bg-secondary',
  running: 'text-bg-primary',
  succeeded: 'text-bg-success',
  retrying: 'text-bg-warning',
  dead: 'text-bg-danger',
  cancelled: 'text-bg-dark',
};

export function statusBadge(status: JobStatus): string {
  return `<span class="badge ${STATUS_BADGE[status]}">${escapeHtml(status)}</span>`;
}

export function shortId(id: string): string {
  return `<code title="${escapeHtml(id)}">${escapeHtml(id.slice(0, 8))}</code>`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? escapeHtml(iso) : escapeHtml(d.toLocaleString());
}
