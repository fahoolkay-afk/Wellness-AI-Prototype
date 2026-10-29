// Staff app: unified inbox + CRM. Plain ES modules, no build step.

const CHANNEL_LABEL = { sms: "SMS", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", email: "Email", voice: "Phone" };
const STAGE_LABEL = { new_lead: "New lead", contacted: "Contacted", booked: "Booked", active_patient: "Active patient", lapsed: "Lapsed" };
const AVATAR_COLORS = ["#00a884", "#1a73e8", "#e8710a", "#a142f4", "#d93025", "#0097a7", "#7cb342", "#c2185b"];

const ICONS = {
  inbox: "M4 4h16v12h-5l-3 3-3-3H4z",
  dashboard: "M4 13h6V4H4zm0 7h6v-5H4zm10 0h6V11h-6zm0-16v5h6V4z",
  pipeline: "M3 5h4v14H3zm7 0h4v10h-4zm7 0h4v6h-4z",
  calendar: "M7 2v3M17 2v3M3 8h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z",
  tasks: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9",
  calls: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z",
  automations: "M13 2L3 14h9l-1 8 10-12h-9z",
  broadcast: "M3 11l18-8-8 18-2-8z",
  contacts: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  test: "M9 3h6M10 3v6L4 19a1 1 0 00.9 1.5h14.2A1 1 0 0020 19l-6-10V3",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
  back: "M15 18l-6-6 6-6",
};

const CH_GLYPH = { sms: "S", whatsapp: "W", messenger: "M", instagram: "IG", email: "@", voice: "☎" };

// ------------------------------------------------------------------ helpers

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
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

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

const chBadge = (channel) => h("span", { class: `ch ${channel}`, title: CHANNEL_LABEL[channel] }, CH_GLYPH[channel] ?? "?");

function avatar(name, channel) {
  const label = (name ?? "?").trim();
  const initials = label.startsWith("+") || label.includes("@") ? "#" : label.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h("div", { class: "avatar", style: { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] } }, initials || "?", channel && chBadge(channel));
}

const contactLabel = (c) => c.contact_name ?? c.name ?? c.contact_phone ?? c.phone ?? c.contact_email ?? c.email ?? "Unknown contact";

/** All times show in the clinic's time zone, wherever the staff member's device is. */
const clinicTz = () => state.clinic?.profile.timezone;
const fmt = (iso, opts) => new Date(iso).toLocaleString([], { ...opts, timeZone: clinicTz() });
const dayKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: clinicTz() }).format(new Date(iso));
const fmtTime = (iso) => fmt(iso, { hour: "numeric", minute: "2-digit" });

function timeShort(iso) {
  if (dayKey(iso) === dayKey(new Date())) return fmtTime(iso);
  if ((Date.now() - new Date(iso)) / 864e5 < 6) return fmt(iso, { weekday: "short" });
  return fmt(iso, { month: "short", day: "numeric" });
}

const fmtDateTime = (iso) => fmt(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function toast(text, isError = false) {
  const el = h("div", { class: `toast${isError ? " err" : ""}` }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), isError ? 5000 : 2600);
}

/** In-page confirmation (embedded viewers block window.confirm). Resolves true if confirmed. */
function askConfirm(message, confirmLabel = "Confirm") {
  return new Promise((resolve) => {
    const close = (answer) => { overlay.remove(); resolve(answer); };
    const ok = h("button", { class: "btn primary", onclick: () => close(true) }, confirmLabel);
    const overlay = h("div", { class: "modal", onclick: (e) => { if (e.target === overlay) close(false); }, onkeydown: (e) => { if (e.key === "Escape") close(false); } },
      h("div", { class: "modal-card", role: "dialog", "aria-modal": "true" },
        h("p", {}, message),
        h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", onclick: () => close(false) }, "Go back"), ok)));
    document.body.append(overlay);
    ok.focus();
  });
}

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/login") {
    state.session = null;
    renderLogin();
    throw new Error("Signed out");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(success);
    return result;
  } catch (err) {
    if (err.message !== "Signed out") toast(err.message, true);
    return undefined;
  }
}

function describeTrigger(t) {
  switch (t.type) {
    case "contact_created": return "When a new contact is created";
    case "appointment_booked": return "When an appointment is booked";
    case "appointment_cancelled": return "When an appointment is cancelled";
    case "appointment_upcoming": return `${t.hours} hours before an appointment`;
    case "appointment_completed": return `${t.hours} hours after an appointment ends`;
    case "lead_not_booked": return `When a new lead hasn't booked after ${t.hours} hours`;
    case "patient_lapsed": return `When a patient hasn't visited for ${t.days} days`;
    case "tag_added": return `When the tag "${t.tag}" is added`;
    default: return t.type;
  }
}

function describeAction(a) {
  switch (a.type) {
    case "send_message": return `Send ${a.channel === "preferred" ? "a message on their preferred channel" : `a ${CHANNEL_LABEL[a.channel]} message`}: "${a.template}"`;
    case "add_tag": return `Add tag "${a.tag}"`;
    case "set_stage": return `Move to pipeline stage "${STAGE_LABEL[a.stage]}"`;
    case "create_task": return `Create staff task: ${a.title}`;
    default: return a.type;
  }
}

// -------------------------------------------------------------------- state

const state = {
  session: null,
  clinics: [],
  clinicId: null,
  clinic: null,
  view: "inbox",
  filter: "all",
  search: "",
  convs: [],
  convId: null,
  thread: null,
  sse: null,
};

const VIEWS = [
  ["inbox", "Inbox"], ["dashboard", "Dashboard"], ["pipeline", "Pipeline"], ["contacts", "Contacts"], ["calendar", "Calendar"],
  ["tasks", "Tasks"], ["calls", "Calls"], ["automations", "Automations"], ["broadcast", "Broadcast"], ["test", "Test"], ["settings", "Settings"],
];

// "#settings" is reserved when the app is embedded, so that view's link is "#setup".
const hashForView = (view) => (view === "settings" ? "setup" : view);
const viewForHash = (hash) => (hash === "setup" ? "settings" : hash);

const root = document.getElementById("app");

// -------------------------------------------------------------------- login

