const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const userscriptPath = path.join(__dirname, "milkyway-guild-trial-allocator.user.js");
const source = fs.readFileSync(userscriptPath, "utf8");
assert.match(source, /@author\s+zc/);
for (const id of ["mwi-gta-remote-endpoint", "mwi-gta-remote-guild", "mwi-gta-remote-token"]) {
  assert.match(source, new RegExp(id));
}
assert.equal(source.includes("mwi-gta-remote-output"), false, "member invite output should be removed");
assert.equal(source.includes('data-action="remote-invites"'), false, "member invite action should be removed");
for (const action of ["remote-config", "remote-pull", "remote-publish"]) assert.match(source, new RegExp(`data-action=\\"${action}\\"`));
assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/overjjjj\/-mwi-guild-trial-data\/main\/outputs\/milkyway-guild-trial-allocator\.user\.js/);
assert.match(source, /data-action="simulate-trials"/);
assert.match(source, /id="mwi-gta-simulation"/);
assert.match(source, /id="mwi-gta-smart-action"/);
assert.match(source, /id="mwi-gta-readiness"/);
assert.match(source, /id="mwi-gta-issues-only"/);
assert.match(source, /const DEFAULT_REMOTE_ENDPOINT = "https:\/\/mwi-guild-trial-data\.vercel\.app"/);
assert.match(source, /id="mwi-gta-guild-setup"/);
for (const id of ["mwi-gta-min-tank", "mwi-gta-min-healer", "mwi-gta-min-debuff", "mwi-gta-connection-backup"]) assert.match(source, new RegExp(`id=\\"${id}\\"`));
for (const action of ["create-guild", "claim-guild", "local-mode", "online-mode", "copy-guild"]) assert.match(source, new RegExp(`data-action=\\"${action}\\"`));
assert.match(source, /data-action="import-connection"/);

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

const abilityMatchesWeapon = loadFunction("abilityMatchesWeapon");
const isHealingAbility = loadFunction("isHealingAbility");
const parseSimulatorExport = loadFunction("parseSimulatorExport", { abilityMatchesWeapon, isHealingAbility });
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
const numberValue = loadFunction("numberValue");
const memberCombatPower = loadFunction("memberCombatPower", { numberValue });
const memberWeaponType = loadFunction("memberWeaponType", { normalizeText });
const isNatureHealer = loadFunction("isNatureHealer", { memberWeaponType, numberValue });
const combatAttributeValue = loadFunction("combatAttributeValue", { numberValue, memberCombatPower, isNatureHealer });
const parseCsvRows = loadFunction("parseCsvRows");
const parseCsv = loadFunction("parseCsv", { parseCsvRows });
const updateCsvMemberSettings = loadFunction("updateCsvMemberSettings", { parseCsvRows, encodeCsvCell: String, normalizeText });
const formatAbilityName = loadFunction("formatAbilityName");
const recommendCombatSkills = loadFunction("recommendCombatSkills", { formatAbilityName, normalizeText, memberWeaponType, abilityMatchesWeapon, isHealingAbility });
const resolveSmartAction = loadFunction("resolveSmartAction");
const resolveConnectionState = loadFunction("resolveConnectionState");
const parseConnectionBackup = loadFunction("parseConnectionBackup");
const selectGuildTrialNavigationTarget = loadFunction("selectGuildTrialNavigationTarget", { normalizeText });
const findTrialMonsterDetails = loadFunction("findTrialMonsterDetails", { normalizeText });
const buildTrialSimulationPlayer = loadFunction("buildTrialSimulationPlayer", { numberValue });
const getMemberIssues = loadFunction("getMemberIssues", { memberWeaponType, normalizeText, numberValue });
const memberMatchesCombatRole = loadFunction("memberMatchesCombatRole", { isNatureHealer });
const assignCombatRoleMinimums = loadFunction("assignCombatRoleMinimums", {
  memberMatchesCombatRole,
  scoreCombatByProfile: (member, trial) => Number(member.raw[trial.key] || 0),
  canJoinCombat: (_member, bucket) => hasTestCapacity(bucket),
  scaledGroupStrength,
  makeCombatProfileReason: () => "属性适配",
  makeSignupChangeReason: () => "",
});
const findCombatRoleWarnings = loadFunction("findCombatRoleWarnings", { memberMatchesCombatRole, normalizeText });
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
  assignCombatRoleMinimums,
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
assert.equal(result.values.role, "healer");
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
  weaponType: "nature",
  abilities: exported.abilities,
  triggerMap: exported.triggerMap,
};
const swarmSkills = recommendCombatSkills({ role: "debuff" }, { key: "swarm", style: "aoe" }, recommendationProfile);
const badgerSkills = recommendCombatSkills({ role: "dps" }, { key: "badger", style: "single" }, recommendationProfile);
const fallbackSkills = recommendCombatSkills({ role: "dps", raw: { weaponType: "nature" } }, { key: "swarm", style: "aoe" }, null);
assert.match(swarmSkills[0], /剧毒花粉/);
assert.match(badgerSkills[0], /缠绕/);
assert.equal(swarmSkills.length <= 3, true);
assert.deepEqual(JSON.parse(JSON.stringify(fallbackSkills)), ["群体法术", "群体治疗", "减益或光环"]);

