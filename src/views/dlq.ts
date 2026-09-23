import type { Job } from '../jobs/types.js';
import { escapeHtml, formatTime, shortId } from './html.js';
import { paginationFragment } from './jobs.js';

/** Dead-letter queue fragments. Replay buttons POST to the gated API route. */

export function dlqTableFragment(jobs: Job[]): string {
  if (jobs.length === 0) {
    return `<div class="alert alert-success">DLQ is empty — no permanently failed jobs.</div>`;
  }
  return `<table class="table table-sm table-hover"><thead><tr><th>ID</th><th>Type</th><th>Attempts</th><th>Last error</th><th>Dead since</th><th></th></tr></thead><tbody>${jobs.map(dlqRowFragment).join('')}</tbody></table>`;
}

function dlqRowFragment(job: Job): string {
  return `<tr><td><a href="/jobs/${escapeHtml(job.id)}">${shortId(job.id)}</a></td><td>${escapeHtml(job.type)}</td><td>${job.attempts}/${job.max_attempts}</td><td class="text-danger">${escapeHtml((job.last_error ?? '—').slice(0, 80))}</td><td>${formatTime(job.updated_at)}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary" hx-post="/api/dlq/${escapeHtml(job.id)}/replay" hx-target="closest tr" hx-swap="outerHTML">Replay</button></td></tr>`;
}

export function dlqPageFragment(jobs: Job[], page: number, perPage: number, total: number): string {
  return `<h1 class="h4 mb-1">Dead-letter queue</h1><p class="text-muted">Permanently failed jobs. Replaying moves a job back to <code>queued</code> with attempts reset.</p>${dlqTableFragment(jobs)}${total > 0 ? paginationFragment('/dlq', {}, page, perPage, total) : ''}`;
}
