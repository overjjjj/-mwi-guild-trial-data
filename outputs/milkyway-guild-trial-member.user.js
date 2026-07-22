// ==UserScript==
// @name         Milky Way Idle 公会试炼会员端
// @namespace    https://www.milkywayidle.com/
// @version      0.6.0
// @description  按公会名单和角色名上传本角色的公会试炼资料，并显示个人适配和正式分配。
// @author       Codex
// @updateURL    https://raw.githubusercontent.com/overjjjj/-mwi-guild-trial-data/main/outputs/milkyway-guild-trial-member.user.js
// @downloadURL  https://raw.githubusercontent.com/overjjjj/-mwi-guild-trial-data/main/outputs/milkyway-guild-trial-member.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "mwi-guild-trial-member:v1";
  let capturedCharacterData = null;
  let currentProfile = null;
  let currentStatus = null;

  installCharacterCapture();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createUi, { once: true });
  else createUi();

  function installCharacterCapture() {
    try {
      const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const prototype = pageWindow.MessageEvent?.prototype;
      if (!prototype || pageWindow.__mwiGuildTrialMemberCaptureInstalled) return;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "data");
      if (!descriptor?.get) return;
      const originalGet = descriptor.get;
      descriptor.get = function () {
        const message = originalGet.call(this);
        captureMessage(message);
        return message;
      };
      Object.defineProperty(prototype, "data", descriptor);
      pageWindow.__mwiGuildTrialMemberCaptureInstalled = true;
    } catch (_) {
      // 仍可通过兼容脚本的公开导出接口读取。
    }
  }

  function captureMessage(message) {
    if (typeof message !== "string" || (!message.includes("init_character_data") && !message.includes("items_updated"))) return;
    try {
      const data = JSON.parse(message);
      if (data.type === "init_character_data") capturedCharacterData = data;
      if (data.type === "items_updated" && capturedCharacterData && Array.isArray(data.characterItems)) {
        capturedCharacterData = { ...capturedCharacterData, characterItems: data.characterItems };
      }
    } catch (_) {
      // 忽略非 JSON 消息。
    }
  }

  function createUi() {
    const style = document.createElement("style");
    style.textContent = `
      #mwi-gtm-launcher{position:fixed;right:68px;bottom:16px;z-index:2147483646;width:44px;height:44px;border:1px solid #6da7df;border-radius:8px;background:#233247;color:#d8f2ff;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}
      #mwi-gtm-panel{position:fixed;right:16px;top:84px;z-index:2147483647;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 110px);display:none;grid-template-rows:auto 1fr;border:1px solid #55799d;border-radius:8px;background:#202938;color:#edf5ff;box-shadow:0 14px 42px rgba(0,0,0,.48);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
      #mwi-gtm-panel[data-open="1"]{display:grid}#mwi-gtm-panel *{box-sizing:border-box}.mwi-gtm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #3c526b;background:#283649}.mwi-gtm-title{font-size:15px;font-weight:800;color:#b7e6ff}.mwi-gtm-body{overflow:auto;padding:12px}.mwi-gtm-field{display:grid;gap:4px;margin-bottom:9px;color:#cfe0f2}.mwi-gtm-field input,.mwi-gtm-field textarea{width:100%;border:1px solid #49637f;border-radius:6px;background:#141c27;color:#fff;padding:7px 8px;font:inherit}.mwi-gtm-field textarea{min-height:74px;resize:vertical;font-family:ui-monospace,Consolas,monospace}.mwi-gtm-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.mwi-gtm-btn{min-height:30px;border:1px solid #587a9d;border-radius:6px;background:#344b65;color:#f3f8ff;padding:5px 9px;cursor:pointer}.mwi-gtm-btn.primary{background:#326c91;border-color:#65a9d5;font-weight:700}.mwi-gtm-note{color:#aebfd1;margin:0 0 10px}.mwi-gtm-section{border-top:1px solid #35495e;padding-top:10px;margin-top:10px}.mwi-gtm-section h3{font-size:13px;margin:0 0 6px;color:#d8ecff}.mwi-gtm-table{width:100%;border-collapse:collapse;background:#18222f}.mwi-gtm-table td,.mwi-gtm-table th{padding:6px 7px;border-bottom:1px solid #304154;text-align:left;vertical-align:top}.mwi-gtm-good{color:#9fe39f}.mwi-gtm-warn{color:#ffd18a}.mwi-gtm-settings{margin-bottom:10px}.mwi-gtm-settings summary{cursor:pointer;color:#cfe0f2;padding:5px 0}.mwi-gtm-skills{margin-top:5px;color:#aef0c9}
    `;
    document.documentElement.appendChild(style);

    const launcher = document.createElement("button");
    launcher.id = "mwi-gtm-launcher";
    launcher.type = "button";
    launcher.title = "公会试炼会员端";
    launcher.textContent = "员";
    document.body.appendChild(launcher);

    const panel = document.createElement("section");
    panel.id = "mwi-gtm-panel";
    panel.innerHTML = `
      <div class="mwi-gtm-head"><div class="mwi-gtm-title">公会试炼会员端</div><button class="mwi-gtm-btn" data-action="close">关闭</button></div>
      <div class="mwi-gtm-body">
        <details class="mwi-gtm-settings">
          <summary>连接设置</summary>
          <label class="mwi-gtm-field">服务地址<input id="mwi-gtm-endpoint" type="url" placeholder="https://your-project.vercel.app"></label>
          <label class="mwi-gtm-field">公会编号<input id="mwi-gtm-guild" type="text" placeholder="例如 guild-cn-1"></label>
          <button class="mwi-gtm-btn" data-action="save">保存连接</button>
          <button class="mwi-gtm-btn" data-action="read">只读取本角色</button>
        </details>
        <div class="mwi-gtm-actions">
          <button class="mwi-gtm-btn primary" data-action="upload">一键上传并查看分配</button>
          <button class="mwi-gtm-btn" data-action="refresh">只查看最新分配</button>
        </div>
        <p class="mwi-gtm-note" id="mwi-gtm-status">尚未读取角色数据。</p>
        <div id="mwi-gtm-profile"></div>
        <div id="mwi-gtm-recommendations"></div>
        <div id="mwi-gtm-assignment"></div>
      </div>
    `;
    document.body.appendChild(panel);
    const el = {
      endpoint: panel.querySelector("#mwi-gtm-endpoint"), guild: panel.querySelector("#mwi-gtm-guild"),
      status: panel.querySelector("#mwi-gtm-status"), profile: panel.querySelector("#mwi-gtm-profile"),
      recommendations: panel.querySelector("#mwi-gtm-recommendations"), assignment: panel.querySelector("#mwi-gtm-assignment"),
    };
    const saved = loadSettings();
    el.endpoint.value = saved.endpoint || "";
    el.guild.value = saved.guildId || "";
    currentProfile = saved.lastProfile || null;
    if (currentProfile) renderProfile(el, currentProfile);

    launcher.addEventListener("click", () => { panel.dataset.open = panel.dataset.open === "1" ? "0" : "1"; });
    panel.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "close") panel.dataset.open = "0";
      if (action === "save") { saveSettings(el); setStatus(el, "设置已保存。"); }
      if (action === "read") await readCurrentCharacter(el);
      if (action === "upload") await uploadProfile(el);
      if (action === "refresh") await refreshStatus(el);
    });
  }

  async function readCurrentCharacter(el) {
    try {
      let source = capturedCharacterData;
      if (!source) {
        const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        const getter = pageWindow.MWI_INTEGRATED?.getSimulatorData;
        if (typeof getter === "function") source = await Promise.resolve(getter());
      }
      if (!source) throw new Error("尚未捕获登录角色数据，请刷新游戏后重试。");
      currentProfile = buildMemberProfile(source);
      saveSettings(el);
      renderProfile(el, currentProfile);
      renderRecommendations(el);
      setStatus(el, `已读取 ${currentProfile.name || "本角色"}，数据尚未上传。`);
    } catch (error) {
      setStatus(el, `读取失败：${error.message}`);
    }
  }

  async function uploadProfile(el) {
    try {
      if (!currentProfile) await readCurrentCharacter(el);
      if (!currentProfile) return;
      saveSettings(el);
      const weekId = getCurrentWeekId();
      await apiRequest(el, "/v1/member/profile", "POST", { weekId, profile: currentProfile });
      setStatus(el, "资料上传成功，正在读取本周分配。");
      await refreshStatus(el);
    } catch (error) {
      setStatus(el, `上传失败：${error.message}`);
    }
  }

  async function refreshStatus(el) {
    try {
      saveSettings(el);
      currentStatus = await apiRequest(el, `/v1/member/status?weekId=${encodeURIComponent(getCurrentWeekId())}`, "GET");
      renderRecommendations(el);
      renderAssignment(el, currentStatus);
      setStatus(el, currentStatus.uploadedAt ? `服务器已收到资料：${new Date(currentStatus.uploadedAt).toLocaleString()}` : "服务器尚未收到你本周的资料。");
    } catch (error) {
      setStatus(el, `刷新失败：${error.message}`);
    }
  }

  async function apiRequest(el, path, method, body) {
    const endpoint = el.endpoint.value.trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(endpoint)) throw new Error("服务地址必须使用 HTTPS。");
    const identity = normalizeMemberIdentity(el.guild.value, currentProfile?.name);
    const url = new URL(`${endpoint}${path}`);
    if (!body) {
      url.searchParams.set("guildId", identity.guildId);
      url.searchParams.set("name", identity.name);
    }
    const requestBody = body ? { ...body, guildId: identity.guildId, profile: { ...body.profile, name: identity.name } } : null;
    const response = await fetch(url, {
      method,
      headers: requestBody ? { "Content-Type": "application/json" } : {},
      ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function renderProfile(el, profile) {
    el.profile.innerHTML = `<div class="mwi-gtm-section"><h3>本地角色资料</h3><table class="mwi-gtm-table"><tbody>
      <tr><th>角色</th><td>${escapeHtml(profile.name || "尚未读取")}</td></tr>
      <tr><th>战斗</th><td>等级 ${profile.values.combatLevel || 0}；${escapeHtml(translateWeapon(profile.values.weaponType))}；装备 ${profile.equipment.length}；技能 ${profile.abilities.length}</td></tr>
      <tr><th>专业</th><td>${Object.entries(profile.lifeSkills).map(([key, value]) => `${escapeHtml(translateLifeSkill(key))} ${value}`).join("，") || "未读取"}</td></tr>
    </tbody></table></div>`;
  }

  function renderRecommendations(el) {
    if (!currentProfile || !currentStatus?.config) { el.recommendations.innerHTML = ""; return; }
    const result = calculatePersonalRecommendations(currentProfile, currentStatus.config);
    const rows = [
      ...result.life.map((item, index) => `<tr><td>生活 ${index + 1}</td><td>${escapeHtml(item.zh)}</td><td>${item.score}</td></tr>`),
      ...result.combat.map((item, index) => `<tr><td>战斗 ${index + 1}</td><td>${escapeHtml(item.zh)}</td><td>${item.score}</td></tr>`),
    ].join("");
    el.recommendations.innerHTML = `<div class="mwi-gtm-section"><h3>个人适配排名</h3><table class="mwi-gtm-table"><tbody>${rows || "<tr><td>会长尚未发布本周试炼配置</td></tr>"}</tbody></table></div>`;
  }

  function renderAssignment(el, status) {
    const assignment = status?.assignment;
    if (!assignment) {
      el.assignment.innerHTML = `<div class="mwi-gtm-section"><h3>正式分配</h3><p class="mwi-gtm-warn">会长尚未发布你的正式方案。</p></div>`;
      return;
    }
    const part = (value) => value ? `${escapeHtml(value.trialName || value.trialKey)}（评分 ${value.score || 0}${value.reason ? "，" + escapeHtml(value.reason) : ""}）${value.skills?.length ? `<div class="mwi-gtm-skills">技能建议：${value.skills.map(escapeHtml).join("、")}</div>` : ""}` : "未分配";
    el.assignment.innerHTML = `<div class="mwi-gtm-section"><h3>正式分配</h3><table class="mwi-gtm-table"><tbody>
      <tr><th>生活</th><td class="mwi-gtm-good">${part(assignment.life)}</td></tr>
      <tr><th>战斗</th><td class="mwi-gtm-good">${part(assignment.combat)}</td></tr>
      <tr><th>发布时间</th><td>${status.assignmentPublishedAt ? new Date(status.assignmentPublishedAt).toLocaleString() : "-"}</td></tr>
    </tbody></table></div>`;
  }

  function translateLifeSkill(key) {
    return ({ milking: "挤奶", foraging: "采摘", woodcutting: "伐木", cheesesmithing: "炼金", crafting: "制作", tailoring: "裁缝", cooking: "烹饪", brewing: "酿造", alchemy: "炼药", enhancing: "强化" })[key] || key;
  }

  function translateWeapon(key) {
    return ({ water: "水法师", fire: "火法师", nature: "自然法师", sword: "剑士", blunt: "钝器战士", spear: "长矛战士", bow: "弓手", crossbow: "弩手", bulwark: "盾兵" })[key] || "职业未读取";
  }

  function abilityMatchesWeapon(hrid, weaponType) {
    const key = String(hrid || "").split("/").pop().toLowerCase();
    const required = {
      mystic_aura: "nature", quick_aid: "nature", natures_veil: "nature", toxic_pollen: "nature",
      entangle: "nature", revive: "nature", healing_aura: "nature", fountain_of_life: "nature",
      fireball: "fire", frost_bolt: "water", ice_spear: "water", rain_of_arrows: "ranged", quick_shot: "ranged",
    }[key];
    if (!required) return true;
    if (required === "ranged") return ["bow", "crossbow"].includes(weaponType);
    return required === weaponType;
  }

  function isHealingAbility(ability, triggerMap) {
    const key = String(ability?.abilityHrid || "").split("/").pop().toLowerCase();
    if (/aid|heal|fountain|revive/.test(key)) return true;
    return (triggerMap?.[ability?.abilityHrid] || []).some((trigger) => {
      const target = String(trigger?.dependencyHrid || "");
      const condition = String(trigger?.conditionHrid || "");
      return /all_allies|targeted_ally/.test(target) && /hp|health/.test(condition);
    });
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  function saveSettings(el) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint: el.endpoint.value.trim(), guildId: el.guild.value.trim(), lastProfile: currentProfile }));
  }

  function normalizeMemberIdentity(guildIdValue, nameValue) {
    const guildId = String(guildIdValue || "").trim();
    const name = String(nameValue || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(guildId)) throw new Error("公会编号只能包含字母、数字、下划线和连字符。");
    if (!name) throw new Error("请先读取本角色，确认角色名后再上传或刷新。");
    return { guildId, name };
  }

  function setStatus(el, message) { el.status.textContent = message; }

  function getCurrentWeekId() {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysSinceFriday = (now.getUTCDay() - 5 + 7) % 7;
    return new Date(midnight - daysSinceFriday * 86400000).toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function buildMemberProfile(input) {
    if (!input || typeof input !== "object") throw new Error("角色数据格式错误");
    const numeric = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };
    const productionLocations = new Set(["/item_locations/woodcutting_tool", "/item_locations/foraging_tool", "/item_locations/milking_tool", "/item_locations/cheesesmithing_tool", "/item_locations/crafting_tool", "/item_locations/tailoring_tool", "/item_locations/cooking_tool", "/item_locations/brewing_tool", "/item_locations/alchemy_tool", "/item_locations/enhancing_tool"]);
    const lifeKeys = ["milking", "foraging", "woodcutting", "cheesesmithing", "crafting", "tailoring", "cooking", "brewing", "alchemy", "enhancing"];
    let name = "";
    let skills = {};
    let equipment = [];
    let abilities = [];
    let triggerMap = {};
    let houseRooms = {};
    let explicitCombatLevel = 0;
    let explicitTotalLevel = 0;

    if (input.player) {
      name = String(input.characterName || "").trim();
      ["melee", "defense", "magic", "ranged", "attack", "intelligence", "stamina"].forEach((key) => { skills[key] = numeric(input.player[`${key}Level`]); });
      equipment = Array.isArray(input.player.equipment) ? input.player.equipment : [];
      abilities = Array.isArray(input.abilities) ? input.abilities : [];
      triggerMap = input.triggerMap || {};
      houseRooms = input.houseRooms || {};
      explicitCombatLevel = numeric(input.combatLevel);
      explicitTotalLevel = numeric(input.totalLevel);
    } else {
      name = String(input.characterName || input.character?.name || input.combatUnit?.name || "").trim();
      (input.characterSkills || []).forEach((skill) => { const key = String(skill?.skillHrid || "").split("/").pop(); if (key) skills[key] = numeric(skill.level); });
      equipment = Array.isArray(input.characterItems) ? input.characterItems : [];
      abilities = input.combatUnit?.combatAbilities || input.characterAbilities || [];
      triggerMap = input.abilityCombatTriggersMap || {};
      houseRooms = Object.fromEntries(Object.values(input.characterHouseRoomMap || {}).map((room) => [room?.houseRoomHrid || "", numeric(room?.level)]).filter(([key]) => key));
      explicitCombatLevel = numeric(input.combatUnit?.combatLevel);
      explicitTotalLevel = Object.values(skills).reduce((sum, level) => sum + numeric(level), 0);
    }

    equipment = equipment.map((item) => ({ itemLocationHrid: String(item?.itemLocationHrid || ""), itemHrid: String(item?.itemHrid || ""), enhancementLevel: numeric(item?.enhancementLevel) }))
      .filter((item) => item.itemHrid && item.itemLocationHrid !== "/item_locations/inventory" && !productionLocations.has(item.itemLocationHrid));
    abilities = abilities.map((ability) => ({ abilityHrid: String(ability?.abilityHrid || ""), level: numeric(ability?.level) })).filter((ability) => ability.abilityHrid);
    triggerMap = Object.fromEntries(Object.entries(triggerMap).filter(([key]) => key.startsWith("/abilities/")));

    const maxCombatSkill = Math.max(numeric(skills.melee), numeric(skills.ranged), numeric(skills.magic));
    const maxAllCombat = Math.max(numeric(skills.attack), numeric(skills.defense), numeric(skills.melee), numeric(skills.ranged), numeric(skills.magic));
    const combatLevel = explicitCombatLevel || Math.floor(0.1 * (numeric(skills.stamina) + numeric(skills.intelligence) + numeric(skills.attack) + numeric(skills.defense) + maxCombatSkill) + 0.5 * maxAllCombat);
    const mainHand = equipment.find((item) => ["/item_locations/main_hand", "/item_locations/two_hand"].includes(item.itemLocationHrid))?.itemHrid || "";
    const offHand = equipment.find((item) => item.itemLocationHrid === "/item_locations/off_hand")?.itemHrid || "";
    const weapon = mainHand.split("/").pop() || "";
    let weaponType = "";
    if (/bulwark/.test(offHand + weapon)) weaponType = "bulwark";
    else if (/crossbow/.test(weapon)) weaponType = "crossbow";
    else if (/bow/.test(weapon) || weapon === "gobo_shooter") weaponType = "bow";
    else if (/water|rippling|frost/.test(weapon)) weaponType = "water";
    else if (/fire|blazing|infernal/.test(weapon) || weapon === "gobo_boomstick") weaponType = "fire";
    else if (/nature|blooming|jackalope/.test(weapon)) weaponType = "nature";
    else if (/sword|slasher/.test(weapon)) weaponType = "sword";
    else if (/mace|flail|smasher|bludgeon/.test(weapon)) weaponType = "blunt";
    else if (/spear|stabber/.test(weapon)) weaponType = "spear";
    const magicWeapon = ["water", "fire", "nature"].includes(weaponType);
    const rangedWeapon = ["bow", "crossbow"].includes(weaponType);
    const physicalWeapon = rangedWeapon || ["sword", "blunt", "spear", "bulwark"].includes(weaponType);
    const compatibleAbilities = abilities.filter((ability) => abilityMatchesWeapon(ability.abilityHrid, weaponType));
    const abilityLevelByTarget = (target) => Math.max(0, ...compatibleAbilities.filter((ability) => (triggerMap[ability.abilityHrid] || []).some((trigger) => String(trigger?.dependencyHrid || "").includes(target))).map((ability) => ability.level));
    const support = Math.max(0, ...compatibleAbilities.filter((ability) => /aura|veil|revive/i.test(ability.abilityHrid)).map((ability) => ability.level));
    const combatHouseNames = ["dining_room", "library", "dojo", "gym", "armory", "archery_range", "mystical_study"];
    const combatHouseLevelSum = Object.entries(houseRooms).filter(([hrid]) => combatHouseNames.some((house) => hrid.includes(house))).reduce((sum, [, level]) => sum + numeric(typeof level === "object" ? level?.level : level), 0);
    const values = {
      level: explicitTotalLevel, combatLevel, combat: combatLevel, attackLevel: numeric(skills.attack), defenseLevel: numeric(skills.defense), meleeLevel: numeric(skills.melee), rangedLevel: numeric(skills.ranged), magicLevel: numeric(skills.magic), staminaLevel: numeric(skills.stamina), intelligenceLevel: numeric(skills.intelligence),
      weaponType, damageType: magicWeapon ? "magic" : physicalWeapon ? "physical" : "", equipmentCount: equipment.length, combatEquipmentCount: equipment.length, maxEnhancement: Math.max(0, ...equipment.map((item) => item.enhancementLevel)), abilityCount: abilities.length, maxAbilityLevel: Math.max(0, ...abilities.map((ability) => ability.level)), combatHouseLevelSum,
    };
    const aoe = abilityLevelByTarget("all_enemies"); const single = abilityLevelByTarget("targeted_enemy");
    const healer = Math.max(0, ...compatibleAbilities.filter((ability) => isHealingAbility(ability, triggerMap)).map((ability) => ability.level));
    if (aoe) values.aoe = aoe; if (single) values.single = single; if (healer && weaponType === "nature") { values.healer = healer; values.role = "healer"; } if (support) values.support = support;
    if (magicWeapon) values.magic = numeric(skills.magic);
    if (physicalWeapon) values.physical = Math.max(numeric(skills.melee), numeric(skills.ranged));
    if (rangedWeapon) values.ranged = numeric(skills.ranged);
    if (weaponType === "sword") values.slash = numeric(skills.melee);
    if (weaponType === "blunt") values.blunt = numeric(skills.melee);
    if (weaponType === "spear") values.stab = numeric(skills.melee);
    if (weaponType === "bulwark") values.role = "tank";
    const lifeSkills = {}; lifeKeys.forEach((key) => { const value = numeric(skills[key]); if (value) lifeSkills[key] = value; });
    return { name, values, lifeSkills, equipment, abilities, triggerMap, houseRooms };
  }

  function calculatePersonalRecommendations(profile, config) {
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const defaults = {
      badger: { weights: { magic: 1.7, single: 1.25, tank: 0.75, healer: 0.55, sustain: 0.55, support: 0.3, physical: 0.2 } },
      chameleon: { weights: { physical: 1.35, single: 1, tank: 0.75, healer: 0.55, sustain: 0.4, support: 0.3 } },
      jellyfish: { weights: { magic: 1, single: 0.75, healer: 0.9, sustain: 0.9, support: 0.7, tank: 0.45 } },
      hedgehog: { weights: { magic: 1.35, single: 1, healer: 0.75, sustain: 0.65, tank: 0.45, support: 0.4 } },
      swarm: { weights: { aoe: 1.8, magic: 1, blunt: 0.85, ranged: 0.75, stab: 0.7, slash: 0.7, physical: 0.55, healer: 0.85, tank: 0.8, support: 0.8, sustain: 0.75 } },
    };
    const life = (config?.lifeTrials || []).map((trial) => ({ key: trial.key, zh: trial.zh || trial.key, score: number(profile?.lifeSkills?.[trial.key]) })).sort((a, b) => b.score - a.score);
    const combat = (config?.combatTrials || []).map((trial) => {
      const weights = config?.bossProfiles?.[trial.key]?.weights || defaults[trial.key]?.weights || {};
      let weighted = 0; let totalWeight = 0;
      Object.entries(weights).forEach(([key, weight]) => {
        if (number(weight) <= 0) return;
        let value = key === "healer" && profile?.values?.weaponType !== "nature" ? 0 : number(profile?.values?.[key]);
        if (!value && key === "single" && trial.key !== "swarm") value = number(profile?.values?.combat);
        if (!value && key === "aoe" && trial.key === "swarm") value = number(profile?.values?.combat);
        if (!value && key === "magic" && profile?.values?.damageType === "magic") value = number(profile?.values?.combat);
        if (!value && key === "physical" && profile?.values?.damageType === "physical") value = number(profile?.values?.combat);
        if (!value && key === "tank" && profile?.values?.role === "tank") value = number(profile?.values?.combat);
        totalWeight += number(weight); weighted += value * number(weight);
      });
      const base = number(profile?.values?.combat);
      let score = totalWeight ? weighted / totalWeight : base;
      if (base && weighted > 0) score = score * 0.8 + base * 0.2;
      return { key: trial.key, zh: trial.zh || trial.key, score: Math.round(score * 10) / 10 };
    }).sort((a, b) => b.score - a.score);
    return { life, combat };
  }
})();
