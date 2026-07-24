import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Robinhood's agentic OAuth only accepts a loopback redirect, which is why this
// service has to complete the flow on a desktop once and then reuse the stored
// refresh token. There is no way to authorize a remote server on demand.
export class RobinhoodAuthProvider {
  constructor({ tokenFile, callbackPort = 41999, clientId = "", clientSecret = "" }) {
    this.tokenFile = tokenFile;
    this.callbackPort = callbackPort;
    this.staticClient = clientId ? { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) } : null;
    this.cache = null;
  }

  get redirectUrl() {
    return `http://localhost:${this.callbackPort}/callback`;
  }

  get clientMetadata() {
    return {
      client_name: "xbot",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post"
    };
  }

  async state() {
    const state = crypto.randomUUID();
    await this.patch({ state });
    return state;
  }

  async clientInformation() {
    if (this.staticClient) return this.staticClient;
    return (await this.read()).clientInformation ?? undefined;
  }

  async saveClientInformation(clientInformation) {
    await this.patch({ clientInformation });
  }

  async tokens() {
    return (await this.read()).tokens ?? undefined;
  }

  async saveTokens(tokens) {
    await this.patch({ tokens });
  }

  async saveCodeVerifier(codeVerifier) {
    await this.patch({ codeVerifier });
  }

  async codeVerifier() {
    const { codeVerifier } = await this.read();
    if (!codeVerifier) throw new Error("Missing PKCE code verifier. Run `npm run robinhood:login` again.");
    return codeVerifier;
  }

  async invalidateCredentials(scope) {
    const current = await this.read();
    if (scope === "all") return this.write({});
    delete current[{ tokens: "tokens", client: "clientInformation", verifier: "codeVerifier" }[scope] ?? scope];
    await this.write(current);
  }

  // The SDK calls this during connect(); the interactive login command below
  // is what actually waits for the resulting code.
  async redirectToAuthorization(authorizationUrl) {
    this.pendingAuthorizationUrl = authorizationUrl;
    if (this.interactive) await openBrowser(authorizationUrl.toString());
  }

  // Serves the loopback redirect exactly once and resolves with the code.
  waitForAuthorizationCode({ signal } = {}) {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url, this.redirectUrl);
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:40px">
          <h1>${code ? "Robinhood connected" : "Authorization failed"}</h1>
          <p>${code ? "You can close this tab and return to your terminal." : escapeHtml(error ?? "No authorization code was returned.")}</p>`);
        server.close();
        if (code) resolve(code);
        else reject(new Error(`Robinhood authorization failed: ${error ?? "no code returned"}`));
      });
      server.on("error", reject);
      server.listen(this.callbackPort);
      signal?.addEventListener("abort", () => {
        server.close();
        reject(new Error("Timed out waiting for Robinhood authorization."));
      });
    });
  }

  async read() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.tokenFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.cache = {};
    }
    return this.cache;
  }

  async patch(values) {
    await this.write({ ...(await this.read()), ...values });
  }

  async write(data) {
    this.cache = data;
    await mkdir(dirname(this.tokenFile), { recursive: true });
    // Refresh tokens grant trading access, so never widen these permissions.
    await writeFile(this.tokenFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
}

async function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Falling back to the printed URL is fine; headless hosts have no browser.
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
