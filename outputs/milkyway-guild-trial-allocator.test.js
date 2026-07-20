const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const userscriptPath = path.join(__dirname, "milkyway-guild-trial-allocator.user.js");
const source = fs.readFileSync(userscriptPath, "utf8");
for (const id of ["mwi-gta-remote-endpoint", "mwi-gta-remote-guild", "mwi-gta-remote-token", "mwi-gta-remote-output"]) {
  assert.match(source, new RegExp(id));
}
for (const action of ["remote-invites", "remote-config", "remote-pull", "remote-publish"]) assert.match(source, new RegExp(`data-action=\\"${action}\\"`));

function loadFunction(name, context = {}) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist in the userscript`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      const functionSource = source.slice(start, index + 1);
      return vm.runInNewContext(`(${functionSource})`, context);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const parseSimulatorExport = loadFunction("parseSimulatorExport");
const buildSimulatorImportRecord = loadFunction("buildSimulatorImportRecord", { parseSimulatorExport });
const buildRemoteInviteMembers = loadFunction("buildRemoteInviteMembers");
const buildRemoteAssignmentPayload = loadFunction("buildRemoteAssignmentPayload");
const buildRemoteConfigPayload = loadFunction("buildRemoteConfigPayload");

const exported = {
  player: {
    meleeLevel: 31,
    defenseLevel: 133,
    magicLevel: 142,
    rangedLevel: 1,
    attackLevel: 130,
    intelligenceLevel: 120,
    staminaLevel: 130,
    equipment: [
      { itemLocationHrid: "/item_locations/alchemy_tool", itemHrid: "/items/crimson_alembic", enhancementLevel: 0 },
      { itemLocationHrid: "/item_locations/main_hand", itemHrid: "/items/blooming_trident_refined", enhancementLevel: 12 },
      { itemLocationHrid: "/item_locations/off_hand", itemHrid: "/items/bishops_codex_refined", enhancementLevel: 10 },
    ],
  },
  food: { "/action_types/combat": [{ itemHrid: "/items/spaceberry_donut" }] },
  drinks: { "/action_types/combat": [{ itemHrid: "/items/ultra_magic_coffee" }] },
  abilities: [
    { abilityHrid: "/abilities/mystic_aura", level: 49 },
    { abilityHrid: "/abilities/quick_aid", level: 62 },
    { abilityHrid: "/abilities/natures_veil", level: 70 },
    { abilityHrid: "/abilities/toxic_pollen", level: 70 },
    { abilityHrid: "/abilities/entangle", level: 73 },
  ],
  triggerMap: {
    "/abilities/quick_aid": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies" }],
    "/abilities/natures_veil": [{ dependencyHrid: "/combat_trigger_dependencies/all_enemies" }],
    "/abilities/toxic_pollen": [{ dependencyHrid: "/combat_trigger_dependencies/all_enemies" }],
    "/abilities/entangle": [{ dependencyHrid: "/combat_trigger_dependencies/targeted_enemy" }],
    "/items/spaceberry_donut": [{ dependencyHrid: "/combat_trigger_dependencies/self" }],
  },
  houseRooms: { "/house_rooms/armory": 6, "/house_rooms/mystical_study": 8 },
  unknownFutureField: { ignored: true },
};

const result = parseSimulatorExport(JSON.stringify(exported));
assert.equal(result.name, "");
assert.equal(result.values.combatLevel, 136);
assert.equal(result.values.combat, 136);
assert.equal(result.values.magicLevel, 142);
assert.equal(result.values.weaponType, "nature");
assert.equal(result.values.damageType, "magic");
assert.equal(result.values.magic, 142);
assert.equal(result.values.equipmentCount, 3);
assert.equal(result.values.combatEquipmentCount, 2);
assert.equal(result.values.maxEnhancement, 12);
assert.equal(result.values.abilityCount, 5);
assert.equal(result.values.maxAbilityLevel, 73);
assert.equal(result.values.aoe, 70);
assert.equal(result.values.single, 73);
assert.equal(result.values.healer, 62);
assert.equal(result.values.support, 70);
assert.equal(result.values.combatHouseLevelSum, 14);
assert.equal("food" in result.profile, false);
assert.equal("drinks" in result.profile, false);
assert.equal("unknownFutureField" in result.profile, false);

const named = parseSimulatorExport(JSON.stringify({ ...exported, characterName: "ExamplePlayer", totalLevel: 1773, combatLevel: 150 }));
assert.equal(named.name, "ExamplePlayer");
assert.equal(named.values.level, 1773);
assert.equal(named.values.combatLevel, 150);

assert.throws(() => parseSimulatorExport("{}"), /player/i);
assert.throws(() => parseSimulatorExport("not json"), /JSON/i);

const manualBinding = buildSimulatorImportRecord(JSON.stringify(exported), "ManualPlayer", "ProfilePlayer");
assert.equal(manualBinding.name, "ManualPlayer");
const profileBinding = buildSimulatorImportRecord(JSON.stringify(exported), "", "ProfilePlayer");
assert.equal(profileBinding.name, "ProfilePlayer");
assert.throws(() => buildSimulatorImportRecord(JSON.stringify(exported), "", ""), /成员名/);
assert.throws(() => buildSimulatorImportRecord(JSON.stringify({ ...exported, characterName: "ExportedPlayer" }), "OtherPlayer", ""), /不一致/);

assert.deepEqual(JSON.parse(JSON.stringify(buildRemoteInviteMembers(
  [{ name: "Alice" }, { name: "测试玩家" }],
  { alice: { characterId: 12345 } },
))), [{ name: "Alice", memberId: "12345" }, { name: "测试玩家" }]);

const remotePayload = buildRemoteAssignmentPayload({
  generatedAt: "2026/7/20 12:00:00",
  lifeAssignments: [{ trial: { key: "foraging", zh: "采摘" }, members: [{ name: "Alice", score: 136, note: "专业最高" }] }],
  combatAssignments: [{ trial: { key: "swarm", zh: "虫群" }, members: [{ name: "Alice", score: 92.4, note: "AOE适配" }] }],
}, "guild-1", "2026-07-17", [{ memberId: "m-alice", name: "Alice" }]);
assert.equal(remotePayload.guildId, "guild-1");
assert.equal(remotePayload.members["m-alice"].life.trialKey, "foraging");
assert.equal(remotePayload.members["m-alice"].combat.reason, "AOE适配");
const remoteConfig = buildRemoteConfigPayload({
  life: [{ key: "foraging", zh: "采摘", capacity: 20, signed: 3 }],
  combat: [{ key: "swarm", zh: "虫群", capacity: 40, signed: 2 }],
}, "guild-1", "2026-07-17", { swarm: { weights: { aoe: 2 } } });
assert.equal(remoteConfig.lifeTrials[0].key, "foraging");
assert.equal(remoteConfig.combatTrials[0].capacity, 40);

console.log("simulator import tests passed");

if (process.argv[2]) {
  const imported = parseSimulatorExport(fs.readFileSync(process.argv[2], "utf8"));
  console.log(JSON.stringify({
    name: imported.name,
    values: imported.values,
    profileEquipment: imported.profile.player.equipment.length,
    profileAbilities: imported.profile.abilities.length,
    triggerKeys: Object.keys(imported.profile.triggerMap),
    hasFood: Object.hasOwn(imported.profile, "food"),
    hasDrinks: Object.hasOwn(imported.profile, "drinks"),
  }, null, 2));
}

module.exports = { parseSimulatorExport, buildSimulatorImportRecord };
