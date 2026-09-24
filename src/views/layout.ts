import { config } from '../config.js';
import { escapeHtml } from './html.js';

export type NavPage = 'dashboard' | 'jobs' | 'dlq' | 'schedules';

/**
 * Base layout: Vercel/Geist-inspired dark theme over Bootstrap 5 + htmx via
 * CDN, brand icon served by the app itself, optional "Manage" token control
 * (hidden entirely when DASHBOARD_TOKEN is unset), vanilla-JS only.
 */
export function layout(title: string, active: NavPage, body: string): string {
  const tokenGate = config.dashboardToken
    ? `<button type="button" class="btn btn-outline-light btn-sm" data-bs-toggle="modal" data-bs-target="#manageModal">Manage</button>`
    : '';
  return `<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · QueueForge</title>
<link rel="icon" type="image/png" href="/assets/icon.png">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
<style>
:root {
  --qf-bg: #060a14;
  --qf-panel: #0b1222;
  --qf-panel-2: #0e1628;
  --qf-line: rgba(148, 163, 184, 0.16);
  --qf-text: #e2e8f0;
  --qf-muted: #8b98ad;
  --qf-blue: #3b82f6;
  --qf-teal: #2dd4bf;
  --qf-amber: #fbbf24;
  --qf-red: #f87171;
  --qf-green: #34d399;
  --qf-radius: 12px;
}
html { scroll-behavior: smooth; }
body {
  background:
    radial-gradient(1200px 500px at 80% -10%, rgba(59, 130, 246, 0.12), transparent 60%),
    radial-gradient(900px 420px at 10% 0%, rgba(45, 212, 191, 0.08), transparent 55%),
    var(--qf-bg);
  color: var(--qf-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  min-height: 100vh;
}
code, pre, .font-monospace, .display-6 {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
a { color: var(--qf-teal); text-decoration: none; }
a:hover { color: #5eead4; }
/* Navbar */
.navbar.qf-nav {
  background: rgba(6, 10, 20, 0.72) !important;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--qf-line);
}
.navbar.qf-nav.scrolled { box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
.navbar-brand { font-weight: 650; letter-spacing: -0.01em; display: flex; align-items: center; gap: 0.5rem; color: #fff !important; }
.navbar-brand img { border-radius: 8px; box-shadow: 0 0 0 1px var(--qf-line); }
.navbar-dark .navbar-nav .nav-link { color: var(--qf-muted); font-size: 0.9rem; border-radius: 8px; padding: 0.35rem 0.7rem; }
.navbar-dark .navbar-nav .nav-link:hover { color: #fff; background: rgba(148, 163, 184, 0.1); }
.navbar-dark .navbar-nav .nav-link.active { color: #fff; background: rgba(59, 130, 246, 0.18); }
/* Cards */
.card {
  background: linear-gradient(180deg, var(--qf-panel-2), var(--qf-panel));
  border: 1px solid var(--qf-line);
  border-radius: var(--qf-radius);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 12px 32px rgba(0, 0, 0, 0.28);
}
.card-header { background: transparent; border-bottom: 1px solid var(--qf-line); font-weight: 600; font-size: 0.9rem; }
.card-subtitle { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; }
.display-6 { font-size: clamp(1.6rem, 2.2vw + 1rem, 2.4rem); font-weight: 650; letter-spacing: -0.02em; }
/* Tables */
.table { --bs-table-bg: transparent; --bs-table-color: var(--qf-text); --bs-table-border-color: var(--qf-line); font-size: 0.88rem; margin-bottom: 0; }
.table thead th { color: var(--qf-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; border-bottom: 1px solid var(--qf-line); }
.table-hover tbody tr { transition: background 0.15s ease; }
.table-hover tbody tr:hover { background: rgba(59, 130, 246, 0.07); }
/* Badges */
.badge { border-radius: 999px; font-weight: 600; font-size: 0.7rem; padding: 0.3em 0.65em; border: 1px solid transparent; }
.text-bg-secondary { background: rgba(148, 163, 184, 0.15) !important; color: #cbd5e1 !important; border-color: rgba(148, 163, 184, 0.25); }
.text-bg-primary { background: rgba(59, 130, 246, 0.16) !important; color: #93c5fd !important; border-color: rgba(59, 130, 246, 0.35); }
.text-bg-success { background: rgba(52, 211, 153, 0.14) !important; color: #6ee7b7 !important; border-color: rgba(52, 211, 153, 0.3); }
.text-bg-warning { background: rgba(251, 191, 36, 0.13) !important; color: #fcd34d !important; border-color: rgba(251, 191, 36, 0.3); }
.text-bg-danger { background: rgba(248, 113, 113, 0.13) !important; color: #fca5a5 !important; border-color: rgba(248, 113, 113, 0.32); }
.text-bg-dark { background: rgba(2, 6, 16, 0.8) !important; color: #94a3b8 !important; border-color: var(--qf-line); }
/* Buttons / forms */
.btn-primary { background: var(--qf-blue); border-color: var(--qf-blue); font-weight: 600; border-radius: 9px; }
.btn-primary:hover { background: #2563eb; border-color: #2563eb; box-shadow: 0 4px 18px rgba(59, 130, 246, 0.4); }
.btn-outline-secondary, .btn-outline-primary, .btn-outline-danger, .btn-outline-success, .btn-outline-light { border-radius: 9px; }
.btn-sm { font-size: 0.78rem; }
.form-control, .form-select { background: #070c18; border: 1px solid var(--qf-line); color: var(--qf-text); border-radius: 9px; }
.form-control:focus, .form-select:focus { background: #070c18; color: #fff; border-color: var(--qf-blue); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22); }
.form-label { font-size: 0.75rem; color: var(--qf-muted); font-weight: 600; margin-bottom: 0.25rem; }
/* Alerts / modal / misc */
.alert { border-radius: 10px; border: 1px solid var(--qf-line); font-size: 0.88rem; }
.alert-success { background: rgba(52, 211, 153, 0.1); color: #a7f3d0; }
.alert-danger { background: rgba(248, 113, 113, 0.1); color: #fecaca; }
.alert-warning { background: rgba(251, 191, 36, 0.1); color: #fde68a; }
.alert-info { background: rgba(59, 130, 246, 0.1); color: #bfdbfe; }
.modal-content { background: var(--qf-panel-2); border: 1px solid var(--qf-line); border-radius: 14px; }
pre { background: #04070f; border: 1px solid var(--qf-line); border-radius: 10px; padding: 0.75rem; font-size: 0.8rem; }
.pagination .page-link { background: transparent; border-color: var(--qf-line); color: var(--qf-teal); border-radius: 8px; margin: 0 2px; font-size: 0.8rem; }
.pagination .page-item.disabled .page-link { background: transparent; color: var(--qf-muted); }
/* Live dot pulse */
#live-dot.text-bg-success { animation: qf-pulse 2s ease-in-out infinite; }
@keyframes qf-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); } 50% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); } }
/* Update flash (applied by the SSE patch script) */
.qf-flash { animation: qf-flash 1.1s ease; border-radius: 8px; }
@keyframes qf-flash { 0% { background: rgba(59, 130, 246, 0.28); } 100% { background: transparent; } }
/* Entrance */
.qf-reveal { animation: qf-rise 0.45s ease both; }
@keyframes qf-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .qf-reveal, .qf-flash, #live-dot.text-bg-success { animation: none; }
  html { scroll-behavior: auto; }
}
@media (max-width: 576px) {
  main.container { padding-left: 0.9rem; padding-right: 0.9rem; }
  .display-6 { font-size: 1.7rem; }
}
</style>
</head>
<body>
<nav class="navbar navbar-expand navbar-dark qf-nav sticky-top mb-4">
<div class="container-fluid">
<a class="navbar-brand" href="/"><img src="/assets/icon.png" alt="QueueForge logo" width="28" height="28">QueueForge</a>
<div class="navbar-nav me-auto">
<a class="nav-link${active === 'dashboard' ? ' active' : ''}" href="/">Dashboard</a>
<a class="nav-link${active === 'jobs' ? ' active' : ''}" href="/jobs">Jobs</a>
<a class="nav-link${active === 'dlq' ? ' active' : ''}" href="/dlq">DLQ</a>
<a class="nav-link${active === 'schedules' ? ' active' : ''}" href="/schedules">Schedules</a>
</div>
${tokenGate}
</div>
</nav>
<main class="container mb-5"><div id="page" class="qf-reveal">
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
  // Sticky-nav depth on scroll.
  var nav = document.querySelector('.qf-nav');
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Animated count-up for stat values on first paint.
  function countUp(el) {
    var target = parseInt(el.getAttribute('data-countup') || el.textContent || '0', 10) || 0;
    if (!isFinite(target) || target <= 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / 600);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  document.querySelectorAll('#stats-cards [data-countup]').forEach(countUp);
})();
</script>
</body>
</html>`;
}
