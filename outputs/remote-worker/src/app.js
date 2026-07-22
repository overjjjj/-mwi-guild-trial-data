import {
  deriveMemberId,
  getWeekId,
  issueGuildCredential,
  normalizeMemberProfile,
  sanitizeId,
  selectMemberAssignment,
  verifyGuildCredential,
} from "./core.js";
import { GitHubRepository } from "./github.js";

export function createWorkerApp(env, options = {}) {
  const repository = options.repository || new GitHubRepository(env, options.fetchImpl);
  const now = options.now || (() => Date.now());

  return {
    async fetch(request) {
      try {
        if (request.method === "OPTIONS") return corsResponse(request, env, new Response(null, { status: 204 }));
        const url = new URL(request.url);
        if (url.pathname === "/v1/health" && request.method === "GET") {
          return respond(request, env, { ok: true, weekId: getWeekId(new Date(now())) });
        }
        if (url.pathname === "/v1/guilds" && request.method === "POST") {
          const guildId = `g-${randomHex(8)}`;
          const leaderToken = await issueGuildCredential(required(env.LEADER_TOKEN, "LEADER_TOKEN"), guildId, randomHex(16));
          return respond(request, env, { ok: true, guildId, leaderToken }, 201);
        }
        if (url.pathname === "/v1/guilds/claim" && request.method === "POST") {
          requireLegacyLeader(request, env);
          const body = await readJson(request);
          const guildId = sanitizeId(body.guildId, "guildId");
          const leaderToken = await issueGuildCredential(required(env.LEADER_TOKEN, "LEADER_TOKEN"), guildId, randomHex(16));
          return respond(request, env, { ok: true, guildId, leaderToken });
        }
        if (url.pathname === "/v1/member/profile" && request.method === "POST") {
          const body = await readJson(request);
          const guildId = sanitizeId(body.guildId, "guildId");
          const weekId = validateWeekId(body.weekId || getWeekId(new Date(now())));
          const { identity } = await requireRosterMember(repository, guildId, weekId, body.profile?.name);
          const profile = normalizeMemberProfile(body.profile, identity, new Date(now()).toISOString());
          await repository.writeJson(memberPath(identity.guildId, weekId, identity.memberId), profile);
          return respond(request, env, { ok: true, guildId: identity.guildId, memberId: identity.memberId, weekId, updatedAt: profile.updatedAt });
        }
        if (url.pathname === "/v1/member/status" && request.method === "GET") {
          const guildId = sanitizeId(url.searchParams.get("guildId"), "guildId");
          const weekId = validateWeekId(url.searchParams.get("weekId") || getWeekId(new Date(now())));
          const { identity, config } = await requireRosterMember(repository, guildId, weekId, url.searchParams.get("name"));
          const root = weekRoot(identity.guildId, weekId);
          const [profile, assignment] = await Promise.all([
            repository.readJson(memberPath(identity.guildId, weekId, identity.memberId)),
            repository.readJson(`${root}/assignment.json`),
          ]);
          return respond(request, env, {
            guildId: identity.guildId,
            memberId: identity.memberId,
            name: identity.name,
            weekId,
            uploadedAt: profile?.updatedAt || null,
            config,
            assignment: selectMemberAssignment(assignment, identity),
            assignmentPublishedAt: assignment?.publishedAt || null,
          });
        }
        if (url.pathname === "/v1/leader/submissions" && request.method === "GET") {
          const guildId = sanitizeId(url.searchParams.get("guildId"), "guildId");
          await requireGuildLeader(request, env, guildId);
          const weekId = validateWeekId(url.searchParams.get("weekId") || getWeekId(new Date(now())));
          const directory = `${weekRoot(guildId, weekId)}/members`;
          const files = (await repository.list(directory)).filter((item) => item.type === "file" && item.path.endsWith(".json"));
          const members = (await Promise.all(files.map((item) => repository.readJson(item.path)))).filter(Boolean);
          members.sort((left, right) => left.name.localeCompare(right.name));
          return respond(request, env, { guildId, weekId, members });
        }
        if (url.pathname === "/v1/leader/config" && request.method === "PUT") {
          const body = await readJson(request);
          const config = normalizeConfig(body, now());
          await requireGuildLeader(request, env, config.guildId);
          await repository.writeJson(`${weekRoot(config.guildId, config.weekId)}/config.json`, config);
          return respond(request, env, { ok: true, guildId: config.guildId, weekId: config.weekId });
        }
        if (url.pathname === "/v1/leader/assignment" && request.method === "PUT") {
          const body = await readJson(request);
          const guildId = sanitizeId(body.guildId, "guildId");
          await requireGuildLeader(request, env, guildId);
          const weekId = validateWeekId(body.weekId);
          const members = normalizeAssignments(body.members);
          const assignment = {
            schemaVersion: 1,
            guildId,
            weekId,
            generatedAt: String(body.generatedAt || "").slice(0, 40),
            publishedAt: new Date(now()).toISOString(),
            members,
          };
          await repository.writeJson(`${weekRoot(guildId, weekId)}/assignment.json`, assignment);
          return respond(request, env, { ok: true, guildId, weekId, memberCount: Object.keys(members).length, publishedAt: assignment.publishedAt });
        }
        return respond(request, env, { error: "Not found" }, 404);
      } catch (error) {
        return respond(request, env, { error: error.message || "Internal error" }, error.status || 500);
      }
    },
  };
}

