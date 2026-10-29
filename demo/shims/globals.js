// Injected into every module of the browser bundle (esbuild `inject`).
import { Buffer } from "buffer/";

export const process = {
  env: { DB_PATH: ":memory:", STAFF_PASSWORD: "demo", SESSION_SECRET: "browser-demo", PUBLIC_URL: "https://your-clinic-domain.example" },
  loadEnvFile() {
    throw new Error("no .env in the browser");
  },
  argv: [],
};

export { Buffer };
