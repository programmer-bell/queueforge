import type { Job, JobEvent } from '../jobs/types.js';

/** Minimal htmx fragments (Bootstrap-flavored). The full dashboard lands in Phase 4. */

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function jobRowFragment(job: Job): string {
  return `<tr><td><code>${escapeHtml(job.id)}</code></td><td>${escapeHtml(job.type)}</td><td><span class="badge text-bg-secondary">${escapeHtml(job.status)}</span></td><td>${job.attempts}/${job.max_attempts}</td></tr>`;
}

export function jobListFragment(jobs: Job[]): string {
  if (jobs.length === 0) return `<p class="text-muted">No jobs found.</p>`;
  return `<table class="table table-sm"><tbody>${jobs.map(jobRowFragment).join('')}</tbody></table>`;
}

export function jobDetailFragment(job: Job, events: JobEvent[]): string {
  const timeline =
    events.length === 0
      ? `<p class="text-muted">No transitions recorded.</p>`
      : `<ul class="list-group list-group-flush">${events
          .map(
            (e) =>
              `<li class="list-group-item"><code>${escapeHtml(e.from_status ?? '∅')} → ${escapeHtml(e.to_status)}</code> <span class="text-muted">attempt ${e.attempt}</span></li>`,
          )
          .join('')}</ul>`;
  return `<div><h2><code>${escapeHtml(job.id)}</code></h2><p>Type <strong>${escapeHtml(job.type)}</strong> · status <span class="badge text-bg-secondary">${escapeHtml(job.status)}</span></p><pre>${escapeHtml(JSON.stringify(job.payload, null, 2))}</pre><h3>Timeline</h3>${timeline}</div>`;
}
