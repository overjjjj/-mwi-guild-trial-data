const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class GitHubRepository {
  constructor(env, fetchImpl = fetch) {
    this.env = env;
    this.fetch = fetchImpl;
    this.owner = required(env.GITHUB_OWNER, "GITHUB_OWNER");
    this.repo = required(env.GITHUB_REPO, "GITHUB_REPO");
    this.branch = env.GITHUB_BRANCH || "main";
  }

  async readJson(path) {
    const file = await this.readFile(path);
    if (!file) return null;
    return JSON.parse(file.text);
  }

  async writeJson(path, value) {
    return this.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async list(path) {
    const response = await this.request("GET", path);
    if (response.status === 404) return [];
    const data = await parseResponse(response);
    if (!response.ok) throw githubError(response, data);
    return Array.isArray(data) ? data : [];
  }

  async readFile(path) {
    const response = await this.request("GET", path);
    if (response.status === 404) return null;
    const data = await parseResponse(response);
    if (!response.ok) throw githubError(response, data);
    if (data.type !== "file" || !data.content) throw new Error(`GitHub path is not a file: ${path}`);
    return { text: decoder.decode(base64Decode(data.content.replace(/\s+/g, ""))), sha: data.sha };
  }

  async writeFile(path, text) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.readFile(path);
      const body = {
        message: `Update ${path}`,
        content: base64Encode(encoder.encode(text)),
        branch: this.branch,
        ...(current?.sha ? { sha: current.sha } : {}),
      };
      const response = await this.request("PUT", path, body);
      const data = await parseResponse(response);
      if (response.ok) return data;
      if (response.status !== 409 || attempt === 3) throw githubError(response, data);
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
    throw new Error("GitHub write retry exhausted");
  }

  async request(method, path, body) {
    const token = await this.getAccessToken();
    const encodedPath = String(path).split("/").map(encodeURIComponent).join("/");
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodedPath}`);
    if (method === "GET") url.searchParams.set("ref", this.branch);
    return this.fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "mwi-guild-trial-allocator",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async getAccessToken() {
    return required(this.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  }
}

function required(value, name) {
  if (value == null || String(value).trim() === "") throw new Error(`Missing ${name}`);
  return String(value).trim();
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text };
  }
}

function githubError(response, data) {
  return new Error(`GitHub API ${response.status}: ${data?.message || response.statusText}`);
}

function base64Encode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64Decode(text) {
  const binary = atob(String(text || ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
