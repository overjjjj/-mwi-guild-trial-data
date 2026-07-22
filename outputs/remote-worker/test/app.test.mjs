import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(here, "../src/app.js");

test("worker application exists", () => {
  assert.equal(fs.existsSync(appPath), true, "src/app.js should exist");
});

if (fs.existsSync(appPath)) {
  const { createWorkerApp } = await import(pathToFileURL(appPath));

  class FakeRepository {
    constructor() { this.files = new Map(); }
    async writeJson(filePath, value) { this.files.set(filePath, structuredClone(value)); }
    async readJson(filePath) { return this.files.has(filePath) ? structuredClone(this.files.get(filePath)) : null; }
    async list(directory) {
      const prefix = `${directory.replace(/\/$/, "")}/`;
      return [...this.files.keys()].filter((key) => key.startsWith(prefix)).map((filePath) => ({ type: "file", path: filePath }));
    }
  }

  test("roster name matching, upload, aggregate and member status work end to end", async () => {
    const repository = new FakeRepository();
    const app = createWorkerApp({
      LEADER_TOKEN: "leader-secret",
      ALLOWED_ORIGINS: "https://www.milkywayidlecn.com",
    }, { repository, now: () => Date.parse("2026-07-20T00:00:00Z") });

    const configResponse = await app.fetch(new Request("https://worker.test/v1/leader/config", {
      method: "PUT",
      headers: { Authorization: "Bearer leader-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        weekId: "2026-07-17",
        memberNames: ["Alice"],
        lifeTrials: [{ key: "foraging", zh: "采摘" }],
        combatTrials: [{ key: "swarm", zh: "虫群" }],
      }),
    }));
    assert.equal(configResponse.status, 200);

    const uploadResponse = await app.fetch(new Request("https://worker.test/v1/member/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", weekId: "2026-07-17", profile: { name: "alice", values: { combatLevel: 136 }, lifeSkills: { foraging: 136 } } }),
    }));
    assert.equal(uploadResponse.status, 200);
    const upload = await uploadResponse.json();
    assert.equal(upload.memberId.startsWith("m-"), true);

    const rejectedResponse = await app.fetch(new Request("https://worker.test/v1/member/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", weekId: "2026-07-17", profile: { name: "Bob" } }),
    }));
    assert.equal(rejectedResponse.status, 403);

    const submissionsResponse = await app.fetch(new Request("https://worker.test/v1/leader/submissions?guildId=guild-1&weekId=2026-07-17", {
      headers: { Authorization: "Bearer leader-secret" },
    }));
    const submissions = await submissionsResponse.json();
    assert.equal(submissions.members.length, 1);
    assert.equal(submissions.members[0].name, "Alice");

    await app.fetch(new Request("https://worker.test/v1/leader/assignment", {
      method: "PUT",
      headers: { Authorization: "Bearer leader-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        weekId: "2026-07-17",
        members: {
          [upload.memberId]: { name: "Alice", life: { trialKey: "foraging" }, combat: { trialKey: "swarm", skills: ["剧毒花粉 70级", "群体治疗"] } },
          "m-other": { name: "Bob", combat: { trialKey: "swarm" } },
        },
      }),
    }));

    const statusResponse = await app.fetch(new Request("https://worker.test/v1/member/status?guildId=guild-1&name=alice&weekId=2026-07-17", {
      headers: { Origin: "https://www.milkywayidlecn.com" },
    }));
    assert.equal(statusResponse.headers.get("access-control-allow-origin"), "https://www.milkywayidlecn.com");
    const status = await statusResponse.json();
    assert.equal(status.assignment.name, "Alice");
    assert.deepEqual(status.assignment.combat.skills, ["剧毒花粉 70级", "群体治疗"]);
    assert.equal(JSON.stringify(status).includes("Bob"), false);
    assert.equal(status.config.combatTrials[0].key, "swarm");
  });

  test("public guild creation issues an isolated leader credential without writing storage", async () => {
    const repository = new FakeRepository();
    const app = createWorkerApp({ LEADER_TOKEN: "master-secret" }, { repository, now: () => Date.parse("2026-07-20T00:00:00Z") });

    const createResponse = await app.fetch(new Request("https://worker.test/v1/guilds", { method: "POST" }));
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.match(created.guildId, /^g-[a-f0-9]{16}$/);
    assert.match(created.leaderToken, new RegExp(`^g1\\.${created.guildId}\\.`));
    assert.equal(repository.files.size, 0, "creating an unused guild should not create GitHub commits");

    const ownConfig = await app.fetch(new Request("https://worker.test/v1/leader/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${created.leaderToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: created.guildId, weekId: "2026-07-17", memberNames: ["Alice"] }),
    }));
    assert.equal(ownConfig.status, 200);

    const crossGuild = await app.fetch(new Request("https://worker.test/v1/leader/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${created.leaderToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "g-other", weekId: "2026-07-17", memberNames: ["Mallory"] }),
    }));
    assert.equal(crossGuild.status, 401);
    assert.equal(await repository.readJson("guilds/g-other/weeks/2026-07-17/config.json"), null);
  });

  test("legacy leader can claim a guild-specific credential", async () => {
    const repository = new FakeRepository();
    const app = createWorkerApp({ LEADER_TOKEN: "master-secret" }, { repository, now: () => Date.parse("2026-07-20T00:00:00Z") });

    const denied = await app.fetch(new Request("https://worker.test/v1/guilds/claim", {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "DaisyCamp" }),
    }));
    assert.equal(denied.status, 401);

    const claimResponse = await app.fetch(new Request("https://worker.test/v1/guilds/claim", {
      method: "POST",
      headers: { Authorization: "Bearer master-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "DaisyCamp" }),
    }));
    assert.equal(claimResponse.status, 200);
    const claimed = await claimResponse.json();
    assert.equal(claimed.guildId, "DaisyCamp");
    assert.equal(await coreCredentialWorks(app, claimed.leaderToken, "DaisyCamp"), true);
  });

  async function coreCredentialWorks(app, token, guildId) {
    const response = await app.fetch(new Request("https://worker.test/v1/leader/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ guildId, weekId: "2026-07-17", memberNames: ["Alice"] }),
    }));
    return response.ok;
  }
}
