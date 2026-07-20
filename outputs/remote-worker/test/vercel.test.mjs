import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.resolve(here, "../src/vercel.js");

test("Vercel adapter exists", () => {
  assert.equal(fs.existsSync(adapterPath), true, "src/vercel.js should exist");
});

if (fs.existsSync(adapterPath)) {
  const { normalizeVercelRequest } = await import(pathToFileURL(adapterPath));
  test("Vercel rewrite metadata restores the public v1 path and query", () => {
    const request = new Request("https://example.vercel.app/api?weekId=2026-07-17&__mwi_path=member/status", {
      headers: { Authorization: "Bearer token" },
    });
    const normalized = normalizeVercelRequest(request);
    const url = new URL(normalized.url);
    assert.equal(url.pathname, "/v1/member/status");
    assert.equal(url.searchParams.get("weekId"), "2026-07-17");
    assert.equal(url.searchParams.has("__mwi_path"), false);
    assert.equal(normalized.headers.get("authorization"), "Bearer token");
  });
}
