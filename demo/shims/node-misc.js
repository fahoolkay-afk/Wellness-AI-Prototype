// Tiny browser stand-ins for node:fs, node:path, node:url and the Anthropic SDK.
// The demo runs with an in-memory database and the offline demo responder.

export const mkdirSync = () => {};
export const dirname = (p) => p.split("/").slice(0, -1).join("/") || ".";
export const fileURLToPath = (u) => String(u).replace(/^file:\/\//, "");

export default class Anthropic {
  constructor() {
    throw new Error("The browser demo uses the built-in demo responder, not the Claude API");
  }
}
