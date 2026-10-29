// Tiny browser stand-ins for node:fs, node:path, node:url and the Anthropic SDK.
// The demo runs with an in-memory database and the offline demo responder.

export const mkdirSync = () => {};
export const chmodSync = () => {};
export const existsSync = () => false;
const noFiles = () => { throw new Error("No files in the browser demo"); };
export const readdirSync = noFiles;
export const readFileSync = noFiles;
export const writeFileSync = noFiles;
export const rmSync = noFiles;
export const statSync = noFiles;
export const join = (...parts) => parts.join("/");
export const dirname = (p) => p.split("/").slice(0, -1).join("/") || ".";
export const fileURLToPath = (u) => String(u).replace(/^file:\/\//, "");

export default class Anthropic {
  constructor() {
    throw new Error("The browser demo uses the built-in demo responder, not the Claude API");
  }
}
