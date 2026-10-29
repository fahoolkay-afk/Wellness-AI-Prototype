// Staff app: unified inbox + CRM on Design OS v2 (docs/DESIGN-OS-v2.md). Plain ES module, no build step.
// Every permission shown here is also enforced by the server; the UI only hides what a role can't use.

const CHANNEL_LABEL = { sms: "SMS", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", email: "Email", voice: "Phone" };
const STAGE_LABEL = { new_lead: "New lead", contacted: "Contacted", booked: "Booked", active_patient: "Active", lapsed: "Lapsed" };
const STAGE_PILL = { new_lead: "info", contacted: "", booked: "accent", active_patient: "success", lapsed: "warn" };
const STAGE_HINT = { new_lead: "New people who wrote or called land here", contacted: "Leads you've replied to land here", booked: "Booked a first visit", active_patient: "Seen at least once", lapsed: "No visit in a while" };
const AVATAR_COLORS = ["#0f766e", "#2563eb", "#b45309", "#7c3aed", "#be123c", "#0e7490", "#4d7c0f", "#a21caf"];
const CONSENT_CHANNELS = ["sms", "whatsapp", "email", "messenger", "instagram"];

const ICONS = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z",
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  pipeline: "M3 5h4v14H3zM10 5h4v10h-4zM17 5h4v6h-4z",
  contacts: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  calls: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z",
  automations: "M13 2L3 14h9l-1 8 10-12h-9z",
  campaigns: "M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6",
  team: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6",
  audit: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  test: "M9 3h6M10 3v6L4 19a1 1 0 00.9 1.5h14.2A1 1 0 0020 19l-6-10V3",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  panel: "M3 4h18v16H3zM15 4v16",
  back: "M15 18l-6-6 6-6",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  sparkle: "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 3v4M21 5h-4",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  stamp: "M5 22h14M5 18h14v-3a2 2 0 00-2-2h-3V9a2 2 0 10-4 0v4H7a2 2 0 00-2 2z",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 118 0v4",
  alert: "M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  clock: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2",
  plus: "M12 5v14M5 12h14",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  more: "M12 13a1 1 0 100-2 1 1 0 000 2zM19 13a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z",
  people: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
};
const CH_ICON = {
  sms: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  whatsapp: "M3 21l1.7-5A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4-1z",
  messenger: "M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.5 5.5 3.8 7.2V22l3.4-1.9c.9.3 1.8.4 2.8.4 5.5 0 10-4.1 10-9.3S17.5 2 12 2zM7 13.5l3.2-3.4 2.3 2.3 3.5-2-3.2 3.4-2.3-2.3z",
  instagram: "M4 4h16v16H4zM12 16a4 4 0 100-8 4 4 0 000 8zM17.5 6.5h.01",
  email: "M4 4h16v16H4zM4 6l8 7 8-7",
  voice: ICONS.calls,
};

// ------------------------------------------------------------------ helpers

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") for (const [prop, val] of Object.entries(v)) { if (prop.startsWith("--")) el.style.setProperty(prop, val); else el.style[prop] = val; }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  return append(el, children);
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Like replaceChildren, but accepts nested arrays and null like h(). */
function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

function svg(d, cls = "i") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", cls);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
const icon = (name, size = "") => svg(ICONS[name], `i ${size}`);

const chBadge = (channel) => h("span", { class: `ch ${channel}`, role: "img", "aria-label": CHANNEL_LABEL[channel], title: CHANNEL_LABEL[channel] }, svg(CH_ICON[channel] ?? ICONS.info, ""));
const chChip = (channel) => h("span", { class: "chchip" }, chBadge(channel), CHANNEL_LABEL[channel]);
const pill = (text, kind = "", opts = {}) => h("span", { class: `pill ${kind}${opts.nodot ? " nodot" : ""}`, title: opts.title }, opts.icon ? icon(opts.icon) : null, text);

function avatar(name, channel, size = "") {
  const label = (name ?? "?").trim();
  const initials = label.startsWith("+") || label.includes("@") ? "#" : label.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h("div", { class: `avatar ${size}`, style: { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }, "aria-hidden": "true" }, initials || "?", channel && chBadge(channel));
}

const contactLabel = (c) => c.contact_name ?? c.name ?? c.contact_phone ?? c.phone ?? c.contact_email ?? c.email ?? "Unknown contact";
const firstName = (name) => (name ?? "").split(" ")[0];