const fireExport = {
  ...exported,
  player: {
    ...exported.player,
    equipment: exported.player.equipment.map((item) => item.itemLocationHrid === "/item_locations/main_hand"
      ? { ...item, itemHrid: "/items/blazing_staff_refined" }
      : item),
  },
  abilities: [
    { abilityHrid: "/abilities/quick_aid", level: 90 },
    { abilityHrid: "/abilities/fireball", level: 80 },
  ],
  triggerMap: {
    "/abilities/quick_aid": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies" }],
    "/abilities/fireball": [{ dependencyHrid: "/combat_trigger_dependencies/targeted_enemy" }],
  },
};
const fireResult = parseSimulatorExport(JSON.stringify(fireExport));
assert.equal(fireResult.values.weaponType, "fire");
assert.equal(fireResult.values.healer || 0, 0, "非自然职业不能获得治疗评分");
assert.equal(combatAttributeValue(normalizeMember({ name: "Fire", weaponType: "fire", role: "healer", healer: 99, combat: 100 }), "healer", { style: "single" }), 0);
assert.equal(combatAttributeValue(normalizeMember({ name: "Nature", weaponType: "nature", role: "healer", healer: 99, combat: 100 }), "healer", { style: "single" }), 99);
const fireSkills = recommendCombatSkills({ role: "dps", raw: { weaponType: "fire" } }, { key: "jellyfish", style: "single" }, fireResult.profile);
assert.equal(fireSkills.some((skill) => /快速援助|治疗/.test(skill)), false, "非自然职业不能推荐治疗技能");
const fireFallbackSkills = recommendCombatSkills({ role: "dps", raw: { weaponType: "fire" } }, { key: "swarm", style: "aoe" }, null);
assert.equal(fireFallbackSkills.some((skill) => /治疗/.test(skill)), false, "非自然职业的兜底建议不能包含治疗");
const incompatibleFireSkills = recommendCombatSkills({ role: "dps", raw: { weaponType: "fire" } }, { key: "jellyfish", style: "single" }, {
  weaponType: "fire",
  abilities: [{ abilityHrid: "/abilities/quick_aid", level: 90 }],
  triggerMap: { "/abilities/quick_aid": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies" }] },
});
assert.deepEqual(JSON.parse(JSON.stringify(incompatibleFireSkills)), ["单体法术", "减益或控制", "防护或续航"]);
const natureBuffResult = parseSimulatorExport(JSON.stringify({
  ...exported,
  abilities: [{ abilityHrid: "/abilities/battle_shout", level: 88 }],
  triggerMap: {
    "/abilities/battle_shout": [{
      dependencyHrid: "/combat_trigger_dependencies/all_allies",
      conditionHrid: "/combat_trigger_conditions/battle_shout",
    }],
  },
}));
assert.equal(natureBuffResult.values.healer || 0, 0, "普通团队增益不能当成治疗技能");
const fireTeamBuffSkills = recommendCombatSkills({ role: "dps", raw: { weaponType: "fire" } }, { key: "jellyfish", style: "single" }, {
  weaponType: "fire",
  abilities: [{ abilityHrid: "/abilities/battle_shout", level: 88 }],
  triggerMap: {
    "/abilities/battle_shout": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies", conditionHrid: "/combat_trigger_conditions/battle_shout" }],
  },
});
assert.equal(fireTeamBuffSkills.some((skill) => /battle shout/.test(skill)), true, "非治疗团队增益应保留");

const smartBase = { currentWeekId: "2026-07-17", syncedWeekId: "", pulledWeekId: "", publishedWeekId: "" };
assert.equal(resolveSmartAction({ trialsComplete: false, memberCount: 0 }, smartBase, true, false).action, "scan");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 0 }, smartBase, true, false).action, "members");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10 }, smartBase, true, false).action, "remote-config");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10 }, { ...smartBase, syncedWeekId: "2026-07-17" }, true, false).action, "remote-pull");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10 }, { ...smartBase, syncedWeekId: "2026-07-17", pulledWeekId: "2026-07-17" }, true, false).action, "plan");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10 }, { ...smartBase, syncedWeekId: "2026-07-17", pulledWeekId: "2026-07-17" }, true, true).action, "remote-publish");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10 }, smartBase, false, true).label, "重新生成");
assert.equal(resolveSmartAction({ trialsComplete: true, memberCount: 10, connectionRequired: true }, smartBase, false, false).action, "setup");

