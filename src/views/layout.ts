import { config } from '../config.js';
import { escapeHtml } from './html.js';

export type NavPage = 'dashboard' | 'jobs';

/**
 * Base layout: Bootstrap 5 + htmx via CDN, navbar, optional "Manage" token
 * control (hidden entirely when DASHBOARD_TOKEN is unset), vanilla-JS only.
 */
export function layout(title: string, active: NavPage, body: string): string {
  const tokenGate = config.dashboardToken
    ? `<button type="button" class="btn btn-outline-light btn-sm" data-bs-toggle="modal" data-bs-target="#manageModal">Manage</button>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · QueueForge</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
</head>
<body>
<nav class="navbar navbar-expand navbar-dark bg-dark mb-4">
<div class="container-fluid">
<a class="navbar-brand" href="/">QueueForge</a>
<div class="navbar-nav me-auto">
<a class="nav-link${active === 'dashboard' ? ' active' : ''}" href="/">Dashboard</a>
<a class="nav-link${active === 'jobs' ? ' active' : ''}" href="/jobs">Jobs</a>
</div>
${tokenGate}
</div>
</nav>
<main class="container mb-5"><div id="page">
${body}
</div></main>
<div class="modal fade" id="manageModal" tabindex="-1" aria-hidden="true">
<div class="modal-dialog"><div class="modal-content">
<div class="modal-header"><h5 class="modal-title">Dashboard token</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
<div class="modal-body">
<p class="text-muted small">Mutating actions (enqueue, cancel) need the dashboard token. It is stored only in this browser's localStorage and sent as <code>Authorization: Bearer …</code>.</p>
<input type="password" id="qf-token-input" class="form-control" placeholder="Paste dashboard token" autocomplete="off">
</div>
<div class="modal-footer"><button type="button" class="btn btn-primary" id="qf-token-save">Save</button></div>
</div></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script>
(function () {
  function authHeaders() {
    var t = localStorage.getItem('qf_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  function applyToken() {
    // htmx merges body hx-headers into every request it issues.
    var t = localStorage.getItem('qf_token');
    if (t) document.body.setAttribute('hx-headers', JSON.stringify({ Authorization: 'Bearer ' + t }));
    else document.body.removeAttribute('hx-headers');
  }
  var input = document.getElementById('qf-token-input');
  if (input) {
    input.value = localStorage.getItem('qf_token') || '';
    document.getElementById('qf-token-save').addEventListener('click', function () {
      var v = input.value.trim();
      if (v) localStorage.setItem('qf_token', v);
      else localStorage.removeItem('qf_token');
      applyToken();
    });
  }
  applyToken();
  window.qfAuthHeaders = authHeaders;
  // Opt-in full reload after a mutating htmx call (e.g. cancel on the detail page).
  document.body.addEventListener('htmx:afterRequest', function (e) {
    if (e.detail.successful && e.detail.elt.hasAttribute('data-reload-on-success')) location.reload();
  });
})();
</script>
</body>
</html>`;
}
