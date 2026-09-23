import type { Job } from '../jobs/types.js';
import type { QueueStats } from '../jobs/stats.js';
import { jobTableFragment } from './jobs.js';

/** Dashboard home fragments: stat cards, recent-jobs table, enqueue test-job form. */

export function statCardsFragment(stats: QueueStats): string {
  const card = (label: string, value: number, sub: string): string =>
    `<div class="col"><div class="card h-100"><div class="card-body"><h6 class="card-subtitle mb-2 text-muted">${label}</h6><p class="card-text display-6 mb-0">${value}</p><p class="card-text"><small class="text-muted">${sub}</small></p></div></div></div>`;
  return `<div class="row row-cols-2 row-cols-md-3 row-cols-lg-6 g-3 mb-4" id="stats-cards">
${card('Queued', stats.counts.queued, 'waiting to run')}
${card('Running', stats.counts.running, 'claimed by workers')}
${card('Succeeded', stats.counts.succeeded, 'completed')}
${card('Retrying', stats.counts.retrying, 'failed, backing off')}
${card('Dead', stats.counts.dead, 'dead-letter queue')}
${card('Throughput', stats.throughputPerMin, 'transitions / min')}
</div>`;
}

export function recentJobsFragment(jobs: Job[]): string {
  return `<div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h5 mb-0">Recent jobs</h2><a href="/jobs" class="btn btn-sm btn-outline-secondary">View all</a></div>
<div id="recent-jobs">${jobTableFragment(jobs)}</div>`;
}

export function enqueueFormFragment(): string {
  return `<div class="card mb-4"><div class="card-header">Enqueue test job</div><div class="card-body">
<form id="enqueue-form" class="row g-2">
<div class="col-md-3"><label class="form-label" for="f-type">Type</label><input id="f-type" name="type" class="form-control form-control-sm" list="demo-types" value="demo.echo" required><datalist id="demo-types"><option value="demo.echo"></option><option value="demo.slow"></option><option value="demo.fail"></option></datalist></div>
<div class="col-md-4"><label class="form-label" for="f-payload">Payload (JSON)</label><input id="f-payload" name="payload" class="form-control form-control-sm font-monospace" value="{}"></div>
<div class="col-md-1"><label class="form-label" for="f-priority">Priority</label><input id="f-priority" name="priority" type="number" class="form-control form-control-sm" value="0"></div>
<div class="col-md-2"><label class="form-label" for="f-delay">Delay (sec)</label><input id="f-delay" name="delay" type="number" min="0" class="form-control form-control-sm" value="0"></div>
<div class="col-md-2 d-flex align-items-end"><button class="btn btn-sm btn-primary w-100" type="submit">Enqueue</button></div>
</form>
<div id="enqueue-result" class="mt-2"></div>
</div></div>
<script>
(function () {
  function showResult(kind, text) {
    var out = document.getElementById('enqueue-result');
    out.textContent = '';
    var div = document.createElement('div');
    div.className = 'alert alert-' + kind;
    div.textContent = text;
    out.appendChild(div);
  }
  function prependRow(rowHtml) {
    var recent = document.getElementById('recent-jobs');
    if (!recent) return;
    var table = recent.querySelector('table tbody');
    if (table) table.insertAdjacentHTML('afterbegin', rowHtml);
    else recent.insertAdjacentHTML('beforeend', '<table class="table table-sm table-hover"><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead><tbody>' + rowHtml + '</tbody></table>');
  }
  var form = document.getElementById('enqueue-form');
  if (!form) return;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var payloadRaw = document.getElementById('f-payload').value.trim() || '{}';
    var payload;
    try { payload = JSON.parse(payloadRaw); }
    catch (e) { showResult('danger', 'Payload is not valid JSON.'); return; }
    var delaySec = Math.max(0, parseInt(document.getElementById('f-delay').value || '0', 10) || 0);
    var body = {
      type: document.getElementById('f-type').value.trim(),
      payload: payload,
      priority: parseInt(document.getElementById('f-priority').value || '0', 10) || 0,
    };
    if (delaySec > 0) body.run_at = new Date(Date.now() + delaySec * 1000).toISOString();
    var headers = Object.assign({ 'Content-Type': 'application/json', 'HX-Request': 'true' }, window.qfAuthHeaders());
    fetch('/api/jobs', { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (text) { return { ok: res.ok, status: res.status, text: text }; });
      })
      .then(function (r) {
        if (!r.ok) { showResult('danger', 'Enqueue failed (HTTP ' + r.status + '): ' + r.text.slice(0, 200)); return; }
        prependRow(r.text);
        showResult('success', 'Job enqueued.');
      })
      .catch(function () { showResult('danger', 'Network error.'); });
  });
})();
</script>`;
}

export function dashboardPage(stats: QueueStats, recent: Job[]): string {
  return `${statCardsFragment(stats)}${enqueueFormFragment()}${recentJobsFragment(recent)}`;
}