assert.deepEqual(JSON.parse(JSON.stringify(resolveConnectionState({ remoteMode: "online", remoteGuildId: "", remoteLeaderToken: "" }))), { mode: "setup" });
assert.deepEqual(JSON.parse(JSON.stringify(resolveConnectionState({ remoteMode: "local", remoteGuildId: "", remoteLeaderToken: "" }))), { mode: "local" });
assert.deepEqual(JSON.parse(JSON.stringify(resolveConnectionState({ remoteMode: "local", remoteGuildId: "g-abc", remoteLeaderToken: "g1.g-abc.nonce.signature" }))), { mode: "local", canRestore: true, guildId: "g-abc" });
assert.deepEqual(JSON.parse(JSON.stringify(resolveConnectionState({ remoteMode: "online", remoteGuildId: "g-abc", remoteLeaderToken: "g1.g-abc.nonce.signature" }))), { mode: "connected", guildId: "g-abc" });
assert.deepEqual(JSON.parse(JSON.stringify(resolveConnectionState({ remoteMode: "online", remoteGuildId: "DaisyCamp", remoteLeaderToken: "legacy-secret" }))), { mode: "legacy", guildId: "DaisyCamp" });

assert.deepEqual(JSON.parse(JSON.stringify(parseConnectionBackup(JSON.stringify({
  endpoint: "https://mwi-guild-trial-data.vercel.app/",
  guildId: "g-abc",
  leaderToken: "g1.g-abc.nonce.signature",
})))), {
  endpoint: "https://mwi-guild-trial-data.vercel.app",
  guildId: "g-abc",
  leaderToken: "g1.g-abc.nonce.signature",
});
assert.throws(() => parseConnectionBackup('{"guildId":"g-abc","leaderToken":"g1.g-other.nonce.signature"}'), /管理密钥/);

const navigationTarget = selectGuildTrialNavigationTarget([
  { text: "公会", href: "/guild" },
  { text: "公会试炼", href: "/guild/trials" },
  { text: "个人试炼", href: "/character/trials" },
]);
assert.deepEqual(JSON.parse(JSON.stringify(navigationTarget)), { text: "公会试炼", href: "/guild/trials" });
assert.deepEqual(JSON.parse(JSON.stringify(selectGuildTrialNavigationTarget([{ text: "公会", href: "/guild" }]))), { text: "公会", href: "/guild" });

const trialMonsters = findTrialMonsterDetails({
  "/monsters/badger": { hrid: "/monsters/badger", name: "Badger" },
  "/monsters/guild_trial_badger": { hrid: "/monsters/guild_trial_badger", name: "Trial Badger" },
  "/monsters/guild_trial_swarm_beetle": { hrid: "/monsters/guild_trial_swarm_beetle", name: "Trial Swarm Beetle" },
}, { key: "badger", zh: "獾", aliases: ["Badger", "试炼獾"] });
assert.deepEqual(JSON.parse(JSON.stringify(trialMonsters.map((monster) => monster.hrid))), ["/monsters/guild_trial_badger"]);

