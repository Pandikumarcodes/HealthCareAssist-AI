import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../../frontend/src/', import.meta.url);
function edit(path, transform) { const file = new URL(path, root); writeFileSync(file, transform(readFileSync(file, 'utf8'))); }

// Retain the existing palette; share its values across public and private layouts.
edit('index.css', () => `@import "tailwindcss";

:root {
  --ink: #203d3b;
  --muted: #536b65;
  --teal: #0b625b;
  --teal-hover: #084641;
  --mint: #eaf4ef;
  --surface: #fff;
  --canvas: #f5f8f7;
  --border: #dce7e3;
  --input-border: #7d948b;
  --focus: #16827a;
  --radius: 12px;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  color: var(--ink);
  background: var(--canvas);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  color-scheme: light;
}
@theme inline {
  --color-brand: var(--teal);
  --color-mint: var(--mint);
  --color-canvas: var(--canvas);
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 0; }
a { color: inherit; }
button, input, textarea, select { font: inherit; }
button, a, input, textarea, select { -webkit-tap-highlight-color: transparent; }
:is(button, a, input, textarea, select):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
h1 { margin: 0 0 12px; font-size: clamp(28px, 3vw, 36px); letter-spacing: -1px; line-height: 1.25; font-weight: 650; }
h2 { font-size: 20px; font-weight: 600; letter-spacing: -.4px; line-height: 1.4; }
dt { color: var(--muted); margin-bottom: 6px; font-size: 12px; }
dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; min-height: 44px; margin: 0; background: var(--teal); color: white; border: 1px solid transparent; border-radius: 8px; padding: 11px 18px; font-size: 14px; font-weight: 600; cursor: pointer; line-height: 1.5; }
button:hover:not(:disabled) { background: var(--teal-hover); }
button:disabled { opacity: .55; cursor: not-allowed; }
.brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; font-size: 19px; font-weight: 650; letter-spacing: -.5px; }
.brand-mark { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 12px; background: var(--teal); color: white; font-size: 28px; }
.brand-ai { color: var(--teal); }
.eyebrow { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 1.5px; color: #376c63; }
.text-link { display: inline-flex; min-height: 24px; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; text-underline-offset: 4px; }
footer { display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid var(--border); }
.not-found { max-width: 720px; margin: 10vh auto; padding: 32px 24px; }
.not-found p { color: var(--muted); line-height: 1.7; margin-bottom: 24px; }
`);

edit('features/auth/auth.css', () => `.login-page, .auth-status { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr); place-content: center; padding: 40px 24px; background: var(--canvas); }
.auth-status { text-align: center; justify-items: center; gap: 16px; }
.auth-status h1 { font-size: 32px; }
.login-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); width: min(100%, 1040px); margin: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 24px; box-shadow: 0 16px 64px #193d3b08; }
.login-card { min-width: 0; padding: clamp(32px, 4vw, 64px); overflow-wrap: anywhere; }
.login-card .brand { font-size: 17px; gap: 10px; }
.login-card .eyebrow { margin: 40px 0 12px; font-size: 11px; letter-spacing: 1.2px; }
.login-card h1 { font-size: 36px; margin: 0 0 12px; }
.login-description { color: var(--muted); font-size: 15px; line-height: 1.7; margin: 0 0 30px; }
.login-card fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.login-card .request-field { margin-bottom: 24px; }
.login-card label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 9px; }
.login-card input { width: 100%; min-width: 0; min-height: 48px; padding: 12px; border-radius: 8px; border: 1px solid var(--input-border); background: var(--surface); color: var(--ink); font-size: 16px; }
.login-card input[aria-invalid=true] { border-color: #ad463b; }
.login-card .field-error, .login-error { color: #9b3c32; font-size: 13px; line-height: 1.6; }
.login-error { padding: 12px 16px; background: #fff3ef; border: 1px solid #edccc2; border-radius: 8px; margin-bottom: 20px; }
.login-card button[type=submit] { width: 100%; min-height: 48px; }
.login-card .password-toggle { min-height: 28px; margin-top: 8px; padding: 2px 0; color: var(--teal); background: transparent; border: 0; border-radius: 3px; font-size: 12px; }
.login-card .password-toggle:hover:not(:disabled) { background: transparent; text-decoration: underline; text-underline-offset: 4px; }
.login-pending { font-size: 13px; color: var(--muted); line-height: 1.6; margin: 12px 0 0; }
.login-pending:empty { display: none; }
.login-note { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; line-height: 1.7; }
.login-panel { display: flex; flex-direction: column; justify-content: center; min-width: 0; margin: 12px; padding: 40px; border-radius: 16px; background: var(--mint); color: var(--ink); }
.login-panel .eyebrow { margin: 0; }
.login-panel h2 { position: relative; font-size: clamp(24px, 2.6vw, 32px); letter-spacing: -1px; line-height: 1.35; margin: 16px 0; }
.login-panel > p:not(.eyebrow) { color: var(--muted); font-size: 14px; line-height: 1.8; margin: 0; max-width: 340px; }
.login-panel-caption { color: var(--muted); font-size: 11px; margin-top: 36px; }
.login-illustration { position: relative; display: grid; place-items: center; height: 215px; margin: 24px 0; }
.login-ring { position: absolute; width: 200px; height: 200px; border: 1px solid #b9d9cd; border-radius: 50%; }
.login-ring-inner { width: 150px; height: 150px; }
.login-cross { font-size: 150px; font-weight: 300; line-height: 1; color: var(--teal); }
.login-illustration svg { position: absolute; width: 100%; top: 95px; stroke: #699d88; stroke-width: 2; stroke-linejoin: round; }
.sidebar-bottom .logout-button { display: flex; justify-content: flex-start; width: 100%; min-height: 44px; margin: 0 0 24px; color: #e8f4ef; background: #ffffff0d; border: 1px solid #ffffff33; }
.sidebar-bottom .logout-button:hover:not(:disabled) { background: #ffffff1a; }
.logout-error { color: #ffe1d5; font-size: 13px; line-height: 1.6; margin-bottom: 20px; }
@media (max-width: 900px) { .login-layout { max-width: 520px; grid-template-columns: minmax(0, 1fr); } .login-panel { display: none; } .login-card { padding: 40px; } }
@media (max-width: 480px) { .login-page { padding: 20px 16px; } .login-card { padding: 28px 20px; } .login-card .brand { font-size: 15px; } .login-card h1 { font-size: 32px; } .login-card .eyebrow { margin-top: 32px; } }
`);

