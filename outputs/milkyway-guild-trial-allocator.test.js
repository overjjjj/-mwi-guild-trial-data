const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const userscriptPath = path.join(__dirname, "milkyway-guild-trial-allocator.user.js");
const source = fs.readFileSync(userscriptPath, "utf8");
for (const id of ["mwi-gta-remote-endpoint", "mwi-gta-remote-guild", "mwi-gta-remote-token"]) {
  assert.match(source, new RegExp(id));
}
assert.equal(source.includes("mwi-gta-remote-output"), false, "member invite output should be removed");
assert.equal(source.includes('data-action="remote-invites"'), false, "member invite action should be removed");
for (const action of ["remote-config", "remote-pull", "remote-publish"]) assert.match(source, new RegExp(`data-action=\\"${action}\\"`));

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
const buildRemoteAssignmentPayload = loadFunction("buildRemoteAssignmentPayload");
const buildRemoteConfigPayload = loadFunction("buildRemoteConfigPayload");
const compareLeximinVectors = loadFunction("compareLeximinVectors");
const chooseLeximinOption = loadFunction("chooseLeximinOption", { compareLeximinVectors });
const scaledGroupStrength = loadFunction("scaledGroupStrength");
const normalizeText = loadFunction("normalizeText");
const normalizeRole = loadFunction("normalizeRole", { normalizeText });
const normalizeDamageType = loadFunction("normalizeDamageType", { normalizeText });
const normalizeMember = loadFunction("normalizeMember", { normalizeRole, normalizeDamageType });
const parseCsvRows = loadFunction("parseCsvRows");
const parseCsv = loadFunction("parseCsv", { parseCsvRows });
const updateCsvMemberSettings = loadFunction("updateCsvMemberSettings", { parseCsvRows, encodeCsvCell: String, normalizeText });
const formatAbilityName = loadFunction("formatAbilityName");
const recommendCombatSkills = loadFunction("recommendCombatSkills", { formatAbilityName, normalizeText });
const hasTestCapacity = (bucket) => bucket && bucket.members.length < bucket.trial.capacity;
const assignLifeByBestSkill = loadFunction("assignLifeByBestSkill", {
  scoreMember: (member, trial) => Number(member.raw[trial.key] || 0),
  trialAvailableCapacity: (trial) => trial.capacity,
  hasCapacity: hasTestCapacity,
  chooseLeximinOption,
  scaledGroupStrength,
  makeSignupChangeReason: () => "",
  assignFallbackMembers: () => {},
});
const assignCombatByBossProfiles = loadFunction("assignCombatByBossProfiles", {
  trialAvailableCapacity: (trial) => trial.capacity,
  matchesPreference: (preference, trial) => preference === trial.key || preference === trial.zh,
  scoreCombatByProfile: (member, trial) => Number(member.raw[trial.key] || 0),
  hasCapacity: hasTestCapacity,
  makeCombatProfileReason: () => "",
  makeSignupChangeReason: () => "",
  canJoinCombat: (_member, bucket) => hasTestCapacity(bucket),
  passesCombatScaling: () => true,
  chooseLeximinOption,
  scaledGroupStrength,
});

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

const remotePayload = buildRemoteAssignmentPayload({
  generatedAt: "2026/7/20 12:00:00",
  lifeAssignments: [{ trial: { key: "foraging", zh: "采摘" }, members: [{ name: "Alice", score: 136, note: "专业最高" }] }],
  combatAssignments: [{ trial: { key: "swarm", zh: "虫群" }, members: [{ name: "Alice", score: 92.4, note: "AOE适配", skills: ["剧毒花粉 70级"] }] }],
}, "guild-1", "2026-07-17", [{ memberId: "m-alice", name: "Alice" }]);
assert.equal(remotePayload.guildId, "guild-1");
assert.equal(remotePayload.members["m-alice"].life.trialKey, "foraging");
assert.equal(remotePayload.members["m-alice"].combat.reason, "AOE适配");
assert.deepEqual(JSON.parse(JSON.stringify(remotePayload.members["m-alice"].combat.skills)), ["剧毒花粉 70级"]);
const remoteConfig = buildRemoteConfigPayload({
  life: [{ key: "foraging", zh: "采摘", capacity: 20, signed: 3 }],
  combat: [{ key: "swarm", zh: "虫群", capacity: 40, signed: 2 }],
}, "guild-1", "2026-07-17", { swarm: { weights: { aoe: 2 } } }, [{ name: "Alice" }, { name: "测试玩家" }, { name: "Alice" }]);
assert.equal(remoteConfig.lifeTrials[0].key, "foraging");
assert.equal(remoteConfig.combatTrials[0].capacity, 40);
assert.deepEqual(JSON.parse(JSON.stringify(remoteConfig.memberNames)), ["Alice", "测试玩家"]);

