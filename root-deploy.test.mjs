import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.join(root, "api", "index.js");
const packagePath = path.join(root, "package.json");
const vercelPath = path.join(root, "vercel.json");
const trialWorkerPath = path.join(root, "public", "trial-worker.js");

test("repository root exposes the Vercel API entry", async () => {
  assert.equal(fs.existsSync(apiPath), true, "api/index.js should exist at repository root");
  const api = await import(pathToFileURL(apiPath));
  assert.equal(typeof api.default?.fetch, "function");
});

test("repository root declares an ESM package and verification scripts", () => {
  assert.equal(fs.existsSync(packagePath), true, "package.json should exist at repository root");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.test, "node root-deploy.test.mjs && node vendor/mwi-combat-simulator/trial-worker.test.cjs && node outputs/remote-worker/test/all.mjs && node outputs/milkyway-guild-trial-member.test.js && node outputs/milkyway-guild-trial-allocator.test.js");
  assert.equal(pkg.scripts.check, "node --check api/index.js && node --check outputs/milkyway-guild-trial-member.user.js && node --check outputs/milkyway-guild-trial-allocator.user.js");
});

test("repository root rewrites public v1 routes to the API entry", () => {
  assert.equal(fs.existsSync(vercelPath), true, "vercel.json should exist at repository root");
  const config = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
  assert.equal(config.installCommand, "");
  assert.equal(config.buildCommand, null);
  assert.equal(config.outputDirectory, null);
  assert.deepEqual(config.rewrites, [
    {
      source: "/v1/:path*",
      destination: "/api?__mwi_path=:path",
    },
  ]);
  assert.deepEqual(config.headers, [{
    source: "/trial-worker.js",
    headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
  }]);
});

test("repository root publishes the trial simulation worker", () => {
  assert.equal(fs.existsSync(trialWorkerPath), true, "public/trial-worker.js should exist");
  assert.ok(fs.statSync(trialWorkerPath).size < 1_000_000, "trial worker should load game data at runtime instead of bundling stale copies");
  assert.match(fs.readFileSync(trialWorkerPath, "utf8"), /trial_simulation_result/);
});