edit('features/dashboard/dashboard.css', (css) => {
  css = css.replace('--ink: #203d3b; --muted: #617571; --teal: #0b625b; ', '');
  // Remove styles belonging solely to obsolete welcome navigation and unused placeholders.
  css = css.split('\n').filter(line => !/^\.(welcome-link|sidebar-note|dashboard-shell \.nav-upcoming|coming-soon)/.test(line)).join('\n');
  css = css.replace('  .welcome-link { margin-bottom: 0; }\n', '');
  css = css.replace(/font-size: 9px/g, 'font-size: 11px').replace(/font-size: 10px/g, 'font-size: 12px').replace(/font-size: 11px/g, 'font-size: 12px');
  css = css.replace('background: #fff; border-right: 1px solid #e1e9e6;', 'background: #123f3c; color: #e8f4ef; border-right: 1px solid #123f3c;');
  css = css.replace('padding: 0 6px 42px', 'padding: 0 6px 32px');
  css = css.replace(/color: #607368/g, 'color: var(--muted)');
  css = css.replace('padding-top: 90px', 'padding-top: 48px');
  css = css.replace('max-width: 1440px', 'max-width: 1280px');
  css = css.replace('border-radius: 10px; box-shadow', 'border-radius: var(--radius); box-shadow');
  css = css.replace('border-radius: 11px; min-width', 'border-radius: var(--radius); min-width');
  css = css.replace('font-size: 13px; letter-spacing: -.1px', 'font-size: 15px; letter-spacing: -.1px');
  css = css.replace('min-height: 155px', 'min-height: 124px').replace('padding: 26px 28px', 'padding: 22px 28px');
  return css + `
/* Shared workspace rhythm, using the existing palette and component classes. */
.dashboard-sidebar .brand-subtitle, .dashboard-sidebar .nav-label, .dashboard-sidebar .sidebar-version { color: #b6d0c5; }
.dashboard-sidebar .sidebar-version { border-color: #ffffff26; padding-top: 20px; line-height: 1.7; }
.dashboard-sidebar .nav-item { min-height: 46px; font-size: 14px; margin-bottom: 6px; }
.dashboard-sidebar .nav-item:hover { background: #ffffff12; }
.dashboard-sidebar .nav-item.active { background: #e7f2ee; color: #095e53; box-shadow: inset 3px 0 #8fc8b2; }
.dashboard-sidebar :is(a, button):focus-visible { outline-color: #a5ddcb; }
.dashboard-heading > div { min-width: 0; }
.dashboard-heading h1 { overflow-wrap: anywhere; }
.dashboard-heading p:not(.dashboard-eyebrow) { font-size: 14px; }
.stat-card dt { font-size: 13px; line-height: 1.5; }
.stat-card .stat-description { font-size: 12px; }
.panel-heading { flex-wrap: wrap; border-radius: var(--radius) var(--radius) 0 0; }
.panel-heading h2 { font-size: 15px; }
.dashboard-panel { box-shadow: 0 2px 8px #193d3b03; }
.dashboard-button, .summary-badge { max-width: 100%; }
.summary-badge { line-height: 1.5; }
.dashboard-notice { overflow-wrap: anywhere; }
.dashboard-shell .dashboard-button { white-space: normal; }
.dashboard-footer { flex-wrap: wrap; line-height: 1.7; }
@media (min-width: 721px) { .dashboard-sidebar { position: sticky; top: 0; height: 100dvh; overflow-y: auto; } }
@media (max-width: 720px) { .dashboard-sidebar { background: #123f3c; } .dashboard-main { padding: 24px 20px; } .sidebar-bottom { padding-top: 20px; } .sidebar-bottom .logout-button { margin-bottom: 0; } .stat-card dt { flex-direction: column-reverse; align-items: flex-start; } }
@media (max-width: 360px) { .dashboard-main { padding-inline: 16px; } .stats-grid { gap: 10px; } .stat-card { padding: 16px 12px; } }
`;
});

for (const path of ['features/requests/requests.css', 'features/knowledge-base/knowledge-base.css', 'features/ai-assistant/ai-assistant.css']) {
  edit(path, css => css.replace(/font-size: 10px/g, 'font-size: 12px').replace(/font-size: 11px/g, 'font-size: 12px').replace(/font-size: 13px/g, 'font-size: 14px').replace(/border-radius: (?:7|9|10|11)px/g, 'border-radius: var(--radius)').replace(/#7d948b/g, 'var(--input-border)').replace(/#16827a/g, 'var(--focus)'));
}
edit('features/requests/requests.css', css => css + `
.request-filters label { font-size: 13px; }
.request-filters :is(input, select), .request-secondary, .request-action-link { min-height: 44px; }
.request-field :is(input, select), .request-status-form select { min-height: 48px; }
.request-field textarea { min-height: 160px; }
.request-form-body { padding: 28px; }
.request-form .request-actions { padding-top: 24px; border-top: 1px solid var(--border); }
.request-table tbody tr:hover, .request-cards li:hover { background: #f8fbfa; }
.request-table tbody tr:last-child > * { border-bottom: 0; }
.request-status { font-size: 12px; }
.request-sort { line-height: 1.6; }
.request-dialog { border-radius: var(--radius); padding: 28px; }
.request-dialog .request-actions { gap: 12px; }
@media (max-width: 480px) { .request-form-body { padding: 20px; } .request-pagination nav { flex-wrap: wrap; } .request-pagination nav > span { flex: 1; } .request-dialog { padding: 22px; } }
`);
edit('features/knowledge-base/knowledge-base.css', css => css + `
.kb-workspace { align-items: stretch; }
.kb-help { font-size: 13px; }
.kb-upload input[type=file] { background: #f8fbfa; border-style: dashed; padding: 14px 10px; }
.kb-upload input[type=file]::file-selector-button { padding: 10px; border-radius: 6px; }
.kb-row-actions .request-secondary { min-height: 44px; }
.kb-table tbody tr:hover, .kb-cards li:hover { background: #f8fbfa; }
.kb-status { max-width: 100%; }
.kb-passage-heading { flex-wrap: wrap; }
.kb-passages li > p { max-width: 80ch; }
`);
edit('features/ai-assistant/ai-assistant.css', css => css + `
.ai-chat { margin-inline: 0; }
.ai-transcript { min-height: 260px; }
.ai-message { max-width: min(94%, 76ch); }
.ai-user { background: var(--mint); }
.ai-assistant { width: min(94%, 76ch); background: var(--surface); }
.ai-message h3 { font-size: 13px; }
.ai-result-label { display: inline-block; background: var(--mint); padding: 4px 8px; border-radius: 5px; }
.ai-no-context { background: #fcf5e7; }
.ai-sources ol { display: grid; gap: 8px; padding: 0; list-style-position: inside; }
.ai-sources li { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: #f8fbfa; }
.ai-composer { background: #fbfdfc; }
.ai-composer textarea { min-height: 100px; font-size: 16px; }
.ai-composer-actions > div { min-width: 0; }
@media (max-width: 480px) { .ai-message { max-width: 100%; } .ai-assistant { width: 100%; } .ai-composer-actions > div { flex-wrap: wrap; } }
`);
