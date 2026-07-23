import CombatSimulator from "./combatSimulator";
import Monster from "./monster";
import Player from "./player";
import abilityDetailMap from "./data/abilityDetailMap.json";
import achievementDetailMap from "./data/achievementDetailMap.json";
import achievementTierDetailMap from "./data/achievementTierDetailMap.json";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import combatStyleDetailMap from "./data/combatStyleDetailMap.json";
import combatTriggerDependencyDetailMap from "./data/combatTriggerDependencyDetailMap.json";
import enhancementLevelTotalBonusMultiplierTable from "./data/enhancementLevelTotalBonusMultiplierTable.json";
import houseRoomDetailMap from "./data/houseRoomDetailMap.json";
import itemDetailMap from "./data/itemDetailMap.json";

const ONE_HOUR = 3600 * 1e9;
console.log = () => {};

function replaceMap(target, source) {
    if (!source || typeof source !== "object" || !Object.keys(source).length) return;
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, source);
}

function installDataMaps(dataMaps) {
    replaceMap(itemDetailMap, dataMaps.itemDetailMap);
    replaceMap(abilityDetailMap, dataMaps.abilityDetailMap);
    replaceMap(combatMonsterDetailMap, dataMaps.combatMonsterDetailMap);
    replaceMap(combatStyleDetailMap, dataMaps.combatStyleDetailMap);
    replaceMap(houseRoomDetailMap, dataMaps.houseRoomDetailMap);
    replaceMap(achievementDetailMap, dataMaps.achievementDetailMap);
    replaceMap(achievementTierDetailMap, dataMaps.achievementTierDetailMap);
    replaceMap(combatTriggerDependencyDetailMap, dataMaps.combatTriggerDependencyDetailMap);
    replaceMap(enhancementLevelTotalBonusMultiplierTable, dataMaps.enhancementLevelTotalBonusMultiplierTable);
}

class TrialZone {
    constructor(monsterHrids, level, hitpointMultiplier) {
        this.hrid = "/actions/combat/guild_trial";
        this.level = level;
        this.monsterHrids = monsterHrids;
        this.hitpointMultiplier = hitpointMultiplier;
        this.buffs = [];
        this.isDungeon = true;
        this.encountersKilled = 1;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.finalWave = false;
        this.monsterSpawnInfo = { bossSpawns: [] };
        this.dungeonSpawnInfo = {
            maxWaves: 1,
            fixedSpawnsMap: { 1: monsterHrids.map((combatMonsterHrid) => ({ combatMonsterHrid })) },
            randomSpawnInfoMap: {},
        };
    }

    getNextWave() {
        if (this.encountersKilled > 1) {
            this.dungeonsCompleted += 1;
            this.encountersKilled = 1;
        }
        this.encountersKilled += 1;
        return this.monsterHrids.map((hrid) => new Monster(hrid, 0, this.level, this.hitpointMultiplier));
    }

    failWave() {
        this.dungeonsFailed += 1;
        this.encountersKilled = 1;
    }
}

function applyLevelGapDebuff(players) {
    const combatLevel = (player) => {
        const maxCombatSkill = Math.max(player.meleeLevel, player.rangedLevel, player.magicLevel);
        const maxAllCombat = Math.max(player.attackLevel, player.defenseLevel, player.meleeLevel, player.rangedLevel, player.magicLevel);
        return Math.floor(0.1 * (player.staminaLevel + player.intelligenceLevel + player.attackLevel + player.defenseLevel + maxCombatSkill) + 0.5 * maxAllCombat);
    };
    const maximum = Math.max(1, ...players.map(combatLevel));
    players.forEach((player) => {
        const ratio = maximum / Math.max(1, combatLevel(player));
        player.debuffOnLevelGap = ratio > 1.2 ? -Math.min(0.9, 3 * (ratio - 1.2)) : 0;
    });
}

function makePlayers(playerDtos) {
    const players = playerDtos.map((dto) => Player.createFromDTO(structuredClone(dto)));
    applyLevelGapDebuff(players);
    players.forEach((player) => {
        player.zoneBuffs = [];
        player.extraBuffs = [
            { uniqueHrid: "/buff_uniques/guild_trial_hp_regen", typeHrid: "/buff_types/hp_regen", ratioBoost: 0, flatBoost: 0.02, duration: 0 },
            { uniqueHrid: "/buff_uniques/guild_trial_mp_regen", typeHrid: "/buff_types/mp_regen", ratioBoost: 0, flatBoost: 0.02, duration: 0 },
        ];
    });
    return players;
}

async function simulateTrial(payload) {
    installDataMaps(payload.dataMaps || {});
    const results = [];
    for (const level of payload.levels || []) {
        const players = makePlayers(payload.players || []);
        const zone = new TrialZone(payload.monsterHrids || [], level, payload.hpMultiplier || 1);
        const simulator = new CombatSimulator(players, zone, null);
        const result = await simulator.simulate(ONE_HOUR);
        const attempts = result.dungeonsCompleted + result.dungeonsFailed;
        results.push({
            level,
            winRate: attempts ? result.dungeonsCompleted / attempts : 0,
            averageSeconds: attempts ? (result.simulatedTime / 1e9) / attempts : 0,
            wins: result.dungeonsCompleted,
            losses: result.dungeonsFailed,
        });
        self.postMessage({ type: "trial_simulation_progress", trialKey: payload.trialKey, level });
        if (results.length >= 2 && results.slice(-2).every((item) => item.winRate === 0)) break;
    }
    return results;
}

self.onmessage = async (event) => {
    if (event.data?.type !== "trial_simulation_start") return;
    try {
        const results = await simulateTrial(event.data);
        self.postMessage({ type: "trial_simulation_result", trialKey: event.data.trialKey, trialName: event.data.trialName, results });
    } catch (error) {
        self.postMessage({ type: "trial_simulation_error", trialKey: event.data.trialKey, error: error?.message || String(error) });
    }
};