/** All times show in the clinic's time zone, wherever the staff member's device is. */
const clinicTz = () => state.clinic?.profile.timezone;
const fmt = (iso, opts) => new Date(iso).toLocaleString([], { ...opts, timeZone: clinicTz() });
const dayKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: clinicTz() }).format(new Date(iso));
const fmtTime = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });
const fmtDateTime = (iso) => fmt(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (iso) => fmt(iso, { month: "short", day: "numeric", year: "numeric" });

function timeShort(iso) {
  const mins = (Date.now() - new Date(iso)) / 60000;
  if (mins < 1) return "now";
  if (mins < 60) return `${Math.floor(mins)} min`;
  if (dayKey(iso) === dayKey(new Date())) return fmtTime(iso);
  if (mins / 1440 < 6) return fmt(iso, { weekday: "short" });
  return fmt(iso, { month: "short", day: "numeric" });
}

function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const can = (perm) => state.session?.permissions.includes(perm);

// ---------------------------------------------------------------- feedback

let toastWrap;
const announcer = h("div", { class: "sr", "aria-live": "polite" });
function announce(text) { announcer.textContent = text; }

function toast(text, opts = {}) {
  toastWrap ??= document.body.appendChild(h("div", { class: "toasts" }));
  const el = h("div", { class: `toast${opts.error ? " err" : ""}`, role: opts.error ? "alert" : "status" }, h("span", {}, text));
  if (opts.action) el.append(h("button", { onclick: () => { opts.action.run(); el.remove(); } }, opts.action.label));
  el.append(h("button", { class: "x", "aria-label": "Dismiss", onclick: () => el.remove() }, icon("x")));
  toastWrap.append(el);
  while (toastWrap.children.length > 3) toastWrap.firstChild.remove();
  let timer;
  const arm = () => { if (!opts.error) timer = setTimeout(() => el.remove(), opts.action ? 6000 : 4000); };
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", arm);
  arm();
}

/** Accessible modal: focus trap, Esc closes, focus returns to the trigger. Resolves with the value passed to close(). */
function modal({ title, body, actions, width, dark, initial }) {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    const titleId = `m${Math.random().toString(36).slice(2)}`;
    const close = (value) => { scrim.remove(); document.removeEventListener("keydown", onKey, true); trigger?.focus?.(); resolve(value); };
    const dialog = h("div", { class: `dialog${dark ? " dark" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, style: { "--w": `${width ?? 480}px` } },
      h("header", {}, h("h3", { id: titleId }, title)),
      h("div", { class: "body" }, body),
      h("footer", {}, actions(close)));
    const scrim = h("div", { class: "scrim", onmousedown: (e) => { if (e.target === scrim) close(undefined); } }, dialog);
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(undefined); }
      if (e.key !== "Tab") return;
      const items = [...dialog.querySelectorAll("button, input, select, textarea, a[href]")].filter((x) => !x.disabled && x.offsetParent);
      if (!items.length) return;
      const [first, last] = [items[0], items.at(-1)];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.append(scrim);
    (initial?.() ?? dialog.querySelector("input, select, textarea") ?? dialog.querySelector("footer button:last-child"))?.focus();
  });
}

function askConfirm(message, confirmLabel, opts = {}) {
  return modal({
    title: opts.title ?? "Are you sure?", width: 440, dark: opts.dark,
    body: h("p", { class: "muted" }, message),
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Go back"), h("button", { class: `btn ${opts.danger ? "danger" : "primary"}`, onclick: () => close(true) }, confirmLabel)],
    // Destructive dialogs start on the safe button.
    initial: opts.danger ? () => document.querySelector(".dialog footer .btn") : undefined,
  });
}

// --------------------------------------------------------------------- api

class SignedOut extends Error {}

async function api(method, path, body, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(opts.background ? { "x-background": "1" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if ((res.status === 401 || (res.status === 403 && data?.setup)) && !path.startsWith("/login") && path !== "/session") {
    const wasIn = state.session?.scope === "full";
    state.session = null;
    stopLive();
    await renderAuth(wasIn ? "You were signed out. Sessions end after 15 minutes without activity." : undefined);
    throw new SignedOut("Signed out");
  }
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(success);
    return result;
  } catch (err) {
    if (!(err instanceof SignedOut)) toast(err.message, { error: true });
    return undefined;
  }
}

/** Downloads a file from the API with the session cookie (works in the browser demo too). */
async function download(path, filename) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? "Download failed", { error: true }); return; }
  const url = URL.createObjectURL(new Blob([await res.text()], { type: "application/fhir+json" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function busy(button, fn) {
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try { return await fn(); } finally { button.removeAttribute("aria-busy"); button.disabled = false; }
}

// ------------------------------------------------------------------- state

const state = {
  boot: null, session: null, clinics: [], clinicId: null, clinic: null,
  view: "inbox", filter: "all", search: "", convs: [], convId: null, thread: null, sse: null,
};

const VIEWS = [
  { id: "inbox", label: "Inbox", perm: "inbox.read" },
  { id: "dashboard", label: "Today", perm: "stats.read", icon: "dashboard" },
  { id: "pipeline", label: "Pipeline", perm: "contacts.read" },
  { id: "contacts", label: "Patients", perm: "contacts.read" },
  { id: "calendar", label: "Calendar", perm: "calendar.read" },
  { id: "tasks", label: "Tasks", perm: "tasks.read" },
  { id: "calls", label: "Calls", perm: "calls.read" },
  { id: "automations", label: "Funnels", perm: "automations.manage" },
  { id: "campaigns", label: "Campaigns", perm: "broadcast.send" },
  { id: "team", label: "Team", perm: "users.manage" },
  { id: "audit", label: "Audit", perm: "audit.read" },
  { id: "test", label: "Test", perm: "simulator.use" },
  { id: "settings", label: "Settings", perm: "settings.manage" },
];
const visibleViews = () => VIEWS.filter((v) => can(v.perm) && (v.id !== "test" || state.session.simulator));

// "#settings" is reserved when the app is embedded, so that view's link is "#setup".
const hashForView = (view) => (view === "settings" ? "setup" : view);
const viewForHash = (hash) => (hash === "setup" ? "settings" : hash);

const root = document.getElementById("app");
document.body.append(announcer);

// --------------------------------------------------------- sign-in & setup

async function renderAuth(notice) {
  stopLive();
  const info = await fetch("/api/session", { headers: { "x-background": "1" } }).then((r) => r.json()).catch(() => ({}));
  state.boot = info;
  const s = info.session;
  if (s?.scope === "full") return boot();
  if (s?.scope === "second") return renderCode();
  if (s?.scope === "setup") return s.mustChangePassword ? renderSetPassword() : renderEnrol();
  renderLogin(notice);
}

function authFrame(title, lead, content, step) {
  root.replaceChildren(h("main", { class: "auth" },
    h("div", { class: "auth-card" },
      h("div", { class: "brand" }, h("span", { class: "mark" }, icon("shield", "lg")), h("b", {}, "Clinic Front Desk")),
      h("div", { class: "card" }, h("div", { class: "body" },
        step && h("div", { class: "steps", "aria-label": `Step ${step[0]} of ${step[1]}` }, Array.from({ length: step[1] }, (_, i) => h("i", { class: i < step[0] ? "on" : "" }))),
        h("h1", {}, title), lead && h("p", { class: "muted" }, lead), content)))));
}

function renderLogin(notice) {
  const username = h("input", { name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const error = h("div", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "btn primary lg", type: "submit" }, "Sign in");
  const demo = state.boot?.demoAccounts;
  authFrame("Sign in", "Patient conversations, bookings and follow-ups in one place.", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = "";
    await busy(submit, async () => {
      try {
        await api("POST", "/login", { username: username.value, password: password.value });
        await renderAuth();
      } catch (err) {
        error.textContent = err.message;
        password.select();
      }
    });
  } },
  notice && h("div", { class: "banner info" }, icon("info"), notice),
  h("label", { class: "f" }, "Username", username),
  h("label", { class: "f" }, "Passphrase", password),
  error, submit,
  demo && h("div", { class: "banner warn" }, icon("alert"), h("div", {}, h("b", {}, "Demo mode, sample data only. "),
    `Accounts: ${demo.usernames.join(", ")}. Passphrase: ${demo.password}`)),
  ));
  username.focus();
}

function codeField() {
  return h("input", { class: "code-input", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxlength: "6", required: true, "aria-label": "6-digit code" });
}

function renderCode() {
  const code = codeField();
  const error = h("div", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "btn primary lg", type: "submit" }, "Verify");
  authFrame("Enter your code", "Open the authenticator app on your phone and type the 6-digit code for Clinic Front Desk.", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    await busy(submit, async () => {
      try { await api("POST", "/login/code", { code: code.value }); await renderAuth(); } catch (err) { error.textContent = err.message; code.select(); }
    });
  } }, code, error, submit,
  h("p", { class: "meta" }, "Lost your phone? Ask the clinic owner to reset your sign-in.")));
  code.focus();
}

function renderSetPassword() {
  const current = h("input", { type: "password", autocomplete: "current-password", required: true });
  const next = h("input", { type: "password", autocomplete: "new-password", minlength: "12", required: true });
  const again = h("input", { type: "password", autocomplete: "new-password", required: true });
  const error = h("div", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "btn primary lg", type: "submit" }, "Save passphrase");
  const needsTotp = state.boot.session.needsTotp;
  authFrame("Choose your passphrase", "Replace the temporary passphrase you were given. Use 12 or more characters; a few unrelated words work well.", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    if (next.value !== again.value) { error.textContent = "The two new passphrases don't match."; return; }
    await busy(submit, async () => {
      try { await api("POST", "/me/password", { current: current.value, next: next.value }); await renderAuth(); } catch (err) { error.textContent = err.message; }
    });
  } },
  h("label", { class: "f" }, "Temporary passphrase", current),
  h("label", { class: "f" }, "New passphrase", next),
  h("label", { class: "f" }, "New passphrase again", again),
  error, submit), [1, needsTotp ? 2 : 1]);
  current.focus();
}

async function renderEnrol() {
  const { secret, uri } = await api("POST", "/me/totp/start", {});
  const code = codeField();
  const error = h("div", { class: "error-text", role: "alert" });
  const submit = h("button", { class: "btn primary lg", type: "submit" }, "Turn on codes");
  authFrame("Set up your phone app", "Every sign-in needs a code from your phone, so a stolen passphrase alone can't open patient messages.", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    await busy(submit, async () => {
      try { await api("POST", "/me/totp/confirm", { code: code.value }); toast("Codes are on for your account"); await renderAuth(); } catch (err) { error.textContent = err.message; code.select(); }
    });
  } },
  h("ol", { class: "small muted stack", style: { paddingLeft: "18px", margin: 0, gap: "6px" } },
    h("li", {}, "Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…)."),
    h("li", {}, "Add an account by entering this setup key, or tap ", h("a", { href: uri }, "open in app"), " on this phone."),
    h("li", {}, "Type the 6-digit code the app shows.")),
  h("div", { class: "secret-key", "aria-label": "Setup key" }, secret.replace(/(.{4})/g, "$1 ").trim()),
  h("label", { class: "f" }, "6-digit code", code), error, submit), [2, 2]);
  code.focus();
}

// ------------------------------------------------------------------- shell

async function boot() {
  state.session = state.boot.session;
  state.clinics = await api("GET", "/clinics");
  if (!state.clinics.length) {
    authFrame("No clinic yet", "Your account isn't linked to a clinic. Ask the owner to add you.", h("button", { class: "btn", onclick: logout }, "Sign out"));
    return;
  }
  let saved;
  try { saved = Number(localStorage.getItem("fd_clinic")); } catch { /* storage unavailable */ }
  state.clinicId = state.clinics.find((c) => c.id === saved)?.id ?? state.clinics[0].id;
  await loadClinic();
  renderShell();
  connectLive();
  const hashView = viewForHash(location.hash.slice(1));
  const views = visibleViews();
  show(views.some((v) => v.id === hashView) ? hashView : views[0]?.id ?? "dashboard");
}

async function loadClinic() {
  state.clinic = await api("GET", `/clinics/${state.clinicId}`);
}

let railEl, titleEl, viewEl, liveDot, aiChip;

function renderShell() {
  railEl = h("nav", { class: "rail", "aria-label": "Main" }, h("div", { class: "mark", title: "Clinic Front Desk" }, icon("shield", "lg")));
  for (const v of visibleViews()) {
    railEl.append(h("button", { "data-view": v.id, onclick: () => show(v.id) }, icon(v.icon ?? v.id, "lg"), v.label));
  }
  railEl.append(h("div", { class: "spacer" }));

  titleEl = h("h2", {});
  liveDot = h("span", { class: "live", title: "Live updates", role: "img", "aria-label": "Live updates" });
  aiChip = h("span", {});
  drawAiChip();
  const clinicSelect = state.clinics.length > 1
    ? h("select", { "aria-label": "Clinic", onchange: async (e) => {
      state.clinicId = Number(e.target.value);
      try { localStorage.setItem("fd_clinic", String(state.clinicId)); } catch { /* storage unavailable */ }
      state.convId = null;
      await loadClinic();
      connectLive();
      show(state.view);
    } }, state.clinics.map((c) => h("option", { value: c.id, selected: c.id === state.clinicId }, c.name)))
    : h("span", { class: "clinic" }, state.clinic.name);
  const me = state.session.user;
  const meBtn = h("button", { class: "who-chip", "aria-haspopup": "menu", onclick: (e) => userMenu(e.currentTarget) }, avatar(me.name), h("span", { class: "hide-sm" }, firstName(me.name)));
  const topbar = h("header", { class: "topbar" },
    titleEl, clinicSelect, h("div", { class: "spacer" }),
    state.boot.demo || window.__FD_DEMO__ ? pill(window.__FD_DEMO__ ? "Browser demo" : "Demo data", "warn", { title: "Sample data only. Never enter real patient information." }) : null,
    h("span", { class: "hide-sm" }, aiChip), liveDot, meBtn);
  viewEl = h("main", { class: "view", id: "view" });
  root.replaceChildren(h("div", { class: "shell" }, railEl, h("div", { class: "main" }, topbar, viewEl)));
}

function drawAiChip() {
  const modes = Object.values(state.clinic.profile.aiModes ?? {});
  const agreements = state.clinic.profile.processorAgreementsRecorded || state.boot.demo;
  const on = agreements && modes.includes("auto");
  const draft = agreements && !on && modes.includes("draft");
  fill(aiChip, h("span", { class: `pill ${on ? "ai" : draft ? "ai" : ""}`, title: !agreements ? "The assistant stays off until processor agreements are recorded in Settings" : `Engine: ${state.clinic.responder === "claude" ? "Claude" : "offline demo"}` },
    icon("sparkle"), `Assistant · ${on ? "On" : draft ? "Draft mode" : "Off"}`));
}

function userMenu(anchor) {
  const me = state.session.user;
  const items = [
    h("div", { class: "menu-head" }, h("b", {}, me.name), h("br"), `${me.roleLabel} · ${me.username}`),
    h("button", { onclick: () => { close(); changePassphrase(); } }, icon("key"), "Change passphrase"),
    h("button", { onclick: () => { close(); toggleTheme(); } }, icon("moon"), "Switch light / dark"),
    h("button", { onclick: () => { close(); shortcutSheet(); } }, icon("keyboard"), "Keyboard shortcuts"),
    h("hr"),
    h("button", { class: "danger", onclick: () => { close(); logout(); } }, icon("logout"), "Sign out"),
  ];
  const close = popover(anchor, items);
}

function popover(anchor, items) {
  document.querySelector(".menu")?.remove();
  const r = anchor.getBoundingClientRect();
  const menu = h("div", { class: "menu", role: "menu", style: { top: `${r.bottom + 6}px`, right: `${Math.max(8, innerWidth - r.right)}px`, position: "fixed" } }, items);
  const close = () => { menu.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", esc, true); };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  const esc = (e) => { if (e.key === "Escape") { close(); anchor.focus(); } };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", esc, true);
  document.body.append(menu);
  menu.querySelector("button, a")?.focus();
  return close;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("fd_theme", next); } catch { /* storage unavailable */ }
}
try { const t = localStorage.getItem("fd_theme"); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }

async function changePassphrase() {
  const current = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password" });
  const ok = await modal({
    title: "Change passphrase",
    body: [h("label", { class: "f" }, "Current passphrase", current), h("label", { class: "f" }, "New passphrase", h("span", { class: "hint" }, "12 or more characters"), next),
      h("p", { class: "meta" }, "You'll stay signed in here; other devices are signed out.")],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Change passphrase")],
  });
  if (ok) await attempt(() => api("POST", "/me/password", { current: current.value, next: next.value }), "Passphrase changed");
}

async function logout() {
  await api("POST", "/logout", {}).catch(() => {});
  state.session = null;
  renderAuth();
}

function stopLive() {
  state.sse?.close();
  state.sse = null;
}

function connectLive() {
  stopLive();
  const sse = new EventSource(`/api/events?clinic=${state.clinicId}`);
  sse.onopen = () => liveDot?.classList.add("on");
  sse.onerror = () => liveDot?.classList.remove("on");
  let timer;
  sse.onmessage = (e) => {
    const event = JSON.parse(e.data);
    clearTimeout(timer);
    timer = setTimeout(() => refresh(event), 150);
  };
  state.sse = sse;
}

const refreshers = {};
function refresh(event) { refreshers[state.view]?.(event); }

function show(view) {
  state.view = view;
  if (location.hash !== `#${hashForView(view)}`) history.replaceState(null, "", `#${hashForView(view)}`);
  for (const b of railEl.querySelectorAll("button[data-view]")) {
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  const v = VIEWS.find((x) => x.id === view);
  titleEl.textContent = v?.label ?? "";
  document.title = `${v?.label ?? ""} · Clinic Front Desk`;
  viewEl.replaceChildren();
  for (const k of Object.keys(refreshers)) refreshers[k] = null;
  ({ inbox: viewInbox, dashboard: viewDashboard, pipeline: viewPipeline, contacts: viewContacts, calendar: viewCalendar, tasks: viewTasks, calls: viewCalls,
    automations: viewAutomations, campaigns: viewCampaigns, team: viewTeam, audit: viewAudit, test: viewTest, settings: viewSettings })[view]?.();
}

// --------------------------------------------------------- keyboard shortcuts

const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
let gPending = false;
document.addEventListener("keydown", (e) => {
  if (!state.session || state.session.scope !== "full" || document.querySelector(".scrim") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (typing(e)) { if (e.key === "Escape") e.target.blur(); return; }
  if (gPending) {
    gPending = false;
    const target = { i: "inbox", p: "pipeline", c: "calendar", d: "dashboard", t: "tasks" }[e.key];
    if (target && visibleViews().some((v) => v.id === target)) { e.preventDefault(); show(target); }
    return;
  }
  if (e.key === "g") { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
  if (e.key === "?") { e.preventDefault(); shortcutSheet(); return; }
  inboxKeys?.(e);
});
let inboxKeys = null;

function shortcutSheet() {
  const rows = [["j / k", "Next / previous conversation"], ["/", "Search"], ["r", "Reply"], ["e", "Mark handled"], [".", "Patient panel"], ["g then i, p, c, d, t", "Go to Inbox, Pipeline, Calendar, Today, Tasks"], ["Esc", "Close or leave a field"], ["?", "This list"]];
  modal({
    title: "Keyboard shortcuts", width: 460,
    body: h("table", { class: "t" }, h("tbody", {}, rows.map(([k, d]) => h("tr", {}, h("td", {}, k.split(" ").map((x) => (/^(then|or|\/)$/.test(x) && x !== "/" ? ` ${x} ` : h("kbd", {}, x.replace(",", ""))))), h("td", {}, d))))),
    actions: (close) => h("button", { class: "btn primary", onclick: () => close() }, "Done"),
  });
}

// ------------------------------------------------------------------- inbox

function viewInbox() {
  const listEl = h("div", { class: "convs", role: "listbox", "aria-label": "Conversations" });
  const searchEl = h("input", { type: "search", placeholder: "Search name, number or message", "aria-label": "Search conversations", value: state.search, oninput: (e) => { state.search = e.target.value; drawList(); } });
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["all", "All"], ["attention", "Needs reply"], ["unread", "Unread"]].map(([f, label]) =>
    h("button", { role: "tab", "aria-selected": String(state.filter === f), onclick: async (e) => {
      state.filter = f;
      for (const b of tabs.children) b.setAttribute("aria-selected", String(b === e.currentTarget));
      await loadList();
    } }, label)));
  const list = h("section", { class: "list" }, h("div", { class: "list-head" }, h("div", { class: "search" }, icon("search"), searchEl), tabs), listEl);
  const thread = h("section", { class: "thread", "aria-label": "Conversation" });
  const side = h("aside", { class: "side", "aria-label": "Patient details" });
  const layout = h("div", { class: "inbox" }, list, thread, side);
  viewEl.replaceChildren(layout);

  const visible = () => {
    const q = state.search.toLowerCase();
    return state.convs.filter((c) => !q || [c.contact_name, c.contact_phone, c.contact_email, c.preview].some((v) => v?.toLowerCase().includes(q)));
  };

  function drawList() {
    const convs = visible();
    if (!convs.length) {
      fill(listEl, state.search
        ? emptyState("search", `No matches for "${state.search}"`, "Try a name, phone number or a word from the message.", h("button", { class: "btn", onclick: () => { state.search = ""; searchEl.value = ""; drawList(); } }, "Clear search"))
        : state.filter !== "all"
          ? emptyState("check", "All caught up", "New messages appear here.")
          : emptyState("inbox", "No conversations yet", "Connect a channel in Settings, or send yourself a test message.", can("simulator.use") && state.session.simulator ? h("button", { class: "btn primary", onclick: () => show("test") }, "Send a test message") : null));
      return;
    }
    fill(listEl, convs.map((c) => {
      const label = contactLabel(c);
      return h("div", {
        class: `conv${c.unread ? " unread" : ""}`, role: "option", tabindex: "0", id: `conv-${c.id}`,
        "aria-selected": String(c.id === state.convId),
        onclick: () => openConversation(c.id),
        onkeydown: (e) => { if (e.key === "Enter") openConversation(c.id); },
      },
      avatar(label, c.last_channel),
      h("div", { class: "conv-body" },
        h("div", { class: "conv-top" }, h("span", { class: "conv-name" }, label), h("span", { class: `conv-time${c.needs_attention ? " warn" : ""}` }, timeShort(c.last_message_at))),
        h("div", { class: "conv-preview" },
          c.preview_author === "ai" ? h("span", { class: "who ai", title: "Assistant" }, icon("sparkle")) : c.preview_author === "staff" ? h("span", { class: "who" }, "You:") : null,
          h("span", {}, c.preview ?? "")),
        h("div", { class: "conv-flags" },
          c.needs_attention ? pill("Needs reply", "warn", { title: c.attention_reason ?? "" }) : null,
          c.drafts ? pill("Draft waiting", "ai") : null,
          !c.ai_enabled ? pill("Assistant off", "", { title: c.paused_by ? `Paused by ${c.paused_by}` : "" }) : null,
          pill(STAGE_LABEL[c.stage], STAGE_PILL[c.stage]),
          c.unread ? h("span", { class: "badge", "aria-label": `${c.unread} unread` }, c.unread) : null)));
    }));
  }

  async function loadList(background = false) {
    state.convs = await attempt(() => api("GET", `/clinics/${state.clinicId}/conversations?filter=${state.filter}`, undefined, { background })) ?? state.convs;
    drawList();
  }

  // The thread pane is split so live refreshes never wipe what staff are typing.
  const head = h("div", { class: "thread-head" });
  const banner = h("div", { class: "attention hidden", role: "status" });
  const messagesEl = h("div", { class: "messages", "aria-live": "polite" });
  const composer = buildComposer();
  let seenIds = new Set();

  async function openConversation(id) {
    if (state.convId !== id) seenIds = new Set();
    state.convId = id;
    layout.classList.add("open");
    drawList();
    await loadThread(true);
    document.getElementById(`conv-${id}`)?.scrollIntoView({ block: "nearest" });
    const c = state.convs.find((x) => x.id === id);
    if (c?.unread) {
      c.unread = 0;
      api("POST", `/conversations/${id}/read`, {}).catch(() => {});
      drawList();
    }
  }

  async function loadThread(scroll = false, background = false) {
    if (!state.convId) {
      fill(thread, emptyState("inbox", "Pick a conversation", "Texts, WhatsApp, Messenger, Instagram, email and calls all land here. The assistant answers what it can and flags the rest for you."));
      side.replaceChildren();
      return;
    }
    const data = await attempt(() => api("GET", `/conversations/${state.convId}`, undefined, { background }));
    if (!data) return;
    state.thread = data;
    if (!thread.contains(messagesEl)) thread.replaceChildren(head, banner, messagesEl, composer.el);
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
    drawHead(data);
    drawMessages(data);
    composer.update(data);
    drawSide(data);
    if (scroll || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function drawHead({ conversation, contact, reachable }) {
    const name = contact.name ?? contact.phone ?? contact.email ?? "Unknown";
    const mode = h("div", { class: "seg ai", role: "group", "aria-label": "Assistant for this conversation" },
      [["on", "Assistant on"], ["off", "Off"]].map(([v, label]) => h("button", {
        "data-v": v, "aria-pressed": String((v === "on") === !!conversation.ai_enabled), disabled: !can("inbox.manage"),
        onclick: async () => {
          const enabled = v === "on";
          if (enabled === !!conversation.ai_enabled) return;
          await attempt(() => api("POST", `/conversations/${conversation.id}/ai`, { enabled }), enabled ? "Assistant on for this conversation" : "Assistant off for this conversation");
          loadThread(); loadList();
        },
      }, v === "on" ? [icon("sparkle"), " ", label] : label)));
    fill(head,
      h("button", { class: "btn ghost icon back", "aria-label": "Back to conversations", onclick: () => { layout.classList.remove("open"); state.convId = null; drawList(); } }, icon("back")),
      avatar(name),
      h("div", { class: "who" }, h("b", {}, name), h("span", { class: "row meta" }, reachable.map(chBadge), [contact.phone, contact.email].filter(Boolean).join(" · "))),
      h("span", { class: "hide-sm" }, mode),
      h("button", { class: "btn ghost icon panel-toggle", "aria-label": "Patient details", title: "Patient details (.)", onclick: () => layout.classList.toggle("show-side") }, icon("panel")));
    banner.classList.toggle("hidden", !conversation.needs_attention);
    fill(banner, icon("alert"), h("span", {}, conversation.attention_reason ?? "Needs a reply from staff"),
      can("inbox.manage") && h("button", { class: "btn sm", onclick: async () => { await attempt(() => api("POST", `/conversations/${conversation.id}/resolve`, {}), "Marked handled"); loadThread(); loadList(); } }, icon("check"), "Mark handled"));
  }

  function drawMessages({ messages }) {
    const nodes = [];
    let lastDay = "";
    let prev = null;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const day = dayKey(m.created_at);
      if (day !== lastDay) {
        nodes.push(h("div", { class: "day" }, fmt(m.created_at, { weekday: "long", month: "short", day: "numeric" })));
        lastDay = day;
        prev = null;
      }
      if (m.author === "system") { nodes.push(h("div", { class: "sysrow" }, h("span", {}, m.body))); prev = null; continue; }
      if (m.author === "call") { nodes.push(callRow(m)); prev = null; continue; }
      const next = messages[i + 1];
      const sameAuthor = (a, b) => a && b && a.author === b.author && a.direction === b.direction && a.status !== "draft" && b.status !== "draft" && Math.abs(new Date(a.created_at) - new Date(b.created_at)) < 180_000 && dayKey(b.created_at) === day;
      const first = !sameAuthor(prev, m);
      const last = !sameAuthor(m, next);
      nodes.push(m.status === "draft" ? draftBubble(m) : bubble(m, first, last));
      prev = m;
    }
    messagesEl.replaceChildren(...nodes);
    for (const m of messages) seenIds.add(m.id);
  }

  function callRow(m) {
    return h("div", { class: "callrow" }, chBadge("voice"), h("div", { class: "grow" },
      h("div", { class: "row" }, h("b", {}, "Call answered by the assistant"), h("span", { class: "meta" }, fmtTime(m.created_at))),
      m.purged_at ? h("span", { class: "meta" }, "Summary cleared after the retention period") : h("div", { class: "small", style: { whiteSpace: "pre-wrap" } }, m.body.replace(/^📞[^\n]*\n?/, "")),
      h("span", { class: "tag-unverified" }, "Caller ID isn't proof of identity")));
  }

  function bubble(m, first, last) {
    const out = m.direction === "out";
    const kind = m.author === "ai" ? "ai" : m.author === "staff" ? "staff" : "";
    const isNew = !seenIds.has(m.id) && seenIds.size > 0 && !out;
    const status = { sent: [icon("check"), "Sent"], simulated: [icon("check"), "Simulated"], failed: [icon("alert"), "Not delivered"], received: null }[m.status];
    const author = first && out && (m.author === "ai"
      ? h("div", { class: "author" }, icon("sparkle"), "Assistant")
      : h("div", { class: "author" }, m.author_name ?? "Staff"));
    return h("div", { class: `msg-row ${out ? "out" : "in"}${first ? " new-group" : ""}` },
      h("div", { class: `msg ${kind}${last ? " tail" : ""}${m.status === "failed" ? " failed" : ""}${isNew ? " arrive" : ""}` },
        author,
        m.subject && h("div", { class: "subject" }, m.subject),
        m.purged_at ? h("span", { class: "subtle" }, "Message text cleared after the retention period") : m.body,
        m.error && h("div", { class: "err" }, m.error),
        h("div", { class: "foot" }, chBadge(m.channel), fmtTime(m.created_at), out && status && h("span", { class: "row", style: { gap: "3px", color: m.status === "failed" ? "var(--danger)" : "" } }, status))));
  }

  function draftBubble(m) {
    const editor = h("textarea", { class: "hidden", rows: 4, value: m.body, "aria-label": "Edit draft" });
    const text = h("div", {}, m.body);
    const approve = h("button", { class: "btn primary sm", onclick: () => busy(approve, async () => {
      const sent = await attempt(() => api("POST", `/messages/${m.id}/approve`, { body: editor.value }));
      if (sent) { toast(sent.status === "failed" ? `Not sent: ${sent.error}` : "Sent", { error: sent.status === "failed" }); loadThread(true); loadList(); }
    }) }, icon("check"), "Approve & send");
    const win = state.thread?.windows?.[m.channel];
    return h("div", { class: "msg-row out" }, h("div", { class: "msg draft" },
      h("div", { class: "author" }, icon("sparkle"), "Draft, needs your OK"),
      m.subject && h("div", { class: "subject" }, m.subject),
      text, editor,
      can("drafts.approve") && h("div", { class: "actions" }, approve,
        h("button", { class: "btn sm", onclick: () => { editor.classList.toggle("hidden"); text.classList.toggle("hidden"); if (!editor.classList.contains("hidden")) editor.focus(); } }, "Edit"),
        h("button", { class: "btn ghost sm", onclick: async () => { await attempt(() => api("POST", `/messages/${m.id}/discard`, {}), "Draft discarded"); loadThread(); loadList(); } }, "Discard")),
      h("div", { class: "foot" }, chBadge(m.channel), CHANNEL_LABEL[m.channel], win ? ` · window ${new Date(win) > new Date() ? `open ${duration(new Date(win) - Date.now())}` : "closed"}` : "", " · ", fmtTime(m.created_at))));
  }

  function buildComposer() {
    const channel = h("select", { "aria-label": "Reply on" });
    const subject = h("input", { placeholder: "Subject", class: "hidden", "aria-label": "Email subject" });
    const text = h("textarea", { rows: 1, placeholder: "Write a reply", "aria-label": "Message", oninput: () => grow(), onkeydown: (e) => {
      if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    } });
    const sendBtn = h("button", { class: "btn primary send", "aria-label": "Send", title: "Send (Enter)", onclick: () => send() }, icon("send", "lg"));
    const row = h("div", { class: "composer-row" }, channel, text, sendBtn);
    const blocked = h("div", { class: "blocked hidden" });
    const foot = h("div", { class: "foot" });
    let keepAi = false;
    const grow = () => { text.style.height = "auto"; text.style.height = `${Math.min(text.scrollHeight, innerHeight * 0.4)}px`; sendBtn.disabled = !text.value.trim(); };
    channel.addEventListener("change", () => draw());
    async function send() {
      const body = text.value.trim();
      if (!body || !state.convId) return;
      await busy(sendBtn, async () => {
        const msg = await attempt(() => api("POST", `/conversations/${state.convId}/reply`, { body, channel: channel.value, subject: subject.value || undefined, keepAiOn: keepAi }));
        if (msg) {
          text.value = ""; subject.value = ""; grow();
          if (msg.status === "failed") toast(`Not delivered: ${msg.error}`, { error: true });
          loadThread(true); loadList();
        }
      });
      text.focus();
    }
    function draw() {
      const data = state.thread;
      if (!data) return;
      const ch = channel.value;
      subject.classList.toggle("hidden", ch !== "email");
      const consent = data.consents?.[ch];
      const win = data.windows?.[ch];
      let block = null;
      if (!can("inbox.reply")) block = [icon("lock"), "Your role can read this conversation but not reply."];
      else if (consent?.service === "withdrawn") block = [icon("shield"), `This person asked not to be contacted on ${CHANNEL_LABEL[ch]}${consent.since ? ` (${fmtDate(consent.since)})` : ""}. ${ch === "sms" ? "Only they can turn texts back on, by texting START." : "Reply on another channel they use, or call them."}`];
      else if (win !== undefined && win !== null && new Date(win) < new Date()) block = [icon("clock"), `${CHANNEL_LABEL[ch]}'s 24-hour window closed ${timeShort(win)} ago. Only an approved template can be sent now. Reply on another channel, or wait for them to write.`];
      blocked.classList.toggle("hidden", !block);
      row.classList.toggle("hidden", !!block);
      if (block) fill(blocked, block[0], h("span", {}, block[1]));
      const closing = win && new Date(win) > new Date() && new Date(win) - Date.now() < 4 * 3600_000;
      fill(foot,
        closing && pill(`Window closes in ${duration(new Date(win) - Date.now())}`, "warn"),
        data.conversation.ai_enabled
          ? [h("span", {}, keepAi ? "The assistant stays on after you send." : "Sending pauses the assistant on this conversation."),
            h("button", { class: "link", onclick: () => { keepAi = !keepAi; draw(); } }, keepAi ? "Pause it" : "Keep it on")]
          : h("span", {}, data.conversation.paused_by ? `Assistant paused by ${data.conversation.paused_by}.` : "Assistant is off here."));
    }
    return {
      el: h("div", { class: "composer" }, subject, blocked, row, foot),
      focus: () => text.focus(),
      update(data) {
        const current = channel.value;
        const options = (data.reachable.length ? data.reachable : [data.conversation.last_channel]).filter((c) => c !== "voice");
        fill(channel, options.map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
        channel.value = options.includes(current) ? current : options.includes(data.conversation.last_channel) ? data.conversation.last_channel : options[0];
        grow();
        draw();
      },
    };
  }

  function drawSide(data) {
    const { contact, appointments, tasks, consents, proposals } = data;
    const reload = () => { loadThread(); loadList(); };
    const upcoming = appointments.filter((a) => a.status === "booked" && new Date(a.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const past = appointments.filter((a) => !upcoming.includes(a)).slice(0, 3);
    const moreBtn = h("button", { class: "btn ghost icon sm", "aria-label": "More actions", onclick: (e) => contactMenu(e.currentTarget, contact, reload) }, icon("more"));
    fill(side,
      h("div", { class: "row between" }, h("button", { class: "btn ghost sm close", onclick: () => layout.classList.remove("show-side") }, icon("x"), "Close"), h("span", {}), moreBtn),
      h("section", { class: "sect" },
        h("div", { class: "ident" }, avatar(contact.name ?? contact.phone, null, "lg"), h("div", {}, h("b", {}, contact.name ?? "No name yet"), h("div", { class: "meta" }, pill(STAGE_LABEL[contact.stage], STAGE_PILL[contact.stage])))),
        contactEditor(contact, reload)),
      proposals.length ? h("section", { class: "sect" }, h("h4", {}, "Changes to confirm", pill(String(proposals.length), "warn", { nodot: true })),
        h("p", { class: "meta" }, "Messages go to the phone and email on file. Confirm a change only after checking it with the patient (for example, on a call to the old number)."),
        proposals.map((p) => h("div", { class: "stack", style: { gap: "6px" } },
          h("div", { class: "small" }, h("b", {}, p.field === "email" ? "Email" : "Phone"), ` → ${p.value}`, h("div", { class: "meta" }, `from ${p.source.startsWith("ai") ? "the assistant" : p.source} · ${timeShort(p.created_at)}`)),
          can("proposals.decide") && h("div", { class: "row" },
            h("button", { class: "btn sm soft", onclick: async () => { await attempt(() => api("POST", `/proposals/${p.id}/approve`, {}), "Contact details updated"); reload(); } }, "Confirm"),
            h("button", { class: "btn sm ghost", onclick: async () => { await attempt(() => api("POST", `/proposals/${p.id}/reject`, {}), "Change rejected"); reload(); } }, "Reject"))))) : null,
      consentSection(contact, consents, reload),
      h("section", { class: "sect" }, h("h4", {}, "Appointments"),
        upcoming.length ? upcoming.map((a) => apptCard(a, reload)) : h("p", { class: "meta" }, "Nothing upcoming."),
        past.length ? h("details", {}, h("summary", { class: "meta" }, `Past (${past.length})`), h("div", { class: "stack", style: { marginTop: "8px", gap: "6px" } }, past.map((a) => apptCard(a, reload)))) : null,
        can("calendar.write") && bookingForm(contact, reload)),
      h("section", { class: "sect" }, h("h4", {}, "Tasks", can("tasks.write") && h("button", { class: "btn ghost sm", onclick: () => newTask(contact, reload) }, icon("plus"), "Add")),
        tasks.length ? h("div", { class: "card flat" }, tasks.slice(0, 6).map((t) => taskRow(t, reload, { compact: true }))) : h("p", { class: "meta" }, "No tasks.")),
      contact.external_id ? h("section", { class: "sect" }, h("h4", {}, "Records"), h("p", { class: "meta" }, "Linked to the clinic's records system. Clinical notes stay there and never come to this app."), h("code", {}, contact.external_id)) : null,
    );
  }

  inboxKeys = (e) => {
    const convs = visible();
    const idx = convs.findIndex((c) => c.id === state.convId);
    if (e.key === "j" || e.key === "ArrowDown") { const n = convs[Math.min(idx + 1, convs.length - 1)]; if (n) { e.preventDefault(); openConversation(n.id); } }
    else if (e.key === "k" || e.key === "ArrowUp") { const n = convs[Math.max(idx - 1, 0)]; if (n) { e.preventDefault(); openConversation(n.id); } }
    else if (e.key === "/") { e.preventDefault(); searchEl.focus(); }
    else if (e.key === "r" && state.convId) { e.preventDefault(); composer.focus(); }
    else if (e.key === "." && state.convId) { layout.classList.toggle("show-side"); }
    else if (e.key === "e" && state.thread?.conversation.needs_attention && can("inbox.manage")) {
      api("POST", `/conversations/${state.convId}/resolve`, {}).then(() => { toast("Marked handled"); loadThread(); loadList(); }).catch(() => {});
    }
  };

  refreshers.inbox = (event) => {
    loadList(true);
    if (state.convId && (!event?.id || event.id === state.convId || event.kind !== "message")) loadThread(false, true);
    if (event?.kind === "message" && event.id === state.convId) announce("New activity in this conversation");
  };
  fill(listEl, Array.from({ length: 6 }, () => h("div", { class: "conv", "aria-hidden": "true" }, h("div", { class: "avatar skel" }), h("div", { class: "conv-body" }, h("div", { class: "skel", style: { height: "12px", width: "60%" } }), h("div", { class: "skel", style: { height: "12px", width: "85%" } })))));
  loadList().then(() => {
    if (state.convId && state.convs.some((c) => c.id === state.convId)) openConversation(state.convId);
    else loadThread();
  });
}

function emptyState(iconName, title, text, action) {
  return h("div", { class: "empty" }, icon(iconName, "xl"), h("b", {}, title), text && h("p", {}, text), action);
}

function contactEditor(contact, onSaved) {
  const editable = can("contacts.write");
  const saved = h("span", { class: "inline-saved", "aria-live": "polite" });
  const save = async (fields) => {
    const ok = await attempt(() => api("PATCH", `/contacts/${contact.id}`, fields));
    if (ok) { saved.textContent = "Saved"; setTimeout(() => { saved.textContent = ""; }, 1200); onSaved(); }
  };
  const field = (label, key, opts = {}) => {
    if (!editable || opts.readOnly) {
      return h("div", { class: "small" }, h("div", { class: "meta" }, label, opts.readOnly && editable ? h("span", { title: opts.readOnly }, " ", icon("lock")) : null), contact[key] || h("span", { class: "subtle" }, "—"));
    }
    const input = h(opts.area ? "textarea" : "input", { value: contact[key] ?? "", rows: opts.area ? 2 : undefined, "aria-label": label, onchange: (e) => save({ [key]: e.target.value }) });
    return h("label", { class: "f" }, label, input);
  };
  const stage = editable
    ? h("label", { class: "f" }, "Pipeline stage", h("select", { onchange: (e) => save({ stage: e.target.value }) }, state.clinic.stages.map((s) => h("option", { value: s, selected: s === contact.stage }, STAGE_LABEL[s]))))
    : null;
  let tags = [...contact.tags];
  const tagWrap = h("div", { class: "tags" });
  const drawTags = () => fill(tagWrap, tags.map((t) => h("span", { class: "tag" }, t, editable && h("button", { "aria-label": `Remove tag ${t}`, onclick: () => { tags = tags.filter((x) => x !== t); drawTags(); save({ tags }); } }, "×"))));
  drawTags();
  return h("div", { class: "stack", style: { gap: "10px" } },
    field("Name", "name"),
    // Changing where messages go is a privacy decision: phone and email are edited deliberately, not inline.
    field("Phone", "phone", { readOnly: "Use More actions → Change phone or email" }),
    field("Email", "email", { readOnly: "Use More actions → Change phone or email" }),
    stage,
    h("div", { class: "f" }, h("span", { class: "meta" }, "Tags"), tagWrap,
      editable && h("input", { placeholder: "Add a tag and press Enter", "aria-label": "Add tag", onkeydown: (e) => {
        if (e.key === "Enter" && e.target.value.trim()) { tags = [...new Set([...tags, e.target.value.trim().toLowerCase()])]; e.target.value = ""; drawTags(); save({ tags }); }
      } })),
    field("Staff notes", "notes", { area: true }),
    h("div", { class: "row between" }, h("span", { class: "meta" }, icon("lock"), " Notes are staff-only and encrypted"), saved));
}

function consentSection(contact, consents, onChange) {
  const label = { granted: ["Yes", "success"], withdrawn: ["Withdrawn", "danger"], none: ["Not asked", ""] };
  const shown = CONSENT_CHANNELS.filter((ch) => consents[ch].service !== "none" || consents[ch].marketing !== "none" || reachableFor(contact, ch));
  return h("section", { class: "sect" },
    h("h4", {}, "Consent", can("consent.write") && h("button", { class: "btn ghost sm", onclick: () => recordConsent(contact, onChange) }, icon("plus"), "Record")),
    h("div", { class: "consent-grid" },
      h("span", {}), h("span", { class: "h" }, "Reminders"), h("span", { class: "h" }, "Marketing"),
      shown.map((ch) => [h("span", { class: "row", style: { gap: "6px" } }, chBadge(ch), CHANNEL_LABEL[ch]),
        pill(...[label[consents[ch].service][0], label[consents[ch].service][1]]),
        pill(...[label[consents[ch].marketing][0], label[consents[ch].marketing][1]])])),
    h("p", { class: "meta" }, "Replies to someone who wrote first are always allowed. Reminders need a yes on that channel; marketing needs an express yes."));
}

function reachableFor(contact, ch) {
  return { sms: contact.phone, whatsapp: contact.whatsapp_id, email: contact.email, messenger: contact.messenger_id, instagram: contact.instagram_id }[ch];
}

async function recordConsent(contact, onChange) {
  const channel = h("select", {}, CONSENT_CHANNELS.map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
  const purpose = h("select", {}, h("option", { value: "service" }, "Reminders and appointment messages"), h("option", { value: "marketing" }, "Marketing (offers, newsletters, review requests)"));
  const status = h("select", {}, h("option", { value: "granted" }, "Patient said yes"), h("option", { value: "withdrawn" }, "Patient said stop"));
  const source = h("input", { placeholder: "e.g. intake form, said yes on the phone today" });
  const ok = await modal({
    title: "Record consent", dark: true,
    body: [h("div", { class: "banner shield" }, icon("shield"), "Record only what the patient actually told you. This is kept as a permanent record with your name (PHIPA, CASL)."),
      h("label", { class: "f" }, "Channel", channel), h("label", { class: "f" }, "For", purpose), h("label", { class: "f" }, "Answer", status),
      h("label", { class: "f" }, "How they told you", source)],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Record consent")],
  });
  if (!ok) return;
  const r = await attempt(() => api("POST", `/contacts/${contact.id}/consent`, { channel: channel.value, purpose: purpose.value, status: status.value, source: source.value }), "Consent recorded");
  if (r) onChange();
}

function contactMenu(anchor, contact, onChange) {
  const items = [
    can("contacts.write") && h("button", { onclick: () => { close(); changeAddress(contact, onChange); } }, icon("key"), "Change phone or email"),
    can("contacts.export") && h("button", { onclick: () => { close(); download(`/contacts/${contact.id}/export`, `patient-${contact.id}-fhir.json`); } }, icon("download"), "Export their data (FHIR)"),
    can("contacts.erase") && [h("hr"), h("button", { class: "danger", onclick: () => { close(); eraseContact(contact, onChange); } }, icon("trash"), "Erase messages…")],
  ].filter(Boolean);
  if (!items.length) items.push(h("div", { class: "menu-head" }, "No actions for your role"));
  const close = popover(anchor, items);
}

async function changeAddress(contact, onChange) {
  const phone = h("input", { value: contact.phone ?? "", autocomplete: "off" });
  const email = h("input", { value: contact.email ?? "", type: "email", autocomplete: "off" });
  const ok = await modal({
    title: "Change phone or email",
    body: [h("div", { class: "banner warn" }, icon("alert"), "Reminders and replies will go to the new details. Confirm the change with the patient first, ideally by calling the number already on file."),
      h("label", { class: "f" }, "Phone", phone), h("label", { class: "f" }, "Email", email)],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Save details")],
  });
  if (ok) { await attempt(() => api("PATCH", `/contacts/${contact.id}`, { phone: phone.value, email: email.value }), "Contact details updated"); onChange(); }
}

async function eraseContact(contact, onChange) {
  const confirmText = `ERASE ${contact.id}`;
  const input = h("input", { autocomplete: "off", "aria-label": "Confirmation" });
  const ok = await modal({
    title: "Erase this person's messages", dark: true,
    body: [h("p", {}, "This clears message text, call summaries and notes for ", h("b", {}, contact.name ?? "this person"), ". Consent records, bookings and the audit log are kept, as the law requires. This can't be undone."),
      h("p", { class: "meta" }, "Export their data first if they asked for a copy."),
      h("label", { class: "f" }, `Type ${confirmText} to confirm`, input)],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Go back"), h("button", { class: "btn danger", onclick: () => close(true) }, "Erase messages")],
    initial: () => input,
  });
  if (ok) { await attempt(() => api("POST", `/contacts/${contact.id}/erase`, { confirm: input.value }), "Messages erased"); onChange(); }
}

async function newTask(contact, onChange) {
  const title = h("input", { placeholder: "e.g. Call back about insurance" });
  const urgent = h("input", { type: "checkbox" });
  const ok = await modal({
    title: contact ? `New task for ${contact.name ?? "this patient"}` : "New task",
    body: [h("label", { class: "f" }, "What needs doing", title), h("label", { class: "row small" }, urgent, "Urgent")],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Add task")],
  });
  if (ok && title.value.trim()) {
    await attempt(() => api("POST", `/clinics/${state.clinicId}/tasks`, { title: title.value, contactId: contact?.id, priority: urgent.checked ? "urgent" : "normal" }), "Task added");
    onChange();
  }
}

function serviceName(id) { return state.clinic.profile.services.find((s) => s.id === id)?.name ?? id; }
function practitionerName(id) { return state.clinic.profile.practitioners.find((p) => p.id === id)?.name ?? id; }
function viaLabel(createdVia) {
  if (!createdVia) return "";
  if (createdVia.startsWith("ai:")) return `Booked by assistant via ${CHANNEL_LABEL[createdVia.slice(3)] ?? createdVia.slice(3)}`;
  if (createdVia.startsWith("staff:")) return `Booked by ${createdVia.slice(6)}`;
  if (createdVia.startsWith("ehr")) return "From the records system";
  return `Booked: ${createdVia}`;
}

function apptCard(a, onChange) {
  const upcoming = a.status === "booked" && new Date(a.starts_at) > new Date();
  const setStatus = (status) => async () => {
    if (status === "cancelled" && !(await askConfirm("The patient will get a cancellation message on their preferred channel (if they agreed to reminders there).", "Cancel appointment", { title: "Cancel this appointment?", danger: true }))) return;
    await attempt(() => api("POST", `/appointments/${a.id}/status`, { status }), { cancelled: "Appointment cancelled", completed: "Marked attended", no_show: "Marked no-show" }[status]);
    onChange();
  };
  return h("div", { class: `appt ${a.status}` },
    h("b", {}, fmtDateTime(a.starts_at)),
    h("div", {}, `${serviceName(a.service_id)} · ${practitionerName(a.practitioner_id)}`),
    h("div", { class: "meta row" }, a.confirmed_at ? pill("Confirmed", "accent") : null, a.status !== "booked" ? pill(a.status === "no_show" ? "No-show" : a.status === "completed" ? "Attended" : "Cancelled", a.status === "completed" ? "success" : a.status === "no_show" ? "danger" : "") : null,
      a.created_via?.startsWith("ai") ? h("span", { class: "row", style: { gap: "3px", color: "var(--ai)" } }, icon("sparkle"), viaLabel(a.created_via)) : viaLabel(a.created_via)),
    a.status === "booked" && can("calendar.write") && h("div", { class: "actions" },
      upcoming && h("button", { class: "btn sm danger", onclick: setStatus("cancelled") }, "Cancel"),
      !upcoming && h("button", { class: "btn sm soft", onclick: setStatus("completed") }, "Attended"),
      !upcoming && h("button", { class: "btn sm", onclick: setStatus("no_show") }, "No-show")));
}

function bookingForm(contact, onBooked) {
  const { services } = state.clinic.profile;
  const service = h("select", { "aria-label": "Service" }, services.map((s) => h("option", { value: s.id }, s.name)));
  const slot = h("select", { "aria-label": "Time" }, h("option", { value: "" }, "Pick a service to load times"));
  const error = h("div", { class: "error-text", role: "alert" });
  const book = h("button", { class: "btn primary sm", onclick: () => busy(book, async () => {
    if (!slot.value) return;
    error.textContent = "";
    const [practitionerId, start] = slot.value.split("|");
    try {
      await api("POST", `/clinics/${state.clinicId}/appointments`, { contactId: contact.id, serviceId: service.value, practitionerId, start });
      toast("Visit booked");
      onBooked();
    } catch (err) {
      if (err instanceof SignedOut) return;
      error.textContent = `${err.message} Here are the next open times.`;
      loadSlots();
    }
  }) }, "Book visit");
  const wrap = h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600, color: "var(--accent-fg)" } }, "Book a visit"),
    h("div", { class: "stack", style: { marginTop: "10px", gap: "8px" } }, service, slot, error, book));
  async function loadSlots() {
    fill(slot, h("option", { value: "" }, "Loading times…"));
    const slots = await attempt(() => api("GET", `/clinics/${state.clinicId}/slots?service=${service.value}`)) ?? [];
    fill(slot, slots.length ? slots.map((s) => h("option", { value: `${s.practitionerId}|${s.start}` }, `${s.label} · ${s.practitionerName}`)) : h("option", { value: "" }, "No open times in the next 2 weeks"));
  }
  service.addEventListener("change", loadSlots);
  wrap.addEventListener("toggle", () => { if (wrap.open) loadSlots(); }, { once: true });
  return wrap;
}

function taskSource(createdBy) {
  if (!createdBy) return "";
  if (createdBy.startsWith("ai:")) return `from assistant · ${CHANNEL_LABEL[createdBy.slice(3)] ?? createdBy.slice(3)}`;
  if (createdBy.startsWith("staff:")) return `from ${createdBy.slice(6)}`;
  if (createdBy.startsWith("automation")) return "from a funnel";
  return createdBy === "system" ? "from the system" : `from ${createdBy}`;
}

function taskRow(t, onChange, opts = {}) {
  const row = h("div", { class: `task${t.status === "done" ? " done" : ""}` },
    h("input", { type: "checkbox", checked: t.status === "done", disabled: !can("tasks.write"), "aria-label": `Done: ${t.title}`, onchange: async (e) => {
      const done = e.target.checked;
      const ok = await attempt(() => api("POST", `/tasks/${t.id}`, { status: done ? "done" : "open" }));
      if (!ok) { e.target.checked = !done; return; }
      row.classList.toggle("done", done);
      if (done) toast("Task done", { action: { label: "Undo", run: async () => { await attempt(() => api("POST", `/tasks/${t.id}`, { status: "open" })); onChange(); } } });
      setTimeout(onChange, 600);
    } }),
    h("div", { class: "grow" },
      h("div", { class: "row", style: { gap: "6px" } }, t.priority === "urgent" ? pill("Urgent", "danger") : null, h("span", { class: "title" }, t.title)),
      !opts.compact && t.details && h("div", { class: "small muted" }, t.details),
      h("div", { class: "meta" }, [taskSource(t.created_by), timeShort(t.created_at)].filter(Boolean).join(" · "))),
    opts.open && t.contact_id && h("div", { class: "acts" }, h("button", { class: "btn sm", onclick: () => openContactThread(t.contact_id) }, t.contact_name ? `Open ${firstName(t.contact_name)}` : "Open")));
  return row;
}

async function openContactThread(contactId) {
  const conv = await attempt(() => api("POST", `/contacts/${contactId}/conversation`, {}));
  if (!conv) return;
  state.convId = conv.id;
  state.filter = "all";
  show("inbox");
}

// ------------------------------------------------------------------- today

function hero(title, text, actions) {
  return h("section", { class: "hero" }, h("div", {}, h("h2", {}, title), text && h("p", {}, text)), actions && h("div", { class: "row" }, actions));
}

async function viewDashboard() {
  const page = h("div", { class: "page" });
  viewEl.replaceChildren(page);
  async function draw(background = false) {
    const opt = { background };
    const [stats, tasks, appts] = await Promise.all([
      api("GET", `/clinics/${state.clinicId}/stats`, undefined, opt),
      can("tasks.read") ? api("GET", `/clinics/${state.clinicId}/tasks?status=open`, undefined, opt) : [],
      can("calendar.read") ? api("GET", `/clinics/${state.clinicId}/appointments?days=1`, undefined, opt) : [],
    ]).catch((err) => { if (!(err instanceof SignedOut)) toast(err.message, { error: true }); return []; });
    if (!stats) return;
    const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: clinicTz() }).format(new Date()));
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const live = appts.filter((a) => a.status !== "cancelled");
    fill(page,
      hero(`${greeting}, ${firstName(state.session.user.name)}`,
        `${stats.needsAttention ? `${stats.needsAttention} conversation${stats.needsAttention === 1 ? "" : "s"} need${stats.needsAttention === 1 ? "s" : ""} you` : "Nothing is waiting on you"} · ${live.length} visit${live.length === 1 ? "" : "s"} today`,
        can("inbox.read") && h("button", { class: "btn on-navy", onclick: () => { state.filter = stats.needsAttention ? "attention" : "all"; show("inbox"); } }, icon("inbox"), "Open inbox")),
      h("div", { class: "stats" },
        statCard("Need a reply", stats.needsAttention, "Conversations flagged for staff", stats.needsAttention ? "warn" : ""),
        statCard("Assistant replies", stats.aiRepliesThisWeek, "Last 7 days", "ai"),
        statCard("Bookings", stats.bookingsThisWeek, `${stats.aiBookingsThisWeek} by the assistant · 7 days`),
        statCard("Calls answered", stats.callsThisWeek, `${stats.newLeadsThisWeek} new people · 7 days`)),
      h("div", { class: "grid2" },
        can("calendar.read") && h("section", { class: "card" }, h("header", {}, h("h3", {}, "Today's visits"), h("button", { class: "btn ghost sm", onclick: () => show("calendar") }, "Calendar")),
          h("div", { class: "body stack", style: { gap: "8px" } }, live.length ? live.map((a) => h("div", { class: `appt ${a.status}` },
            h("b", {}, fmtTime(a.starts_at), " · ", a.contact_name ?? "Patient"),
            h("div", { class: "meta" }, `${serviceName(a.service_id)} · ${practitionerName(a.practitioner_id)}`))) : emptyState("calendar", "No visits today", null))),
        can("tasks.read") && h("section", { class: "card" }, h("header", {}, h("h3", {}, "Open tasks"), h("button", { class: "btn ghost sm", onclick: () => show("tasks") }, "All tasks")),
          tasks.length ? tasks.slice(0, 7).map((t) => taskRow(t, () => draw(), { open: true })) : emptyState("check", "Nothing to do", "The assistant adds call-backs here."))));
  }
  refreshers.dashboard = () => draw(true);
  draw();
}

function statCard(label, n, detail, tone) {
  return h("div", { class: "card stat" }, h("div", { class: "l row", style: { gap: "6px", color: tone === "ai" ? "var(--ai)" : tone === "warn" && n ? "var(--warn)" : "" } }, tone === "ai" ? icon("sparkle") : null, label), h("div", { class: "n" }, n), h("div", { class: "d" }, detail));
}

// --------------------------------------------------------------- pipeline

async function viewPipeline() {
  const board = h("div", { class: "kanban" });
  viewEl.replaceChildren(board);
  const live = h("div", { class: "sr", "aria-live": "assertive" });
  async function draw(background = false) {
    const pipeline = await attempt(() => api("GET", `/clinics/${state.clinicId}/pipeline`, undefined, { background }));
    if (!pipeline) return;
    const move = async (id, stage, name) => {
      const ok = await attempt(() => api("PATCH", `/contacts/${id}`, { stage }));
      if (ok) { live.textContent = `${name} moved to ${STAGE_LABEL[stage]}`; toast(`Moved to ${STAGE_LABEL[stage]}`); }
      draw();
    };
    fill(board, live, state.clinic.stages.map((stage, si) => {
      const col = h("section", { class: "col", "aria-label": STAGE_LABEL[stage],
        ondragover: (e) => { if (!can("contacts.write")) return; e.preventDefault(); col.classList.add("over"); },
        ondragleave: () => col.classList.remove("over"),
        ondrop: (e) => { e.preventDefault(); col.classList.remove("over"); const [id, name] = e.dataTransfer.getData("text/plain").split("|"); move(id, stage, name); } },
      h("h4", {}, h("span", { class: "row", style: { gap: "6px" } }, pill(STAGE_LABEL[stage], STAGE_PILL[stage])), h("span", { class: "badge" }, pipeline[stage].length)),
      pipeline[stage].length ? pipeline[stage].map((c) => h("div", { class: "kcard", tabindex: "0", draggable: can("contacts.write") ? "true" : "false",
        "aria-label": `${contactLabel(c)}. Arrow left or right to move between stages, Enter to open.`,
        ondragstart: (e) => e.dataTransfer.setData("text/plain", `${c.id}|${contactLabel(c)}`),
        onkeydown: (e) => {
          if (e.key === "Enter") openContactThread(c.id);
          const to = e.key === "ArrowRight" ? si + 1 : e.key === "ArrowLeft" ? si - 1 : -1;
          if (to >= 0 && to < state.clinic.stages.length && can("contacts.write")) { e.preventDefault(); move(c.id, state.clinic.stages[to], contactLabel(c)); }
        },
        onclick: () => openContactThread(c.id) },
      h("b", {}, contactLabel(c)), h("div", { class: "meta" }, c.phone ?? c.email ?? ""),
      c.tags.length ? h("div", { class: "tags" }, c.tags.slice(0, 2).map((t) => h("span", { class: "tag" }, t)), c.tags.length > 2 && h("span", { class: "tag" }, `+${c.tags.length - 2}`)) : null))
        : h("div", { class: "hint" }, STAGE_HINT[stage]));
      return col;
    }));
  }
  refreshers.pipeline = () => draw(true);
  draw();
}

// --------------------------------------------------------------- patients

async function viewContacts() {
  const page = h("div", { class: "page" });
  const search = h("input", { type: "search", placeholder: "Search patients", "aria-label": "Search patients", oninput: () => draw() });
  const tbody = h("tbody");
  page.append(
    h("div", { class: "row between" }, h("div", { class: "search grow", style: { maxWidth: "360px" } }, icon("search"), search),
      can("contacts.write") && h("button", { class: "btn primary", onclick: () => addContact(draw) }, icon("plus"), "Add patient")),
    h("div", { class: "card table-wrap" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Name", "Phone", "Email", "Stage", "Consent", ""].map((x) => h("th", {}, x)))), tbody)));
  viewEl.replaceChildren(page);
  async function draw(background = false) {
    const contacts = await attempt(() => api("GET", `/clinics/${state.clinicId}/contacts?search=${encodeURIComponent(search.value)}`, undefined, { background })) ?? [];
    if (!contacts.length) {
      fill(tbody, h("tr", {}, h("td", { colspan: "6" }, emptyState("people", search.value ? `No matches for "${search.value}"` : "No patients yet", search.value ? null : "People are added when they message or call, or you can add them here."))));
      return;
    }
    fill(tbody, contacts.map((c) => {
      const withdrawn = Object.entries(c.consents).filter(([, v]) => v.service === "withdrawn").map(([ch]) => CHANNEL_LABEL[ch]);
      const marketing = Object.values(c.consents).some((v) => v.marketing === "granted");
      return h("tr", {},
        h("td", {}, h("div", { class: "row" }, avatar(contactLabel(c)), h("b", {}, c.name ?? "No name"))),
        h("td", {}, c.phone ?? ""), h("td", {}, c.email ?? ""),
        h("td", {}, pill(STAGE_LABEL[c.stage], STAGE_PILL[c.stage])),
        h("td", {}, h("div", { class: "row", style: { gap: "4px" } }, withdrawn.length ? pill(`Stopped: ${withdrawn.join(", ")}`, "danger") : null, marketing ? pill("Marketing yes", "success") : null)),
        h("td", {}, can("inbox.read") && h("button", { class: "btn sm", onclick: () => openContactThread(c.id) }, "Message")));
    }));
  }
  refreshers.contacts = () => draw(true);
  draw();
}

async function addContact(onDone) {
  const name = h("input", { autocomplete: "off" });
  const phone = h("input", { autocomplete: "off", inputmode: "tel" });
  const email = h("input", { autocomplete: "off", type: "email" });
  const box = (label) => h("input", { type: "checkbox", "aria-label": label });
  const consent = { sms: { r: box("Texts: reminders"), m: box("Texts: marketing") }, email: { r: box("Email: reminders"), m: box("Email: marketing") }, whatsapp: { r: box("WhatsApp: reminders"), m: box("WhatsApp: marketing") } };
  const source = h("input", { value: "intake form" });
  const ok = await modal({
    title: "Add patient", width: 560,
    body: [h("label", { class: "f" }, "Full name", name),
      h("div", { class: "grid2", style: { gap: "12px", gridTemplateColumns: "1fr 1fr" } }, h("label", { class: "f" }, "Phone", phone), h("label", { class: "f" }, "Email", email)),
      h("div", { class: "stack", style: { gap: "8px" } }, h("b", { class: "small" }, "What did they agree to?"),
        h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Reminders"), h("th", {}, "Marketing"))),
          h("tbody", {}, Object.entries(consent).map(([ch, b]) => h("tr", {}, h("td", {}, h("span", { class: "row" }, chBadge(ch), CHANNEL_LABEL[ch])), h("td", {}, b.r), h("td", {}, b.m))))),
        h("p", { class: "meta" }, "Leave a box empty if you didn't ask. Marketing needs a clear yes from the patient (CASL / PHIPA s.33)."),
        h("label", { class: "f" }, "How they told you", source))],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Add patient")],
  });
  if (!ok) return;
  const consents = Object.fromEntries(Object.entries(consent).map(([ch, b]) => [ch, { reminders: b.r.checked, marketing: b.m.checked }]));
  const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/contacts`, { name: name.value, phone: phone.value, email: email.value, consents: { ...consents, source: source.value } }), "Patient added");
  if (r) onDone();
}

// --------------------------------------------------------------- calendar

async function viewCalendar() {
  const tz = state.clinic.profile.timezone;
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  let start = todayLocal;
  const page = h("div", { class: "page", style: { maxWidth: "1480px" } });
  viewEl.replaceChildren(page);
  const addDays = (d, n) => { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10); };
  async function draw(background = false) {
    const appts = await attempt(() => api("GET", `/clinics/${state.clinicId}/appointments?from=${start}&days=7`, undefined, { background })) ?? [];
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const byDay = Object.fromEntries(days.map((d) => [d, []]));
    for (const a of appts) byDay[new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(a.starts_at))]?.push(a);
    fill(page,
      h("div", { class: "row between" },
        h("h3", { style: { fontSize: "18px" } }, `Week of ${new Date(`${start}T12:00:00Z`).toLocaleDateString([], { month: "long", day: "numeric", timeZone: "UTC" })}`),
        h("div", { class: "row" },
          h("button", { class: "btn icon", "aria-label": "Previous week", onclick: () => { start = addDays(start, -7); draw(); } }, icon("back")),
          h("button", { class: "btn", onclick: () => { start = todayLocal; draw(); } }, "Today"),
          h("button", { class: "btn icon", "aria-label": "Next week", onclick: () => { start = addDays(start, 7); draw(); } }, h("span", { style: { transform: "scaleX(-1)", display: "inline-flex" } }, icon("back"))))),
      h("div", { class: "week" }, days.map((d) => h("section", { class: `day-col${d === todayLocal ? " today" : ""}`, "aria-label": d },
        h("h4", {}, new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })),
        byDay[d].length ? byDay[d].map((a) => h("button", { class: `ev ${a.status}`, onclick: () => apptDialog(a, draw) },
          h("span", { class: "meta" }, fmtTime(a.starts_at)),
          h("b", {}, a.contact_name ?? "Patient"),
          h("span", { class: "meta" }, `${firstName(practitionerName(a.practitioner_id))}`),
          a.created_via?.startsWith("ai") && h("span", { class: "by-ai meta" }, icon("sparkle"), "by assistant"))) : h("span", { class: "none" }, "No visits")))));
  }
  refreshers.calendar = () => draw(true);
  draw();
}

function apptDialog(a, onChange) {
  modal({
    title: a.contact_name ?? "Appointment", width: 440,
    body: [apptCard(a, () => { document.querySelector(".scrim")?.remove(); onChange(); })],
    actions: (close) => [a.contact_id && can("inbox.read") && h("button", { class: "btn", onclick: () => { close(); openContactThread(a.contact_id); } }, "Open conversation"), h("button", { class: "btn primary", onclick: () => close() }, "Done")],
  });
}

// ------------------------------------------------------------------ tasks

async function viewTasks() {
  let status = "open";
  const page = h("div", { class: "page narrow" });
  const listEl = h("div", { class: "card" });
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["open", "Open"], ["done", "Done"], ["all", "All"]].map(([s, label]) => h("button", {
    role: "tab", "aria-selected": String(s === status), onclick: (e) => { status = s; for (const b of tabs.children) b.setAttribute("aria-selected", String(b === e.currentTarget)); draw(); },
  }, label)));
  page.append(h("div", { class: "row between" }, tabs, can("tasks.write") && h("button", { class: "btn primary", onclick: () => newTask(null, draw) }, icon("plus"), "New task")), listEl);
  viewEl.replaceChildren(page);
  async function draw(background = false) {
    const tasks = await attempt(() => api("GET", `/clinics/${state.clinicId}/tasks?status=${status}`, undefined, { background })) ?? [];
    fill(listEl, tasks.length ? tasks.map((t) => taskRow(t, () => draw(), { open: true })) : emptyState("check", status === "open" ? "Nothing to do" : "Nothing here", status === "open" ? "The assistant adds call-backs here." : null));
  }
  refreshers.tasks = () => draw(true);
  draw();
}

// ------------------------------------------------------------------ calls

async function viewCalls() {
  const page = h("div", { class: "page narrow" });
  viewEl.replaceChildren(page);
  async function draw(background = false) {
    const calls = await attempt(() => api("GET", `/clinics/${state.clinicId}/calls`, undefined, { background })) ?? [];
    fill(page,
      h("div", { class: "banner info" }, icon("info"), "The phone assistant answers, tells callers the call is transcribed, and checks identity with a one-time code before discussing an existing appointment."),
      calls.length ? calls.map((c) => h("section", { class: "card" },
        h("header", {}, h("div", { class: "row" }, chBadge("voice"), h("div", {}, h("h3", {}, c.contact_name ?? c.from_number ?? "Unknown caller"), h("div", { class: "meta" }, [fmtDateTime(c.created_at), c.duration_s ? `${Math.floor(c.duration_s / 60)}m ${c.duration_s % 60}s` : null, c.outcome].filter(Boolean).join(" · ")))),
          c.contact_id && can("inbox.read") && h("button", { class: "btn sm", onclick: () => openContactThread(c.contact_id) }, "Open conversation")),
        h("div", { class: "body stack" }, h("p", {}, c.summary ?? h("span", { class: "subtle" }, "No summary (cleared after the retention period, or not available).")),
          c.transcript && h("details", {}, h("summary", { class: "small", style: { cursor: "pointer" } }, "Transcript"), h("pre", { class: "small", style: { whiteSpace: "pre-wrap", margin: "8px 0 0" } }, c.transcript)))))
        : emptyState("calls", "No calls yet", "Calls answered by the phone assistant appear here with a summary."));
  }
  refreshers.calls = () => draw(true);
  draw();
}

// ---------------------------------------------------------------- funnels

const TRIGGER_TEXT = (t) => ({
  contact_created: "When someone new gets in touch", appointment_booked: "When a visit is booked", appointment_cancelled: "When a visit is cancelled",
  appointment_upcoming: `${t.hours} hours before a visit`, appointment_completed: `${t.hours} hours after a visit`,
  lead_not_booked: `When a new lead hasn't booked after ${t.hours} hours`, patient_lapsed: `When a patient hasn't visited for ${t.days} days`, tag_added: `When the tag "${t.tag}" is added`,
})[t.type] ?? t.type;

async function saveProfile(profile, message) {
  const updated = await attempt(() => api("PUT", `/clinics/${state.clinicId}/profile`, profile), message);
  if (updated) { state.clinic.profile = updated.profile; drawAiChip(); }
  return updated;
}

function highlightVars(template) {
  return template.split(/(\{\{\s*\w+\s*\}\})/g).map((part) => (/^\{\{/.test(part) ? h("span", { class: "var", title: "Filled in per patient" }, part.replace(/[{}\s]/g, "").replace(/_/g, " ")) : part));
}

function viewAutomations() {
  const page = h("div", { class: "page narrow" });
  viewEl.replaceChildren(page);
  function draw() {
    const profile = state.clinic.profile;
    const qh = profile.quietHours ?? { start: "08:00", end: "21:00" };
    fill(page,
      hero("Funnels", "Reminders, follow-ups and re-engagement that run on their own. Each message checks consent first."),
      h("div", { class: "banner" }, icon("shield"), h("div", {}, h("b", {}, "Rules every funnel follows. "),
        `Reminders go only where the patient agreed to them; marketing only with an express yes. Texts never name the service or a body area. Nothing is sent between ${qh.end} and ${qh.start} clinic time. WhatsApp messages outside the 24-hour window need a Meta-approved template.`)),
      profile.automations.map((a, i) => {
        const toggle = h("input", { type: "checkbox", checked: a.enabled, "aria-label": `${a.name} on or off`, onchange: async (e) => {
          const next = structuredClone(profile);
          next.automations[i].enabled = e.target.checked;
          await saveProfile(next, e.target.checked ? `${a.name}: on` : `${a.name}: off`);
          draw();
        } });
        const purposes = a.actions.filter((x) => x.type === "send_message").map((x) => x.purpose);
        return h("section", { class: "card" },
          h("header", {}, h("div", { class: "row" }, h("h3", {}, a.name), purposes.includes("marketing") ? pill("Marketing · express consent", "warn") : purposes.length ? pill("Reminder · service consent", "accent") : null, !a.enabled && pill("Off")),
            h("label", { class: "switch" }, toggle, h("span", {}))),
          h("div", { class: "body flow" },
            h("div", { class: "step" }, h("span", { class: "node" }, icon("bolt")), h("div", { class: "box" }, TRIGGER_TEXT(a.trigger))),
            a.actions.map((x) => x.type === "send_message"
              ? h("div", { class: "step" }, h("span", { class: "node msg-node" }, icon("stamp")), h("div", { class: "box" },
                h("div", { class: "row" }, h("b", {}, x.channel === "preferred" ? "Message on their preferred channel" : `${CHANNEL_LABEL[x.channel]} message`)),
                h("div", { class: "preview-bubble" }, highlightVars(x.template))))
              : h("div", { class: "step" }, h("span", { class: "node" }, icon("check")), h("div", { class: "box" },
                x.type === "set_stage" ? `Move to ${STAGE_LABEL[x.stage]}` : x.type === "add_tag" ? `Add tag "${x.tag}"` : x.type === "create_task" ? `Create a staff task: ${x.title}` : x.type)))));
      }),
      h("details", { class: "card" }, h("summary", { class: "body", style: { cursor: "pointer", fontWeight: 600 } }, "Edit funnels as JSON (advanced)"), h("div", { class: "body" }, automationEditor())));
  }
  function automationEditor() {
    const area = h("textarea", { rows: 18, value: JSON.stringify(state.clinic.profile.automations, null, 2), class: "mono", "aria-label": "Funnels JSON" });
    return h("div", { class: "stack" }, area, h("p", { class: "meta" }, "Each send_message needs \"purpose\": \"service\" (reminders) or \"marketing\". Wording rules are checked when you save."),
      h("div", {}, h("button", { class: "btn primary", onclick: async () => {
        let automations;
        try { automations = JSON.parse(area.value); } catch { return toast("That isn't valid JSON", { error: true }); }
        if (await saveProfile({ ...state.clinic.profile, automations }, "Funnels saved")) draw();
      } }, "Save funnels")));
  }
  draw();
}

// -------------------------------------------------------------- campaigns

function viewCampaigns() {
  const profile = state.clinic.profile;
  const name = h("input", { placeholder: "e.g. Holiday hours" });
  const purpose = h("select", {}, h("option", { value: "marketing" }, "Marketing: offers, news, review requests"), h("option", { value: "service" }, "Service notice to booked patients (closure, practitioner away)"));
  const tag = h("select", {}, h("option", { value: "" }, "Everyone (no tag filter)"), (profile.audienceTags ?? []).map((t) => h("option", { value: t }, t)));
  const stage = h("select", {}, h("option", { value: "" }, "Any stage"), state.clinic.stages.map((s) => h("option", { value: s }, STAGE_LABEL[s])));
  const channel = h("select", {}, h("option", { value: "preferred" }, "Each person's preferred channel"), ["sms", "whatsapp", "email"].map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
  const subject = h("input", { placeholder: "Email subject" });
  const body = h("textarea", { rows: 5, placeholder: "Hi {{first_name}}, …" });
  const previewBox = h("div", { class: "stack" });
  const options = () => ({ name: name.value || "Campaign", purpose: purpose.value, tag: tag.value, stage: purpose.value === "service" ? "booked" : stage.value || undefined, channel: channel.value, subject: subject.value, template: body.value });
  purpose.addEventListener("change", () => { stage.disabled = purpose.value === "service"; if (stage.disabled) stage.value = "booked"; });

  async function preview(btn) {
    await busy(btn, async () => {
      const opts = options();
      const p = await attempt(() => api("POST", `/clinics/${state.clinicId}/campaigns/preview`, opts));
      if (!p) return;
      if (p.problem) { fill(previewBox, h("div", { class: "banner danger" }, icon("alert"), p.problem)); return; }
      const skipped = Object.entries(p.skipped);
      const send = h("button", { class: "btn primary", disabled: !p.eligible, onclick: async () => {
        const ok = await askConfirm(`Send "${opts.name}" to ${p.eligible} ${p.eligible === 1 ? "person" : "people"} now? This is recorded under your name.`, `Send to ${p.eligible}`, { title: "Send campaign?" });
        if (!ok) return;
        const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/campaigns`, { ...opts, confirmToken: p.confirmToken }));
        if (r) fill(previewBox, h("div", { class: "banner success" }, icon("check"), `Sending to ${r.queued} people. Replies land in the inbox.`));
      } }, icon("send"), `Send to ${p.eligible}`);
      fill(previewBox, h("section", { class: "card" },
        h("header", {}, h("h3", {}, "Who gets it")),
        h("div", { class: "body stack" },
          h("div", { class: "row" }, h("span", { class: "stat" }, h("span", { class: "n" }, p.eligible), h("span", { class: "l" }, `of ${p.matched} matched`)),
            Object.entries(p.byChannel).map(([ch, n]) => h("span", { class: "chchip" }, chBadge(ch), `${n}`))),
          skipped.length ? h("div", { class: "small muted" }, "Left out: ", skipped.map(([why, n]) => `${n} ${why}`).join(" · ")) : null,
          h("div", { class: "preview-bubble" }, highlightVars(opts.template))),
        h("footer", { class: "row end" }, send)));
    });
  }

  viewEl.replaceChildren(h("div", { class: "page narrow" },
    hero("Campaigns", "One-off messages to a group. You'll see exactly who gets it before anything is sent."),
    h("section", { class: "card" }, h("div", { class: "body stack" },
      h("label", { class: "f" }, "Name (for your records)", name),
      h("label", { class: "f" }, "Kind of message", purpose),
      h("div", { class: "grid2", style: { gap: "12px" } }, h("label", { class: "f" }, "Audience tag", h("span", { class: "hint" }, "Only tags the owner approved; never health details"), tag), h("label", { class: "f" }, "Pipeline stage", stage)),
      h("label", { class: "f" }, "Send on", channel),
      h("label", { class: "f" }, "Email subject", subject),
      h("label", { class: "f" }, "Message", h("span", { class: "hint" }, "Use {{first_name}} and {{clinic_name}}. Texts can't mention services, body areas or conditions."), body),
      h("div", { class: "row end" }, (() => { const b = h("button", { class: "btn primary", onclick: () => preview(b) }, "Preview audience"); return b; })()))),
    previewBox));
}

