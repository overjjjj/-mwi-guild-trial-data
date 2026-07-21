// ==UserScript==
// @name         Milky Way Idle 公会试炼分配助手
// @namespace    https://www.milkywayidle.com/
// @version      0.14.0
// @description  根据成员能力、偏好和当前试炼名额，生成公会试炼报名推荐表。只做本地辅助推荐，不自动绕过游戏权限。
// @author       Codex
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "mwi-guild-trial-allocator:v1";
  const GUILD_LEVEL_CACHE_KEY = "mwi-guild-trial-allocator:guild-levels:v1";
  const BOSS_PROFILE_VERSION = 2;
  const MEMBER_DATA_VERSION = 2;

  const LIFE_TRIALS = [
    { key: "milking", zh: "挤奶", aliases: ["Milking", "挤奶"] },
    { key: "foraging", zh: "采摘", aliases: ["Foraging", "采摘", "采集"] },
    { key: "woodcutting", zh: "伐木", aliases: ["Woodcutting", "伐木"] },
    { key: "cheesesmithing", zh: "炼金", aliases: ["Cheesesmithing", "奶酪锻造", "炼金"] },
    { key: "crafting", zh: "制作", aliases: ["Crafting", "制作"] },
    { key: "tailoring", zh: "裁缝", aliases: ["Tailoring", "裁缝"] },
    { key: "cooking", zh: "烹饪", aliases: ["Cooking", "烹饪"] },
    { key: "brewing", zh: "酿造", aliases: ["Brewing", "酿造"] },
    { key: "alchemy", zh: "炼药", aliases: ["Alchemy", "炼药", "炼金术"] },
    { key: "enhancing", zh: "强化", aliases: ["Enhancing", "强化"] },
  ];

  const COMBAT_TRIALS = [
    { key: "badger", zh: "獾", style: "single", aliases: ["Badger", "獾", "蜜獾"] },
    { key: "chameleon", zh: "变色龙", style: "single", aliases: ["Chameleon", "变色龙"] },
    { key: "jellyfish", zh: "水母", style: "single", aliases: ["Jellyfish", "水母"] },
    { key: "hedgehog", zh: "刺猬", style: "single", aliases: ["Hedgehog", "刺猬"] },
    { key: "swarm", zh: "虫群", style: "aoe", aliases: ["Swarm", "虫群", "试炼虫群", "AOE"] },
  ];

  const DEFAULT_BOSS_PROFILES = {
    badger: {
      label: "magic-single-low-evasion",
      weights: { magic: 1.7, single: 1.25, tank: 0.75, healer: 0.55, sustain: 0.55, support: 0.3, physical: 0.2 },
      tags: ["single", "magic", "low-magic-evasion"],
    },
    chameleon: {
      label: "physical-single",
      weights: { physical: 1.35, single: 1.0, tank: 0.75, healer: 0.55, sustain: 0.4, support: 0.3 },
      tags: ["single", "physical"],
    },
    jellyfish: {
      label: "magic-sustain",
      weights: { magic: 1.0, single: 0.75, healer: 0.9, sustain: 0.9, support: 0.7, tank: 0.45 },
      tags: ["magic", "sustain", "support"],
    },
    hedgehog: {
      label: "magic-single",
      weights: { magic: 1.35, single: 1.0, healer: 0.75, sustain: 0.65, tank: 0.45, support: 0.4 },
      tags: ["single", "magic"],
    },
    swarm: {
      label: "aoe-mixed-four-targets",
      weights: { aoe: 1.8, magic: 1.0, blunt: 0.85, ranged: 0.75, stab: 0.7, slash: 0.7, physical: 0.55, healer: 0.85, tank: 0.8, support: 0.8, sustain: 0.75 },
      tags: ["aoe", "mixed-damage", "four-targets", "sustain", "support"],
    },
  };

  const CSV_HEADERS = ["name", "level", "lifeLevel", "combatLevel", "currentLife", "currentCombat", "foraging", "woodcutting", "alchemy", "enhancing", "combat", "aoe", "single", "physical", "magic", "tank", "healer", "sustain", "support", "role", "damageType", "preferLife", "preferCombat", "avoid", "fixedCombat"];
  const EMPTY_CSV = CSV_HEADERS.join(",");
  const EXAMPLE_CSV = [
    EMPTY_CSV,
    "Alice,100,95,90,foraging,badger,95,40,60,80,90,95,82,96,50,20,25,55,70,dps,physical,enhancing,chameleon,",
    "Bob,100,92,75,woodcutting,swarm,55,92,30,35,75,60,88,72,30,95,35,80,40,tank,,woodcutting,chameleon,alchemy",
    "Carol,100,91,82,alchemy,badger,88,72,91,45,65,70,63,35,82,25,96,88,85,healer,magic,alchemy,hedgehog,",
    "Dave,100,72,96,enhancing,swarm,45,38,50,72,96,80,96,45,98,30,30,60,65,dps,magic,enhancing,hedgehog,",
  ].join("\n");

  const DEFAULT_STATE = {
    membersCsv: EMPTY_CSV,
    memberDataVersion: MEMBER_DATA_VERSION,
    bossProfilesJson: JSON.stringify(DEFAULT_BOSS_PROFILES, null, 2),
    bossProfileVersion: BOSS_PROFILE_VERSION,
    lifeCapacity: 24,
    combatCapacity: 48,
    replanAll: true,
    excludeAlreadySigned: false,
    compact: false,
    remoteEndpoint: "",
    remoteGuildId: "",
    remoteLeaderToken: "",
  };

  installGuildLevelCapture();

  function installGuildLevelCapture() {
    try {
      const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const prototype = pageWindow.MessageEvent?.prototype;
      if (!prototype || pageWindow.__mwiGtaGuildLevelCaptureInstalled) return;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "data");
      if (!descriptor?.get) return;
      const originalGet = descriptor.get;
      descriptor.get = function () {
        const message = originalGet.call(this);
        captureGuildLevelMessage(message);
        return message;
      };
      Object.defineProperty(prototype, "data", descriptor);
      pageWindow.__mwiGtaGuildLevelCaptureInstalled = true;
    } catch (_) {
      // 页面结构不支持监听时，仍可使用成员姓名和手工 CSV。
    }
  }

  function captureGuildLevelMessage(message) {
    if (typeof message !== "string" || (!message.includes("guild_characters_updated") && !message.includes("guild_trial_signup_updated"))) return;
    try {
      const data = JSON.parse(message);
      if (data.type === "guild_trial_signup_updated") {
        const cache = readGuildLevelCache();
        const entry = Object.values(cache).find((item) => String(item.characterId) === String(data.characterId));
        if (!entry) return;
        entry.lifeTrialKey = matchLifeTrialKey(data.signedUpSkillingTrialHrid);
        entry.combatTrialKey = matchCombatTrialKey(data.signedUpCombatTrialHrid);
        entry.lifeLevel = entry.lifeTrialKey ? extractLevelValue(data.trialSignupLevels || {}, "life") : 0;
        entry.combatLevel = entry.combatTrialKey ? extractLevelValue(data.trialSignupLevels || {}, "combat") : 0;
        entry.capturedAt = new Date().toISOString();
        localStorage.setItem(GUILD_LEVEL_CACHE_KEY, JSON.stringify(cache));
        return;
      }
      if (data.type !== "guild_characters_updated") return;
      const sharableMap = data.guildSharableCharacterMap || {};
      const guildCharacterMap = data.guildCharacterMap || {};
      const signupLevelMap = data.guildTrialSignupLevelMap || {};
      const cache = readGuildLevelCache();

      Object.entries(sharableMap).forEach(([characterId, sharable]) => {
        const name = String(sharable?.name || "").trim();
        if (!name) return;
        const guildCharacter = guildCharacterMap[characterId] || {};
        const signupLevels = signupLevelMap[characterId] || {};
        const lifeLevel = guildCharacter.signedUpSkillingTrialHrid ? extractLevelValue(signupLevels, "life") : 0;
        const combatLevel = guildCharacter.signedUpCombatTrialHrid ? extractLevelValue(signupLevels, "combat") : 0;
        const generalLevel = extractLevelValue(sharable, "general");
        const lifeTrialKey = matchLifeTrialKey(guildCharacter.signedUpSkillingTrialHrid);
        const combatTrialKey = matchCombatTrialKey(guildCharacter.signedUpCombatTrialHrid);
        const previous = cache[normalizeText(name)] || {};
        cache[normalizeText(name)] = {
          ...previous,
          name,
          characterId,
          level: generalLevel || previous.level || 0,
          lifeLevel: lifeLevel || 0,
          combatLevel: combatLevel || previous.combatLevel || 0,
          lifeTrialKey: lifeTrialKey || "",
          combatTrialKey: combatTrialKey || "",
          capturedAt: new Date().toISOString(),
        };
      });
      localStorage.setItem(GUILD_LEVEL_CACHE_KEY, JSON.stringify(cache));
    } catch (_) {
      // 忽略非 JSON 消息或未来版本中不兼容的数据结构。
    }
  }

  function extractLevelValue(value, kind) {
    const candidates = [];
    const visit = (current, path, depth) => {
      if (depth > 3 || current == null) return;
      if (typeof current === "number" && Number.isFinite(current) && current > 0) {
        candidates.push({ path: normalizeText(path), value: current });
        return;
      }
      if (typeof current !== "object") return;
      Object.entries(current).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key, depth + 1));
    };
    visit(value, "", 0);
    const patterns = kind === "life"
      ? [/skilling/, /skill/, /life/]
      : kind === "combat"
        ? [/combat/, /battle/]
        : [/totallevel/, /characterlevel/, /^level$/];
    for (const pattern of patterns) {
      const match = candidates.find((candidate) => pattern.test(candidate.path));
      if (match) return Math.round(match.value);
    }
    return kind === "general" ? 0 : Math.round(Math.max(0, ...candidates.map((candidate) => candidate.value)));
  }

  function matchLifeTrialKey(hrid) {
    const text = normalizeText(hrid);
    if (!text) return "";
    return LIFE_TRIALS.find((trial) => [trial.key, trial.zh, ...trial.aliases].some((alias) => text.includes(normalizeText(alias))))?.key || "";
  }

  function matchCombatTrialKey(hrid) {
    const text = normalizeText(hrid);
    if (!text) return "";
    return COMBAT_TRIALS.find((trial) => [trial.key, trial.zh, ...trial.aliases].some((alias) => text.includes(normalizeText(alias))))?.key || "";
  }

  function readGuildLevelCache() {
    try {
      return JSON.parse(localStorage.getItem(GUILD_LEVEL_CACHE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    #mwi-gta-launcher {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      width: 44px;
      height: 44px;
      border: 1px solid rgba(141, 166, 255, .65);
      border-radius: 8px;
      background: #252b3f;
      color: #b6ff6a;
      font-weight: 800;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
      cursor: pointer;
    }
    #mwi-gta-panel {
      position: fixed;
      right: 16px;
      top: 84px;
      z-index: 2147483647;
      width: min(680px, calc(100vw - 32px));
      max-height: calc(100vh - 110px);
      display: none;
      grid-template-rows: auto auto 1fr auto;
      border: 1px solid rgba(141, 166, 255, .55);
      border-radius: 8px;
      background: #202538;
      color: #e6ebff;
      box-shadow: 0 14px 42px rgba(0, 0, 0, .48);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    #mwi-gta-panel[data-open="1"] { display: grid; }
    #mwi-gta-panel * { box-sizing: border-box; }
    .mwi-gta-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(141, 166, 255, .25);
      background: #2a3047;
    }
    .mwi-gta-title { color: #7dff48; font-weight: 800; font-size: 15px; }
    .mwi-gta-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .mwi-gta-btn {
      min-height: 30px;
      border: 1px solid rgba(141, 166, 255, .42);
      border-radius: 6px;
      background: #343c59;
      color: #eef3ff;
      padding: 5px 9px;
      cursor: pointer;
      font: inherit;
    }
    .mwi-gta-btn.primary { background: #5367dd; border-color: #8091ff; font-weight: 700; }
    .mwi-gta-btn.warn { background: #574034; border-color: #b78867; }
    .mwi-gta-tabs {
      display: flex;
      gap: 6px;
      padding: 8px 10px 0;
      background: #202538;
    }
    .mwi-gta-tab {
      border: 1px solid rgba(141, 166, 255, .32);
      border-bottom: 0;
      border-radius: 7px 7px 0 0;
      padding: 6px 12px;
      background: #262c42;
      color: #bfc9ef;
      cursor: pointer;
    }
    .mwi-gta-tab.active { background: #333b58; color: #fff; font-weight: 700; }
    .mwi-gta-body {
      overflow: auto;
      padding: 12px;
      min-height: 300px;
    }
    .mwi-gta-view { display: none; }
    .mwi-gta-view.active { display: block; }
    .mwi-gta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .mwi-gta-field {
      display: grid;
      gap: 4px;
      color: #c9d3ff;
    }
    .mwi-gta-field input,
    .mwi-gta-field textarea {
      width: 100%;
      border: 1px solid rgba(141, 166, 255, .32);
      border-radius: 6px;
      background: #151a29;
      color: #f3f6ff;
      padding: 7px 8px;
      font: inherit;
    }
    .mwi-gta-field textarea { min-height: 220px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .mwi-gta-check {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #c9d3ff;
      margin: 8px 0 12px;
    }
    .mwi-gta-note {
      margin: 0 0 10px;
      color: #aeb9df;
    }
    .mwi-gta-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      background: #181d2d;
    }
    .mwi-gta-table th,
    .mwi-gta-table td {
      border-bottom: 1px solid rgba(141, 166, 255, .16);
      padding: 7px 8px;
      text-align: left;
      vertical-align: top;
    }
    .mwi-gta-table th {
      position: sticky;
      top: 0;
      background: #29304a;
      color: #dfe6ff;
      z-index: 1;
    }
    .mwi-gta-pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border-radius: 6px;
      padding: 2px 6px;
      background: #313a59;
      color: #dce5ff;
      margin: 1px 3px 1px 0;
      white-space: nowrap;
    }
    .mwi-gta-pill.life { background: #234d42; color: #bfffe8; }
    .mwi-gta-pill.combat { background: #4a344d; color: #ffd1ff; }
    .mwi-gta-foot {
      border-top: 1px solid rgba(141, 166, 255, .2);
      padding: 8px 12px;
      color: #aeb9df;
      background: #1a1f31;
    }
    @media (max-width: 620px) {
      .mwi-gta-grid { grid-template-columns: 1fr; }
      .mwi-gta-actions { justify-content: flex-end; }
    }
  `;
  document.documentElement.appendChild(style);

  const state = loadState();
  let latestPlan = null;
  let remoteMembers = [];

  const launcher = document.createElement("button");
  launcher.id = "mwi-gta-launcher";
  launcher.type = "button";
  launcher.title = "公会试炼分配助手";
  launcher.textContent = "试";
  document.body.appendChild(launcher);

  const panel = document.createElement("section");
  panel.id = "mwi-gta-panel";
  panel.innerHTML = `
    <div class="mwi-gta-head">
      <div class="mwi-gta-title">公会试炼分配助手</div>
      <div class="mwi-gta-actions">
        <button class="mwi-gta-btn" data-action="scan">读取页面</button>
        <button class="mwi-gta-btn" data-action="members">读取成员/等级</button>
        <button class="mwi-gta-btn" data-action="profile">读取当前资料</button>
        <button class="mwi-gta-btn primary" data-action="plan">生成分配</button>
        <button class="mwi-gta-btn" data-action="copy">复制结果</button>
        <button class="mwi-gta-btn" data-action="close">关闭</button>
      </div>
    </div>
    <div class="mwi-gta-tabs">
      <button class="mwi-gta-tab active" data-tab="plan">分配</button>
      <button class="mwi-gta-tab" data-tab="settings">设置</button>
      <button class="mwi-gta-tab" data-tab="help">说明</button>
    </div>
    <div class="mwi-gta-body">
      <div class="mwi-gta-view active" data-view="plan">
        <p class="mwi-gta-note" id="mwi-gta-status">先点“读取页面”或直接“生成分配”。</p>
        <div id="mwi-gta-trials"></div>
        <div id="mwi-gta-result"></div>
      </div>
      <div class="mwi-gta-view" data-view="settings">
        <div class="mwi-gta-grid">
          <label class="mwi-gta-field">生活试炼默认名额
            <input id="mwi-gta-life-cap" type="number" min="1" max="200">
          </label>
          <label class="mwi-gta-field">战斗试炼默认名额
            <input id="mwi-gta-combat-cap" type="number" min="1" max="200">
          </label>
        </div>
        <label class="mwi-gta-check">
          <input id="mwi-gta-replan-all" type="checkbox">
          重新规划全部报名：当前报名仅用于生成改报名单，不占用最终名额
        </label>
        <label class="mwi-gta-check">
          <input id="mwi-gta-exclude-signed" type="checkbox">
          读取到“未参加/未报名”名单时，只给未报名成员分配
        </label>
        <div class="mwi-gta-grid">
          <label class="mwi-gta-field">角色导出绑定成员名
            <input id="mwi-gta-simulator-name" type="text" placeholder="导出无 characterName 时必填">
          </label>
        </div>
        <label class="mwi-gta-field">角色战斗导出 JSON
          <textarea id="mwi-gta-simulator-json" spellcheck="false" placeholder="粘贴模拟器导出 JSON；食物和饮料会被忽略"></textarea>
        </label>
        <div class="mwi-gta-actions" style="margin:8px 0 12px">
          <button class="mwi-gta-btn" data-action="read-simulator">一键读取并导入本角色</button>
          <button class="mwi-gta-btn" data-action="import-simulator">导入上述 JSON</button>
        </div>
        <div class="mwi-gta-grid">
          <label class="mwi-gta-field">远程服务地址
            <input id="mwi-gta-remote-endpoint" type="url" placeholder="https://your-project.vercel.app">
          </label>
          <label class="mwi-gta-field">公会 ID
            <input id="mwi-gta-remote-guild" type="text" placeholder="例如 guild-cn-1">
          </label>
        </div>
        <label class="mwi-gta-field">会长令牌
          <input id="mwi-gta-remote-token" type="password" autocomplete="off" placeholder="Vercel 环境变量中的 LEADER_TOKEN">
        </label>
        <div class="mwi-gta-actions" style="margin:8px 0 12px">
          <button class="mwi-gta-btn" data-action="remote-config">同步试炼和会员名单</button>
          <button class="mwi-gta-btn" data-action="remote-pull">拉取会员上传</button>
          <button class="mwi-gta-btn primary" data-action="remote-publish">发布当前方案</button>
        </div>
        <label class="mwi-gta-field">成员 CSV
          <textarea id="mwi-gta-csv" spellcheck="false"></textarea>
        </label>
        <label class="mwi-gta-field">Boss 属性权重 JSON
          <textarea id="mwi-gta-boss-profiles" spellcheck="false"></textarea>
        </label>
        <div class="mwi-gta-actions">
          <button class="mwi-gta-btn primary" data-action="save">保存设置</button>
          <button class="mwi-gta-btn" data-action="example">填入示例</button>
          <button class="mwi-gta-btn warn" data-action="reset">重置</button>
        </div>
      </div>
      <div class="mwi-gta-view" data-view="help">
        <p class="mwi-gta-note">CSV 第一行必须是表头。评分应基于试炼所选配装的快照，不计消耗品，并包含当前公会建筑和神龛增益；数值越高越优先。</p>
        <table class="mwi-gta-table">
          <tbody>
            <tr><th>字段</th><td>name 必填；自动字段为 level/lifeLevel/combatLevel/currentLife/currentCombat；生活字段支持 milking/foraging/woodcutting/cheesesmithing/crafting/tailoring/cooking/brewing/alchemy/enhancing；战斗字段支持 combat/aoe/single/physical/magic/stab/slash/blunt/ranged/tank/healer/sustain/support/power、role、damageType。减益角色可设 role=debuff，并用 fixedCombat 固定到本周某场战斗试炼。</td></tr>
            <tr><th>Boss 属性</th><td>支持獾、变色龙、水母、刺猬、虫群五种遭遇。按当周两个 Boss 的属性权重分配，并检查成员边际贡献是否足以抵消每名参与者带来的 1% 怪物 HP 增长。</td></tr>
            <tr><th>周规则</th><td>每周五 00:00 UTC 重置；每人最多报名 1 场生活和 1 场战斗。试炼与正常行动并行，使用报名配装快照且不使用消耗品，从 Lv.100 起每层 +10，最高 Lv.300。</td></tr>
            <tr><th>分配</th><td>fixedCombat 是硬约束，会先占位；剩余名额按近似 Leximin 优先提高最弱组的折算强度。生活自动读取值是专业等级，也可手填每小时有效产出，后者更准确。</td></tr>
            <tr><th>偏好</th><td>preferLife、preferCombat 可填 key 或中文名，会给该成员加分。avoid 可用英文逗号或竖线分隔多个不想去的试炼。</td></tr>
            <tr><th>页面读取</th><td>在“试炼”页读取试炼和名额；在“成员”页读取姓名和报名方向。打开公开成员资料后，可在“概览”或“专业”页点击“读取当前资料”，缓存总等级、战斗等级、战力和10项生活等级。</td></tr>
            <tr><th>角色导出</th><td>可粘贴模拟器角色 JSON，或读取其他兼容脚本公开的 MWI_INTEGRATED.getSimulatorData()。导入战斗等级、武器类别、非生产装备、能力与战斗房屋摘要；试炼禁用的食物和饮料不会计入。导出没有角色名时必须手工绑定或先打开对应成员资料。</td></tr>
            <tr><th>会员端</th><td>同步试炼时会把成员 CSV 中的姓名保存为本周公会名单。会员填写相同公会 ID 后，按当前角色名匹配名单并上传。该模式没有会员令牌，无法防止懂接口的人伪造同名请求。</td></tr>
            <tr><th>边界</th><td>脚本不直接报名、不调用隐藏接口、不代替会长权限；输出的是推荐表和可复制名单。</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="mwi-gta-foot">本地计算；数据保存在浏览器 localStorage。</div>
  `;
  document.body.appendChild(panel);

  const el = {
    status: panel.querySelector("#mwi-gta-status"),
    trials: panel.querySelector("#mwi-gta-trials"),
    result: panel.querySelector("#mwi-gta-result"),
    csv: panel.querySelector("#mwi-gta-csv"),
    bossProfiles: panel.querySelector("#mwi-gta-boss-profiles"),
    lifeCap: panel.querySelector("#mwi-gta-life-cap"),
    combatCap: panel.querySelector("#mwi-gta-combat-cap"),
    replanAll: panel.querySelector("#mwi-gta-replan-all"),
    excludeSigned: panel.querySelector("#mwi-gta-exclude-signed"),
    simulatorName: panel.querySelector("#mwi-gta-simulator-name"),
    simulatorJson: panel.querySelector("#mwi-gta-simulator-json"),
    remoteEndpoint: panel.querySelector("#mwi-gta-remote-endpoint"),
    remoteGuild: panel.querySelector("#mwi-gta-remote-guild"),
    remoteToken: panel.querySelector("#mwi-gta-remote-token"),
  };

  hydrateSettings();
  renderTrialSummary(scanPageTrials());

  launcher.addEventListener("click", () => {
    const open = panel.dataset.open === "1";
    panel.dataset.open = open ? "0" : "1";
    if (!open) {
      renderTrialSummary(scanPageTrials());
    }
  });

  el.replanAll.addEventListener("change", () => {
    el.excludeSigned.disabled = el.replanAll.checked;
  });

  panel.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      switchTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "close") panel.dataset.open = "0";
    if (action === "scan") renderTrialSummary(scanPageTrials(), true);
    if (action === "members") importMembersFromPage();
    if (action === "profile") captureCurrentProfile();
    if (action === "read-simulator") readCompatibleSimulatorExport();
    if (action === "import-simulator") importSimulatorExport(el.simulatorJson.value);
    if (action === "remote-config") syncRemoteConfig();
    if (action === "remote-pull") pullRemoteMembers();
    if (action === "remote-publish") publishRemotePlan();
    if (action === "plan") buildAndRenderPlan();
    if (action === "copy") copyPlan();
    if (action === "save") saveSettings();
    if (action === "example") {
      el.csv.value = EXAMPLE_CSV;
      saveSettings();
    }
    if (action === "reset") {
      localStorage.removeItem(STORAGE_KEY);
      Object.assign(state, DEFAULT_STATE);
      hydrateSettings();
      setStatus("已重置为默认设置。");
    }
  });

  function switchTab(name) {
    panel.querySelectorAll(".mwi-gta-tab").forEach((node) => {
      node.classList.toggle("active", node.dataset.tab === name);
    });
    panel.querySelectorAll(".mwi-gta-view").forEach((node) => {
      node.classList.toggle("active", node.dataset.view === name);
    });
  }

  function hydrateSettings() {
    el.csv.value = state.membersCsv;
    el.bossProfiles.value = state.bossProfilesJson;
    el.lifeCap.value = state.lifeCapacity;
    el.combatCap.value = state.combatCapacity;
    el.replanAll.checked = !!state.replanAll;
    el.excludeSigned.checked = !!state.excludeAlreadySigned;
    el.excludeSigned.disabled = !!state.replanAll;
    el.remoteEndpoint.value = state.remoteEndpoint || "";
    el.remoteGuild.value = state.remoteGuildId || "";
    el.remoteToken.value = state.remoteLeaderToken || "";
  }

  function saveSettings() {
    state.membersCsv = el.csv.value.trim();
    state.bossProfilesJson = el.bossProfiles.value.trim() || JSON.stringify(DEFAULT_BOSS_PROFILES, null, 2);
    state.lifeCapacity = clampNumber(el.lifeCap.value, 24);
    state.combatCapacity = clampNumber(el.combatCap.value, 48);
    state.replanAll = el.replanAll.checked;
    state.excludeAlreadySigned = el.excludeSigned.checked;
    state.remoteEndpoint = el.remoteEndpoint.value.trim();
    state.remoteGuildId = el.remoteGuild.value.trim();
    state.remoteLeaderToken = el.remoteToken.value.trim();
    el.excludeSigned.disabled = !!state.replanAll;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus("设置已保存。");
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const merged = { ...DEFAULT_STATE, ...saved };
      if (Number(saved.memberDataVersion || 0) < MEMBER_DATA_VERSION && saved.membersCsv === EXAMPLE_CSV) {
        merged.membersCsv = EMPTY_CSV;
        merged.memberDataVersion = MEMBER_DATA_VERSION;
      }
      if (Number(saved.bossProfileVersion || 0) < BOSS_PROFILE_VERSION) {
        let savedProfiles = {};
        try {
          savedProfiles = JSON.parse(saved.bossProfilesJson || "{}");
        } catch (_) {
          savedProfiles = {};
        }
        merged.bossProfilesJson = JSON.stringify({
          ...savedProfiles,
          badger: DEFAULT_BOSS_PROFILES.badger,
          swarm: DEFAULT_BOSS_PROFILES.swarm,
        }, null, 2);
        merged.bossProfileVersion = BOSS_PROFILE_VERSION;
      }
      return merged;
    } catch (_) {
      return { ...DEFAULT_STATE };
    }
  }

  function scanPageTrials() {
    const lifeTrials = LIFE_TRIALS
      .map((trial) => readTrialFromPage(trial, "life"))
      .filter(Boolean);
    const combatTrials = COMBAT_TRIALS
      .map((trial) => readTrialFromPage(trial, "combat"))
      .filter(Boolean);

    return {
      life: uniqueByKey(lifeTrials).slice(0, 4),
      combat: uniqueByKey(combatTrials).slice(0, 2),
      unsignedNames: readUnsignedNames(),
    };
  }

  function readTrialFromPage(trial, type) {
    const registration = readRegistrationFromTrialCard(trial);
    if (!registration) return null;
    return { ...trial, type, signed: registration.signed, capacity: registration.capacity, source: "trial-card" };
  }

  function readRegistrationFromTrialCard(trial) {
    const normalizedAliases = [trial.key, trial.zh, ...trial.aliases].map(normalizeText);
    const allTrials = [...LIFE_TRIALS, ...COMBAT_TRIALS];
    const candidates = Array.from(document.querySelectorAll("div, section, article, li, button"))
      .filter((node) => !node.closest("#mwi-gta-panel"))
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
        const text = (node.innerText || "").trim();
        const normalized = normalizeText(text);
        if (!text || text.length > 1200 || !normalizedAliases.some((alias) => normalized.includes(alias))) return null;
        const knownTrialCount = allTrials.filter((knownTrial) => {
          const names = [knownTrial.key, knownTrial.zh, ...knownTrial.aliases].map(normalizeText);
          return names.some((name) => normalized.includes(name));
        }).length;
        if (knownTrialCount !== 1) return null;
        const match = text.match(/(?:已报名|Registered|Signed\s*up|报名)\s*(\d+)\s*\/\s*(\d+)/i);
        if (!match) return null;
        return {
          signed: Math.max(0, Number(match[1]) || 0),
          capacity: Math.max(1, Number(match[2]) || 1),
          textLength: text.length,
          childCount: node.querySelectorAll("*").length,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.textLength - b.textLength || a.childCount - b.childCount);
    return candidates[0] || null;
  }

  function readUnsignedNames() {
    const rows = Array.from(document.querySelectorAll("tr, [role='row']"));
    const names = [];
    rows.forEach((row) => {
      if (row.closest("#mwi-gta-panel")) return;
      const text = normalizeText(row.innerText || "");
      if (!text || !/(未参加|未报名|not joined|not signed|unregistered)/i.test(text)) return;
      const name = (row.innerText || "").split(/\n|\t/).map((part) => part.trim()).find(Boolean);
      if (name && name.length <= 40) names.push(name);
    });
    return Array.from(new Set(names));
  }

  function renderTrialSummary(trials, scanned) {
    const life = trials.life;
    const combat = trials.combat;

    el.trials.innerHTML = `
      <div>
        ${life.map((trial) => `<span class="mwi-gta-pill life">${escapeHtml(trial.zh)} ${Number.isFinite(trial.signed) ? trial.signed + "/" : "名额"}${trial.capacity}</span>`).join("")}
        ${combat.map((trial) => `<span class="mwi-gta-pill combat">${escapeHtml(trial.zh)} ${Number.isFinite(trial.signed) ? trial.signed + "/" : "名额"}${trial.capacity}</span>`).join("")}
        ${!life.length && !combat.length ? `<span class="mwi-gta-note">尚未读取试炼报名数据</span>` : ""}
      </div>
    `;
    if (scanned) {
      const count = trials.unsignedNames.length ? `，读取到未报名成员 ${trials.unsignedNames.length} 人` : "";
      if (!trials.life.length && !trials.combat.length) setStatus("未识别到试炼报名数据，请切换到公会“试炼”页后重试。");
      else setStatus(`已在试炼卡片中验证：生活 ${trials.life.length}/4，战斗 ${trials.combat.length}/2${count}。`);
    }
  }

  function importMembersFromPage() {
    const names = readGuildMemberNames();
    if (!names.length) {
      setStatus("未识别到公会成员表，请切换到公会“成员”页后重试。");
      return;
    }
    const levelCache = readGuildLevelCache();
    const records = names.map((name) => {
      const cached = levelCache[normalizeText(name)] || {};
      const values = {
        ...(cached.simulatorValues || {}),
        level: cached.level,
        lifeLevel: cached.lifeLevel,
        combatLevel: cached.combatLevel,
        combat: cached.combatLevel,
        power: cached.power,
        currentLife: cached.lifeTrialKey,
        currentCombat: cached.combatTrialKey,
        ...(cached.profileSkills || {}),
      };
      if (cached.lifeTrialKey && cached.lifeLevel) values[cached.lifeTrialKey] = cached.lifeLevel;
      return { name, values };
    });
    const levelCount = records.filter((record) => Object.values(record.values).some((value) => numberValue(value) > 0)).length;
    el.csv.value = mergeMemberRecordsIntoCsv(el.csv.value, records);
    saveSettings();
    switchTab("settings");
    setStatus(`已合并 ${names.length} 名成员，其中 ${levelCount} 人读取到游戏已推送的等级；手工评分未覆盖。`);
  }

  function captureCurrentProfile() {
    const modal = findVisibleProfileModal();
    if (!modal) {
      setStatus("未识别到公开成员资料，请先打开成员资料的“概览”或“专业”页。");
      return;
    }
    const name = readProfileName(modal);
    if (!name) {
      setStatus("已找到资料窗口，但未识别到成员名。");
      return;
    }
    const text = modal.innerText || "";
    const totalLevel = readLabeledProfileNumber(text, ["总等级", "Total Level"]);
    const combatLevel = readLabeledProfileNumber(text, ["战斗等级", "Combat Level"]);
    const power = readLabeledProfileNumber(text, ["战力评分", "Combat Power", "Power Rating"]);
    const levelMatches = Array.from(text.matchAll(/Lv\.?\s*(\d+)/gi)).map((match) => Number(match[1])).filter((value) => value > 0);
    const profileSkills = {};
    if (levelMatches.length >= LIFE_TRIALS.length) {
      LIFE_TRIALS.forEach((trial, index) => {
        profileSkills[trial.key] = levelMatches[index];
      });
    }
    if (!totalLevel && !combatLevel && !power && !Object.keys(profileSkills).length) {
      setStatus("资料窗口当前页没有可读取数值，请切换到“概览”或“专业”页后重试。");
      return;
    }

    const cache = readGuildLevelCache();
    const key = normalizeText(name);
    const previous = cache[key] || { name };
    cache[key] = {
      ...previous,
      name,
      level: totalLevel || previous.level || 0,
      combatLevel: combatLevel || previous.combatLevel || 0,
      power: power || previous.power || 0,
      profileSkills: { ...(previous.profileSkills || {}), ...profileSkills },
      profileCapturedAt: new Date().toISOString(),
    };
    localStorage.setItem(GUILD_LEVEL_CACHE_KEY, JSON.stringify(cache));

    const values = {
      level: cache[key].level,
      combatLevel: cache[key].combatLevel,
      combat: cache[key].combatLevel,
      power: cache[key].power,
      ...cache[key].profileSkills,
    };
    el.csv.value = mergeMemberRecordsIntoCsv(el.csv.value, [{ name, values }]);
    saveSettings();
    const captured = [totalLevel ? "概览" : "", Object.keys(profileSkills).length ? "10项专业" : ""].filter(Boolean).join("+");
    setStatus(`已读取 ${name}：${captured || "公开数值"}，并合并到成员 CSV。`);
  }

  async function readCompatibleSimulatorExport() {
    try {
      const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const getter = pageWindow.MWI_INTEGRATED?.getSimulatorData;
      if (typeof getter !== "function") {
        setStatus("未找到兼容脚本的角色导出接口，请把角色 JSON 粘贴到设置页后导入。");
        switchTab("settings");
        return;
      }
      const data = await Promise.resolve(getter());
      if (!data) throw new Error("兼容脚本尚未收到完整角色数据，请刷新游戏后重试。");
      el.simulatorJson.value = JSON.stringify(data, null, 2);
      if (data.characterName) el.simulatorName.value = String(data.characterName).trim();
      importSimulatorExport(data);
    } catch (error) {
      setStatus(`读取角色导出失败：${error.message}`);
      switchTab("settings");
    }
  }

  function importSimulatorExport(input) {
    try {
      const modal = findVisibleProfileModal();
      const profileName = modal ? readProfileName(modal) : "";
      const record = buildSimulatorImportRecord(input, el.simulatorName.value, profileName);
      const cache = readGuildLevelCache();
      const key = normalizeText(record.name);
      const previous = cache[key] || { name: record.name };
      cache[key] = {
        ...previous,
        name: record.name,
        combatLevel: record.values.combatLevel || previous.combatLevel || 0,
        simulatorValues: { ...(previous.simulatorValues || {}), ...record.values },
        simulatorProfile: record.profile,
        simulatorCapturedAt: new Date().toISOString(),
      };
      localStorage.setItem(GUILD_LEVEL_CACHE_KEY, JSON.stringify(cache));
      el.csv.value = mergeMemberRecordsIntoCsv(el.csv.value, [{ name: record.name, values: record.values }]);
      el.simulatorName.value = record.name;
      saveSettings();
      switchTab("settings");
      setStatus(`已导入 ${record.name}：战斗等级 ${record.values.combatLevel || 0}，战斗装备 ${record.values.combatEquipmentCount || 0} 件，能力 ${record.values.abilityCount || 0} 个；食物和饮料未计入。`);
    } catch (error) {
      setStatus(`导入角色 JSON 失败：${error.message}`);
      switchTab("settings");
    }
  }

  function findVisibleProfileModal() {
    return Array.from(document.querySelectorAll("div, [role='dialog']"))
      .filter((node) => !node.closest("#mwi-gta-panel") && node.getClientRects().length > 0)
      .map((node) => ({ node, text: (node.innerText || "").trim() }))
      .filter(({ text }) => text.length > 20 && text.length < 6000)
      .filter(({ text }) => ["概览", "专业", "装备", "房屋"].every((label) => text.includes(label)))
      .filter(({ text }) => /总等级|战斗等级|Lv\.?\s*\d+/i.test(text))
      .sort((a, b) => a.text.length - b.text.length)[0]?.node || null;
  }

  function readProfileName(modal) {
    const named = modal.querySelector('[class*="CharacterName_name"], [class*="characterName"]');
    if (named?.textContent?.trim()) return named.textContent.trim();
    const ignored = new Set(["概览", "专业", "装备", "房屋", "成就完成"]);
    return (modal.innerText || "").split(/\n+/).map((line) => line.trim()).find((line) => line && line.length <= 40 && !ignored.has(line) && !/^(Lv\.?|总等级|战斗等级|成就|任务积分|迷宫积分|最高层数|收藏点数|图鉴点数|年龄|战力评分)/i.test(line)) || "";
  }

  function readLabeledProfileNumber(text, labels) {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*([\\d,.]+)`, "i"));
      if (match) return Number(match[1].replace(/,/g, "")) || 0;
    }
    return 0;
  }

  function parseSimulatorExport(text) {
    let data;
    try {
      data = typeof text === "string" ? JSON.parse(text) : text;
    } catch (_) {
      throw new Error("角色导出 JSON 格式错误。");
    }
    if (!data?.player || typeof data.player !== "object") {
      throw new Error("角色导出缺少 player 数据。");
    }

    const numeric = (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : 0;
    };
    const levels = {
      meleeLevel: numeric(data.player.meleeLevel),
      defenseLevel: numeric(data.player.defenseLevel),
      magicLevel: numeric(data.player.magicLevel),
      rangedLevel: numeric(data.player.rangedLevel),
      attackLevel: numeric(data.player.attackLevel),
      intelligenceLevel: numeric(data.player.intelligenceLevel),
      staminaLevel: numeric(data.player.staminaLevel),
    };
    const maxCombatSkill = Math.max(levels.meleeLevel, levels.rangedLevel, levels.magicLevel);
    const maxAllCombat = Math.max(levels.attackLevel, levels.defenseLevel, levels.meleeLevel, levels.rangedLevel, levels.magicLevel);
    const computedCombatLevel = Math.floor(0.1 * (
      levels.staminaLevel + levels.intelligenceLevel + levels.attackLevel + levels.defenseLevel + maxCombatSkill
    ) + 0.5 * maxAllCombat);
    const combatLevel = numeric(data.combatLevel) || computedCombatLevel;

    const productionLocations = new Set([
      "/item_locations/woodcutting_tool",
      "/item_locations/foraging_tool",
      "/item_locations/milking_tool",
      "/item_locations/cheesesmithing_tool",
      "/item_locations/crafting_tool",
      "/item_locations/tailoring_tool",
      "/item_locations/cooking_tool",
      "/item_locations/brewing_tool",
      "/item_locations/alchemy_tool",
      "/item_locations/enhancing_tool",
    ]);
    const equipment = Array.isArray(data.player.equipment)
      ? data.player.equipment.map((item) => ({
        itemLocationHrid: String(item?.itemLocationHrid || ""),
        itemHrid: String(item?.itemHrid || ""),
        enhancementLevel: numeric(item?.enhancementLevel),
      })).filter((item) => item.itemLocationHrid && item.itemHrid)
      : [];
    const combatEquipment = equipment.filter((item) => !productionLocations.has(item.itemLocationHrid));
    const mainHand = combatEquipment.find((item) => ["/item_locations/main_hand", "/item_locations/two_hand"].includes(item.itemLocationHrid))?.itemHrid || "";
    const offHand = combatEquipment.find((item) => item.itemLocationHrid === "/item_locations/off_hand")?.itemHrid || "";
    const weaponName = mainHand.split("/").pop() || "";
    const offHandName = offHand.split("/").pop() || "";
    let weaponType = "";
    if (offHandName.includes("bulwark") || weaponName.includes("bulwark")) weaponType = "bulwark";
    else if (weaponName.includes("crossbow")) weaponType = "crossbow";
    else if (weaponName.includes("bow") || weaponName === "gobo_shooter") weaponType = "bow";
    else if (weaponName.includes("water") || weaponName.includes("rippling") || weaponName.includes("frost")) weaponType = "water";
    else if (weaponName.includes("fire") || weaponName.includes("blazing") || weaponName.includes("infernal") || weaponName === "gobo_boomstick") weaponType = "fire";
    else if (weaponName.includes("nature") || weaponName.includes("blooming") || weaponName.includes("jackalope")) weaponType = "nature";
    else if (weaponName.includes("sword") || weaponName.includes("slasher")) weaponType = "sword";
    else if (weaponName.includes("mace") || weaponName.includes("flail") || weaponName.includes("smasher") || weaponName.includes("bludgeon")) weaponType = "blunt";
    else if (weaponName.includes("spear") || weaponName.includes("stabber")) weaponType = "spear";

    const magicWeapon = ["water", "fire", "nature"].includes(weaponType);
    const rangedWeapon = ["bow", "crossbow"].includes(weaponType);
    const physicalWeapon = rangedWeapon || ["sword", "blunt", "spear", "bulwark"].includes(weaponType);
    const damageType = magicWeapon ? "magic" : physicalWeapon ? "physical" : "";
    const abilities = Array.isArray(data.abilities)
      ? data.abilities.map((ability) => ({
        abilityHrid: String(ability?.abilityHrid || ""),
        level: numeric(ability?.level),
      })).filter((ability) => ability.abilityHrid)
      : [];
    const abilityTriggers = Object.fromEntries(Object.entries(data.triggerMap || {})
      .filter(([hrid]) => hrid.startsWith("/abilities/")));
    const abilityLevelByTarget = (target) => Math.max(0, ...abilities
      .filter((ability) => (abilityTriggers[ability.abilityHrid] || []).some((trigger) => String(trigger?.dependencyHrid || "").includes(target)))
      .map((ability) => ability.level));
    const supportAbilityLevel = Math.max(0, ...abilities
      .filter((ability) => /aura|veil|revive/i.test(ability.abilityHrid))
      .map((ability) => ability.level));
    const houseRooms = Object.fromEntries(Object.entries(data.houseRooms || {})
      .map(([hrid, level]) => [hrid, numeric(typeof level === "object" ? level?.level : level)])
      .filter(([, level]) => level > 0));
    const combatHouseNames = ["dining_room", "library", "dojo", "gym", "armory", "archery_range", "mystical_study"];
    const combatHouseLevelSum = Object.entries(houseRooms)
      .filter(([hrid]) => combatHouseNames.some((name) => hrid.includes(name)))
      .reduce((sum, [, level]) => sum + level, 0);
    const values = {
      ...levels,
      level: numeric(data.totalLevel),
      combatLevel,
      combat: combatLevel,
      weaponType,
      damageType,
      equipmentCount: equipment.length,
      combatEquipmentCount: combatEquipment.length,
      maxEnhancement: Math.max(0, ...combatEquipment.map((item) => item.enhancementLevel)),
      abilityCount: abilities.length,
      maxAbilityLevel: Math.max(0, ...abilities.map((ability) => ability.level)),
      combatHouseLevelSum,
    };
    const aoeAbilityLevel = abilityLevelByTarget("all_enemies");
    const singleAbilityLevel = abilityLevelByTarget("targeted_enemy");
    const healerAbilityLevel = abilityLevelByTarget("all_allies");
    if (aoeAbilityLevel) values.aoe = aoeAbilityLevel;
    if (singleAbilityLevel) values.single = singleAbilityLevel;
    if (healerAbilityLevel) values.healer = healerAbilityLevel;
    if (supportAbilityLevel) values.support = supportAbilityLevel;
    if (magicWeapon) values.magic = levels.magicLevel;
    if (physicalWeapon) values.physical = Math.max(levels.meleeLevel, levels.rangedLevel);
    if (rangedWeapon) values.ranged = levels.rangedLevel;
    if (weaponType === "sword") values.slash = levels.meleeLevel;
    if (weaponType === "blunt") values.blunt = levels.meleeLevel;
    if (weaponType === "spear") values.stab = levels.meleeLevel;
    if (weaponType === "bulwark") values.role = "tank";

    return {
      name: String(data.characterName || "").trim(),
      values,
      profile: {
        player: { ...levels, equipment: combatEquipment },
        abilities,
        triggerMap: abilityTriggers,
        houseRooms,
        totalLevel: numeric(data.totalLevel),
        combatLevel,
        buildScore: numeric(data.buildScore),
        weaponType,
        importedAt: new Date().toISOString(),
      },
    };
  }

  function buildSimulatorImportRecord(input, enteredName, profileName) {
    const record = parseSimulatorExport(input);
    const exportedName = record.name.trim();
    const manualName = String(enteredName || "").trim();
    const visibleProfileName = String(profileName || "").trim();
    const normalizeName = (value) => value.toLowerCase().replace(/\s+/g, "");
    if (exportedName && manualName && normalizeName(exportedName) !== normalizeName(manualName)) {
      throw new Error(`导出角色名 ${exportedName} 与绑定成员名 ${manualName} 不一致。`);
    }
    const name = exportedName || manualName || visibleProfileName;
    if (!name) throw new Error("导出没有角色名，请填写绑定成员名或打开对应成员资料。");
    return { ...record, name };
  }

  async function pullRemoteMembers() {
    try {
      saveSettings();
      remoteMembers = await fetchRemoteMembers();
      const records = remoteMembers.map((member) => ({
        name: member.name,
        values: { ...(member.values || {}), ...(member.lifeSkills || {}) },
      }));
      el.csv.value = mergeMemberRecordsIntoCsv(el.csv.value, records);
      const cache = readGuildLevelCache();
      remoteMembers.forEach((member) => {
        const key = normalizeText(member.name);
        cache[key] = {
          ...(cache[key] || {}),
          name: member.name,
          remoteMemberId: member.memberId,
          remoteCapturedAt: member.updatedAt,
          simulatorValues: { ...(cache[key]?.simulatorValues || {}), ...(member.values || {}), ...(member.lifeSkills || {}) },
        };
      });
      localStorage.setItem(GUILD_LEVEL_CACHE_KEY, JSON.stringify(cache));
      saveSettings();
      setStatus(`已拉取并合并 ${remoteMembers.length} 名会员的本周上传；手工评分未覆盖。`);
      switchTab("settings");
    } catch (error) {
      setStatus(`拉取会员上传失败：${error.message}`);
      switchTab("settings");
    }
  }

  async function syncRemoteConfig() {
    try {
      saveSettings();
      const trials = scanPageTrials();
      if (trials.life.length !== 4 || trials.combat.length !== 2) throw new Error(`试炼数据不完整：生活 ${trials.life.length}/4、战斗 ${trials.combat.length}/2。`);
      let bossProfiles = {};
      try { bossProfiles = JSON.parse(state.bossProfilesJson || "{}"); }
      catch (_) { throw new Error("Boss 属性 JSON 无法解析。"); }
      const roster = readRemoteRoster();
      const payload = buildRemoteConfigPayload(trials, state.remoteGuildId, getCurrentWeekId(), bossProfiles, roster);
      await remoteApi("/v1/leader/config", "PUT", payload);
      setStatus(`本周试炼、Boss 权重和 ${payload.memberNames.length} 名会员名单已同步。`);
    } catch (error) {
      setStatus(`同步本周试炼失败：${error.message}`);
    }
  }

  async function publishRemotePlan() {
    try {
      if (!latestPlan) buildAndRenderPlan();
      if (!latestPlan) throw new Error("请先生成完整分配方案。");
      saveSettings();
      if (!remoteMembers.length) remoteMembers = await fetchRemoteMembers();
      const weekId = getCurrentWeekId();
      let bossProfiles = {};
      try { bossProfiles = JSON.parse(state.bossProfilesJson || "{}"); }
      catch (_) { throw new Error("Boss 属性 JSON 无法解析。"); }
      const roster = readRemoteRoster();
      await remoteApi("/v1/leader/config", "PUT", buildRemoteConfigPayload({
        life: latestPlan.lifeAssignments.map((group) => group.trial),
        combat: latestPlan.combatAssignments.map((group) => group.trial),
      }, state.remoteGuildId, weekId, bossProfiles, roster));
      const payload = buildRemoteAssignmentPayload(latestPlan, state.remoteGuildId, weekId, remoteMembers);
      const result = await remoteApi("/v1/leader/assignment", "PUT", payload);
      setStatus(`已发布本周方案，${result.memberCount} 名已上传会员可在会员端查看。`);
    } catch (error) {
      setStatus(`发布方案失败：${error.message}`);
    }
  }

  async function fetchRemoteMembers() {
    const data = await remoteApi(`/v1/leader/submissions?guildId=${encodeURIComponent(state.remoteGuildId)}&weekId=${encodeURIComponent(getCurrentWeekId())}`, "GET");
    return Array.isArray(data.members) ? data.members : [];
  }

  async function remoteApi(path, method, body) {
    const endpoint = String(state.remoteEndpoint || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(endpoint)) throw new Error("远程服务地址必须使用 HTTPS。");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(state.remoteGuildId || "")) throw new Error("公会 ID 只能包含字母、数字、下划线和连字符。");
    if (!state.remoteLeaderToken) throw new Error("请填写会长令牌。");
    const response = await fetch(`${endpoint}${path}`, {
      method,
      headers: { Authorization: `Bearer ${state.remoteLeaderToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function buildRemoteAssignmentPayload(plan, guildId, weekId, uploadedMembers) {
    const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
    const members = {};
    const memberByName = new Map();
    (uploadedMembers || []).forEach((member) => {
      const memberId = String(member?.memberId || "").trim();
      const name = String(member?.name || "").trim();
      if (!memberId || !name) return;
      members[memberId] = { name, life: null, combat: null };
      memberByName.set(normalize(name), memberId);
    });
    const assign = (groups, type) => {
      (groups || []).forEach((group) => {
        (group.members || []).forEach((assigned) => {
          const memberId = memberByName.get(normalize(assigned.name));
          if (!memberId) return;
          members[memberId][type] = {
            trialKey: group.trial.key,
            trialName: group.trial.zh || group.trial.key,
            score: Number(assigned.score) || 0,
            reason: String(assigned.note || ""),
          };
        });
      });
    };
    assign(plan?.lifeAssignments, "life");
    assign(plan?.combatAssignments, "combat");
    return { guildId, weekId, generatedAt: plan?.generatedAt || "", members };
  }

  function buildRemoteConfigPayload(trials, guildId, weekId, bossProfiles, rosterMembers) {
    const names = new Map();
    (rosterMembers || []).forEach((member) => {
      const name = String(member?.name || member || "").trim().slice(0, 40);
      const key = name.toLowerCase().replace(/\s+/g, "");
      if (key && !names.has(key)) names.set(key, name);
    });
    return {
      guildId,
      weekId,
      lifeTrials: (trials?.life || []).map((trial) => ({ key: trial.key, zh: trial.zh || trial.key, capacity: Number(trial.capacity) || 0, signed: Number(trial.signed) || 0 })),
      combatTrials: (trials?.combat || []).map((trial) => ({ key: trial.key, zh: trial.zh || trial.key, capacity: Number(trial.capacity) || 0, signed: Number(trial.signed) || 0 })),
      memberNames: [...names.values()],
      bossProfiles: bossProfiles || {},
    };
  }

  function readRemoteRoster() {
    const members = parseCsv(state.membersCsv).map(normalizeMember).filter((member) => member.name);
    if (!members.length) throw new Error("成员 CSV 为空，请先在公会成员页读取成员。");
    return members;
  }

  function getCurrentWeekId() {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysSinceFriday = (now.getUTCDay() - 5 + 7) % 7;
    return new Date(midnight - daysSinceFriday * 86400000).toISOString().slice(0, 10);
  }

  function copyText(text, successMessage) {
    if (!text) { setStatus("没有可复制的内容。"); return; }
    if (typeof GM_setClipboard === "function") GM_setClipboard(text);
    else navigator.clipboard?.writeText(text);
    setStatus(successMessage);
  }

  function readGuildMemberNames() {
    const tables = Array.from(document.querySelectorAll("table, [role='table']"))
      .filter((table) => !table.closest("#mwi-gta-panel"))
      .filter((table) => {
        const text = normalizeText(table.innerText || "");
        return text.includes("成员") && (text.includes("职位") || text.includes("状态"));
      });
    const names = [];
    const collectRow = (row, requireRole) => {
        const cells = row.querySelectorAll("td, [role='cell']");
        if (!cells.length) return;
        const name = (cells[0].innerText || "").split(/\n+/).map((part) => part.trim()).find(Boolean) || "";
        if (!name || name.length > 40 || /^(成员|member|name|玩家)$/i.test(name)) return;
        if (requireRole) {
          const role = normalizeText(cells[1]?.innerText || "");
          if (!/(会长|将军|官员|会员|leader|general|officer|member)/i.test(role)) return;
        }
        names.push(name);
    };
    tables.forEach((table) => {
      table.querySelectorAll("tr, [role='row']").forEach((row) => collectRow(row, false));
    });
    if (!tables.length) {
      document.querySelectorAll("tr, [role='row']").forEach((row) => {
        if (!row.closest("#mwi-gta-panel")) collectRow(row, true);
      });
    }
    return Array.from(new Set(names));
  }

  function buildAndRenderPlan() {
    latestPlan = null;
    saveSettings();
    const pageTrials = scanPageTrials();
    renderTrialSummary(pageTrials);
    if (pageTrials.life.length !== 4 || pageTrials.combat.length !== 2) {
      setStatus(`试炼数据不完整：识别到生活 ${pageTrials.life.length}/4、战斗 ${pageTrials.combat.length}/2。请在公会“试炼”页重新读取。`);
      return;
    }
    const trials = { life: pageTrials.life, combat: pageTrials.combat };

    const members = parseCsv(state.membersCsv).map(normalizeMember).filter((member) => member.name);
    if (!members.length) {
      el.result.innerHTML = "";
      setStatus("成员 CSV 为空。请在“成员”页点击“读取成员”，再补充能力评分。");
      return;
    }
    const unsigned = new Set(pageTrials.unsignedNames.map(normalizeText));
    const eligibleMembers = !state.replanAll && state.excludeAlreadySigned && unsigned.size
      ? members.filter((member) => unsigned.has(normalizeText(member.name)))
      : members;

    const lifeAssignments = assignLifeByBestSkill(eligibleMembers, trials.life);
    const combatAssignments = assignCombatByGuildRules(eligibleMembers, trials.combat);
    latestPlan = {
      generatedAt: new Date().toLocaleString(),
      lifeAssignments,
      combatAssignments,
      unassignedLife: findUnassigned(eligibleMembers, lifeAssignments),
      unassignedCombat: findUnassigned(eligibleMembers, combatAssignments),
      cancelLife: findSignupCancellations(eligibleMembers, lifeAssignments, "life"),
      cancelCombat: findSignupCancellations(eligibleMembers, combatAssignments, "combat"),
      trials,
    };
    renderPlan(latestPlan);
  }

  function assignLifeByBestSkill(members, trials) {
    const buckets = new Map(trials.map((trial) => [trial.key, {
      trial,
      members: [],
      fairnessActive: trialAvailableCapacity(trial) > 0,
    }]));
    const candidates = members.map((member) => {
      const scores = trials.map((trial) => ({ trial, score: scoreMember(member, trial, "life") }))
        .filter((option) => option.score > 0)
        .sort((a, b) => b.score - a.score);
      return {
        member,
        scores,
        edge: (scores[0]?.score || 0) - (scores[1]?.score || 0),
      };
    }).filter((candidate) => candidate.scores.length);

    candidates.sort((a, b) => {
      if (b.edge !== a.edge) return b.edge - a.edge;
      if (b.scores[0].score !== a.scores[0].score) return b.scores[0].score - a.scores[0].score;
      return a.member.name.localeCompare(b.member.name);
    });

    candidates.forEach((candidate) => {
      const options = candidate.scores.filter((option) => hasCapacity(buckets.get(option.trial.key)));
      const choice = chooseLeximinOption(options, buckets, scaledGroupStrength);
      if (!choice) return;
      const bucket = buckets.get(choice.trial.key);
      bucket.members.push({
        name: candidate.member.name,
        score: Math.round(choice.score * 10) / 10,
        note: ["近似Leximin均衡", makeSignupChangeReason(candidate.member, bucket.trial, "life")].filter(Boolean).join("、"),
      });
    });

    const noScoreMembers = members.filter((member) => trials.every((trial) => scoreMember(member, trial, "life") <= 0));
    assignFallbackMembers(
      noScoreMembers,
      buckets,
      "缺少生活评分，均衡兜底",
      "life"
    );

    return Array.from(buckets.values());
  }

  function assignCombatByGuildRules(members, trials) {
    return assignCombatByBossProfiles(members, trials, readBossProfiles());
  }

  function assignCombatByBossProfiles(members, trials, profiles) {
    const buckets = new Map(trials.map((trial) => [trial.key, {
      trial,
      members: [],
      fairnessActive: trialAvailableCapacity(trial) > 0,
    }]));
    const fixedMembers = new Set(members.filter((member) => member.fixedCombat));
    const fixedCandidates = Array.from(fixedMembers).map((member) => {
      const trial = trials.find((item) => matchesPreference(member.fixedCombat, item));
      if (!trial) return null;
      const score = Math.max(0, scoreCombatByProfile({ ...member, avoid: new Set() }, trial, profiles[trial.key]));
      return { member, trial, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name));

    fixedCandidates.forEach((candidate) => {
      const bucket = buckets.get(candidate.trial.key);
      if (!hasCapacity(bucket)) return;
      const reason = makeCombatProfileReason(candidate.member, candidate.trial, profiles[candidate.trial.key]);
      bucket.members.push({
        name: candidate.member.name,
        score: Math.round(candidate.score * 10) / 10,
        note: ["固定位置", reason, makeSignupChangeReason(candidate.member, candidate.trial, "combat")].filter(Boolean).join("、"),
      });
    });

    const candidates = members.filter((member) => !fixedMembers.has(member)).map((member) => {
      const scores = trials.map((trial) => ({
        trial,
        score: scoreCombatByProfile(member, trial, profiles[trial.key]),
      })).sort((a, b) => b.score - a.score);
      const best = scores[0]?.score || 0;
      const second = scores[1]?.score || 0;
      return { member, scores, edge: best - second };
    }).filter((candidate) => candidate.scores.length && candidate.scores[0].score > 0);

    candidates.sort((a, b) => {
      if (b.edge !== a.edge) return b.edge - a.edge;
      if (b.scores[0].score !== a.scores[0].score) return b.scores[0].score - a.scores[0].score;
      return a.member.name.localeCompare(b.member.name);
    });

    candidates.forEach((candidate) => {
      const options = candidate.scores.filter((option) => {
        const bucket = buckets.get(option.trial.key);
        return canJoinCombat(candidate.member, bucket) && passesCombatScaling(bucket, option.score);
      });
      const choice = chooseLeximinOption(options, buckets, scaledGroupStrength);
      if (!choice) return;
      const bucket = buckets.get(choice.trial.key);
      const reason = makeCombatProfileReason(candidate.member, choice.trial, profiles[choice.trial.key]);
      bucket.members.push({
        name: candidate.member.name,
        score: Math.round(choice.score * 10) / 10,
        note: [reason, "近似Leximin均衡", "人数缩放通过", makeSignupChangeReason(candidate.member, bucket.trial, "combat")].filter(Boolean).join("、"),
      });
    });

    return Array.from(buckets.values());
  }

  function compareLeximinVectors(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left[index] ?? -Infinity) - (right[index] ?? -Infinity);
      if (Math.abs(difference) > 1e-9) return difference;
    }
    return 0;
  }

  function chooseLeximinOption(options, buckets, strengthFn) {
    let best = null;
    options.forEach((option) => {
      const bucket = buckets.get(option.trial.key);
      if (!bucket) return;
      bucket.members.push({ score: option.score });
      const vector = Array.from(buckets.values())
        .filter((item) => item.fairnessActive !== false)
        .map((item) => strengthFn(item))
        .sort((a, b) => a - b);
      bucket.members.pop();
      const comparison = best ? compareLeximinVectors(vector, best.vector) : 1;
      if (comparison > 0 || (comparison === 0 && option.score > best.option.score)) {
        best = { option, vector };
      }
    });
    return best?.option || null;
  }

  function scaledGroupStrength(bucket) {
    const total = bucket.members.reduce((sum, member) => {
      const score = Number(member.score);
      return sum + (Number.isFinite(score) ? score : 0);
    }, 0);
    return total / (1 + 0.01 * bucket.members.length);
  }

  function passesCombatScaling(bucket, candidateScore) {
    if (candidateScore <= 0) return false;
    const scores = bucket.members.map((member) => numberValue(member.score)).filter((score) => score > 0);
    const assignedPower = scores.reduce((sum, score) => sum + score, 0);
    const averagePower = scores.length ? assignedPower / scores.length : candidateScore;
    const signedCount = !state.replanAll && Number.isFinite(bucket.trial.signed) ? bucket.trial.signed : 0;
    const estimatedCurrentPower = assignedPower + signedCount * averagePower;
    const currentParticipants = signedCount + scores.length;
    if (estimatedCurrentPower <= 0) return true;
    const requiredMarginalPower = 0.01 * estimatedCurrentPower / (1 + 0.01 * currentParticipants);
    return candidateScore >= requiredMarginalPower;
  }

  function assignFallbackMembers(members, buckets, note, type) {
    members.forEach((member) => {
      const bucket = Array.from(buckets.values())
        .filter((item) => item.members.length < trialAvailableCapacity(item.trial))
        .sort((a, b) => {
          const aCapacity = Math.max(1, trialAvailableCapacity(a.trial));
          const bCapacity = Math.max(1, trialAvailableCapacity(b.trial));
          const pressure = a.members.length / aCapacity - b.members.length / bCapacity;
          if (pressure !== 0) return pressure;
          return a.trial.key.localeCompare(b.trial.key);
        })[0];
      if (!bucket) return;
      bucket.members.push({ name: member.name, score: 0, note: [note, makeSignupChangeReason(member, bucket.trial, type)].filter(Boolean).join("、") });
    });
  }

  function readBossProfiles() {
    try {
      return { ...DEFAULT_BOSS_PROFILES, ...JSON.parse(state.bossProfilesJson || "{}") };
    } catch (_) {
      setStatus("Boss 属性 JSON 解析失败，已使用默认权重。");
      return DEFAULT_BOSS_PROFILES;
    }
  }

  function scoreCombatByProfile(member, trial, profile) {
    if (member.avoid.has(trial.key) || member.avoid.has(trial.zh)) return -9999;
    const weights = profile?.weights || {};
    const base = numberValue(member.raw[trial.key]) || numberValue(member.raw[trial.zh]) || numberValue(member.raw.combat) || 0;
    let weighted = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([key, weight]) => {
      if (weight <= 0) return;
      const value = combatAttributeValue(member, key, trial);
      totalWeight += weight;
      if (value > 0) weighted += value * weight;
    });

    let score = totalWeight ? weighted / totalWeight : base;
    if (base && weighted > 0) score = score * 0.8 + base * 0.2;
    else if (base) score = base;
    if (matchesPreference(member.preferCombat, trial)) score += 8;
    return score;
  }

  function combatAttributeValue(member, key, trial) {
    if (key === "single") return numberValue(member.raw.single) || (trial.style === "single" ? numberValue(member.raw.combat) : 0);
    if (key === "aoe") return numberValue(member.raw.aoe) || (trial.style === "aoe" ? numberValue(member.raw.combat) : 0);
    if (key === "physical") return numberValue(member.raw.physical) || (member.damageType === "physical" ? numberValue(member.raw.combat) : 0);
    if (key === "magic") return numberValue(member.raw.magic) || (member.damageType === "magic" ? numberValue(member.raw.combat) : 0);
    if (key === "tank") return numberValue(member.raw.tank) || (member.role === "tank" ? memberCombatPower(member) : 0);
    if (key === "healer") return numberValue(member.raw.healer) || (member.role === "healer" ? memberCombatPower(member) : 0);
    if (key === "sustain") return numberValue(member.raw.sustain) || numberValue(member.raw.survival) || numberValue(member.raw.defense);
    if (key === "support") return numberValue(member.raw.support) || numberValue(member.raw.aura) || numberValue(member.raw.revive) || numberValue(member.raw.debuff) || (member.role === "debuff" ? memberCombatPower(member) : 0);
    return numberValue(member.raw[key]);
  }

  function makeCombatProfileReason(member, trial, profile) {
    const tags = profile?.tags || [];
    const reasons = [];
    if (tags.includes("aoe")) reasons.push("AOE");
    if (tags.includes("physical") && member.damageType === "physical") reasons.push("物理适配");
    if (tags.includes("magic") && member.damageType === "magic") reasons.push("法系适配");
    if (tags.includes("low-magic-evasion")) reasons.push("低魔闪374");
    if (tags.includes("four-targets")) reasons.push("四目标混编");
    if (tags.includes("mixed-damage") && (member.role === "tank" || member.role === "healer")) reasons.push("混合伤害应对");
    if (tags.includes("sustain") && (member.role === "healer" || numberValue(member.raw.sustain))) reasons.push("续航");
    if (tags.includes("support") && numberValue(member.raw.support)) reasons.push("辅助");
    if (matchesPreference(member.preferCombat, trial)) reasons.push("偏好");
    return reasons.join("、") || profile?.label || "";
  }

  function assignRatioPool(members, buckets, ratios, note) {
    const ordered = [...members].sort((a, b) => memberCombatPower(b) - memberCombatPower(a));
    const counts = Object.fromEntries(Object.keys(ratios).map((key) => [key, 0]));
    ordered.forEach((member) => {
      const targetKey = Object.keys(ratios)
        .filter((key) => canJoinCombat(member, buckets.get(key)))
        .sort((a, b) => {
          const aPressure = counts[a] / Math.max(0.01, ratios[a]);
          const bPressure = counts[b] / Math.max(0.01, ratios[b]);
          return aPressure - bPressure;
        })[0];
      const bucket = buckets.get(targetKey);
      if (!bucket) return;
      bucket.members.push({
        name: member.name,
        score: Math.round(memberCombatPower(member) * 10) / 10,
        note,
      });
      counts[targetKey] += 1;
    });
  }

  function assignPreferredPool(members, buckets, trialKeys, note) {
    const ordered = [...members].sort((a, b) => memberCombatPower(b) - memberCombatPower(a));
    ordered.forEach((member) => {
      const key = trialKeys.find((trialKey) => canJoinCombat(member, buckets.get(trialKey)));
      const bucket = buckets.get(key);
      if (!bucket) return;
      bucket.members.push({
        name: member.name,
        score: Math.round(memberCombatPower(member) * 10) / 10,
        note,
      });
    });
  }

  function hasCapacity(bucket) {
    return bucket && bucket.members.length < trialAvailableCapacity(bucket.trial);
  }

  function trialAvailableCapacity(trial) {
    if (state.replanAll) return trial.capacity;
    if (!Number.isFinite(trial.signed)) return trial.capacity;
    return Math.max(0, trial.capacity - trial.signed);
  }

  function combatHpMultiplier(group) {
    const signedCount = !state.replanAll && Number.isFinite(group.trial.signed) ? group.trial.signed : 0;
    return 1 + 0.01 * (signedCount + group.members.length);
  }

  function canJoinCombat(member, bucket) {
    if (!hasCapacity(bucket)) return false;
    return !member.avoid.has(bucket.trial.key) && !member.avoid.has(bucket.trial.zh);
  }

  function memberCombatPower(member) {
    return Math.max(
      numberValue(member.raw.combat),
      numberValue(member.raw.single),
      numberValue(member.raw.aoe),
      numberValue(member.raw.power)
    );
  }

  function assignGroup(members, trials, type) {
    const buckets = new Map(trials.map((trial) => [trial.key, { trial, members: [] }]));
    const candidates = [];

    members.forEach((member) => {
      const scores = trials.map((trial) => ({
        trial,
        score: scoreMember(member, trial, type),
      })).sort((a, b) => b.score - a.score);
      if (!scores.length || scores[0].score <= 0) return;
      const best = scores[0].score;
      const second = scores[1]?.score || 0;
      candidates.push({ member, scores, edge: best - second });
    });

    candidates.sort((a, b) => {
      if (b.edge !== a.edge) return b.edge - a.edge;
      return b.scores[0].score - a.scores[0].score;
    });

    candidates.forEach((candidate) => {
      for (const option of candidate.scores) {
        const bucket = buckets.get(option.trial.key);
        if (!bucket) continue;
        if (bucket.members.length >= trialAvailableCapacity(option.trial)) continue;
        if (option.score <= 0) continue;
        bucket.members.push({
          name: candidate.member.name,
          score: Math.round(option.score * 10) / 10,
          note: makeReason(candidate.member, option.trial, type),
        });
        break;
      }
    });

    return Array.from(buckets.values());
  }

  function scoreMember(member, trial, type) {
    if (member.avoid.has(trial.key) || member.avoid.has(trial.zh)) return -9999;
    let score = 0;
    if (type === "life") {
      score = numberValue(member.raw[trial.key]) || numberValue(member.raw[trial.zh]) || 0;
    } else {
      const combat = numberValue(member.raw.combat) || 0;
      const styleScore = numberValue(member.raw[trial.style]) || 0;
      const direct = numberValue(member.raw[trial.key]) || numberValue(member.raw[trial.zh]) || 0;
      score = Math.max(direct, combat, styleScore ? combat * 0.55 + styleScore * 0.45 : combat);
    }
    if (matchesPreference(member.preferLife, trial) && type === "life") score += 8;
    if (matchesPreference(member.preferCombat, trial) && type === "combat") score += 8;
    return score;
  }

  function makeReason(member, trial, type) {
    const reasons = [];
    if (type === "combat" && trial.style === "aoe") reasons.push("AOE");
    if (matchesPreference(member.preferLife, trial) || matchesPreference(member.preferCombat, trial)) reasons.push("偏好");
    return reasons.join("、");
  }

  function makeSignupChangeReason(member, trial, type) {
    if (!state.replanAll) return "";
    const current = type === "life" ? member.currentLife : member.currentCombat;
    if (!current) return "新报名";
    if (matchesPreference(current, trial)) return "保持原报名";
    return `改报 ${current}→${trial.zh}`;
  }

  function matchesPreference(pref, trial) {
    if (!pref) return false;
    const normalized = normalizeText(pref);
    return normalizeText(trial.key) === normalized || normalizeText(trial.zh) === normalized || trial.aliases.some((alias) => normalizeText(alias) === normalized);
  }

  function findUnassigned(members, groups) {
    const assigned = new Set();
    groups.forEach((group) => group.members.forEach((member) => assigned.add(member.name)));
    return members.map((member) => member.name).filter((name) => !assigned.has(name));
  }

  function findSignupCancellations(members, groups, type) {
    if (!state.replanAll) return [];
    const assigned = new Set();
    groups.forEach((group) => group.members.forEach((member) => assigned.add(member.name)));
    return members
      .filter((member) => (type === "life" ? member.currentLife : member.currentCombat) && !assigned.has(member.name))
      .map((member) => member.name);
  }

  function renderPlan(plan) {
    const lifeHtml = renderAssignmentTable("生活试炼", plan.lifeAssignments);
    const combatHtml = renderAssignmentTable("战斗试炼", plan.combatAssignments);
    el.result.innerHTML = `
      ${lifeHtml}
      ${combatHtml}
      <table class="mwi-gta-table">
        <tbody>
          <tr><th>生活未分配</th><td>${escapeHtml(plan.unassignedLife.join(", ") || "无")}</td></tr>
          <tr><th>战斗未分配</th><td>${escapeHtml(plan.unassignedCombat.join(", ") || "无")}</td></tr>
          <tr><th>需取消生活报名</th><td>${escapeHtml(plan.cancelLife.join(", ") || "无")}</td></tr>
          <tr><th>需取消战斗报名</th><td>${escapeHtml(plan.cancelCombat.join(", ") || "无")}</td></tr>
        </tbody>
      </table>
    `;
    const fallbackLife = plan.lifeAssignments.reduce((count, group) => count + group.members.filter((member) => member.note.includes("缺少生活评分")).length, 0);
    const fallback = fallbackLife ? `；生活兜底 ${fallbackLife} 人` : "";
    const combatSkipped = plan.unassignedCombat.length ? `；战斗未分配 ${plan.unassignedCombat.length} 人（缺少评分、缩放不足或名额已满）` : "";
    setStatus(`已生成分配：${plan.generatedAt}${fallback}${combatSkipped}`);
  }

  function renderAssignmentTable(title, groups) {
    const rows = groups.map((group) => {
      const names = group.members.map((member) => `${escapeHtml(member.name)} <span style="color:#9fb0dd">(${member.score}${member.note ? ", " + escapeHtml(member.note) : ""})</span>`).join("<br>");
      const available = trialAvailableCapacity(group.trial);
      const signedLabel = state.replanAll ? "当前乱报" : "已报";
      const signed = Number.isFinite(group.trial.signed) ? `<br><span style="color:#8792b7">${signedLabel} ${group.trial.signed}/${group.trial.capacity}</span>` : "";
      const hpScale = group.trial.type === "combat" ? `<br><span style="color:#8792b7">预计HP ×${combatHpMultiplier(group).toFixed(2)}</span>` : "";
      const totalScore = group.members.reduce((sum, member) => sum + numberValue(member.score), 0);
      const effective = Math.round(scaledGroupStrength(group) * 10) / 10;
      const strength = `<br><span style="color:#bfffe8">总值 ${Math.round(totalScore * 10) / 10} / 折算 ${effective}</span>`;
      return `<tr><td>${escapeHtml(group.trial.zh)}</td><td>${group.members.length}/${available}${signed}${strength}${hpScale}</td><td>${names || "<span style='color:#8792b7'>无</span>"}</td></tr>`;
    }).join("");
    return `
      <table class="mwi-gta-table">
        <thead><tr><th colspan="3">${escapeHtml(title)}</th></tr><tr><th>试炼</th><th>人数</th><th>成员</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function copyPlan() {
    if (!latestPlan) buildAndRenderPlan();
    if (!latestPlan) return;
    const text = formatPlanText(latestPlan);
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
    } else {
      navigator.clipboard?.writeText(text);
    }
    setStatus("结果已复制到剪贴板。");
  }

  function formatPlanText(plan) {
    const lines = [`公会试炼推荐分配 ${plan.generatedAt}`, ""];
    const fallbackLife = plan.lifeAssignments.reduce((count, group) => count + group.members.filter((member) => String(member.note).includes("缺少生活评分")).length, 0);
    if (fallbackLife) lines.push(`提示：生活 ${fallbackLife} 人缺少评分，已按剩余名额均衡兜底。`, "");
    if (plan.unassignedCombat.length) lines.push(`提示：战斗 ${plan.unassignedCombat.length} 人因缺少评分、边际贡献不足或名额已满而未分配。`, "");
    lines.push("生活试炼");
    plan.lifeAssignments.forEach((group) => {
      const totalScore = group.members.reduce((sum, member) => sum + numberValue(member.score), 0);
      lines.push(`${group.trial.zh} (建议 ${group.members.length}/${trialAvailableCapacity(group.trial)}，当前报名 ${group.trial.signed}/${group.trial.capacity}，总值 ${Math.round(totalScore * 10) / 10}，折算强度 ${Math.round(scaledGroupStrength(group) * 10) / 10}): ${group.members.map((member) => `${member.name}(${member.score}${member.note ? ", " + member.note : ""})`).join(", ") || "-"}`);
    });
    lines.push("", "战斗试炼");
    plan.combatAssignments.forEach((group) => {
      lines.push(`${group.trial.zh} (建议 ${group.members.length}/${trialAvailableCapacity(group.trial)}，当前报名 ${group.trial.signed}/${group.trial.capacity}，折算强度 ${Math.round(scaledGroupStrength(group) * 10) / 10}，预计HP ×${combatHpMultiplier(group).toFixed(2)}): ${group.members.map((member) => `${member.name}(${member.score}${member.note ? ", " + member.note : ""})`).join(", ") || "-"}`);
    });
    if (plan.unassignedLife.length) lines.push("", `生活未分配: ${plan.unassignedLife.join(", ")}`);
    if (plan.unassignedCombat.length) lines.push(`战斗未分配: ${plan.unassignedCombat.join(", ")}`);
    if (plan.cancelLife.length) lines.push(`需取消生活报名: ${plan.cancelLife.join(", ")}`);
    if (plan.cancelCombat.length) lines.push(`需取消战斗报名: ${plan.cancelCombat.join(", ")}`);
    return lines.join("\n");
  }

  function mergeMemberRecordsIntoCsv(text, records) {
    const rows = parseCsvRows(text);
    const headers = rows.length ? rows[0].map((header) => header.trim()) : [...CSV_HEADERS];
    let nameIndex = headers.findIndex((header) => ["name", "player", "玩家"].includes(normalizeText(header)));
    if (nameIndex < 0) {
      headers.unshift("name");
      rows.slice(1).forEach((row) => row.unshift(""));
      nameIndex = 0;
    }
    const dataRows = rows.length ? rows.slice(1) : [];
    const rowByName = new Map(dataRows.map((row) => [normalizeText(row[nameIndex] || ""), row]).filter(([name]) => name));
    const ensureHeader = (key) => {
      let index = headers.findIndex((header) => normalizeText(header) === normalizeText(key));
      if (index >= 0) return index;
      headers.push(key);
      dataRows.forEach((row) => row.push(""));
      return headers.length - 1;
    };

    records.forEach((record) => {
      const normalizedName = normalizeText(record.name);
      let row = rowByName.get(normalizedName);
      if (!row) {
        row = Array(headers.length).fill("");
        row[nameIndex] = record.name;
        dataRows.push(row);
        rowByName.set(normalizedName, row);
      }
      Object.entries(record.values || {}).forEach(([key, value]) => {
        if (value == null || !String(value).trim() || (typeof value === "number" && value <= 0)) return;
        const index = ensureHeader(key);
        while (row.length < headers.length) row.push("");
        const serialized = typeof value === "number" ? String(Math.round(value)) : String(value).trim();
        if (["level", "lifeLevel", "combatLevel", "currentLife", "currentCombat", "power"].includes(key) || !String(row[index] || "").trim()) row[index] = serialized;
      });
    });
    return [headers, ...dataRows].map((row) => row.map(encodeCsvCell).join(",")).join("\n");
  }

  function encodeCsvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map((header) => header.trim());
    return rows.slice(1).map((cells) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = (cells[index] || "").trim();
      });
      return item;
    });
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  }

  function normalizeMember(row) {
    const avoid = new Set(String(row.avoid || "").split(/[|,，;；]/).map((value) => value.trim()).filter(Boolean));
    return {
      name: row.name || row.player || row["玩家"] || "",
      raw: row,
      role: normalizeRole(row.role || row["定位"] || row["职责"] || ""),
      damageType: normalizeDamageType(row.damageType || row["输出类型"] || row["伤害类型"] || ""),
      preferLife: row.preferLife || row["生活偏好"] || "",
      preferCombat: row.preferCombat || row["战斗偏好"] || "",
      currentLife: row.currentLife || row["当前生活报名"] || "",
      currentCombat: row.currentCombat || row["当前战斗报名"] || "",
      fixedCombat: row.fixedCombat || row["固定战斗"] || row["固定战斗试炼"] || "",
      avoid,
    };
  }

  function normalizeRole(value) {
    const text = normalizeText(value);
    if (["tank", "t", "mt", "坦克", "盾"].includes(text)) return "tank";
    if (["healer", "heal", "h", "治疗", "奶", "奶妈"].includes(text)) return "healer";
    if (["debuff", "debuffer", "减益", "弱化"].includes(text)) return "debuff";
    if (["dps", "输出", "打手"].includes(text)) return "dps";
    return text || "dps";
  }

  function normalizeDamageType(value) {
    const text = normalizeText(value);
    if (["physical", "phys", "物理", "物理输出"].includes(text)) return "physical";
    if (["magic", "magical", "mage", "法系", "魔法", "法术", "法系输出"].includes(text)) return "magic";
    return text;
  }

  function numberValue(value) {
    const num = Number(String(value ?? "").replace("%", "").trim());
    return Number.isFinite(num) ? num : 0;
  }

  function clampNumber(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(200, Math.max(1, Math.round(num)));
  }

  function normalizeText(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
  }

  function uniqueByKey(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function setStatus(message) {
    el.status.textContent = message;
  }
})();