function normalizeConfig(body, now) {
  const normalizeTrials = (trials, max) => (Array.isArray(trials) ? trials.slice(0, max) : []).map((trial) => ({
    key: sanitizeId(trial?.key, "trial key"),
    zh: String(trial?.zh || trial?.key || "").trim().slice(0, 24),
    capacity: Math.max(0, Math.min(Number(trial?.capacity || 0), 500)),
    signed: Math.max(0, Math.min(Number(trial?.signed || 0), 500)),
  }));
  return {
    schemaVersion: 1,
    guildId: sanitizeId(body.guildId, "guildId"),
    weekId: validateWeekId(body.weekId),
    updatedAt: new Date(now).toISOString(),
    lifeTrials: normalizeTrials(body.lifeTrials, 4),
    combatTrials: normalizeTrials(body.combatTrials, 2),
    memberNames: normalizeMemberNames(body.memberNames),
    bossProfiles: body.bossProfiles && typeof body.bossProfiles === "object" ? body.bossProfiles : {},
  };
}

function normalizeMemberNames(input) {
  const members = new Map();
  (Array.isArray(input) ? input : []).slice(0, 500).forEach((value) => {
    const name = String(value || "").trim().slice(0, 40);
    const key = normalizeName(name);
    if (key && !members.has(key)) members.set(key, name);
  });
  return [...members.values()];
}

function normalizeAssignments(input) {
  const result = {};
  Object.entries(input && typeof input === "object" ? input : {}).slice(0, 500).forEach(([memberId, assignment]) => {
    const id = sanitizeId(memberId, "memberId");
    result[id] = {
      name: String(assignment?.name || "").trim().slice(0, 40),
      life: normalizeAssignmentPart(assignment?.life),
      combat: normalizeAssignmentPart(assignment?.combat),
    };
  });
  return result;
}

function normalizeAssignmentPart(part) {
  if (!part?.trialKey) return null;
  return {
    trialKey: sanitizeId(part.trialKey, "trial key"),
    trialName: String(part.trialName || part.trialKey).trim().slice(0, 24),
    score: Number.isFinite(Number(part.score)) ? Number(part.score) : 0,
    reason: String(part.reason || "").trim().slice(0, 240),
    skills: (Array.isArray(part.skills) ? part.skills : []).slice(0, 3).map((skill) => String(skill || "").trim().slice(0, 80)).filter(Boolean),
  };
}

async function requireRosterMember(repository, guildId, weekId, requestedName) {
  const name = String(requestedName || "").trim().slice(0, 40);
  if (!name) throw httpError(400, "Player name is required");
  const config = await repository.readJson(`${weekRoot(guildId, weekId)}/config.json`);
  if (!config) throw httpError(409, "Guild roster is not synchronized");
  const canonicalName = (Array.isArray(config.memberNames) ? config.memberNames : [])
    .find((memberName) => normalizeName(memberName) === normalizeName(name));
  if (!canonicalName) throw httpError(403, "Player is not in the synchronized guild roster");
  return {
    identity: { guildId, memberId: await deriveMemberId(canonicalName), name: canonicalName },
    config,
  };
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

async function requireGuildLeader(request, env, guildId) {
  const token = readBearer(request);
  const masterSecret = required(env.LEADER_TOKEN, "LEADER_TOKEN");
  if (!token || (token !== masterSecret && !(await verifyGuildCredential(masterSecret, token, guildId)))) {
    throw httpError(401, "Leader authorization failed");
  }
}

function requireLegacyLeader(request, env) {
  const token = readBearer(request);
  if (!token || token !== required(env.LEADER_TOKEN, "LEADER_TOKEN")) throw httpError(401, "Legacy leader authorization failed");
}

function readBearer(request) {
  const match = String(request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 256_000) throw httpError(413, "Request body too large");
  const text = await request.text();
  if (text.length > 256_000) throw httpError(413, "Request body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch (_) {
    throw httpError(400, "Invalid JSON body");
  }
}

function validateWeekId(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, "Invalid weekId");
  return text;
}

function weekRoot(guildId, weekId) {
  return `guilds/${sanitizeId(guildId, "guildId")}/weeks/${validateWeekId(weekId)}`;
}

function memberPath(guildId, weekId, memberId) {
  return `${weekRoot(guildId, weekId)}/members/${sanitizeId(memberId, "memberId")}.json`;
}

function respond(request, env, data, status = 200) {
  return corsResponse(request, env, Response.json(data, { status }));
}

function corsResponse(request, env, response) {
  const origin = request.headers.get("origin");
  const allowed = new Set(String(env.ALLOWED_ORIGINS || "https://www.milkywayidle.com,https://test.milkywayidle.com,https://www.milkywayidlecn.com,https://test.milkywayidlecn.com")
    .split(",").map((item) => item.trim()).filter(Boolean));
  const headers = new Headers(response.headers);
  if (origin && allowed.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function required(value, name) {
  if (value == null || String(value).trim() === "") throw httpError(500, `Missing ${name}`);
  return String(value).trim();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