// ------------------------------------------------------------------- team

async function viewTeam() {
  const page = h("div", { class: "page narrow" });
  viewEl.replaceChildren(page);
  async function draw() {
    const data = await attempt(() => api("GET", `/clinics/${state.clinicId}/users`));
    if (!data) return;
    fill(page,
      h("div", { class: "row between" }, h("p", { class: "muted" }, "Everyone signs in with their own account and a phone-app code. Give each person the smallest role that lets them do their job."),
        h("button", { class: "btn primary", onclick: () => addUser(data.roles, draw) }, icon("plus"), "Add person")),
      h("section", { class: "card table-wrap" }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, ["Name", "Role", "Sign-in", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, data.users.map((u) => h("tr", {},
          h("td", {}, h("div", { class: "row" }, avatar(u.name), h("div", {}, h("b", {}, u.name), h("div", { class: "meta" }, u.username)))),
          h("td", {}, data.roles.find((r) => r.id === u.role)?.label ?? u.role),
          h("td", {}, u.disabled ? pill("Disabled", "danger") : u.locked_until && new Date(u.locked_until) > new Date() ? pill("Locked", "warn") : u.must_change_password ? pill("Not set up yet", "warn") : u.totp_enabled ? pill("Code on", "success") : pill("No code", "warn")),
          h("td", {}, u.id !== state.session.user.id && h("div", { class: "row end" },
            h("button", { class: "btn sm", onclick: async () => {
              if (!(await askConfirm(`${u.name} will be signed out and get a new temporary passphrase. They'll set up their phone code again.`, "Reset sign-in", { title: "Reset sign-in?" }))) return;
              const r = await attempt(() => api("POST", `/users/${u.id}/reset`, {}));
              if (r) showTempPassword(u.name, r.tempPassword);
              draw();
            } }, "Reset sign-in"),
            h("button", { class: `btn sm ${u.disabled ? "" : "danger"}`, onclick: async () => {
              await attempt(() => api("POST", `/users/${u.id}/${u.disabled ? "enable" : "disable"}`, {}), u.disabled ? "Account enabled" : "Account disabled; they're signed out");
              draw();
            } }, u.disabled ? "Enable" : "Disable")))))))),
      h("section", { class: "card" }, h("header", {}, h("h3", {}, "What each role can do")), h("div", { class: "body small stack", style: { gap: "6px" } },
        h("div", {}, h("b", {}, "Owner: "), "everything, including campaigns, settings, the team, exports and erasing data."),
        h("div", {}, h("b", {}, "Front desk: "), "inbox, patients, consent, calendar, tasks and calls."),
        h("div", {}, h("b", {}, "Practitioner: "), "reads conversations, patients and the calendar; manages tasks."),
        h("div", {}, h("b", {}, "Auditor: "), "the audit log and totals only; never opens patient messages."))));
  }
  draw();
}