function renderLogin() {
  state.sse?.close();
  const name = h("input", { placeholder: "Your name", autocomplete: "name", value: localStorage.getItem("fd_name") ?? "" });
  const password = h("input", { type: "password", placeholder: "Clinic password", autocomplete: "current-password" });
  const error = h("div", { class: "error" });
  const submit = async (e) => {
    e.preventDefault();
    error.textContent = "";
    try {
      await api("POST", "/login", { name: name.value, password: password.value });
      try { localStorage.setItem("fd_name", name.value); } catch { /* storage unavailable */ }
      await boot();
    } catch (err) {
      error.textContent = err.message;
    }
  };
  root.replaceChildren(h("div", { class: "login" },
    h("form", { class: "login-card", onsubmit: submit },
      h("h1", {}, "Clinic Front Desk"),
      h("p", { class: "muted" }, "Every patient conversation in one place, with an AI receptionist that never misses a message."),
      h("label", {}, "Name"), name,
      h("label", {}, "Password"), password,
      error,
      h("button", { class: "btn primary", type: "submit" }, "Sign in"),
      h("p", { class: "muted small" }, 'Demo password: "demo"'),
    )));
  (name.value ? password : name).focus();
}

// -------------------------------------------------------------------- shell

async function boot() {
  state.session = await api("GET", "/session");
  if (!state.session) return renderLogin();
  state.clinics = await api("GET", "/clinics");
  let saved;
  try { saved = Number(localStorage.getItem("fd_clinic")); } catch { /* storage unavailable */ }
  state.clinicId = state.clinics.find((c) => c.id === saved)?.id ?? state.clinics[0]?.id;
  await loadClinic();
  renderShell();
  connectLive();
  const hashView = viewForHash(location.hash.slice(1));
  show(VIEWS.some(([v]) => v === hashView) ? hashView : "inbox");
}

async function loadClinic() {
  state.clinic = await api("GET", `/clinics/${state.clinicId}`);
}

let navEl, titleEl, viewEl, liveDot;

function renderShell() {
  navEl = h("nav", { class: "nav" }, h("div", { class: "logo", title: "Clinic Front Desk" }, "FD"));
  for (const [id, label] of VIEWS) {
    navEl.append(h("button", { "data-view": id, onclick: () => show(id), title: label }, icon(id === "test" ? "test" : id), label));
  }
  navEl.append(h("div", { class: "spacer" }), h("button", { onclick: logout, title: "Sign out" }, icon("logout"), "Sign out"));

  titleEl = h("h2", {});
  liveDot = h("span", { class: "dot", title: "Live updates" });
  const clinicSelect = state.clinics.length > 1
    ? h("select", { onchange: async (e) => {
      state.clinicId = Number(e.target.value);
      try { localStorage.setItem("fd_clinic", String(state.clinicId)); } catch { /* storage unavailable */ }
      state.convId = null;
      await loadClinic();
      connectLive();
      show(state.view);
    } }, state.clinics.map((c) => h("option", { value: c.id, selected: c.id === state.clinicId }, c.name)))
    : h("span", { class: "muted small" }, state.clinic.name);
  const topbar = h("div", { class: "topbar" },
    titleEl,
    clinicSelect,
    h("span", { class: "pill", title: "Edition" }, state.clinic.edition === "ehr" ? "EHR-connected" : "Standalone"),
    h("span", { class: "pill ai", title: "AI receptionist engine" }, state.clinic.responder === "claude" ? "AI: Claude" : "AI: demo mode"),
    window.__FD_DEMO__ ? h("span", { class: "pill warn", title: "Runs entirely in your browser. Nothing is sent, and data resets when you reload." }, "Browser demo") : null,
    liveDot,
    h("span", { class: "muted small" }, state.session.name),
  );
  viewEl = h("div", { class: "view" });
  root.replaceChildren(h("div", { class: "shell" }, navEl, h("div", { class: "main" }, topbar, viewEl)));
}

async function logout() {
  await api("POST", "/logout");
  state.session = null;
  renderLogin();
}

