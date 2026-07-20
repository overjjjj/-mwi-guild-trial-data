import {
  createMemberToken,
  deriveMemberId,
  getWeekId,
  normalizeMemberProfile,
  sanitizeId,
  selectMemberAssignment,
  verifyMemberToken,
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
        if (url.pathname === "/v1/leader/invites" && request.method === "POST") {
          requireLeader(request, env);
          const body = await readJson(request);
          const guildId = sanitizeId(body.guildId, "guildId");
          const members = Array.isArray(body.members) ? body.members.slice(0, 200) : [];
          if (!members.length) throw httpError(400, "members is required");
          const ttlMs = Math.max(86_400_000, Math.min(Number(env.MEMBER_TOKEN_TTL_DAYS || 90) * 86_400_000, 365 * 86_400_000));
          const invites = [];
          for (const member of members) {
            const name = String(member?.name || "").trim().slice(0, 40);
            if (!name) continue;
            const memberId = member.memberId ? sanitizeId(member.memberId, "memberId") : await deriveMemberId(name);
            const token = await createMemberToken(required(env.MEMBER_TOKEN_SECRET, "MEMBER_TOKEN_SECRET"), { guildId, memberId, name }, now(), ttlMs);
            invites.push({ memberId, name, token });
          }
          return respond(request, env, { guildId, invites });
        }
        if (url.pathname === "/v1/member/profile" && request.method === "POST") {
          const identity = await requireMember(request, env, now());
          const body = await readJson(request);
          const weekId = validateWeekId(body.weekId || getWeekId(new Date(now())));
          const profile = normalizeMemberProfile(body.profile, identity, new Date(now()).toISOString());
          await repository.writeJson(memberPath(identity.guildId, weekId, identity.memberId), profile);
          return respond(request, env, { ok: true, guildId: identity.guildId, memberId: identity.memberId, weekId, updatedAt: profile.updatedAt });
        }
        if (url.pathname === "/v1/member/status" && request.method === "GET") {
          const identity = await requireMember(request, env, now());
          const weekId = validateWeekId(url.searchParams.get("weekId") || getWeekId(new Date(now())));
          const root = weekRoot(identity.guildId, weekId);
          const [profile, config, assignment] = await Promise.all([
            repository.readJson(memberPath(identity.guildId, weekId, identity.memberId)),
            repository.readJson(`${root}/config.json`),
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
          requireLeader(request, env);
          const guildId = sanitizeId(url.searchParams.get("guildId"), "guildId");
          const weekId = validateWeekId(url.searchParams.get("weekId") || getWeekId(new Date(now())));
          const directory = `${weekRoot(guildId, weekId)}/members`;
          const files = (await repository.list(directory)).filter((item) => item.type === "file" && item.path.endsWith(".json"));
          const members = (await Promise.all(files.map((item) => repository.readJson(item.path)))).filter(Boolean);
          members.sort((left, right) => left.name.localeCompare(right.name));
          return respond(request, env, { guildId, weekId, members });
        }
        if (url.pathname === "/v1/leader/config" && request.method === "PUT") {
          requireLeader(request, env);
          const body = await readJson(request);
          const config = normalizeConfig(body, now());
          await repository.writeJson(`${weekRoot(config.guildId, config.weekId)}/config.json`, config);
          return respond(request, env, { ok: true, guildId: config.guildId, weekId: config.weekId });
        }
        if (url.pathname === "/v1/leader/assignment" && request.method === "PUT") {
          requireLeader(request, env);
          const body = await readJson(request);
          const guildId = sanitizeId(body.guildId, "guildId");
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
    bossProfiles: body.bossProfiles && typeof body.bossProfiles === "object" ? body.bossProfiles : {},
  };
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
  };
}

async function requireMember(request, env, now) {
  const token = readBearer(request);
  if (!token) throw httpError(401, "Member token required");
  try {
    return await verifyMemberToken(required(env.MEMBER_TOKEN_SECRET, "MEMBER_TOKEN_SECRET"), token, now);
  } catch (error) {
    throw httpError(401, error.message);
  }
}

function requireLeader(request, env) {
  const token = readBearer(request);
  if (!token || token !== required(env.LEADER_TOKEN, "LEADER_TOKEN")) throw httpError(401, "Leader authorization failed");
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