async function addUser(roles, onDone) {
  const name = h("input", { autocomplete: "off" });
  const username = h("input", { autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
  const role = h("select", {}, roles.map((r) => h("option", { value: r.id, selected: r.id === "front_desk" }, r.label)));
  const ok = await modal({
    title: "Add a person",
    body: [h("label", { class: "f" }, "Full name", name), h("label", { class: "f" }, "Username", h("span", { class: "hint" }, "Letters, numbers and . _ - only"), username), h("label", { class: "f" }, "Role", role)],
    actions: (close) => [h("button", { class: "btn", onclick: () => close(false) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(true) }, "Add person")],
  });
  if (!ok) return;
  const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/users`, { name: name.value, username: username.value, role: role.value }));
  if (r) { showTempPassword(r.user.name, r.tempPassword); onDone(); }
}

function showTempPassword(name, temp) {
  modal({
    title: `Temporary passphrase for ${name}`, dark: true,
    body: [h("p", {}, "Give this to them in person or read it over the phone. It's shown once and isn't stored. They'll choose their own and set up a phone code when they first sign in."),
      h("div", { class: "secret-key" }, temp)],
    actions: (close) => h("button", { class: "btn primary", onclick: () => close() }, "I've handed it over"),
  });
}

// ------------------------------------------------------------------ audit

async function viewAudit() {
  const page = h("div", { class: "page" });
  viewEl.replaceChildren(page);
  let rows = [];
  async function load(more = false) {
    const before = more && rows.length ? `?before=${rows.at(-1).id}` : "";
    const data = await attempt(() => api("GET", `/clinics/${state.clinicId}/audit${before}`));
    if (!data) return;
    rows = more ? [...rows, ...data.rows] : data.rows;
    draw(data, data.rows.length >= 100);
  }
  const actorLabel = (r) => (r.actor_type === "user" ? r.actor : r.actor_type === "ai" ? "Assistant" : r.actor_type === "webhook" ? `${r.actor} (provider)` : r.actor_type === "system" ? `System: ${r.actor}` : r.actor);
  function draw(data, hasMore) {
    fill(page,
      h("div", { class: `banner ${data.chain.ok && data.triggers ? "success" : "danger"}` }, icon(data.chain.ok ? "check" : "alert"),
        data.chain.ok && data.triggers
          ? `The log is intact: ${data.chain.rows} events, each chained to the one before, and the database refuses edits and deletions.`
          : `The log has been altered${data.chain.brokenAt ? ` at event ${data.chain.brokenAt}` : ""}${data.triggers ? "" : " and its edit protection is missing"}. Tell your privacy officer now.`),
      h("div", { class: "row between" }, h("p", { class: "muted" }, "Who looked at or changed what, and when. Message text is never written here."),
        h("button", { class: "btn", onclick: () => download(`/clinics/${state.clinicId}/audit/fhir`, "audit-fhir.json") }, icon("download"), "Export (FHIR AuditEvent)")),
      h("section", { class: "card table-wrap" }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, ["When", "Who", "Did", "Record", "Result"].map((x) => h("th", {}, x)))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("td", { class: "meta" }, fmtDateTime(r.ts)),
          h("td", {}, actorLabel(r), r.role ? h("div", { class: "meta" }, r.role.replace("_", " ")) : null),
          h("td", {}, r.action, r.detail ? h("div", { class: "meta" }, r.detail) : null),
          h("td", { class: "meta" }, [r.target, r.contact_id ? `patient #${r.contact_id}` : null].filter(Boolean).join(" · ")),
          h("td", {}, pill(r.outcome, r.outcome === "ok" ? "success" : r.outcome === "denied" ? "warn" : "danger"))))))),
      hasMore && h("div", { class: "row end" }, h("button", { class: "btn", onclick: () => load(true) }, "Load older")));
  }
  load();
}

