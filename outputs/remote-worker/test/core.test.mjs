import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const corePath = path.resolve(here, "../src/core.js");

test("remote worker core exists", () => {
  assert.equal(fs.existsSync(corePath), true, "src/core.js should exist");
});

if (fs.existsSync(corePath)) {
  const core = await import(pathToFileURL(corePath));

  test("week id resets on Friday 00:00 UTC", () => {
    assert.equal(core.getWeekId(new Date("2026-07-20T02:00:00Z")), "2026-07-17");
    assert.equal(core.getWeekId(new Date("2026-07-17T00:00:00Z")), "2026-07-17");
    assert.equal(core.getWeekId(new Date("2026-07-16T23:59:59Z")), "2026-07-10");
  });

  test("member ids derived from names are deterministic and path safe", async () => {
    const first = await core.deriveMemberId("测试 Player");
    const second = await core.deriveMemberId("测试 Player");
    assert.equal(first, second);
    assert.match(first, /^m-[a-f0-9]{20}$/);
  });

  test("member tokens are signed, scoped and expire", async () => {
    const now = Date.parse("2026-07-20T00:00:00Z");
    const token = await core.createMemberToken("invite-secret", {
      guildId: "guild-1",
      memberId: "member-1",
      name: "Alice",
    }, now, 60_000);
    const payload = await core.verifyMemberToken("invite-secret", token, now + 30_000);
    assert.equal(payload.guildId, "guild-1");
    assert.equal(payload.memberId, "member-1");
    assert.equal(payload.name, "Alice");
    await assert.rejects(() => core.verifyMemberToken("invite-secret", `${token}x`, now), /token/i);
    await assert.rejects(() => core.verifyMemberToken("invite-secret", token, now + 60_001), /expired/i);
  });

  test("member uploads are minimized and bound to the signed identity", () => {
    const normalized = core.normalizeMemberProfile({
      name: "ForgedName",
      values: { combatLevel: 136, magic: 142, unknown: 999 },
      lifeSkills: { foraging: 136, unknownSkill: 200 },
      equipment: Array.from({ length: 40 }, (_, index) => ({ itemHrid: `/items/item_${index}`, enhancementLevel: index })),
      abilities: [{ abilityHrid: "/abilities/entangle", level: 73 }],
      food: { combat: ["secret-food"] },
      drinks: { combat: ["secret-drink"] },
      achievements: { hidden: true },
    }, {
      guildId: "guild-1",
      memberId: "member-1",
      name: "Alice",
    }, "2026-07-20T00:00:00.000Z");

    assert.equal(normalized.name, "Alice");
    assert.equal(normalized.guildId, "guild-1");
    assert.equal(normalized.values.combatLevel, 136);
    assert.equal(normalized.values.unknown, undefined);
    assert.deepEqual(normalized.lifeSkills, { foraging: 136 });
    assert.equal(normalized.equipment.length, 32);
    assert.equal("food" in normalized, false);
    assert.equal("drinks" in normalized, false);
    assert.equal("achievements" in normalized, false);
  });

  test("member status only selects the caller assignment", () => {
    const assignment = {
      members: {
        "m-1": { name: "Alice", life: { trialKey: "foraging" } },
        "m-2": { name: "Bob", combat: { trialKey: "swarm" } },
      },
    };
    assert.deepEqual(core.selectMemberAssignment(assignment, { memberId: "m-1", name: "Alice" }), assignment.members["m-1"]);
    assert.equal(core.selectMemberAssignment(assignment, { memberId: "m-3", name: "Carol" }), null);
  });
}
