const encoder = new TextEncoder();

const LIFE_SKILLS = [
  "milking", "foraging", "woodcutting", "cheesesmithing", "crafting",
  "tailoring", "cooking", "brewing", "alchemy", "enhancing",
];

const ALLOWED_VALUES = new Set([
  "level", "combatLevel", "combat", "power", "attackLevel", "defenseLevel",
  "meleeLevel", "rangedLevel", "magicLevel", "staminaLevel", "intelligenceLevel",
  "single", "aoe", "physical", "magic", "stab", "slash", "blunt", "ranged",
  "tank", "healer", "sustain", "support", "weaponType", "damageType", "role",
  "equipmentCount", "combatEquipmentCount", "maxEnhancement", "abilityCount",
  "maxAbilityLevel", "combatHouseLevelSum",
]);

export function getWeekId(input = new Date()) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceFriday = (date.getUTCDay() - 5 + 7) % 7;
  return new Date(midnight - daysSinceFriday * 86_400_000).toISOString().slice(0, 10);
}

export function sanitizeId(value, label = "id") {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

export async function deriveMemberId(name) {
  const normalized = cleanText(name, 80).toLowerCase().replace(/\s+/g, "");
  if (!normalized) throw new Error("Invalid member name");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(normalized)));
  return `m-${Array.from(digest.slice(0, 10), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function issueGuildCredential(masterSecret, guildId, nonce) {
  const secret = String(masterSecret || "").trim();
  if (!secret) throw new Error("Missing leader credential secret");
  const id = sanitizeId(guildId, "guildId");
  const tokenNonce = String(nonce || "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(tokenNonce)) throw new Error("Invalid credential nonce");
  const payload = `g1.${id}.${tokenNonce}`;
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifyGuildCredential(masterSecret, token, guildId) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 4 || parts[0] !== "g1") return false;
  let id;
  try { id = sanitizeId(guildId, "guildId"); }
  catch (_) { return false; }
  if (parts[1] !== id || !/^[A-Za-z0-9_-]{16,64}$/.test(parts[2])) return false;
  let expected;
  try { expected = await issueGuildCredential(masterSecret, id, parts[2]); }
  catch (_) { return false; }
  return constantTimeEqual(expected, String(token || "").trim());
}

export function normalizeMemberProfile(input, identity, updatedAt = new Date().toISOString()) {
  const values = {};
  Object.entries(input?.values || {}).forEach(([key, value]) => {
    if (!ALLOWED_VALUES.has(key)) return;
    if (["weaponType", "damageType", "role"].includes(key)) {
      const text = cleanText(value, 24);
      if (text) values[key] = text;
      return;
    }
    const number = finiteNumber(value, 0, 1_000_000);
    if (number > 0) values[key] = number;
  });

  const lifeSkills = {};
  LIFE_SKILLS.forEach((key) => {
    const value = finiteNumber(input?.lifeSkills?.[key], 0, 500);
    if (value > 0) lifeSkills[key] = value;
  });

  const equipment = Array.isArray(input?.equipment) ? input.equipment.slice(0, 32).map((item) => ({
    itemLocationHrid: cleanHrid(item?.itemLocationHrid),
    itemHrid: cleanHrid(item?.itemHrid),
    enhancementLevel: finiteNumber(item?.enhancementLevel, 0, 30),
  })).filter((item) => item.itemHrid) : [];

  const abilities = Array.isArray(input?.abilities) ? input.abilities.slice(0, 10).map((ability) => ({
    abilityHrid: cleanHrid(ability?.abilityHrid),
    level: finiteNumber(ability?.level, 0, 500),
  })).filter((ability) => ability.abilityHrid) : [];

  const triggerMap = {};
  Object.entries(input?.triggerMap || {}).slice(0, 20).forEach(([abilityHrid, triggers]) => {
    const key = cleanHrid(abilityHrid);
    if (!key.startsWith("/abilities/") || !Array.isArray(triggers)) return;
    triggerMap[key] = triggers.slice(0, 8).map((trigger) => ({
      dependencyHrid: cleanHrid(trigger?.dependencyHrid),
      conditionHrid: cleanHrid(trigger?.conditionHrid),
      comparatorHrid: cleanHrid(trigger?.comparatorHrid),
      value: finiteNumber(trigger?.value, -1_000_000, 1_000_000),
    }));
  });

  const houseRooms = {};
  Object.entries(input?.houseRooms || {}).slice(0, 32).forEach(([hrid, level]) => {
    const key = cleanHrid(hrid);
    const number = finiteNumber(typeof level === "object" ? level?.level : level, 0, 100);
    if (key && number > 0) houseRooms[key] = number;
  });

  return {
    schemaVersion: 1,
    guildId: sanitizeId(identity.guildId, "guildId"),
    memberId: sanitizeId(identity.memberId, "memberId"),
    name: cleanText(identity.name, 40),
    updatedAt,
    values,
    lifeSkills,
    equipment,
    abilities,
    triggerMap,
    houseRooms,
  };
}

export function selectMemberAssignment(assignment, identity) {
  const members = assignment?.members;
  if (!members || typeof members !== "object") return null;
  if (members[identity.memberId]) return members[identity.memberId];
  const normalizedName = String(identity.name || "").toLowerCase().replace(/\s+/g, "");
  return Object.values(members).find((member) => String(member?.name || "").toLowerCase().replace(/\s+/g, "") === normalizedName) || null;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanHrid(value) {
  const text = cleanText(value, 160);
  return /^\/[A-Za-z0-9_/-]+$/.test(text) ? text : "";
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  return difference === 0;
}