function connectLive() {
  state.sse?.close();
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

function refresh(event) {
  refreshers[state.view]?.(event);
}

function show(view) {
  state.view = view;
  if (location.hash !== `#${hashForView(view)}`) history.replaceState(null, "", `#${hashForView(view)}`);
  for (const b of navEl.querySelectorAll("button[data-view]")) b.classList.toggle("active", b.dataset.view === view);
  titleEl.textContent = VIEWS.find(([v]) => v === view)?.[1] ?? "";
  viewEl.replaceChildren();
  ({ inbox: viewInbox, dashboard: viewDashboard, pipeline: viewPipeline, contacts: viewContacts, calendar: viewCalendar, tasks: viewTasks, calls: viewCalls, automations: viewAutomations, broadcast: viewBroadcast, test: viewTest, settings: viewSettings })[view]();
}

// -------------------------------------------------------------------- inbox

function viewInbox() {
  const listEl = h("div", { class: "convs" });
  const searchEl = h("input", { placeholder: "Search name, phone or message", value: state.search, oninput: (e) => { state.search = e.target.value; drawList(); } });
  const tabs = h("div", { class: "tabs" }, [["all", "All"], ["attention", "Needs attention"], ["unread", "Unread"]].map(([f, label]) =>
    h("button", { class: state.filter === f ? "active" : "", onclick: async (e) => {
      state.filter = f;
      for (const b of tabs.children) b.classList.remove("active");
      e.target.classList.add("active");
      await loadList();
    } }, label)));
  const list = h("div", { class: "list" }, h("div", { class: "list-head" }, searchEl, tabs), listEl);
  const thread = h("div", { class: "thread" });
  const side = h("div", { class: "side" });
  const layout = h("div", { class: "inbox" }, list, thread, side);
  viewEl.replaceChildren(layout);

  function drawList() {
    const q = state.search.toLowerCase();
    const convs = state.convs.filter((c) => !q || [c.contact_name, c.contact_phone, c.contact_email, c.preview].some((v) => v?.toLowerCase().includes(q)));
    listEl.replaceChildren(...(convs.length ? convs.map((c) => h("div", {
      class: `conv${c.id === state.convId ? " active" : ""}`,
      onclick: () => openConversation(c.id),
    },
    avatar(contactLabel(c), c.last_channel),
    h("div", { class: "conv-body" },
      h("div", { class: "conv-top" }, h("span", { class: "conv-name" }, contactLabel(c)), h("span", { class: "conv-time" }, timeShort(c.last_message_at))),
      h("div", { class: "conv-preview" }, c.preview_author === "ai" ? h("span", { class: "pill ai" }, "AI") : c.preview_author === "staff" ? h("span", {}, "You:") : null, h("span", {}, c.preview ?? "")),
      h("div", { class: "conv-flags" },
        c.needs_attention ? h("span", { class: "pill warn", title: c.attention_reason ?? "" }, "Needs attention") : null,
        !c.ai_enabled ? h("span", { class: "pill" }, "AI paused") : null,
        h("span", { class: "pill" }, STAGE_LABEL[c.stage]),
        c.unread ? h("span", { class: "badge" }, c.unread) : null,
      ),
    ))) : [h("div", { class: "empty" }, h("div", {}, h("div", { class: "big" }, "💬"), "No conversations yet. Use the Test tab to send one as a patient."))]));
  }

  async function loadList() {
    state.convs = await attempt(() => api("GET", `/clinics/${state.clinicId}/conversations?filter=${state.filter}`)) ?? [];
    drawList();
  }

  // Thread pane is split so live refreshes never wipe what staff are typing.
  const head = h("div", { class: "thread-head" });
  const banner = h("div", { class: "attention hidden" });
  const messagesEl = h("div", { class: "messages" });
  const composer = buildComposer();

  async function openConversation(id) {
    state.convId = id;
    layout.classList.add("open");
    drawList();
    await loadThread(true);
    api("POST", `/conversations/${id}/read`).catch(() => {});
  }

  async function loadThread(scroll = false) {
    if (!state.convId) {
      thread.replaceChildren(h("div", { class: "empty" }, h("div", {}, h("div", { class: "big" }, "🩺"), h("b", {}, "Select a conversation"), h("p", {}, "SMS, WhatsApp, Messenger, Instagram, email and phone calls all land here. The AI replies on its own; anything it can't handle is flagged for you."))));
      side.replaceChildren();
      return;
    }
    const data = await attempt(() => api("GET", `/conversations/${state.convId}`));
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
    const toggle = h("input", { type: "checkbox", checked: !!conversation.ai_enabled, onchange: async (e) => {
      await attempt(() => api("POST", `/conversations/${conversation.id}/ai`, { enabled: e.target.checked }), e.target.checked ? "AI receptionist on" : "AI paused for this conversation");
      loadThread();
      loadList();
    } });
    head.replaceChildren(
      h("button", { class: "btn back", onclick: () => { layout.classList.remove("open"); state.convId = null; drawList(); } }, icon("back")),
      avatar(contact.name ?? contact.phone ?? contact.email),
      h("div", { class: "who" }, h("b", {}, contact.name ?? contact.phone ?? contact.email ?? "Unknown"),
        h("span", { class: "muted small" }, [contact.phone, contact.email].filter(Boolean).join(" · "), " ", reachable.map(chBadge))),
      h("label", { class: "ai-toggle", title: "When on, the AI receptionist answers this patient automatically" }, h("span", { class: "switch" }, toggle, h("span", {})), "AI"),
      h("button", { class: "btn small", title: "Patient details", onclick: () => layout.classList.toggle("show-side") }, icon("info")),
    );
    banner.classList.toggle("hidden", !conversation.needs_attention);
    banner.replaceChildren(h("span", {}, "⚠ ", conversation.attention_reason ?? "Needs attention"),
      h("button", { class: "btn small", onclick: async () => { await attempt(() => api("POST", `/conversations/${conversation.id}/resolve`), "Marked as handled"); loadThread(); loadList(); } }, "Mark handled"));
  }

  function drawMessages({ messages }) {
    const nodes = [];
    let lastDay = "";
    for (const m of messages) {
      const day = dayKey(m.created_at);
      if (day !== lastDay) {
        nodes.push(h("div", { class: "day-sep" }, fmt(m.created_at, { weekday: "long", month: "short", day: "numeric" })));
        lastDay = day;
      }
      if (m.author === "system") {
        nodes.push(h("div", { class: "sys" }, m.body));
        continue;
      }
      nodes.push(m.status === "draft" ? draftBubble(m) : bubble(m));
    }
    messagesEl.replaceChildren(...nodes);
  }

  function bubble(m) {
    const out = m.direction === "out";
    const who = m.author === "ai" ? (m.author_name ?? "AI receptionist") : m.author === "staff" ? (m.author_name ?? "Staff") : null;
    const status = { sent: "✓✓", simulated: "✓ simulated", failed: "✕ failed", received: "" }[m.status] ?? "";
    return h("div", { class: `bubble${out ? " out" : ""}${m.author === "ai" ? " ai" : ""}${m.status === "failed" ? " failed" : ""}` },
      who && h("div", { class: "author" }, m.author === "ai" ? "🤖" : "", who),
      m.subject && h("div", { class: "subject" }, m.subject),
      m.body,
      m.error && h("div", { class: "err" }, m.error),
      h("div", { class: "meta" }, chBadge(m.channel), fmtTime(m.created_at), out && status),
    );
  }

  function draftBubble(m) {
    const editor = h("textarea", { class: "hidden", value: m.body });
    const text = h("div", {}, m.body);
    const edit = h("button", { class: "btn small", onclick: () => { editor.classList.toggle("hidden"); text.classList.toggle("hidden"); } }, "Edit");
    return h("div", { class: "bubble out draft" },
      h("div", { class: "author" }, "🤖 AI draft, waiting for your approval"),
      m.subject && h("div", { class: "subject" }, m.subject),
      text, editor,
      h("div", { class: "actions" },
        h("button", { class: "btn primary small", onclick: async () => {
          await attempt(() => api("POST", `/messages/${m.id}/approve`, { body: editor.value }), "Sent");
          loadThread(true); loadList();
        } }, "Approve & send"),
        edit,
        h("button", { class: "btn small danger", onclick: async () => { await attempt(() => api("POST", `/messages/${m.id}/discard`)); loadThread(); } }, "Discard"),
      ),
      h("div", { class: "meta" }, chBadge(m.channel), fmtTime(m.created_at)),
    );
  }

  function buildComposer() {
    const channel = h("select", { title: "Reply on" });
    const subject = h("input", { placeholder: "Subject", class: "hidden" });
    const text = h("textarea", { rows: 1, placeholder: "Type a message", onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
    const keepAi = h("input", { type: "checkbox" });
    const sendBtn = h("button", { class: "btn primary send", title: "Send", onclick: () => send() }, icon("send"));
    channel.addEventListener("change", () => subject.classList.toggle("hidden", channel.value !== "email"));
    async function send() {
      const body = text.value.trim();
      if (!body || !state.convId) return;
      sendBtn.disabled = true;
      const ok = await attempt(() => api("POST", `/conversations/${state.convId}/reply`, { body, channel: channel.value, subject: subject.value || undefined, keepAiOn: keepAi.checked }));
      sendBtn.disabled = false;
      if (ok) {
        text.value = "";
        subject.value = "";
        loadThread(true);
        loadList();
      }
    }
    return {
      el: h("div", { class: "composer" }, subject, h("div", { class: "composer-row" }, channel, text, sendBtn),
        h("div", { class: "opts" }, h("label", {}, keepAi, "Keep AI on after my reply"), h("span", {}, "Replying pauses the AI on this thread unless ticked."))),
      update({ conversation, reachable }) {
        const current = channel.value;
        const options = reachable.length ? reachable : [conversation.last_channel];
        channel.replaceChildren(...options.map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
        channel.value = options.includes(current) ? current : options.includes(conversation.last_channel) ? conversation.last_channel : options[0];
        subject.classList.toggle("hidden", channel.value !== "email");
      },
    };
  }

  function drawSide({ contact, appointments, tasks }) {
    fill(side, [
      h("button", { class: "btn small back", style: { marginBottom: "8px" }, onclick: () => layout.classList.remove("show-side") }, icon("back"), "Close"),
      contactCard(contact, () => { loadThread(); loadList(); }),
      h("h3", {}, "Appointments"),
      appointments.length ? appointments.map((a) => apptCard(a, () => loadThread())) : h("p", { class: "muted small" }, "No appointments yet."),
      bookingForm(contact, () => loadThread()),
      h("h3", {}, "Tasks"),
      tasks.length ? tasks.map((t) => taskRow(t, () => loadThread())) : h("p", { class: "muted small" }, "No tasks."),
    ]);
  }

  refreshers.inbox = (event) => {
    loadList();
    if (state.convId && (!event?.id || event.id === state.convId || event.kind !== "message")) loadThread();
  };
  loadList().then(() => {
    if (state.convId && state.convs.some((c) => c.id === state.convId)) openConversation(state.convId);
    else loadThread();
  });
}

function contactCard(contact, onSaved) {
  const name = h("input", { value: contact.name ?? "" });
  const phone = h("input", { value: contact.phone ?? "" });
  const email = h("input", { value: contact.email ?? "" });
  const stage = h("select", {}, state.clinic.stages.map((s) => h("option", { value: s, selected: s === contact.stage }, STAGE_LABEL[s])));
  const notes = h("textarea", { rows: 2, value: contact.notes ?? "" });
  let tags = [...contact.tags];
  const tagWrap = h("div", { class: "tags" });
  const drawTags = () => tagWrap.replaceChildren(...tags.map((t) => h("span", { class: "tag" }, t, h("button", { title: "Remove", onclick: () => { tags = tags.filter((x) => x !== t); drawTags(); } }, "×"))));
  drawTags();
  const tagInput = h("input", { placeholder: "Add tag + Enter", onkeydown: (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      tags = [...new Set([...tags, e.target.value.trim().toLowerCase()])];
      e.target.value = "";
      drawTags();
    }
  } });
  return h("div", {},
    h("h3", {}, "Patient"),
    h("label", {}, "Name"), name,
    h("div", { class: "row" }, h("div", {}, h("label", {}, "Phone"), phone), h("div", {}, h("label", {}, "Email"), email)),
    h("label", {}, "Pipeline stage"), stage,
    h("label", {}, "Tags"), tagWrap, tagInput,
    h("label", {}, "Notes"), notes,
    contact.opted_out ? h("p", { class: "pill warn" }, "Opted out of SMS") : null,
    contact.external_id ? h("p", { class: "muted small" }, `EHR patient id: ${contact.external_id}`) : null,
    h("div", { style: { marginTop: "8px" } }, h("button", { class: "btn primary small", onclick: async () => {
      await attempt(() => api("PATCH", `/contacts/${contact.id}`, { name: name.value, phone: phone.value, email: email.value, stage: stage.value, notes: notes.value, tags }), "Saved");
      onSaved();
    } }, "Save")),
  );
}

function apptCard(a, onChange) {
  const service = state.clinic.profile.services.find((s) => s.id === a.service_id)?.name ?? a.service_id;
  const practitioner = state.clinic.profile.practitioners.find((p) => p.id === a.practitioner_id)?.name ?? a.practitioner_id;
  const upcoming = a.status === "booked" && new Date(a.starts_at) > new Date();
  const setStatus = (status) => async () => {
    if (status === "cancelled" && !(await askConfirm("Cancel this appointment? The patient will be notified.", "Cancel appointment"))) return;
    await attempt(() => api("POST", `/appointments/${a.id}/status`, { status }), "Updated");
    onChange();
  };
  return h("div", { class: `appt ${a.status}` },
    h("b", {}, fmtDateTime(a.starts_at)), h("div", {}, `${service} · ${practitioner}`),
    h("div", { class: "muted" }, a.status.replace("_", " "), " · via ", a.created_via),
    a.status === "booked" && h("div", { class: "actions" },
      upcoming && h("button", { class: "btn small danger", onclick: setStatus("cancelled") }, "Cancel"),
      !upcoming && h("button", { class: "btn small", onclick: setStatus("completed") }, "Attended"),
      !upcoming && h("button", { class: "btn small", onclick: setStatus("no_show") }, "No-show"),
    ),
  );
}

function bookingForm(contact, onBooked) {
  const { services } = state.clinic.profile;
  const service = h("select", {}, services.map((s) => h("option", { value: s.id }, s.name)));
  const slot = h("select", {}, h("option", {}, "Pick a service to load times"));
  const wrap = h("details", {}, h("summary", {}, "+ Book an appointment"), h("label", {}, "Service"), service, h("label", {}, "Time"), slot,
    h("button", { class: "btn primary small", style: { marginTop: "8px" }, onclick: async () => {
      if (!slot.value) return;
      const [practitionerId, start] = slot.value.split("|");
      const ok = await attempt(() => api("POST", `/clinics/${state.clinicId}/appointments`, { contactId: contact.id, serviceId: service.value, practitionerId, start }), "Booked");
      if (ok) onBooked();
    } }, "Book"));
  async function loadSlots() {
    slot.replaceChildren(h("option", { value: "" }, "Loading…"));
    const slots = await attempt(() => api("GET", `/clinics/${state.clinicId}/slots?service=${service.value}`)) ?? [];
    slot.replaceChildren(...(slots.length ? slots.map((s) => h("option", { value: `${s.practitionerId}|${s.start}` }, `${s.label} · ${s.practitionerName}`)) : [h("option", { value: "" }, "No open times in the next 2 weeks")]));
  }
  service.addEventListener("change", loadSlots);
  wrap.addEventListener("toggle", () => { if (wrap.open) loadSlots(); }, { once: true });
  return wrap;
}

function taskRow(t, onChange) {
  return h("div", { class: `card compact task${t.status === "done" ? " done" : ""}` },
    h("input", { type: "checkbox", checked: t.status === "done", onchange: async (e) => {
      await attempt(() => api("POST", `/tasks/${t.id}`, { status: e.target.checked ? "done" : "open", clinicId: state.clinicId }));
      onChange();
    } }),
    h("div", {},
      h("div", { class: `title ${t.priority === "urgent" ? "prio-urgent" : ""}` }, t.title),
      t.details && h("div", { class: "muted small" }, t.details),
      h("div", { class: "muted small" }, `${t.type} · ${t.created_by} · ${timeShort(t.created_at)}`),
    ),
  );
}

// ---------------------------------------------------------------- dashboard

async function viewDashboard() {
  const page = h("div", { class: "page" });
  viewEl.replaceChildren(page);
  async function draw() {
    const [stats, tasks, appts] = await Promise.all([
      api("GET", `/clinics/${state.clinicId}/stats`),
      api("GET", `/clinics/${state.clinicId}/tasks?status=open`),
      api("GET", `/clinics/${state.clinicId}/appointments?days=1`),
    ]).catch((err) => { toast(err.message, true); return []; });
    if (!stats) return;
    const tiles = [
      [stats.needsAttention, "Conversations needing a human"], [stats.openTasks, "Open front-desk tasks"],
      [stats.aiRepliesThisWeek, "AI replies sent (7 days)"], [stats.aiBookingsThisWeek, "Bookings made by AI (7 days)"],
      [stats.bookingsThisWeek, "All bookings (7 days)"], [stats.callsThisWeek, "Calls answered (7 days)"],
      [stats.newLeadsThisWeek, "New leads (7 days)"], [stats.messagesThisWeek, "Messages (7 days)"],
    ];
    page.replaceChildren(
      h("div", { class: "stats" }, tiles.map(([n, l]) => h("div", { class: "stat" }, h("div", { class: "n" }, n), h("div", { class: "l" }, l)))),
      h("div", { class: "grid2" },
        h("div", {}, h("div", { class: "section-title" }, h("h3", {}, "Today's appointments")),
          appts.length ? appts.map((a) => h("div", { class: `appt ${a.status}` }, h("b", {}, fmtTime(a.starts_at), " ", a.contact_name ?? ""),
            h("div", {}, state.clinic.profile.services.find((s) => s.id === a.service_id)?.name ?? a.service_id))) : h("p", { class: "muted" }, "Nothing booked today.")),
        h("div", {}, h("div", { class: "section-title" }, h("h3", {}, "Open tasks"), h("button", { class: "btn small", onclick: () => show("tasks") }, "All tasks")),
          tasks.slice(0, 8).map((t) => taskRow(t, draw)), !tasks.length && h("p", { class: "muted" }, "All caught up.")),
      ),
    );
  }
  refreshers.dashboard = draw;
  draw();
}

// ----------------------------------------------------------------- pipeline

async function viewPipeline() {
  const board = h("div", { class: "kanban" });
  viewEl.replaceChildren(board);
  async function draw() {
    const pipeline = await attempt(() => api("GET", `/clinics/${state.clinicId}/pipeline`));
    if (!pipeline) return;
    board.replaceChildren(...state.clinic.stages.map((stage) => {
      const col = h("div", { class: "col",
        ondragover: (e) => { e.preventDefault(); col.classList.add("over"); },
        ondragleave: () => col.classList.remove("over"),
        ondrop: async (e) => {
          e.preventDefault();
          col.classList.remove("over");
          const id = e.dataTransfer.getData("text/plain");
          await attempt(() => api("PATCH", `/contacts/${id}`, { stage }), `Moved to ${STAGE_LABEL[stage]}`);
          draw();
        } },
      h("h4", {}, STAGE_LABEL[stage], h("span", { class: "badge" }, pipeline[stage].length)),
      pipeline[stage].map((c) => h("div", { class: "kcard", draggable: "true",
        ondragstart: (e) => e.dataTransfer.setData("text/plain", String(c.id)),
        onclick: () => openContactThread(c.id) },
      h("b", {}, contactLabel(c)), h("div", { class: "muted small" }, c.phone ?? c.email ?? ""),
      h("div", { class: "tags" }, c.tags.map((t) => h("span", { class: "tag" }, t))))));
      return col;
    }));
  }
  refreshers.pipeline = draw;
  draw();
}

async function openContactThread(contactId) {
  const conv = await attempt(() => api("POST", `/contacts/${contactId}/conversation`));
  if (!conv) return;
  state.convId = conv.id;
  state.filter = "all";
  show("inbox");
}

// ----------------------------------------------------------------- contacts

async function viewContacts() {
  const page = h("div", { class: "page" });
  const search = h("input", { placeholder: "Search contacts", oninput: () => draw() });
  const tbody = h("tbody");
  const name = h("input", { placeholder: "Full name" });
  const phone = h("input", { placeholder: "Phone" });
  const email = h("input", { placeholder: "Email" });
  page.append(
    h("div", { class: "section-title" }, h("h3", {}, "Contacts"), h("div", { style: { width: "280px" } }, search)),
    h("details", { class: "card" }, h("summary", {}, "+ Add contact"), h("div", { class: "row", style: { marginTop: "8px" } }, name, phone, email,
      h("button", { class: "btn primary", onclick: async () => {
        const ok = await attempt(() => api("POST", `/clinics/${state.clinicId}/contacts`, { name: name.value, phone: phone.value, email: email.value }), "Contact added");
        if (ok) { name.value = phone.value = email.value = ""; draw(); }
      } }, "Add"))),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Name", "Phone", "Email", "Stage", "Tags", ""].map((x) => h("th", {}, x)))), tbody)),
  );
  viewEl.replaceChildren(page);
  async function draw() {
    const contacts = await attempt(() => api("GET", `/clinics/${state.clinicId}/contacts?search=${encodeURIComponent(search.value)}`)) ?? [];
    tbody.replaceChildren(...contacts.map((c) => h("tr", {},
      h("td", {}, h("b", {}, c.name ?? "—"), c.opted_out ? h("span", { class: "pill warn", style: { marginLeft: "6px" } }, "SMS opt-out") : null),
      h("td", {}, c.phone ?? ""), h("td", {}, c.email ?? ""), h("td", {}, STAGE_LABEL[c.stage]),
      h("td", {}, h("div", { class: "tags" }, c.tags.map((t) => h("span", { class: "tag" }, t)))),
      h("td", {}, h("button", { class: "btn small", onclick: () => openContactThread(c.id) }, "Message")),
    )));
  }
  refreshers.contacts = draw;
  draw();
}

// ----------------------------------------------------------------- calendar

async function viewCalendar() {
  const tz = state.clinic.profile.timezone;
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  let start = todayLocal;
  const page = h("div", { class: "page", style: { maxWidth: "none" } });
  viewEl.replaceChildren(page);
  const addDays = (d, n) => { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10); };
  async function draw() {
    const appts = await attempt(() => api("GET", `/clinics/${state.clinicId}/appointments?from=${start}&days=7`)) ?? [];
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const byDay = Object.fromEntries(days.map((d) => [d, []]));
    for (const a of appts) {
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(a.starts_at));
      byDay[d]?.push(a);
    }
    page.replaceChildren(
      h("div", { class: "section-title" },
        h("h3", {}, `Week of ${new Date(`${start}T12:00:00Z`).toLocaleDateString([], { month: "long", day: "numeric", timeZone: "UTC" })}`),
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => { start = addDays(start, -7); draw(); } }, "‹ Prev"),
          h("button", { class: "btn", onclick: () => { start = todayLocal; draw(); } }, "Today"),
          h("button", { class: "btn", onclick: () => { start = addDays(start, 7); draw(); } }, "Next ›"))),
      h("div", { class: "week" }, days.map((d) => h("div", { class: `day${d === todayLocal ? " today" : ""}` },
        h("h4", {}, new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })),
        byDay[d].length ? byDay[d].map((a) => {
          const card = apptCard(a, draw);
          card.prepend(h("div", {}, h("b", {}, a.contact_name ?? "Patient")));
          return card;
        }) : h("div", { class: "muted small" }, "—")))),
    );
  }
  refreshers.calendar = draw;
  draw();
}

