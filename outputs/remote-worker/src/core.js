const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function createMemberToken(secret, identity, now = Date.now(), ttlMs = 30 * 86_400_000) {
  const payload = {
    guildId: sanitizeId(identity.guildId, "guildId"),
    memberId: sanitizeId(identity.memberId, "memberId"),
    name: cleanText(identity.name, 40),
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
  };
  if (!payload.name) throw new Error("Invalid member name");
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signHmac(secret, body);
  return `${body}.${base64UrlEncode(signature)}`;
}

export async function verifyMemberToken(secret, token, now = Date.now()) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) throw new Error("Invalid member token");
  const expected = await signHmac(secret, body);
  const actual = base64UrlDecode(signature);
  if (!timingSafeEqual(expected, actual)) throw new Error("Invalid member token signature");
  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecode(body)));
  } catch (_) {
    throw new Error("Invalid member token payload");
  }
  sanitizeId(payload.guildId, "guildId");
  sanitizeId(payload.memberId, "memberId");
  if (!payload.name || !Number.isFinite(payload.exp)) throw new Error("Invalid member token payload");
  if (Math.floor(now / 1000) >= payload.exp) throw new Error("Member token expired");
  return payload;
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

async function signHmac(secret, message) {
  if (!secret) throw new Error("Missing token secret");
  const key = await globalThis.crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message)));
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

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

function base64Encode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64Decode(text) {
  const binary = atob(String(text || ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
