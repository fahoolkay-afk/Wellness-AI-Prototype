// Injected into every module of the browser bundle (esbuild `inject`).
import { Buffer } from "buffer/";

export const process = {
  env: { DEMO: "1", DB_PATH: ":memory:", PUBLIC_URL: "https://your-clinic-domain.example" },
  loadEnvFile() {
    throw new Error("no .env in the browser");
  },
  argv: [],
};

// The buffer polyfill has no base64url; the app uses it for random tokens.
const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (encoding, ...rest) {
  if (encoding === "base64url") return toString.call(this, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return toString.call(this, encoding, ...rest);
};

export { Buffer };