// -------------------------------------------------------------------- tasks

async function viewTasks() {
  let status = "open";
  const page = h("div", { class: "page" });
  const listEl = h("div");
  const tabs = h("div", { class: "tabs" }, [["open", "Open"], ["done", "Done"], ["all", "All"]].map(([s, label]) => h("button", {
    class: s === status ? "active" : "", onclick: (e) => { status = s; for (const b of tabs.children) b.classList.remove("active"); e.target.classList.add("active"); draw(); },
  }, label)));
  const title = h("input", { placeholder: "New task for the front desk" });
  page.append(h("div", { class: "section-title" }, tabs),
    h("div", { class: "row", style: { marginBottom: "12px" } }, title, h("button", { class: "btn primary", onclick: async () => {
      if (!title.value.trim()) return;
      await attempt(() => api("POST", `/clinics/${state.clinicId}/tasks`, { title: title.value }), "Task added");
      title.value = "";
      draw();
    } }, "Add")), listEl);
  viewEl.replaceChildren(page);
  async function draw() {
    const tasks = await attempt(() => api("GET", `/clinics/${state.clinicId}/tasks?status=${status}`)) ?? [];
    listEl.replaceChildren(...(tasks.length ? tasks.map((t) => {
      const row = taskRow(t, draw);
      if (t.contact_id) row.append(h("button", { class: "btn small", style: { marginLeft: "auto" }, onclick: () => openContactThread(t.contact_id) }, `Open ${t.contact_name ?? "thread"}`));
      return row;
    }) : [h("p", { class: "muted" }, "Nothing here.")]));
  }
  refreshers.tasks = draw;
  draw();
}