const simulationPlayer = buildTrialSimulationPlayer(normalizeMember({
  name: "NatureMage", staminaLevel: 120, intelligenceLevel: 130, attackLevel: 20,
  meleeLevel: 20, defenseLevel: 115, rangedLevel: 10, magicLevel: 140,
}), {
  player: { equipment: [{ itemLocationHrid: "/item_locations/main_hand", itemHrid: "/items/nature_staff", enhancementLevel: 9 }] },
  abilities: [{ abilityHrid: "/abilities/rejuvenate", level: 42 }],
  triggerMap: { "/abilities/rejuvenate": [{ dependencyHrid: "/combat_trigger_dependencies/lowest_hp_ally", conditionHrid: "/combat_trigger_conditions/current_hp", comparatorHrid: "/combat_trigger_comparators/less_than_equal", value: 0.7 }] },
  houseRooms: { "/house_rooms/observatory": 12 },
}, 3);
assert.equal(simulationPlayer.hrid, "player3");
assert.equal(simulationPlayer.magicLevel, 140);
assert.equal(simulationPlayer.equipment["/equipment_types/main_hand"].hrid, "/items/nature_staff");
assert.equal(simulationPlayer.abilities[0].triggers[0].value, 0.7);
assert.deepEqual(JSON.parse(JSON.stringify(simulationPlayer.food)), [null, null, null]);
assert.deepEqual(JSON.parse(JSON.stringify(simulationPlayer.drinks)), [null, null, null]);

const roleTrials = [{ key: "alpha", zh: "甲", capacity: 10 }, { key: "beta", zh: "乙", capacity: 10 }];
const roleBuckets = new Map(roleTrials.map((trial) => [trial.key, { trial, members: [], fairnessActive: true }]));
const roleMembers = [
  normalizeMember({ name: "TankA", role: "tank", alpha: 90, beta: 20 }),
  normalizeMember({ name: "TankB", role: "tank", alpha: 30, beta: 85 }),
  normalizeMember({ name: "HealA", role: "healer", weaponType: "nature", healer: 80, alpha: 80, beta: 25 }),
  normalizeMember({ name: "HealB", role: "healer", weaponType: "nature", healer: 82, alpha: 20, beta: 82 }),
  normalizeMember({ name: "DebuffA", role: "debuff", alpha: 75, beta: 20 }),
  normalizeMember({ name: "DebuffB", role: "debuff", alpha: 20, beta: 78 }),
];
const roleAssigned = assignCombatRoleMinimums(roleMembers, roleBuckets, roleTrials, {}, { tank: 1, healer: 1, debuff: 1 }, new Set());
assert.equal(roleAssigned.size, 6);
assert.deepEqual([...roleBuckets.values()].map((bucket) => bucket.members.length), [3, 3]);
assert.equal([...roleBuckets.values()].every((bucket) => bucket.members.every((member) => /最低配置/.test(member.note))), true);
assert.deepEqual(JSON.parse(JSON.stringify(findCombatRoleWarnings([...roleBuckets.values()], roleMembers.filter((member) => member.name !== "HealB"), { tank: 1, healer: 1, debuff: 1 }))), ["乙：治疗 0/1"]);

const issueTrials = { combat: [{ key: "swarm", zh: "虫群" }] };
const incompleteIssues = getMemberIssues(normalizeMember({ name: "Missing" }), issueTrials, null, [], false);
assert.deepEqual(JSON.parse(JSON.stringify(incompleteIssues)), ["missing-profession", "missing-skills"]);
const conflictIssues = getMemberIssues(normalizeMember({ name: "FireHeal", weaponType: "fire", role: "healer", abilityCount: 2, fixedCombat: "badger" }), issueTrials, null, [], true);
assert.deepEqual(JSON.parse(JSON.stringify(conflictIssues)), ["healer-class", "fixed-trial", "not-uploaded"]);
const natureIssues = getMemberIssues(normalizeMember({ name: "NatureHeal", weaponType: "nature", role: "healer", abilityCount: 2, healer: 0 }), issueTrials, null, ["NatureHeal"], true);
assert.deepEqual(JSON.parse(JSON.stringify(natureIssues)), ["healer-skill"]);

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
