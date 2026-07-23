const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const userscriptPath = path.join(__dirname, "milkyway-guild-trial-member.user.js");
assert.equal(fs.existsSync(userscriptPath), true, "member userscript should exist");
const source = fs.readFileSync(userscriptPath, "utf8");
assert.match(source, /@author\s+zc/);
for (const id of ["mwi-gtm-launcher", "mwi-gtm-panel", "mwi-gtm-endpoint", "mwi-gtm-guild"]) {
  assert.equal((source.match(new RegExp(id, "g")) || []).length >= 1, true, `${id} should be present`);
}
assert.equal(source.includes("mwi-gtm-token"), false, "member token field should be removed");
for (const action of ["read", "upload", "refresh"]) assert.match(source, new RegExp(`data-action=\\"${action}\\"`));
assert.match(source, /技能建议/);
assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/overjjjj\/-mwi-guild-trial-data\/main\/outputs\/milkyway-guild-trial-member\.user\.js/);
assert.match(source, /const DEFAULT_REMOTE_ENDPOINT = "https:\/\/mwi-guild-trial-data\.vercel\.app"/);

function loadFunction(name, context = {}) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
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
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return vm.runInNewContext(`(${source.slice(start, index + 1)})`, context);
  }
  throw new Error(`Could not extract ${name}`);
}

const abilityMatchesWeapon = loadFunction("abilityMatchesWeapon");
const isHealingAbility = loadFunction("isHealingAbility");
const buildMemberProfile = loadFunction("buildMemberProfile", { abilityMatchesWeapon, isHealingAbility });
const calculatePersonalRecommendations = loadFunction("calculatePersonalRecommendations");
const normalizeMemberIdentity = loadFunction("normalizeMemberIdentity");

const identity = normalizeMemberIdentity(" guild-cn-1 ", " Alice ");
assert.equal(identity.guildId, "guild-cn-1");
assert.equal(identity.name, "Alice");
assert.throws(() => normalizeMemberIdentity("bad guild", "Alice"), /公会编号/);
assert.throws(() => normalizeMemberIdentity("guild-cn-1", ""), /角色/);

const skills = {
  melee: 31, defense: 133, magic: 142, ranged: 1, attack: 130,
  intelligence: 120, stamina: 130, foraging: 136, woodcutting: 104,
};
const raw = {
  type: "init_character_data",
  characterName: "Alice",
  characterSkills: Object.entries(skills).map(([name, level]) => ({ skillHrid: `/skills/${name}`, level })),
  characterItems: [
    { itemLocationHrid: "/item_locations/main_hand", itemHrid: "/items/blooming_trident_refined", enhancementLevel: 12 },
    { itemLocationHrid: "/item_locations/alchemy_tool", itemHrid: "/items/crimson_alembic", enhancementLevel: 3 },
    { itemLocationHrid: "/item_locations/inventory", itemHrid: "/items/coin", enhancementLevel: 0 },
  ],
  combatUnit: { combatAbilities: [
    { abilityHrid: "/abilities/toxic_pollen", level: 70 },
    { abilityHrid: "/abilities/entangle", level: 73 },
  ] },
  abilityCombatTriggersMap: {
    "/abilities/toxic_pollen": [{ dependencyHrid: "/combat_trigger_dependencies/all_enemies" }],
    "/abilities/entangle": [{ dependencyHrid: "/combat_trigger_dependencies/targeted_enemy" }],
  },
  characterHouseRoomMap: {
    armory: { houseRoomHrid: "/house_rooms/armory", level: 6 },
  },
  actionTypeFoodSlotsMap: { combat: [{ itemHrid: "/items/food" }] },
};

const profile = buildMemberProfile(raw);
assert.equal(profile.name, "Alice");
assert.equal(profile.values.combatLevel, 136);
assert.equal(profile.values.weaponType, "nature");
assert.equal(profile.values.aoe, 70);
assert.equal(profile.values.single, 73);
assert.equal(profile.values.combatHouseLevelSum, 6);
assert.equal(profile.lifeSkills.foraging, 136);
assert.equal(profile.equipment.length, 1);
assert.equal("food" in profile, false);

const fireProfile = buildMemberProfile({
  ...raw,
  characterItems: raw.characterItems.map((item) => item.itemLocationHrid === "/item_locations/main_hand"
    ? { ...item, itemHrid: "/items/blazing_staff_refined" }
    : item),
  combatUnit: { combatAbilities: [{ abilityHrid: "/abilities/quick_aid", level: 90 }] },
  abilityCombatTriggersMap: {
    "/abilities/quick_aid": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies" }],
  },
});
assert.equal(fireProfile.values.weaponType, "fire");
assert.equal(fireProfile.values.healer || 0, 0, "非自然职业不能获得治疗评分");

const natureTeamBuffProfile = buildMemberProfile({
  ...raw,
  combatUnit: { combatAbilities: [{ abilityHrid: "/abilities/battle_shout", level: 88 }] },
  abilityCombatTriggersMap: {
    "/abilities/battle_shout": [{ dependencyHrid: "/combat_trigger_dependencies/all_allies", conditionHrid: "/combat_trigger_conditions/battle_shout" }],
  },
});
assert.equal(natureTeamBuffProfile.values.healer || 0, 0, "普通团队增益不能当成治疗技能");

const recommendations = calculatePersonalRecommendations(profile, {
  lifeTrials: [{ key: "foraging", zh: "采摘" }, { key: "woodcutting", zh: "伐木" }],
  combatTrials: [{ key: "badger", zh: "獾" }, { key: "swarm", zh: "虫群" }],
  bossProfiles: {
    badger: { weights: { physical: 10, single: 1 } },
    swarm: { weights: { aoe: 2, magic: 1 } },
  },
});
assert.equal(recommendations.life[0].key, "foraging");
assert.equal(recommendations.combat[0].key, "swarm");

const legacyFireRecommendations = calculatePersonalRecommendations({ values: { weaponType: "fire", combat: 100, healer: 999 } }, {
  combatTrials: [{ key: "jellyfish", zh: "水母" }, { key: "badger", zh: "獾" }],
  bossProfiles: {
    jellyfish: { weights: { healer: 10 } },
    badger: { weights: {} },
  },
});
assert.equal(legacyFireRecommendations.combat[0].key, "badger", "非自然职业的旧治疗分不能影响个人排名");

console.log("member userscript tests passed");

if (process.argv[2]) {
  const imported = buildMemberProfile(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  console.log(JSON.stringify({
    name: imported.name,
    values: imported.values,
    lifeSkills: imported.lifeSkills,
    equipment: imported.equipment.length,
    abilities: imported.abilities.length,
    hasFood: Object.hasOwn(imported, "food"),
  }, null, 2));
}

module.exports = { buildMemberProfile, calculatePersonalRecommendations, normalizeMemberIdentity };