// -------------------------------------------------------------------- calls

async function viewCalls() {
  const page = h("div", { class: "page" });
  viewEl.replaceChildren(page);
  async function draw() {
    const calls = await attempt(() => api("GET", `/clinics/${state.clinicId}/calls`)) ?? [];
    fill(page,
      h("p", { class: "muted" }, "Calls are answered by the ElevenLabs voice agent. Bookings, messages and callbacks it takes appear in the inbox and task list."),
      calls.length ? calls.map((c) => h("div", { class: "card" },
        h("div", { class: "row" }, h("div", {}, h("b", {}, c.contact_name ?? c.from_number ?? "Unknown caller"), h("div", { class: "muted small" }, `${fmtDateTime(c.created_at)} · ${c.duration_s ? `${Math.floor(c.duration_s / 60)}m ${c.duration_s % 60}s` : ""} · ${c.outcome ?? ""}`)),
          c.contact_id && h("button", { class: "btn small", onclick: () => openContactThread(c.contact_id) }, "Open thread")),
        h("p", {}, c.summary ?? ""),
        c.transcript && h("details", {}, h("summary", {}, "Transcript"), h("pre", { class: "code" }, c.transcript)),
      )) : h("p", { class: "muted" }, "No calls yet."),
    );
  }
  refreshers.calls = draw;
  draw();
}