// ------------------------------------------------------------------- test

function viewTest() {
  const channel = h("select", {}, ["sms", "whatsapp", "messenger", "instagram", "email"].map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
  const from = h("input", { value: "+1 416 555 0199" });
  const name = h("input", { placeholder: "Optional" });
  const subject = h("input", { placeholder: "Subject" });
  const body = h("textarea", { rows: 3, placeholder: "e.g. Hi, can I book a massage this Saturday?" });
  const subjectWrap = h("label", { class: "f hidden" }, "Email subject", subject);
  const fromLabel = h("span", {}, "Phone number");
  channel.addEventListener("change", () => {
    const c = channel.value;
    subjectWrap.classList.toggle("hidden", c !== "email");
    fromLabel.textContent = { sms: "Phone number", whatsapp: "WhatsApp number", messenger: "Messenger user id", instagram: "Instagram user id", email: "Email address" }[c];
    from.value = { sms: "+1 416 555 0199", whatsapp: "+1 416 555 0199", messenger: "fb-user-1001", instagram: "ig-user-2002", email: "patient@example.com" }[c];
  });
  const samples = ["Hi, do you have any openings this week?", "How much is a 60 min massage? Do you direct bill Sun Life?", "Is there parking?", "Can I move my appointment?", "Can I speak to a real person please", "STOP", "CANCEL"];
  const sendBtn = h("button", { class: "btn primary", onclick: () => busy(sendBtn, async () => {
    const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/simulate`, { channel: channel.value, from: from.value, name: name.value, subject: subject.value, body: body.value }), "Sent. Opening the conversation…");
    if (r?.conversationId) { body.value = ""; state.convId = r.conversationId; state.filter = "all"; setTimeout(() => show("inbox"), 400); }
  }) }, icon("send"), "Send as patient");
  viewEl.replaceChildren(h("div", { class: "page narrow" },
    h("div", { class: "banner warn" }, icon("alert"), h("div", {}, h("b", {}, "Test console. "), "Messages sent here are marked as simulated and never change a real patient's consent. Use made-up names and numbers only.")),
    h("section", { class: "card" }, h("div", { class: "body stack" },
      h("div", { class: "grid2", style: { gap: "12px" } }, h("label", { class: "f" }, "Channel", channel), h("label", { class: "f" }, fromLabel, from)),
      h("label", { class: "f" }, "Name", name), subjectWrap,
      h("label", { class: "f" }, "Message", body),
      h("div", { class: "tags" }, samples.map((s) => h("button", { class: "tag", style: { cursor: "pointer", border: 0 }, onclick: () => { body.value = s; body.focus(); } }, s))),
      h("div", { class: "row end" }, sendBtn))),
    h("p", { class: "meta" }, "Phone calls need an ElevenLabs agent on a real number; see Settings → Phone assistant.")));
}

// --------------------------------------------------------------- settings

function viewSettings() {
  const c = state.clinic;
  const p = c.profile;
  const base = location.origin;
  const hooks = [
    ["SMS (Twilio)", `${base}/webhooks/twilio/sms`], ["SMS delivery receipts (Twilio)", `${base}/webhooks/twilio/status`], ["SMS (Telnyx)", `${base}/webhooks/telnyx/sms`],
    ["WhatsApp / Messenger / Instagram (Meta)", `${base}/webhooks/meta`], ["Email inbound (Postmark, Basic auth)", `https://inbound:EMAIL_INBOUND_SECRET@${location.host}/webhooks/email`],
    ["Phone: call start (ElevenLabs)", `${base}/webhooks/elevenlabs/init`], ["Phone: after the call (ElevenLabs)", `${base}/webhooks/elevenlabs/post-call`],
    ...(c.edition === "ehr" ? [["Records system events", `${base}/webhooks/ehr`]] : []),
  ];
  const modeRows = Object.keys(CHANNEL_LABEL).filter((ch) => ch !== "voice").map((ch) => {
    const select = h("select", { "aria-label": `${CHANNEL_LABEL[ch]} assistant mode` }, [["auto", "Replies on its own"], ["draft", "Drafts, staff approve"], ["off", "Off"]].map(([v, l]) => h("option", { value: v, selected: p.aiModes[ch] === v }, l)));
    select.addEventListener("change", () => saveProfile({ ...state.clinic.profile, aiModes: { ...state.clinic.profile.aiModes, [ch]: select.value } }, `${CHANNEL_LABEL[ch]}: ${select.selectedOptions[0].textContent}`));
    return h("tr", {}, h("td", {}, h("span", { class: "row" }, chBadge(ch), CHANNEL_LABEL[ch])), h("td", {}, select));
  });

  const agreements = h("input", { type: "checkbox", checked: !!p.processorAgreementsRecorded, onchange: async (e) => {
    if (e.target.checked && !(await askConfirm("Confirm that signed agreements (BAA or data-processing agreement) are in place with every vendor that handles patient messages: the AI provider, SMS, WhatsApp/Meta, email and voice. The assistant starts replying once this is on.", "Agreements are signed", { title: "Record processor agreements", dark: true }))) { e.target.checked = false; return; }
    await saveProfile({ ...state.clinic.profile, processorAgreementsRecorded: e.target.checked }, e.target.checked ? "Recorded; the assistant can now reply" : "The assistant is off until agreements are recorded");
  } });
  const wording = Object.entries(c.wordingRules).map(([key, label]) => h("label", { class: "row small" }, h("input", { type: "checkbox", checked: (p.wordingRules ?? Object.keys(c.wordingRules)).includes(key), "data-rule": key }), label));
  const wordingBox = h("div", { class: "stack", style: { gap: "6px" } }, wording);
  const tagsInput = h("input", { value: (p.audienceTags ?? []).join(", ") });
  const msgDays = h("input", { type: "number", min: "1", max: "3650", value: p.retention?.messageDays ?? 180 });
  const callDays = h("input", { type: "number", min: "1", max: "3650", value: p.retention?.callDays ?? 30 });
  const qStart = h("input", { type: "time", value: p.quietHours?.start ?? "08:00" });
  const qEnd = h("input", { type: "time", value: p.quietHours?.end ?? "21:00" });
  const policySave = h("button", { class: "btn primary", onclick: () => busy(policySave, () => saveProfile({
    ...state.clinic.profile,
    wordingRules: [...wordingBox.querySelectorAll("input[data-rule]")].filter((x) => x.checked).map((x) => x.dataset.rule),
    audienceTags: tagsInput.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    retention: { messageDays: Number(msgDays.value), callDays: Number(callDays.value) },
    quietHours: { start: qStart.value, end: qEnd.value },
  }, "Privacy settings saved")) }, "Save privacy settings");

  const profileArea = h("textarea", { rows: 20, class: "mono", "aria-label": "Clinic profile JSON",
    value: JSON.stringify({ ...p, automations: undefined, wordingRules: undefined, audienceTags: undefined, retention: undefined, quietHours: undefined, processorAgreementsRecorded: undefined, aiModes: undefined }, null, 2) });
  const voiceBox = h("pre", { class: "small", style: { whiteSpace: "pre-wrap", maxHeight: "360px", overflow: "auto", margin: 0 } }, "Loading…");
  api("GET", `/clinics/${state.clinicId}/voice-config`).then((cfg) => { voiceBox.textContent = JSON.stringify(cfg, null, 2); }).catch((e) => { voiceBox.textContent = e.message; });

  viewEl.replaceChildren(h("div", { class: "page" },
    !p.processorAgreementsRecorded && (state.boot.demo
      ? h("div", { class: "banner info" }, icon("info"), "Demo mode runs the assistant on sample data. With real patients it stays off until processor agreements are recorded below.")
      : h("div", { class: "banner warn" }, icon("alert"), "The assistant is off until processor agreements are recorded below.")),
    h("div", { class: "grid2" },
      h("section", { class: "card" }, h("header", {}, h("h3", {}, "Assistant")), h("div", { class: "body stack" },
        h("label", { class: "row", style: { flexWrap: "nowrap", alignItems: "flex-start", gap: "12px" } }, h("span", { class: "switch", style: { marginTop: "2px" } }, agreements, h("span", {})), h("span", {}, h("b", {}, "Processor agreements signed"), h("div", { class: "meta" }, "Required before the assistant sends patient messages to outside services (PHIPA s.17)"))),
        h("table", { class: "t" }, h("tbody", {}, modeRows)),
        h("p", { class: "meta" }, "Email starts in draft mode so staff check replies from the general inbox."))),
      h("section", { class: "card" }, h("header", {}, h("h3", {}, "Channels")), h("div", { class: "body" },
        h("table", { class: "t" }, h("tbody", {}, Object.entries(c.channels).map(([ch, status]) => h("tr", {},
          h("td", {}, h("span", { class: "row" }, chBadge(ch), CHANNEL_LABEL[ch])),
          h("td", {}, status === "live" ? pill("Live", "success") : pill("Simulated", "", { title: "No credentials: nothing is really sent" })),
          h("td", { class: "meta" }, c.accounts.filter((a) => a.channel === ch).map((a) => a.address).join(", ")))))),
        h("p", { class: "meta", style: { marginTop: "8px" } }, c.edition === "ehr"
          ? `Connected to the records system${c.ehrPaired ? "" : " (not paired yet: run npm run cli -- pair-ehr on the server)"}. Patients and bookings come from there.`
          : `Standalone: this app's calendar is the source of truth${p.bookingProvider === "jane" ? ", with bookings handed to Jane App" : ""}.`)))),
    h("section", { class: "card" }, h("header", {}, h("h3", {}, "Privacy and wording")), h("div", { class: "body grid2" },
      h("div", { class: "stack" }, h("b", { class: "small" }, "Words never sent to patients"), h("p", { class: "meta" }, "Leave all on unless your regulator allows a term for your professions (for example, chiropractors may use \"Dr.\")."), wordingBox),
      h("div", { class: "stack" },
        h("label", { class: "f" }, "Audience tags allowed in campaigns", h("span", { class: "hint" }, "Comma-separated. Tags that describe health (e.g. lower-back) are refused."), tagsInput),
        h("div", { class: "grid2", style: { gap: "12px", gridTemplateColumns: "1fr 1fr" } },
          h("label", { class: "f" }, "Keep message text (days)", msgDays), h("label", { class: "f" }, "Keep call summaries (days)", callDays),
          h("label", { class: "f" }, "Automated messages from", qStart), h("label", { class: "f" }, "until", qEnd)),
        h("div", { class: "row end" }, policySave)))),
    h("section", { class: "card" }, h("header", {}, h("h3", {}, "Webhook addresses")), h("div", { class: "body stack" },
      h("p", { class: "meta" }, "Paste these into each provider's console. Each one only works once its secret is set on the server."),
      h("table", { class: "t" }, h("tbody", {}, hooks.map(([label, url]) => h("tr", {}, h("td", {}, label), h("td", {}, h("code", {}, url)))))))),
    h("section", { class: "card" }, h("header", {}, h("h3", {}, "What the assistant knows")), h("div", { class: "body stack" },
      h("p", { class: "meta" }, "Services, practitioners and hours, policies and FAQ. The assistant answers only from this. Integration settings can't be changed here."),
      profileArea,
      h("div", {}, h("button", { class: "btn primary", onclick: async () => {
        let next;
        try { next = JSON.parse(profileArea.value); } catch { return toast("That isn't valid JSON", { error: true }); }
        const cur = state.clinic.profile;
        await saveProfile({ ...next, automations: cur.automations, wordingRules: cur.wordingRules, audienceTags: cur.audienceTags, retention: cur.retention, quietHours: cur.quietHours, processorAgreementsRecorded: cur.processorAgreementsRecorded, aiModes: cur.aiModes }, "Saved");
      } }, "Save")))),
    h("section", { class: "card" }, h("header", {}, h("h3", {}, "Phone assistant (ElevenLabs)")), h("div", { class: "body stack" },
      h("p", { class: "meta" }, "Create an ElevenLabs agent with this prompt and these tools, connect the clinic's number, and set the two phone webhooks above. Tools authenticate with the x-tool-secret header."),
      voiceBox))));
}

renderAuth().catch(() => renderLogin());
