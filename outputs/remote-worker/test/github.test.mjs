import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const githubPath = path.resolve(here, "../src/github.js");

test("GitHub repository adapter exists", () => {
  assert.equal(fs.existsSync(githubPath), true, "src/github.js should exist");
});

if (fs.existsSync(githubPath)) {
  const { GitHubRepository } = await import(pathToFileURL(githubPath));

  test("repository adapter writes, reads and lists plaintext JSON", async () => {
    const files = new Map();
    const fakeFetch = async (url, init = {}) => {
      const parsed = new URL(url);
      const marker = "/contents/";
      const pathIndex = parsed.pathname.indexOf(marker);
      const filePath = decodeURIComponent(parsed.pathname.slice(pathIndex + marker.length));
      if ((init.method || "GET") === "PUT") {
        const body = JSON.parse(init.body);
        files.set(filePath, { content: body.content, sha: `sha-${files.size + 1}` });
        return Response.json({ content: { path: filePath }, commit: { sha: files.get(filePath).sha } }, { status: 201 });
      }
      if (files.has(filePath)) {
        const file = files.get(filePath);
        return Response.json({ type: "file", ...file });
      }
      const prefix = `${filePath.replace(/\/$/, "")}/`;
      const children = [...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({
        type: "file",
        name: key.slice(prefix.length),
        path: key,
      }));
      if (children.length) return Response.json(children);
      return Response.json({ message: "Not Found" }, { status: 404 });
    };
    const repository = new GitHubRepository({
      GITHUB_TOKEN: "test-token",
      GITHUB_OWNER: "owner",
      GITHUB_REPO: "repo",
      GITHUB_BRANCH: "main",
    }, fakeFetch);

    await repository.writeJson("guilds/g1/member.json", { name: "Alice" });
    assert.deepEqual(await repository.readJson("guilds/g1/member.json"), { name: "Alice" });
    assert.match(Buffer.from(files.get("guilds/g1/member.json").content, "base64").toString("utf8"), /Alice/);
    const listed = await repository.list("guilds/g1");
    assert.equal(listed[0].path, "guilds/g1/member.json");
  });

  test("repository adapter requires a server-side GitHub token", async () => {
    const repository = new GitHubRepository({ GITHUB_OWNER: "owner", GITHUB_REPO: "repo" }, async () => Response.json({}));
    await assert.rejects(() => repository.list("guilds/g1"), /GITHUB_TOKEN/);
  });
}