// -------------------------------------------------------------- automations

async function saveProfile(profile, message) {
  const updated = await attempt(() => api("PUT", `/clinics/${state.clinicId}/profile`, profile), message);
  if (updated) state.clinic.profile = updated.profile;
  return updated;
}

function viewAutomations() {
  const page = h("div", { class: "page" });
  viewEl.replaceChildren(page);
  function draw() {
    const profile = state.clinic.profile;
    fill(page,
      h("p", { class: "muted" }, "Workflows run automatically: a trigger, then actions. Message templates can use {{first_name}}, {{appointment_time}}, {{service}}, {{practitioner}}, {{clinic_name}}, {{review_url}} and {{booking_url}}. Patients who texted STOP never receive automated SMS."),
      profile.automations.map((a, i) => {
        const toggle = h("input", { type: "checkbox", checked: a.enabled, onchange: async (e) => {
          const next = structuredClone(profile);
          next.automations[i].enabled = e.target.checked;
          await saveProfile(next, e.target.checked ? "Automation on" : "Automation off");
          draw();
        } });
        return h("div", { class: "card auto" },
          h("label", { class: "switch", style: { margin: "2px 0 0" } }, toggle, h("span", {})),
          h("div", { class: "body" }, h("b", {}, a.name), h("div", { class: "muted small" }, "⚡ ", describeTrigger(a.trigger)),
            h("ol", {}, a.actions.map((x) => h("li", {}, describeAction(x))))));
      }),
      h("details", { class: "card" }, h("summary", {}, "Edit automations as JSON"), automationEditor()),
    );
  }
  function automationEditor() {
    const area = h("textarea", { rows: 18, value: JSON.stringify(state.clinic.profile.automations, null, 2), style: { fontFamily: "monospace", fontSize: "12px", marginTop: "8px" } });
    return h("div", {}, area, h("button", { class: "btn primary", style: { marginTop: "8px" }, onclick: async () => {
      let automations;
      try { automations = JSON.parse(area.value); } catch { return toast("That isn't valid JSON", true); }
      await saveProfile({ ...state.clinic.profile, automations }, "Automations saved");
      draw();
    } }, "Save"));
  }
  refreshers.automations = null;
  draw();
}

