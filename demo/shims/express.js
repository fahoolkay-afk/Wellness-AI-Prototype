// Just enough of Express 5 for src/app.ts to run in the browser: routers,
// middleware, params, async error propagation and the response helpers it uses.

function compile(path) {
  const keys = [];
  const pattern = path.replace(/\/:(\w+)/g, (_, key) => {
    keys.push(key);
    return "/([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}/?$`), keys };
}

class Router {
  constructor() {
    this.stack = [];
  }

  use(pathOrHandler, ...handlers) {
    const path = typeof pathOrHandler === "string" ? pathOrHandler : "";
    const fns = typeof pathOrHandler === "string" ? handlers : [pathOrHandler, ...handlers];
    for (const fn of fns) this.stack.push({ use: true, path, fn });
    return this;
  }

  route(method, path, handlers) {
    const { regex, keys } = compile(path);
    for (const fn of handlers) this.stack.push({ method, regex, keys, fn });
    return this;
  }

  get(path, ...h) { return this.route("GET", path, h); }
  post(path, ...h) { return this.route("POST", path, h); }
  put(path, ...h) { return this.route("PUT", path, h); }
  patch(path, ...h) { return this.route("PATCH", path, h); }
  delete(path, ...h) { return this.route("DELETE", path, h); }
  disable() { return this; }
  set() { return this; }

  /** Runs the request through this router's stack; calls done(err) if nothing ends the response. */
  handle(req, res, done) {
    let i = 0;
    const next = (err) => {
      if (res.finished) return;
      const layer = this.stack[i++];
      if (!layer) return done(err);
      let params = {};
      if (layer.use) {
        if (layer.path && !(req.path === layer.path || req.path.startsWith(`${layer.path}/`))) return next(err);
      } else {
        if (layer.method !== req.method) return next(err);
        const m = layer.regex.exec(req.path);
        if (!m) return next(err);
        layer.keys.forEach((k, idx) => { params[k] = decodeURIComponent(m[idx + 1]); });
      }
      const isErrorHandler = layer.fn.length === 4;
      if (err ? !isErrorHandler : isErrorHandler) return next(err);
      req.params = params;
      try {
        if (layer.fn instanceof Router) {
          const saved = req.path;
          req.path = req.path.slice(layer.path.length) || "/";
          return layer.fn.handle(req, res, (e) => { req.path = saved; next(e); });
        }
        const result = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
        if (result && typeof result.then === "function") result.then(undefined, next);
      } catch (e) {
        next(e);
      }
    };
    next();
  }
}

function express() {
  return new Router();
}

const passthrough = () => (_req, _res, next) => next();
express.json = passthrough;
express.urlencoded = passthrough;
express.static = passthrough;
express.Router = () => new Router();

export default express;
export { Router };

/** Builds a request/response pair and runs it through an app. Resolves when the response ends. */
export function dispatch(app, { method, url, headers = {}, body, onWrite, onClose }) {
  const u = new URL(url, "http://demo.local");
  const closeHandlers = [];
  const req = {
    method, url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname,
    query: Object.fromEntries(u.searchParams), headers, body, params: {}, secure: true,
    get: (name) => headers[name.toLowerCase()],
    on: (event, fn) => { if (event === "close") closeHandlers.push(fn); },
  };
  if (onClose) onClose(() => closeHandlers.forEach((fn) => fn()));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, locals: {}, finished: false, body: "",
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      type(t) { this.headers["content-type"] = t.includes("/") ? t : `text/${t}`; return this; },
      json(obj) { this.headers["content-type"] = "application/json"; this.end(JSON.stringify(obj)); },
      send(text) { this.end(String(text)); },
      sendStatus(code) { this.statusCode = code; this.end(String(code)); },
      writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); },
      write(chunk) { onWrite?.(String(chunk)); return true; },
      end(text = "") { if (this.finished) return; this.finished = true; this.body = text; resolve(this); },
    };
    app.handle(req, res, (err) => {
      if (!res.finished) res.status(err ? 500 : 404).json({ error: err ? String(err.message ?? err) : "Not found" });
    });
  });
}
