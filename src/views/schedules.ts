import type { Schedule } from '../jobs/schedules.js';
import { escapeHtml, formatTime } from './html.js';
import { paginationFragment } from './jobs.js';

/** Recurring-job schedule fragments. Mutations POST/PATCH the gated API routes. */

export function scheduleTableFragment(schedules: Schedule[]): string {
  if (schedules.length === 0) {
    return `<div class="alert alert-info">No schedules yet — create one below.</div>`;
  }
  return `<table class="table table-sm table-hover"><thead><tr><th>Name</th><th>Cron</th><th>Job type</th><th>Enabled</th><th>Last run</th><th></th></tr></thead><tbody>${schedules.map(scheduleRowFragment).join('')}</tbody></table>`;
}

function scheduleRowFragment(s: Schedule): string {
  const toggle = s.enabled
    ? `<button class="btn btn-sm btn-outline-secondary" hx-patch="/api/schedules/${escapeHtml(s.id)}" hx-vals='{"enabled": false}' hx-swap="none" data-reload-on-success="true">Disable</button>`
    : `<button class="btn btn-sm btn-outline-success" hx-patch="/api/schedules/${escapeHtml(s.id)}" hx-vals='{"enabled": true}' hx-swap="none" data-reload-on-success="true">Enable</button>`;
  return `<tr><td>${escapeHtml(s.name)}</td><td><code>${escapeHtml(s.cron)}</code></td><td>${escapeHtml(s.job_type)}</td><td>${s.enabled ? '<span class="badge text-bg-success">on</span>' : '<span class="badge text-bg-secondary">off</span>'}</td><td>${s.last_run_at ? formatTime(s.last_run_at) : '—'}</td><td class="text-end">${toggle}</td></tr>`;
}

export function scheduleCreateFormFragment(): string {
  return `<div class="card mb-4"><div class="card-header">New schedule</div><div class="card-body">
<form id="schedule-form" class="row g-2">
<div class="col-md-3"><label class="form-label" for="s-name">Name</label><input id="s-name" class="form-control form-control-sm" value="" required></div>
<div class="col-md-2"><label class="form-label" for="s-cron">Cron</label><input id="s-cron" class="form-control form-control-sm font-monospace" value="* * * * *" required></div>
<div class="col-md-3"><label class="form-label" for="s-type">Job type</label><input id="s-type" class="form-control form-control-sm" list="demo-types" value="demo.echo" required><datalist id="demo-types"><option value="demo.echo"></option><option value="demo.slow"></option><option value="demo.fail"></option></datalist></div>
<div class="col-md-2"><label class="form-label" for="s-payload">Payload (JSON)</label><input id="s-payload" class="form-control form-control-sm font-monospace" value="{}"></div>
<div class="col-md-2 d-flex align-items-end"><button class="btn btn-sm btn-primary w-100" type="submit">Create</button></div>
</form>
<div id="schedule-result" class="mt-2"></div>
</div></div>
<script>
(function () {
  function showResult(kind, text) {
    var out = document.getElementById('schedule-result');
    out.textContent = '';
    var div = document.createElement('div');
    div.className = 'alert alert-' + kind;
    div.textContent = text;
    out.appendChild(div);
  }
  var form = document.getElementById('schedule-form');
  if (!form) return;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var payloadRaw = document.getElementById('s-payload').value.trim() || '{}';
    var payload;
    try { payload = JSON.parse(payloadRaw); }
    catch (e) { showResult('danger', 'Payload is not valid JSON.'); return; }
    var body = {
      name: document.getElementById('s-name').value.trim(),
      cron: document.getElementById('s-cron').value.trim(),
      job_type: document.getElementById('s-type').value.trim(),
      payload_template: payload,
    };
    var headers = Object.assign({ 'Content-Type': 'application/json', 'HX-Request': 'true' }, window.qfAuthHeaders());
    fetch('/api/schedules', { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (text) { return { ok: res.ok, status: res.status, text: text }; });
      })
      .then(function (r) {
        if (!r.ok) { showResult('danger', 'Create failed (HTTP ' + r.status + '): ' + r.text.slice(0, 200)); return; }
        location.reload();
      })
      .catch(function () { showResult('danger', 'Network error.'); });
  });
})();
</script>`;
}

export function schedulesPageFragment(
  schedules: Schedule[],
  page: number,
  perPage: number,
  total: number,
): string {
  return `<h1 class="h4 mb-1">Recurring jobs</h1><p class="text-muted">Cron schedules. The in-process ticker enqueues a job instance whenever one is due.</p>${scheduleCreateFormFragment()}${scheduleTableFragment(schedules)}${total > 0 ? paginationFragment('/schedules', {}, page, perPage, total) : ''}`;
}
