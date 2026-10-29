// Routes the staff app's /api calls and live-update stream to the in-browser
// server instead of the network. Imported first so it is in place before the
// staff app starts making requests.

import { dispatch } from "./shims/express.js";

let resolveApp;
const appReady = new Promise((resolve) => { resolveApp = resolve; });
export const setApp = (app) => resolveApp(app);

let sessionCookie = "";

function rememberCookie(setCookie) {
  if (!setCookie) return;
  const [pair] = setCookie.split(";");
  sessionCookie = /Max-Age=0/i.test(setCookie) ? "" : pair;
}

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const app = await appReady;
  const headers = { cookie: sessionCookie };
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
  const res = await dispatch(app, {
    method: (init.method ?? "GET").toUpperCase(),
    url: url.pathname + url.search,
    headers,
    body: init.body ? JSON.parse(init.body) : undefined,
  });
  rememberCookie(res.headers["set-cookie"]);
  return new Response(res.body, { status: res.statusCode, headers: { "content-type": res.headers["content-type"] ?? "text/plain" } });
};

window.EventSource = class DemoEventSource {
  constructor(url) {
    this.readyState = 0;
    appReady.then((app) => {
      if (this.readyState === 2) return;
      let buffer = "";
      dispatch(app, {
        method: "GET", url, headers: { cookie: sessionCookie },
        onClose: (close) => { this.closeStream = close; },
        onWrite: (chunk) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
            if (data) this.onmessage?.({ data });
          }
        },
      });
      this.readyState = 1;
      this.onopen?.();
    });
  }

  close() {
    this.readyState = 2;
    this.closeStream?.();
  }
};

window.__FD_DEMO__ = true;
