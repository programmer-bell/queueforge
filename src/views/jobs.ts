import type { Job, JobEvent, JobStatus } from '../jobs/types.js';
import { escapeHtml, formatTime, shortId, statusBadge } from './html.js';

/** Job table / detail fragments (Bootstrap). Full pages compose these in `layout`. */

const FILTER_STATUSES: Array<JobStatus | ''> = [
  '',
  'queued',
  'running',
  'succeeded',
  'retrying',
  'dead',
  'cancelled',
];

export function jobRowFragment(job: Job): string {
  return `<tr><td><a href="/jobs/${escapeHtml(job.id)}" hx-get="/jobs/${escapeHtml(job.id)}" hx-target="#page" hx-push-url="true">${shortId(job.id)}</a></td><td>${escapeHtml(job.type)}</td><td>${statusBadge(job.status)}</td><td>${job.attempts}/${job.max_attempts}</td><td>${formatTime(job.created_at)}</td></tr>`;
}

export function jobTableFragment(jobs: Job[]): string {
  if (jobs.length === 0) return `<p class="text-muted">No jobs found.</p>`;
  return `<table class="table table-sm table-hover"><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead><tbody>${jobs.map(jobRowFragment).join('')}</tbody></table>`;
}

/** Backwards-compatible list fragment used by the JSON/HTML API routes. */
export function jobListFragment(jobs: Job[]): string {
  return jobTableFragment(jobs);
}

export function paginationFragment(
  basePath: string,
  query: { status?: string; type?: string },
  page: number,
  perPage: number,
  total: number,
): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const href = (p: number): string => {
    const q = new URLSearchParams(params);
    q.set('page', String(p));
    q.set('per_page', String(perPage));
    return `${basePath}?${q.toString()}`;
  };
  const link = (p: number, label: string, disabled: boolean): string =>
    disabled
      ? `<li class="page-item disabled"><span class="page-link">${label}</span></li>`
      : `<li class="page-item"><a class="page-link" href="${href(p)}" hx-get="${href(p)}" hx-target="#page" hx-push-url="true">${label}</a></li>`;
  return `<nav aria-label="Jobs pages"><ul class="pagination pagination-sm mb-0"><li class="page-item disabled"><span class="page-link">Page ${page} of ${totalPages} · ${total} jobs</span></li>${link(page - 1, '‹ Prev', page <= 1)}${link(page + 1, 'Next ›', page >= totalPages)}</ul></nav>`;
}

export function jobFilterFormFragment(current: { status?: string; type?: string }): string {
  const options = FILTER_STATUSES.map(
    (s) =>
      `<option value="${s}"${current.status === s || (s === '' && !current.status) ? ' selected' : ''}>${s === '' ? 'any status' : s}</option>`,
  ).join('');
  return `<form class="row g-2 mb-3" hx-get="/jobs" hx-target="#page" hx-push-url="true" hx-swap="innerHTML">
<div class="col-auto"><select name="status" class="form-select form-select-sm" aria-label="Filter by status">${options}</select></div>
<div class="col-auto"><input name="type" class="form-control form-control-sm" placeholder="exact type…" value="${escapeHtml(current.type ?? '')}"></div>
<div class="col-auto"><button class="btn btn-sm btn-outline-primary" type="submit">Filter</button></div>
</form>`;
}

export function jobDetailFragment(job: Job, events: JobEvent[]): string {
  const timeline =
    events.length === 0
      ? `<p class="text-muted">No transitions recorded.</p>`
      : `<table class="table table-sm"><thead><tr><th>Transition</th><th>Attempt</th><th>Message</th><th>At</th></tr></thead><tbody>${events
          .map(
            (e) =>
              `<tr><td><code>${escapeHtml(e.from_status ?? '∅')} → ${escapeHtml(e.to_status)}</code></td><td>${e.attempt}</td><td>${escapeHtml(e.message ?? '—')}</td><td>${formatTime(e.created_at)}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  const cancel =
    job.status === 'queued'
      ? `<button class="btn btn-sm btn-outline-danger" hx-post="/api/jobs/${escapeHtml(job.id)}/cancel" data-reload-on-success="true" hx-swap="none">Cancel job</button>`
      : '';
  return `<div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h5 mb-0">Job ${shortId(job.id)}</h2><div>${statusBadge(job.status)} ${cancel}</div></div>
<div class="row g-3 mb-4">
<div class="col-md-6"><div class="card"><div class="card-body"><dl class="row mb-0">
<dt class="col-4">Type</dt><dd class="col-8">${escapeHtml(job.type)}</dd>
<dt class="col-4">Attempts</dt><dd class="col-8">${job.attempts} / ${job.max_attempts}</dd>
<dt class="col-4">Priority</dt><dd class="col-8">${job.priority}</dd>
<dt class="col-4">Run at</dt><dd class="col-8">${formatTime(job.run_at)}</dd>
<dt class="col-4">Locked by</dt><dd class="col-8">${escapeHtml(job.locked_by ?? '—')}</dd>
${job.last_error ? `<dt class="col-4">Last error</dt><dd class="col-8 text-danger">${escapeHtml(job.last_error)}</dd>` : ''}
</dl></div></div></div>
<div class="col-md-6"><div class="card"><div class="card-header">Payload</div><div class="card-body"><pre class="mb-0">${escapeHtml(JSON.stringify(job.payload, null, 2))}</pre></div></div></div>
</div>
<h3 class="h6">Timeline</h3>${timeline}`;
}