assert.equal(compareLeximinVectors([20, 100], [20, 90]) > 0, true);
assert.equal(compareLeximinVectors([20, 100], [21, 50]) < 0, true);
const fairnessBuckets = new Map([
  ["left", { fairnessActive: true, members: [{ score: 100 }] }],
  ["right", { fairnessActive: true, members: [{ score: 20 }] }],
]);
const fairnessChoice = chooseLeximinOption([
  { trial: { key: "left" }, score: 90 },
  { trial: { key: "right" }, score: 80 },
], fairnessBuckets, (bucket) => bucket.members.reduce((sum, member) => sum + member.score, 0));
assert.equal(fairnessChoice.trial.key, "right");
assert.equal(scaledGroupStrength({ members: [{ score: 100 }, { score: 100 }] }), 200 / 1.02);

const fixedDebuffer = normalizeMember({ name: "Debuffer", role: "debuff", fixedCombat: "swarm" });
assert.equal(fixedDebuffer.role, "debuff");
assert.equal(fixedDebuffer.fixedCombat, "swarm");
const fixedDebufferZh = normalizeMember({ name: "DebufferZh", role: "减益", "固定战斗试炼": "虫群" });
assert.equal(fixedDebufferZh.role, "debuff");
assert.equal(fixedDebufferZh.fixedCombat, "虫群");

const testTrials = [
  { key: "badger", zh: "獾", capacity: 2 },
  { key: "swarm", zh: "虫群", capacity: 2 },
];
const lifeGroups = assignLifeByBestSkill([
  { name: "LifeA", raw: { badger: 100, swarm: 20 } },
  { name: "LifeB", raw: { badger: 90, swarm: 80 } },
], testTrials);
assert.deepEqual(JSON.parse(JSON.stringify(lifeGroups.map((group) => group.members.map((member) => member.name)))), [["LifeA"], ["LifeB"]]);

const combatGroups = assignCombatByBossProfiles([
  { name: "Fixed", fixedCombat: "swarm", raw: { badger: 100, swarm: 10 } },
  { name: "Flexible", fixedCombat: "", raw: { badger: 90, swarm: 80 } },
], testTrials, {});
assert.deepEqual(JSON.parse(JSON.stringify(combatGroups.map((group) => group.members.map((member) => member.name)))), [["Flexible"], ["Fixed"]]);
assert.match(combatGroups[1].members[0].note, /固定位置/);

const editedCsv = updateCsvMemberSettings("name,combat\nAlice,136", "Alice", {
  role: "debuff",
  fixedCombat: "swarm",
  preferLife: "foraging",
  preferCombat: "swarm",
});
const editedMember = parseCsv(editedCsv)[0];
assert.equal(editedMember.combat, "136");
assert.equal(editedMember.role, "debuff");
assert.equal(editedMember.fixedCombat, "swarm");
assert.equal(editedMember.preferLife, "foraging");

const recommendationProfile = {
  abilities: exported.abilities,
  triggerMap: exported.triggerMap,
};
const swarmSkills = recommendCombatSkills({ role: "debuff" }, { key: "swarm", style: "aoe" }, recommendationProfile);
const badgerSkills = recommendCombatSkills({ role: "dps" }, { key: "badger", style: "single" }, recommendationProfile);
const fallbackSkills = recommendCombatSkills({ role: "dps" }, { key: "swarm", style: "aoe" }, null);
assert.match(swarmSkills[0], /剧毒花粉/);
assert.match(badgerSkills[0], /缠绕/);
assert.equal(swarmSkills.length <= 3, true);
assert.deepEqual(JSON.parse(JSON.stringify(fallbackSkills)), ["全体攻击", "群体治疗", "减益或光环"]);

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