// ---------------------------------------------------------------- broadcast

function viewBroadcast() {
  const name = h("input", { placeholder: "e.g. Holiday hours" });
  const stage = h("select", {}, h("option", { value: "" }, "Any stage"), state.clinic.stages.map((s) => h("option", { value: s }, STAGE_LABEL[s])));
  const tag = h("input", { placeholder: "Only contacts with this tag (optional)" });
  const channel = h("select", {}, h("option", { value: "preferred" }, "Each patient's preferred channel"), ["sms", "whatsapp", "email"].map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
  const subject = h("input", { placeholder: "Email subject" });
  const body = h("textarea", { rows: 5, placeholder: "Hi {{first_name}}, ..." });
  const result = h("div");
  viewEl.replaceChildren(h("div", { class: "page", style: { maxWidth: "720px" } },
    h("p", { class: "muted" }, "Send a one-off message to a group of contacts, e.g. holiday hours, a new practitioner, or open spots this week. SMS opt-outs are skipped automatically. In Canada and the US, promotional messages need prior consent (CASL / TCPA)."),
    h("label", {}, "Campaign name"), name,
    h("div", { class: "row" }, h("div", {}, h("label", {}, "Pipeline stage"), stage), h("div", {}, h("label", {}, "Tag"), tag)),
    h("label", {}, "Send via"), channel,
    h("label", {}, "Email subject"), subject,
    h("label", {}, "Message"), body,
    h("div", { style: { marginTop: "12px" } }, h("button", { class: "btn primary", onclick: async () => {
      if (!(await askConfirm("Send this message now to every matching contact?", "Send broadcast"))) return;
      const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/broadcast`, { name: name.value || "Broadcast", stage: stage.value, tag: tag.value.trim().toLowerCase(), channel: channel.value, subject: subject.value, template: body.value }));
      if (r) result.replaceChildren(h("p", { class: "pill live" }, `Sent to ${r.sent} contacts, skipped ${r.skipped}.`));
    } }, "Send broadcast")),
    result,
  ));
  refreshers.broadcast = null;
}

// ------------------------------------------------------------- test console

function viewTest() {
  const channel = h("select", {}, ["sms", "whatsapp", "messenger", "instagram", "email"].map((c) => h("option", { value: c }, CHANNEL_LABEL[c])));
  const from = h("input", { value: "+1 416 555 0199" });
  const name = h("input", { placeholder: "Optional (WhatsApp and email show a name)" });
  const subject = h("input", { placeholder: "Subject" });
  const body = h("textarea", { rows: 3, placeholder: "e.g. Hi, can I book a massage this Saturday?" });
  const subjectWrap = h("div", { class: "hidden" }, h("label", {}, "Email subject"), subject);
  const fromLabel = h("label", {}, "Patient phone number");
  channel.addEventListener("change", () => {
    const c = channel.value;
    subjectWrap.classList.toggle("hidden", c !== "email");
    fromLabel.textContent = { sms: "Patient phone number", whatsapp: "Patient WhatsApp number", messenger: "Messenger user id", instagram: "Instagram user id", email: "Patient email address" }[c];
    from.value = { sms: "+1 416 555 0199", whatsapp: "+1 416 555 0199", messenger: "fb-user-1001", instagram: "ig-user-2002", email: "patient@example.com" }[c];
  });
  const samples = ["Hi, do you have any physio openings this week for my knee?", "How much is a 60 min massage? Do you direct bill Sun Life?", "Is there parking?", "I need to cancel my appointment", "Can I speak to a real person please"];
  viewEl.replaceChildren(h("div", { class: "page", style: { maxWidth: "720px" } },
    h("p", { class: "muted" }, "Send a message as if you were a patient, to try the AI receptionist and automations without connecting real accounts. Replies show up in the Inbox; channels without credentials are marked \"simulated\"."),
    h("div", { class: "row" }, h("div", {}, h("label", {}, "Channel"), channel), h("div", {}, fromLabel, from)),
    h("label", {}, "Patient name"), name,
    subjectWrap,
    h("label", {}, "Message"), body,
    h("div", { class: "tags", style: { margin: "8px 0" } }, samples.map((s) => h("button", { class: "tag", onclick: () => { body.value = s; } }, s))),
    h("button", { class: "btn primary", onclick: async () => {
      const r = await attempt(() => api("POST", `/clinics/${state.clinicId}/simulate`, { channel: channel.value, from: from.value, name: name.value, subject: subject.value, body: body.value }), "Message sent. Opening the conversation…");
      if (r?.conversationId) {
        body.value = "";
        state.convId = r.conversationId;
        state.filter = "all";
        setTimeout(() => show("inbox"), 400);
      }
    } }, "Send as patient"),
    h("h3", { style: { marginTop: "28px" } }, "Try a phone call"),
    h("p", { class: "muted" }, "Phone calls need an ElevenLabs agent connected to a phone number; see Settings → Voice agent. The demo inbox includes a sample call from Tom Becker."),
  ));
  refreshers.test = null;
}

// ----------------------------------------------------------------- settings

function viewSettings() {
  const c = state.clinic;
  const base = location.origin;
  const hooks = [
    ["SMS (Twilio)", `${base}/webhooks/twilio/sms`], ["SMS (Telnyx)", `${base}/webhooks/telnyx/sms`],
    ["WhatsApp / Messenger / Instagram (Meta)", `${base}/webhooks/meta`], ["Email inbound (Postmark)", `${base}/webhooks/email`],
    ["Voice: conversation init (ElevenLabs)", `${base}/webhooks/elevenlabs/init`], ["Voice: post-call (ElevenLabs)", `${base}/webhooks/elevenlabs/post-call`],
    ...(c.edition === "ehr" ? [["EHR events", `${base}/webhooks/ehr`]] : []),
  ];
  const modeSelects = Object.keys(CHANNEL_LABEL).filter((ch) => ch !== "voice").map((ch) => {
    const select = h("select", {}, [["auto", "AI replies automatically"], ["draft", "AI drafts, staff approve"], ["off", "AI off"]].map(([v, l]) => h("option", { value: v, selected: c.profile.aiModes[ch] === v }, l)));
    select.addEventListener("change", async () => {
      await saveProfile({ ...state.clinic.profile, aiModes: { ...state.clinic.profile.aiModes, [ch]: select.value } }, `${CHANNEL_LABEL[ch]}: ${select.selectedOptions[0].textContent}`);
    });
    return h("tr", {}, h("td", {}, chBadge(ch), " ", CHANNEL_LABEL[ch]), h("td", {}, select));
  });
  const profileArea = h("textarea", { rows: 22, value: JSON.stringify({ ...c.profile, automations: undefined }, null, 2), style: { fontFamily: "monospace", fontSize: "12px" } });
  const voiceBox = h("pre", { class: "code" }, "Loading…");
  api("GET", `/clinics/${state.clinicId}/voice-config`).then((cfg) => { voiceBox.textContent = JSON.stringify(cfg, null, 2); }).catch((e) => { voiceBox.textContent = e.message; });

  viewEl.replaceChildren(h("div", { class: "page" },
    h("div", { class: "grid2" },
      h("div", {},
        h("h3", {}, "Channels"),
        h("table", {}, h("tbody", {}, Object.entries(c.channels).map(([ch, status]) => h("tr", {},
          h("td", {}, chBadge(ch), " ", CHANNEL_LABEL[ch]),
          h("td", {}, h("span", { class: `pill ${status === "live" ? "live" : ""}` }, status === "live" ? "● Live" : "Simulated (no credentials)")),
          h("td", { class: "muted small" }, c.accounts.filter((a) => a.channel === ch).map((a) => a.address).join(", ")),
        )))),
        h("h3", {}, "AI receptionist by channel"),
        h("table", {}, h("tbody", {}, modeSelects)),
        h("p", { class: "muted small" }, "Email defaults to draft mode so staff review replies from the general inbox before they go out."),
      ),
      h("div", {},
        h("h3", {}, "Webhook URLs"),
        h("p", { class: "muted small" }, "Paste these into each provider's console. Use your public HTTPS URL (PUBLIC_URL) in production."),
        h("table", {}, h("tbody", {}, hooks.map(([label, url]) => h("tr", {}, h("td", {}, label), h("td", {}, h("code", { class: "small" }, url)))))),
        h("h3", {}, "Edition"),
        h("p", {}, c.edition === "ehr"
          ? "EHR-connected: patients, availability and appointments come from your EHRM through the connector API (see docs/EHR_CONNECTOR_SPEC.md)."
          : `Standalone: this app's own calendar is the source of truth${c.profile.bookingProvider === "jane" ? ", with bookings handed off to Jane App" : ""}.`),
      ),
    ),
    h("h3", {}, "Clinic profile (what the AI knows)"),
    h("p", { class: "muted small" }, "Services, practitioners and their hours, policies and FAQ. The AI answers only from this."),
    profileArea,
    h("button", { class: "btn primary", style: { marginTop: "8px" }, onclick: async () => {
      let profile;
      try { profile = JSON.parse(profileArea.value); } catch { return toast("That isn't valid JSON", true); }
      await saveProfile({ ...profile, automations: state.clinic.profile.automations }, "Clinic profile saved");
    } }, "Save profile"),
    h("h3", {}, "Voice agent (ElevenLabs)"),
    h("p", { class: "muted small" }, "Create an ElevenLabs agent with this prompt and these server tools, connect your clinic phone number to it, and set the two voice webhooks above. Tool calls are authenticated with the x-tool-secret header (ELEVENLABS_TOOL_SECRET)."),
    voiceBox,
  ));
  refreshers.settings = null;
}

boot().catch(() => renderLogin());
