/* MWI Combat Simulator, MIT License, Copyright (c) 2024 AmVoidGuy. Trial integration by zc. */
(function () {
const __modules = {
"trialWorker.js": function(module, exports, __require) {
const CombatSimulator = __require("combatSimulator.js");
const Monster = __require("monster.js");
const Player = __require("player.js");
const abilityDetailMap = __require("data/abilityDetailMap.json");
const achievementDetailMap = __require("data/achievementDetailMap.json");
const achievementTierDetailMap = __require("data/achievementTierDetailMap.json");
const combatMonsterDetailMap = __require("data/combatMonsterDetailMap.json");
const combatStyleDetailMap = __require("data/combatStyleDetailMap.json");
const combatTriggerDependencyDetailMap = __require("data/combatTriggerDependencyDetailMap.json");
const enhancementLevelTotalBonusMultiplierTable = __require("data/enhancementLevelTotalBonusMultiplierTable.json");
const houseRoomDetailMap = __require("data/houseRoomDetailMap.json");
const itemDetailMap = __require("data/itemDetailMap.json");
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

},
"combatSimulator.js": function(module, exports, __require) {
const CombatUtilities = __require("combatUtilities.js");
const AutoAttackEvent = __require("events/autoAttackEvent.js");
const DamageOverTimeEvent = __require("events/damageOverTimeEvent.js");
const CheckBuffExpirationEvent = __require("events/checkBuffExpirationEvent.js");
const CombatStartEvent = __require("events/combatStartEvent.js");
const ConsumableTickEvent = __require("events/consumableTickEvent.js");
const CooldownReadyEvent = __require("events/cooldownReadyEvent.js");
const EnemyRespawnEvent = __require("events/enemyRespawnEvent.js");
const EventQueue = __require("events/eventQueue.js");
const PlayerRespawnEvent = __require("events/playerRespawnEvent.js");
const RegenTickEvent = __require("events/regenTickEvent.js");
const StunExpirationEvent = __require("events/stunExpirationEvent.js");
const BlindExpirationEvent = __require("events/blindExpirationEvent.js");
const SilenceExpirationEvent = __require("events/silenceExpirationEvent.js");
const CurseExpirationEvent = __require("events/curseExpirationEvent.js");
const WeakenExpirationEvent = __require("events/weakenExpirationEvent.js");
const FuryExpirationEvent = __require("events/furyExpirationEvent.js");
const EnrageTickEvent = __require("events/enrageTickEvent.js");
const SimResult = __require("simResult.js");
const AbilityCastEndEvent = __require("events/abilityCastEndEvent.js");
const AwaitCooldownEvent = __require("events/awaitCooldownEvent.js");
const Monster = __require("monster.js");
const Ability = __require("ability.js");
const ONE_SECOND = 1e9;
const HOT_TICK_INTERVAL = 5 * ONE_SECOND;
const DOT_TICK_INTERVAL = 3 * ONE_SECOND;
const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;
const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;
const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;
const RESTART_INTERVAL = 3 * ONE_SECOND;
const ENRAGE_TICK_INTERVAL = 60 * ONE_SECOND;

class CombatSimulator extends EventTarget {
    constructor(players, zone, labyrinth, options = {}) {
        super();
        this.players = players;
        this.zone = zone;
        this.labyrinth = labyrinth;
        this.eventQueue = new EventQueue();
        this.simResult = new SimResult(zone, labyrinth, players.length);
        this.allPlayersDead = false;
        this.enableHpMpVisualization = options.enableHpMpVisualization || false;

        this.wipeLogs = {
            buffer: new Array(200),
            index: 0,
            count: 0,
            maxSize: 200
        };
    }

        addToWipeLogs(logEntry) {
        const { buffer, maxSize } = this.wipeLogs;

        buffer[this.wipeLogs.index] = logEntry;
        this.wipeLogs.index = (this.wipeLogs.index + 1) % maxSize;
        this.wipeLogs.count = Math.min(this.wipeLogs.count + 1, maxSize);
    }

    logAndResetWipeLogs() {
        const logs = this.getOrderedWipeLogs();

        // console.log("===== 团灭日志 =====");
        // console.log(`最后 ${logs.length} 条战斗日志：`);

        logs.forEach(log => {
            if (log.error) {
                console.log(log.error);
                return;
            }

            const time = (log.time / 1e9).toFixed(2);
            // console.log(
            //     `[${time}s] [${log.source}] 用 [${log.ability}] ` +
            //     `对 ${log.target} 造成 ${log.damage} 伤害，` +
            //     `HP ${log.beforeHp} → ${log.afterHp}。` +
            //     `队伍生命值：${log.playersHp.map(p => `${p.hrid}: ${p.current}/${p.max}`).join(" | ")}`
            // );
        });

        this.wipeLogs.index = 0;
        this.wipeLogs.count = 0;
        // console.log("===== 团灭日志结束 =====");
    }

    buildCombatLog(source, ability, target, damageDone) {
        try {
            const sourceHrid = source?.hrid || "UNKNOWN_SOURCE";
            const targetHrid = target?.hrid || "UNKNOWN_TARGET";

            const afterHp = target?.combatDetails?.currentHitpoints || 0;
            const beforeHp = Math.max(0, afterHp + damageDone);

            const playersHp = this.players.map(p => ({
                hrid: p.hrid || "UNKNOWN_PLAYER",
                current: p.combatDetails?.currentHitpoints ?? 0,
                max: p.combatDetails?.maxHitpoints ?? 0
            }));

            return {
                time: this.simulationTime,
                wave: (this.zone.encountersKilled - 1),
                source: sourceHrid,
                ability: ability,
                target: targetHrid,
                damage: damageDone,
                beforeHp: beforeHp,
                afterHp: afterHp,
                playersHp: playersHp,
                // enemiesHp: enemiesHp,
                isCrit: false,
            };
        } catch (e) {
            return {
                error: `[日志生成错误] ${e.message}`
            };
        }
    }

    generateCombatLog(source, ability, target, attackResult) {
        try {
            const sourceHrid = source?.hrid || "UNKNOWN_SOURCE";
            const targetHrid = target?.hrid || "UNKNOWN_TARGET";
            const damage = attackResult?.damageDone || 0;

            const afterHp = target?.combatDetails?.currentHitpoints || 0;
            const beforeHp = Math.max(0, afterHp + damage);

            const playersHp = this.players.map(p => ({
                hrid: p.hrid || "UNKNOWN_PLAYER",
                current: p.combatDetails?.currentHitpoints ?? 0,
                max: p.combatDetails?.maxHitpoints ?? 0
            }));

            return {
                time: this.simulationTime,
                wave: (this.zone.encountersKilled - 1),
                source: sourceHrid,
                ability: ability,
                target: targetHrid,
                damage: damage,
                beforeHp: beforeHp,
                afterHp: afterHp,
                playersHp: playersHp,
                // enemiesHp: enemiesHp,
                isCrit: attackResult?.isCrit || false,
            };
        } catch (e) {
            return {
                error: `[日志生成错误] ${e.message}`
            };
        }
    }

    getOrderedWipeLogs() {
        const { buffer, maxSize, count } = this.wipeLogs;
        const logs = [];

        for (let i = 0; i < count; i++) {
            const idx = (this.wipeLogs.index - count + maxSize + i) % maxSize;
            logs.push(buffer[idx]);
        }

        return logs;
    }

    saveWipeLogsToSimResult(wave) {
        const logs = this.getOrderedWipeLogs();
        this.simResult.addWipeEvent(logs, this.simulationTime, wave);
    }

    async simulate(simulationTimeLimit) {
        this.reset();

        let ticks = 0;

        let combatStartEvent = new CombatStartEvent(0);
        this.eventQueue.addEvent(combatStartEvent);

        while (this.simulationTime < simulationTimeLimit) {
            let nextEvent = this.eventQueue.getNextEvent();
            await this.processEvent(nextEvent);

            ticks++;
            if (ticks == 1000) {
                ticks = 0;
                // 收集HP/MP时序数据
                if (this.enableHpMpVisualization) {
                    this.simResult.addTimeSeriesSnapshot(this.simulationTime, this.players);
                }
                let progressEvent = new CustomEvent("progress", {
                    detail: {
                        zone: this.zone?.hrid,
                        difficultyTier: this.zone?.difficultyTier,
                        labyrinth: this.labyrinth?.hrid,
                        roomLevel: this.labyrinth?.roomLevel,
                        progress: Math.min(this.simulationTime / simulationTimeLimit, 1),
                        timeSeriesData: this.enableHpMpVisualization ? this.simResult.timeSeriesData : null
                    },
                });
                this.dispatchEvent(progressEvent);
            }
        }

        // for (let i = 0; i < this.simResult.timeSpentAlive.length; i++) {
        //     if (this.simResult.timeSpentAlive[i].alive == true) {
        //         this.simResult.updateTimeSpentAlive(this.simResult.timeSpentAlive[i].name, false, simulationTimeLimit);
        //     }
        // }

        this.simResult.isDungeon = this.zone?.isDungeon ?? false;
        if (this.zone && this.simResult.isDungeon) {
            console.log("Timeout now at wave #" + (this.zone.encountersKilled - 1));

            this.simResult.dungeonsCompleted = this.zone.dungeonsCompleted;
            this.simResult.dungeonsFailed = this.zone.dungeonsFailed;
            if (this.simResult.dungeonsCompleted < 1) {
                this.simResult.maxWaveReached = 0;
                for (let i = 1; i <= this.zone.dungeonSpawnInfo.maxWaves; i++) {
                    let waveName = "#" + i.toString();
                    const idx = this.simResult.timeSpentAlive.findIndex(e => e.name === waveName);
                    if (idx == -1 || this.simResult.timeSpentAlive[idx].count == 0) {
                        break;
                    }
                    this.simResult.maxWaveReached = i;
                }
            } else {
                this.simResult.maxWaveReached = this.zone.dungeonSpawnInfo.maxWaves;
            }
        }
        this.simResult.simulatedTime = this.simulationTime;

        for (let i = 0; i < this.players.length; i++) {
            this.simResult.setDropRateMultipliers(this.players[i]);
            this.simResult.setManaUsed(this.players[i]);
        }

        if (this.zone?.isDungeon) {
            Object.entries(this.zone.dungeonSpawnInfo.fixedSpawnsMap).forEach(([wave, monsters]) => {
                let waveName = "#" + wave.toString();
                monsters.forEach(monster => {
                    waveName += ',' + monster.combatMonsterHrid;
                });
                this.simResult.bossSpawns.push(waveName);
            });

        }
        if (this.zone?.isDungeon && this.zone.monsterSpawnInfo.bossSpawns) {
            for (const boss of this.zone.monsterSpawnInfo.bossSpawns) {
                this.simResult.bossSpawns.push(boss.combatMonsterHrid);
            }
        }
        if (this.labyrinth) {
            this.simResult.labyAttemptCount = this.labyrinth.attemptCount;
        }

        return this.simResult;
    }

    reset() {
        this.tempDungeonCount = 0;
        this.simulationTime = 0;
        this.eventQueue.clear();
        this.simResult = new SimResult(this.zone, this.labyrinth, this.players.length);
    }

    async processEvent(event) {
        this.simulationTime = event.time;

        // console.log(this.simulationTime / 1e9, event.type, event);

        switch (event.type) {
            case CombatStartEvent.type:
                this.processCombatStartEvent(event);
                break;
            case PlayerRespawnEvent.type:
                this.processPlayerRespawnEvent(event);
                break;
            case EnemyRespawnEvent.type:
                this.processEnemyRespawnEvent(event);
                break;
            case AutoAttackEvent.type:
                this.processAutoAttackEvent(event);
                break;
            case ConsumableTickEvent.type:
                this.processConsumableTickEvent(event);
                break;
            case DamageOverTimeEvent.type:
                this.processDamageOverTimeTickEvent(event);
                break;
            case CheckBuffExpirationEvent.type:
                this.processCheckBuffExpirationEvent(event);
                break;
            case RegenTickEvent.type:
                this.processRegenTickEvent(event);
                break;
            case StunExpirationEvent.type:
                this.processStunExpirationEvent(event);
                break;
            case BlindExpirationEvent.type:
                this.processBlindExpirationEvent(event);
                break;
            case SilenceExpirationEvent.type:
                this.processSilenceExpirationEvent(event);
                break;
            case CurseExpirationEvent.type:
                this.processCurseExpirationEvent(event);
                break;
            case WeakenExpirationEvent.type:
                this.processWeakenExpirationEvent(event);
                break;
            case FuryExpirationEvent.type:
                this.processFuryExpirationEvent(event);
                break;
            case EnrageTickEvent.type:
                this.processEnrageTickEvent(event);
                break;
            case AbilityCastEndEvent.type:
                this.tryUseAbility(event.source, event.ability);
                break;
            case AwaitCooldownEvent.type:
                // console.log("Await CD " + (this.simulationTime / 1000000000));
                this.addNextAttackEvent(event.source);
                break;
            case CooldownReadyEvent.type:
                // Only used to check triggers
                break;
        }

        this.checkTriggers();
    }

    processCombatStartEvent(event) {
        // console.log("Combat Start " + (this.simulationTime / 1000000000));
        for (let i = 0; i < this.players.length; i++) {
            if (event.time == 0) { // First combat start event
                this.players[i].generatePermanentBuffs();
            }
            if (this.labyrinth) {
                this.players[i].reset();
            } else {
                this.players[i].reset(this.simulationTime);
            }
        }
        let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
        this.eventQueue.addEvent(regenTickEvent);

        this.startNewEncounter();
    }

    processPlayerRespawnEvent(event) {
        // console.log("Player " + event.hrid + " respawn at " + + (this.simulationTime / 1000000000));
        let respawningPlayer = this.players.find(player => player.hrid === event.hrid);
        respawningPlayer.combatDetails.currentHitpoints = respawningPlayer.combatDetails.maxHitpoints;
        respawningPlayer.combatDetails.currentManapoints = respawningPlayer.combatDetails.maxManapoints;
        respawningPlayer.clearBuffs();
        respawningPlayer.clearCCs();
        if (this.allPlayersDead) {
            this.allPlayersDead = false;
            this.startAttacks();
        } else {
            this.addNextAttackEvent(respawningPlayer);
        }
    }

    processEnemyRespawnEvent(event) {
        this.startNewEncounter();
    }

    startNewEncounter() {
        if (this.allPlayersDead) {
            this.allPlayersDead = false;
            if (this.zone) {
                this.zone.failWave();
            }
        }

        if (this.zone) {
            if (!this.zone.isDungeon) {
                this.enemies = this.zone.getRandomEncounter();
            } else {
                this.enemies = this.zone.getNextWave();
                this.simResult.updateTimeSpentAlive("#" + (this.zone.encountersKilled - 1).toString(), true, this.simulationTime);
                let currentDungeonCount = this.zone.dungeonsCompleted;
                // console.log('wave at #' + (this.zone.encountersKilled - 1) +' completed:' + this.zone.dungeonsCompleted + ' failed:'+ this.zone.dungeonsFailed + ' temp:'+ this.tempDungeonCount);
                if (currentDungeonCount > this.tempDungeonCount) {
                    this.tempDungeonCount = currentDungeonCount;
                    for (let i = 0; i < this.players.length; i++) {
                        this.players[i].combatDetails.currentHitpoints = this.players[i].combatDetails.maxHitpoints;
                        this.players[i].combatDetails.currentManapoints = this.players[i].combatDetails.maxManapoints;
                        // this.simResult.playerRanOutOfMana[this.players[i].hrid] = false;
                    }
                }
            }
        }

        if (this.labyrinth) {
            this.enemies = this.labyrinth.getMonster();
            this.labyrinth.updateEnconterStartTime(this.simulationTime);
        }

        this.enemies.forEach((enemy) => {
            enemy.reset(this.simulationTime);
            this.simResult.updateTimeSpentAlive(enemy.hrid, true, this.simulationTime);
            //console.log(enemy.hrid, "spawned");
        });

        this.eventQueue.clearEventsOfType(EnrageTickEvent.type);
        let enrageTickEvent = new EnrageTickEvent(this.simulationTime + ENRAGE_TICK_INTERVAL, ENRAGE_TICK_INTERVAL);
        this.eventQueue.addEvent(enrageTickEvent);
        this.enrageBeginTime = this.simulationTime;

        this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);

        // 提前检查trigger让吃喝先跑
        this.checkTriggers();

        this.startAttacks();
    }

    startAttacks() {
        let units = [...this.players];
        if (this.enemies) {
            units.push(...this.enemies);
        }

        for (const unit of units) {
            if (unit.combatDetails.currentHitpoints <= 0) {
                continue;
            }

            /*-if (unit.isPlayer) {
                // console.log("Start Attacks " + (this.simulationTime / 1000000000));
            }*/
            this.addNextAttackEvent(unit);
        }
    }

    checkParry(targets) {
        let parryUnits = targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0 && unit.combatDetails.combatStats.parry > 0);
        if (parryUnits.length <= 0) {
            return undefined;
        }
        let randomIndex = Math.floor(Math.random() * parryUnits.length);
        if (parryUnits[randomIndex].combatDetails.combatStats.parry > Math.random()) {
            return parryUnits[randomIndex];
        }
        return undefined;
    }

    processAutoAttackEvent(event) {
        // console.log("source:", event.source.hrid);
        // console.log("aa " + (this.simulationTime / 1000000000));

        let targets = event.source.isPlayer ? this.enemies : this.players;

        if (!targets) {
            return;
        }

        const aliveTargets = targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0);

        for (let i = 0; i < aliveTargets.length; i++) {
            let target = aliveTargets[i];
            if (!event.source.isPlayer && aliveTargets.length > 1) {
                let cumulativeThreat = 0;
                let cumulativeRanges = [];
                aliveTargets.forEach(player => {
                    let playerThreat = player.combatDetails.combatStats.threat;
                    cumulativeThreat += playerThreat;
                    cumulativeRanges.push({
                        player: player,
                        rangeStart: cumulativeThreat - playerThreat,
                        rangeEnd: cumulativeThreat
                    });
                });
                let randomValueHit = Math.random() * cumulativeThreat;
                target = cumulativeRanges.find(range => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd).player;
            }
            let source = event.source;

            let parryTarget = this.checkParry(targets);
            if (parryTarget) {
                target = source;
                source = parryTarget;
            }

            let attackResult = CombatUtilities.processAttack(source, target);
            if (this.zone?.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {
                const log = this.generateCombatLog(source, "autoAttack", target, attackResult);
                this.addToWipeLogs(log);
            }

            let mayhem = source.combatDetails.combatStats.mayhem > Math.random();

            if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {
                const curseExpireTime = 15000000000;
                let currentCurseEvent = this.eventQueue.getMatching((event) => event.type == CurseExpirationEvent.type && event.source == target);
                let currentCurseAmount = 0;
                if (currentCurseEvent) currentCurseAmount = currentCurseEvent.curseAmount;
                this.eventQueue.clearMatching((event) => event.type == CurseExpirationEvent.type && event.source == target);

                let curseExpirationEvent = new CurseExpirationEvent(this.simulationTime + curseExpireTime, currentCurseAmount, target);
                const curseBuff = {
                    "uniqueHrid": "/buff_uniques/curse",
                    "typeHrid": "/buff_types/damage_taken",
                    "ratioBoost": 0,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": source.combatDetails.combatStats.curse * curseExpirationEvent.curseAmount,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": curseExpireTime
                };
                target.addBuff(curseBuff, this.simulationTime);
                this.eventQueue.addEvent(curseExpirationEvent);
            }

            if (source.combatDetails.combatStats.fury > 0) {
                let currentFuryEvent = this.eventQueue.getMatching((event) => event.type == FuryExpirationEvent.type && event.source == source);
                this.eventQueue.clearMatching((event) => event.type == FuryExpirationEvent.type && event.source == source);

                const furyExpireTime = 15000000000;
                const maxFuryStack = 5;

                let furyAmount = 0;
                if (currentFuryEvent) furyAmount = currentFuryEvent.furyAmount;

                if (attackResult.didHit) {
                    furyAmount = Math.min(furyAmount + 1, maxFuryStack);
                } else {
                    furyAmount = furyAmount / 2;
                }

                const furyAccuracyBuf = {
                    "uniqueHrid": "/buff_uniques/fury_accuracy",
                    "typeHrid": "/buff_types/fury_accuracy",
                    "ratioBoost": furyAmount * source.combatDetails.combatStats.fury,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": 0,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": furyExpireTime
                };
                const furyDamageBuf = {
                    "uniqueHrid": "/buff_uniques/fury_damage",
                    "typeHrid": "/buff_types/fury_damage",
                    "ratioBoost": furyAmount * source.combatDetails.combatStats.fury,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": 0,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": furyExpireTime
                };

                if (furyAmount > 0) {
                    let furyExpirationEvent = new FuryExpirationEvent(this.simulationTime + furyExpireTime, furyAmount, source);
                    this.eventQueue.addEvent(furyExpirationEvent);

                    source.addBuffs([furyAccuracyBuf , furyDamageBuf], this.simulationTime);
                    // source.addBuff(furyAccuracyBuf, this.simulationTime);
                    // source.addBuff(furyDamageBuf, this.simulationTime);
                }
                else {
                    source.removeBuffs([furyAccuracyBuf, furyDamageBuf]);
                    // source.removeBuff(furyAccuracyBuf);
                    // source.removeBuff(furyDamageBuf);
                }
            }

            if (target.combatDetails.combatStats.weaken > 0) {
                const weakenExpireTime = 15000000000;
                let currentWeakenEvent = this.eventQueue.getMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
                let weakenAmount = 0;
                if (currentWeakenEvent)
                    weakenAmount = currentWeakenEvent.weakenAmount;
                this.eventQueue.clearMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
                let weakenExpirationEvent = new WeakenExpirationEvent(this.simulationTime + 15000000000, weakenAmount, source);
                const weakenBuff = {
                    "uniqueHrid": "/buff_uniques/weaken",
                    "typeHrid": "/buff_types/damage",
                    "ratioBoost": -1 * target.combatDetails.combatStats.weaken * weakenExpirationEvent.weakenAmount,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": 0,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": weakenExpireTime
                };
                source.addBuff(weakenBuff, this.simulationTime);
                this.eventQueue.addEvent(weakenExpirationEvent);
            }

            if (!mayhem || (mayhem && attackResult.didHit) || (mayhem && i == (aliveTargets.length - 1))) {
                let attackType = "autoAttack";
                if (parryTarget) attackType = "parry";
                this.simResult.addAttack(
                    source,
                    target,
                    attackType,
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );
            }

            if (attackResult.lifeStealHeal > 0) {
                this.simResult.addHitpointsGained(source, "lifesteal", attackResult.lifeStealHeal);
            }

            if (attackResult.manaLeechMana > 0) {
                this.simResult.addManapointsGained(source, "manaLeech", attackResult.manaLeechMana);
            }

            if (attackResult.thornDamageDone > 0) {
                this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);
            }
            if (this.zone?.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {
                const log = this.buildCombatLog(target, attackResult.thornType, source, attackResult.thornDamageDone);
                this.addToWipeLogs(log);
            }

            if (target.combatDetails.combatStats.retaliation > 0) {
                this.simResult.addAttack(target, source, "retaliation", attackResult.retaliationDamageDone > 0?attackResult.retaliationDamageDone:"miss");
            }
            if (this.zone?.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {
                const log = this.buildCombatLog(target, "retaliation", source, attackResult.retaliationDamageDone);
                this.addToWipeLogs(log);
            }

            if (target.combatDetails.currentHitpoints == 0) {
                this.eventQueue.clearEventsForUnit(target);
                this.simResult.addDeath(target);
                if (!target.isPlayer) {
                    this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);
                }
                // console.log(target.hrid, "died");
            }

            // Could die from reflect damage
            if (source.combatDetails.currentHitpoints == 0 &&
                (attackResult.thornDamageDone != 0 || attackResult.retaliationDamageDone != 0)
            ) {
                this.eventQueue.clearEventsForUnit(source);
                this.simResult.addDeath(source);
                if (!source.isPlayer) {
                    this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
                }
                break;
            }

            if (mayhem && !attackResult.didHit) {
                continue;
            }

            if (!attackResult.didHit || parryTarget || source.combatDetails.combatStats.pierce <= Math.random()) {
                break;
            }
        }

        if (!this.checkEncounterEnd()) {
            // console.log("!EncounterEnd " + (this.simulationTime / 1000000000));
            this.addNextAttackEvent(event.source);
        }
    }

    checkEncounterEnd() {
        if (this.enemies) {
            let deadEnemies = this.enemies.filter((enemy) => enemy.combatDetails.currentHitpoints <= 0 && enemy.experienceRate == 0);
            if (deadEnemies.length > 0) {
                deadEnemies.forEach(enemy => {
                    let aliveDuration = this.simulationTime - this.enrageBeginTime;
                    if (aliveDuration > enemy.enrageTime) {
                        aliveDuration = enemy.enrageTime;
                    }
                    enemy.experienceRate = 1.0 + aliveDuration / enemy.enrageTime;
                    // console.log(enemy.hrid, "alive duration", aliveDuration, "exp rate", enemy.experienceRate);
                })
            }
        }

        let encounterEnded = false;

        if (this.enemies && !this.enemies.some((enemy) => enemy.combatDetails.currentHitpoints > 0)) {
            this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
            // this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
            let enemyRespawnEvent = new EnemyRespawnEvent(this.simulationTime + ENEMY_RESPAWN_INTERVAL);
            this.eventQueue.addEvent(enemyRespawnEvent);

            //calc exp before clear
            if (this.enemies.some(enemy => enemy.experienceRate <= 0)) {
                console.log("WARN: Some enemies have no experience rate");
            }

            let totalExp = this.enemies.map(enemy => enemy.experience * enemy.experienceRate).reduce((a, b) => a + b, 0);
            this.players.forEach(player => {
                this.simResult.addExperienceGain(player, totalExp / this.players.length);
            });

            this.enemies = null;

            if (this.zone?.isDungeon) {
                this.simResult.updateTimeSpentAlive("#" + (this.zone.encountersKilled - 1).toString(), false, this.simulationTime);
                if (this.zone.encountersKilled > this.zone.dungeonSpawnInfo.maxWaves) {
                    this.simResult.updateDungenonFinish("#1", this.simulationTime);
                    this.simResult.lastDungeonFinishTime = this.simulationTime;
                }
            }
            this.simResult.addEncounterEnd();
            this.simResult.lastEncounterFinishTime = this.simulationTime;
            // console.log("All enemies died");

            encounterEnded = true;
            // console.log("encounter end " + (this.simulationTime / 1000000000))
        }

        this.players.forEach(player => {
            if ((player.combatDetails.currentHitpoints <= 0) && !this.eventQueue.containsEventOfTypeAndHrid(PlayerRespawnEvent.type, player.hrid)) {
                if (this.zone && !this.zone.isDungeon) {
                    let playerRespawnEvent = new PlayerRespawnEvent(this.simulationTime + PLAYER_RESPAWN_INTERVAL, player.hrid);
                    this.eventQueue.addEvent(playerRespawnEvent);
                }
                this.simResult.addRanOutOfManaCount(player, false, this.simulationTime);
                // console.log(player.hrid + " died at " + (this.simulationTime / 1000000000) + 'in wave #' + (this.zone.encountersKilled - 1) + ' with ememies: ' + this.enemies?.map(enemy => (enemy.hrid+"("+(enemy.combatDetails.currentHitpoints*100/enemy.combatDetails.maxHitpoints).toFixed(2)+"%)")).join(", "));
            }
        });

        if (
            !this.players.some((player) => player.combatDetails.currentHitpoints > 0)
        ) {
            if (this.zone) {
                if (this.zone.isDungeon) {
                    console.log("All Players died at wave #" + (this.zone.encountersKilled - 1) + " with ememies: " + this.enemies.map(enemy => (enemy.hrid+"("+(enemy.combatDetails.currentHitpoints*100/enemy.combatDetails.maxHitpoints).toFixed(2)+"%)")).join(", "));

                    this.saveWipeLogsToSimResult(this.zone.encountersKilled - 1);
                    // console.log(this.simResult)
                    this.wipeLogs.index = 0;
                    this.wipeLogs.count = 0;

                    // 地下城团灭：只清除战斗相关事件，保留buff过期检查和CD事件
                    this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
                    this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
                    this.eventQueue.clearEventsOfType(DamageOverTimeEvent.type);
                    this.eventQueue.clearEventsOfType(ConsumableTickEvent.type);
                    this.eventQueue.clearEventsOfType(RegenTickEvent.type);
                    this.eventQueue.clearEventsOfType(EnrageTickEvent.type);
                    this.eventQueue.clearEventsOfType(StunExpirationEvent.type);
                    this.eventQueue.clearEventsOfType(BlindExpirationEvent.type);
                    this.eventQueue.clearEventsOfType(SilenceExpirationEvent.type);
                    this.eventQueue.clearEventsOfType(AwaitCooldownEvent.type);
                    this.enemies = null;

                    let combatStartEvent = new CombatStartEvent(this.simulationTime + RESTART_INTERVAL);
                    this.eventQueue.addEvent(combatStartEvent);
                } else {
                    this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
                    this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
                }
            }

            // console.log("All Players died");
            encounterEnded = true;
            this.allPlayersDead = true;
        }

        if (this.labyrinth && (this.labyrinth.checkTimeout(this.simulationTime) || encounterEnded)) {
            this.enemies = null;
            encounterEnded = true;
            this.eventQueue.clear();
            let combatStartEvent = new CombatStartEvent(this.simulationTime);
            this.eventQueue.addEvent(combatStartEvent);
        }

        return encounterEnded;
    }

    addNextAttackEvent(source) {
        if (this.eventQueue.getMatching((event) => (event.type == AbilityCastEndEvent.type || event.type == AutoAttackEvent.type)&& event.source == source)) {
            return;
        }

        let target;
        let friendlies;
        let enemies;
        if (source.isPlayer) {
            target = CombatUtilities.getTarget(this.enemies);
            friendlies = this.players;
            enemies = this.enemies;
        } else {
            target = CombatUtilities.getTarget(this.players);
            friendlies = this.enemies;
            enemies = this.players;
        }

        let usedAbility = false;
        let skipNextAbility = false;

        source.abilities
            .filter((ability) => ability != null)
            .forEach((ability) => {
                if (!usedAbility && !skipNextAbility && ability.shouldTrigger(this.simulationTime, source, target, friendlies, enemies)) {
                    if (!this.canUseAbility(source, ability, true)) {
                        skipNextAbility = true;
                    }

                    if (!skipNextAbility) {
                        let castDuration = ability.castDuration;
                        castDuration /= (1 + source.combatDetails.combatStats.castSpeed)
                        let abilityCastEndEvent = new AbilityCastEndEvent(this.simulationTime + castDuration, source, ability);
                        this.eventQueue.addEvent(abilityCastEndEvent);
                        /*-if (source.isPlayer) {
                            let haste = source.combatDetails.combatStats.abilityHaste;
                            let cooldownDuration = ability.cooldownDuration;
                            if (haste > 0) {
                                cooldownDuration = cooldownDuration * 100 / (100 + haste);
                            }
                            // console.log((this.simulationTime / 1000000000) + " Casting " + ability.hrid + " Cast time " + (castDuration / 1e9) + " Off CD at " + ((this.simulationTime + cooldownDuration + castDuration) / 1e9) + " CD " + ((cooldownDuration) / 1e9));
                        }*/
                        usedAbility = true;
                    }
                }
            });

        if (usedAbility) {
            source.isOutOfMana = false;
            return;
        }

        if (!enemies) {
            return;
        }

        if (!source.isBlinded) {
            let autoAttackEvent = new AutoAttackEvent(
                this.simulationTime + source.combatDetails.combatStats.attackInterval,
                source
            );
            /*-if (source.isPlayer) {
                // console.log("next attack " + ((this.simulationTime + source.combatDetails.combatStats.attackInterval) / 1e9))
            }*/
            this.eventQueue.addEvent(autoAttackEvent);
        } else {
            source.isOutOfMana = true;
        }
    }

    processConsumableTickEvent(event) {
        if (event.consumable.hitpointRestore > 0) {
            let tickValue = CombatUtilities.calculateTickValue(
                event.consumable.hitpointRestore,
                event.totalTicks,
                event.currentTick
            );
            let hitpointsAdded = event.source.addHitpoints(tickValue);
            this.simResult.addHitpointsGained(event.source, event.consumable.hrid, hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);
        }

        if (event.consumable.manapointRestore > 0) {
            let tickValue = CombatUtilities.calculateTickValue(
                event.consumable.manapointRestore,
                event.totalTicks,
                event.currentTick
            );
            let manapointsAdded = event.source.addManapoints(tickValue);
            this.simResult.addManapointsGained(event.source, event.consumable.hrid, manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);

            // when oom check ability trigger
            if (event.source.isOutOfMana) {
                let awaitCooldownEvent = new AwaitCooldownEvent(
                    this.simulationTime,
                    event.source
                );
                this.eventQueue.addEvent(awaitCooldownEvent);
            }
        }

        if (event.currentTick < event.totalTicks) {
            let consumableTickEvent = new ConsumableTickEvent(
                this.simulationTime + HOT_TICK_INTERVAL,
                event.source,
                event.consumable,
                event.totalTicks,
                event.currentTick + 1
            );
            this.eventQueue.addEvent(consumableTickEvent);
        }
    }

    processDamageOverTimeTickEvent(event) {
        let tickDamage = CombatUtilities.calculateTickValue(event.damage, event.totalTicks, event.currentTick);
        let damage = Math.min(tickDamage, event.target.combatDetails.currentHitpoints);

        event.target.combatDetails.currentHitpoints -= damage;
        this.simResult.addAttack(event.sourceRef, event.target, "damageOverTime", damage);

        if (this.zone?.isDungeon && event.target.isPlayer) {
            const log = this.buildCombatLog("", "damageOverTime", event.target, damage);
            this.addToWipeLogs(log);
        }


        // console.log(event.target.hrid, "bleed for", damage);

        if (event.currentTick < event.totalTicks) {
            let damageOverTimeTickEvent = new DamageOverTimeEvent(
                this.simulationTime + DOT_TICK_INTERVAL,
                event.sourceRef,
                event.target,
                event.damage,
                event.totalTicks,
                event.currentTick + 1,
                event.combatStyleHrid
            );
            this.eventQueue.addEvent(damageOverTimeTickEvent);
        }

        if (event.target.combatDetails.currentHitpoints == 0) {
            this.eventQueue.clearEventsForUnit(event.target);
            this.simResult.addDeath(event.target);
            if (!event.target.isPlayer) {
                this.simResult.updateTimeSpentAlive(event.target.hrid, false, this.simulationTime);
            }
        }

        this.checkEncounterEnd();
    }

    processRegenTickEvent(event) {
        let units = [...this.players];

        // regen of emeny always set to 0, ingore the proc time
        // if (this.enemies) {
        //     units.push(...this.enemies);
        // }

        for (const unit of units) {
            if (unit.combatDetails.currentHitpoints <= 0) {
                continue;
            }

            let hitpointRegen = Math.floor(unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.hpRegenPer10);
            let hitpointsAdded = unit.addHitpoints(hitpointRegen);
            this.simResult.addHitpointsGained(unit, "regen", hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);

            let manapointRegen = Math.floor(unit.combatDetails.maxManapoints * unit.combatDetails.combatStats.mpRegenPer10);
            let manapointsAdded = unit.addManapoints(manapointRegen);
            this.simResult.addManapointsGained(unit, "regen", manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);

            // when oom check ability trigger
            if (unit.isOutOfMana) {
                let awaitCooldownEvent = new AwaitCooldownEvent(
                    this.simulationTime,
                    unit
                );
                this.eventQueue.addEvent(awaitCooldownEvent);
            }
        }

        let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
        this.eventQueue.addEvent(regenTickEvent);
    }

    processCheckBuffExpirationEvent(event) {
        event.source.removeExpiredBuffs(this.simulationTime);
    }

    processStunExpirationEvent(event) {
        event.source.isStunned = false;
        // console.log("Stun " + (this.simulationTime / 1000000000));
        this.addNextAttackEvent(event.source);
    }

    processBlindExpirationEvent(event) {
        event.source.isBlinded = false;
        this.addNextAttackEvent(event.source);
    }

    processSilenceExpirationEvent(event) {
        event.source.isSilenced = false;
    }

    processCurseExpirationEvent(event) {
        event.source.removeExpiredBuffs(this.simulationTime);
    }

    processWeakenExpirationEvent(event) {
        event.source.removeExpiredBuffs(this.simulationTime);
    }

    processFuryExpirationEvent(event) {
        event.source.removeExpiredBuffs(this.simulationTime);
        console.log("Fury Timeout");
    }

    processEnrageTickEvent(event) {
        if (!this.enemies) return;
        const maxEnrageStack = 10;
        this.enemies.filter((enemy) => enemy.combatDetails.currentHitpoints > 0).forEach((enemy) => {
            let nowStack = Math.min(maxEnrageStack, Math.floor(event.encounterTime / enemy.enrageTime));

            if (nowStack <= 0) {
                return;
            }

            console.log(enemy.hrid, nowStack, " stack Enrage at ", (event.encounterTime / ONE_SECOND));

            const enrageDamageBuff = {
                    "uniqueHrid": "/buff_uniques/enrage_damage",
                    "typeHrid": "/buff_types/damage",
                    "ratioBoost": nowStack * 0.1,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": 0,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": ENRAGE_TICK_INTERVAL
            };
            const enrageAccuracyBuff = {
                    "uniqueHrid": "/buff_uniques/enrage_accuracy",
                    "typeHrid": "/buff_types/accuracy",
                    "ratioBoost": nowStack * 0.1,
                    "ratioBoostLevelBonus": 0,
                    "flatBoost": 0,
                    "flatBoostLevelBonus": 0,
                    "startTime": "0001-01-01T00:00:00Z",
                    "duration": ENRAGE_TICK_INTERVAL
            };
            enemy.addBuffs([enrageDamageBuff, enrageAccuracyBuff]);
            // enemy.addBuff(enrageDamageBuff);
            // enemy.addBuff(enrageAccuracyBuff);

            this.simResult.maxEnrageStack = Math.max(this.simResult.maxEnrageStack, nowStack);
        });

        let enrageTickEvent = new EnrageTickEvent(this.simulationTime + ENRAGE_TICK_INTERVAL, event.encounterTime + ENRAGE_TICK_INTERVAL);
        this.eventQueue.addEvent(enrageTickEvent);
    }

    checkTriggers() {
        let triggeredSomething;

        do {
            triggeredSomething = false;

            this.players
                .filter((player) => player.combatDetails.currentHitpoints > 0)
                .forEach((player) => {
                    if (this.checkTriggersForUnit(player, this.players, this.enemies)) {
                        triggeredSomething = true;
                    }
                });

            if (this.enemies) {
                this.enemies
                    .filter((enemy) => enemy.combatDetails.currentHitpoints > 0)
                    .forEach((enemy) => {
                        if (this.checkTriggersForUnit(enemy, this.enemies, this.players)) {
                            triggeredSomething = true;
                        }
                    });
            }
        } while (triggeredSomething);
    }

    checkTriggersForUnit(unit, friendlies, enemies) {
        if (unit.combatDetails.currentHitpoints <= 0) {
            throw new Error("Checking triggers for a dead unit");
        }

        let triggeredSomething = false;
        let target = CombatUtilities.getTarget(enemies);

        for (const food of unit.food) {
            if (food && food.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {
                let result = this.tryUseConsumable(unit, food);
                if (result) {
                    triggeredSomething = true;
                }
            }
        }

        for (const drink of unit.drinks) {
            if (drink && drink.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {
                let result = this.tryUseConsumable(unit, drink);
                if (result) {
                    triggeredSomething = true;
                }
            }
        }

        return triggeredSomething;
    }

    tryUseConsumable(source, consumable) {
        // console.log("Consuming:", consumable);

        if (source.combatDetails.currentHitpoints <= 0) {
            return false;
        }

        consumable.lastUsed = this.simulationTime;
        let consumeCooldown = consumable.cooldownDuration;
        if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes("drink")) {
            consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.drinkConcentration);
        } else if (source.combatDetails.combatStats.foodHaste > 0 && consumable.catagoryHrid.includes("food")) {
            consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.foodHaste);
        }
        let cooldownReadyEvent = new CooldownReadyEvent(this.simulationTime + consumeCooldown);
        this.eventQueue.addEvent(cooldownReadyEvent);

        this.simResult.addConsumableUse(source, consumable);

        if (consumable.recoveryDuration == 0) {
            if (consumable.hitpointRestore > 0) {
                let hitpointsAdded = source.addHitpoints(consumable.hitpointRestore);
                this.simResult.addHitpointsGained(source, consumable.hrid, hitpointsAdded);
                // console.log("Added hitpoints:", hitpointsAdded);
            }

            if (consumable.manapointRestore > 0) {
                let manapointsAdded = source.addManapoints(consumable.manapointRestore);
                this.simResult.addManapointsGained(source, consumable.hrid, manapointsAdded);
                // console.log("Added manapoints:", manapointsAdded);

                // when oom check ability trigger
                if (source.isOutOfMana) {
                    let awaitCooldownEvent = new AwaitCooldownEvent(
                        this.simulationTime,
                        source
                    );
                    this.eventQueue.addEvent(awaitCooldownEvent);
                }
            }
        } else {
            let consumableTickEvent = new ConsumableTickEvent(
                this.simulationTime + HOT_TICK_INTERVAL,
                source,
                consumable,
                consumable.recoveryDuration / HOT_TICK_INTERVAL,
                1
            );
            this.eventQueue.addEvent(consumableTickEvent);
        }

        for (const buff of consumable.buffs) {
            let currentBuff = structuredClone(buff);
            if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes("drink")) {
                currentBuff.ratioBoost *= (1 + source.combatDetails.combatStats.drinkConcentration);
                currentBuff.flatBoost *= (1 + source.combatDetails.combatStats.drinkConcentration);
                currentBuff.duration = currentBuff.duration / (1 + source.combatDetails.combatStats.drinkConcentration);
            }
            source.addBuff(currentBuff, this.simulationTime);
            // console.log("Added buff:", currentBuff);
            let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + currentBuff.duration, source);
            this.eventQueue.addEvent(checkBuffExpirationEvent);
        }

        return true;
    }

    canUseAbility(source, ability, oomCheck) {
        if (source.combatDetails.currentHitpoints <= 0) {
            return false;
        }

        if (source.combatDetails.currentManapoints < ability.manaCost) {
            if (source.isPlayer && oomCheck) {
                // if (this.simResult.playerRanOutOfMana[source.hrid] == false) {
                //     console.log(source.hrid + " ran out of mana" + ' at wave #' + (this.zone.encountersKilled - 1) + ' at time ' + this.simulationTime / 1000000000 + 's');
                // }
                this.simResult.addRanOutOfManaCount(source, true, this.simulationTime);
            }
            return false;
        }
        if (source.isPlayer && oomCheck) {
            this.simResult.addRanOutOfManaCount(source, false, this.simulationTime);
        }
        return true;
    }

    tryUseAbility(source, ability) {

        if (!this.canUseAbility(source, ability, true)) {
            // console.log("Falseeeeeee");
            return false;
        }

        // console.log("Casting:", ability);

        if (source.isPlayer) {
            if (source.abilityManaCosts.has(ability.hrid)) {
                source.abilityManaCosts.set(ability.hrid, source.abilityManaCosts.get(ability.hrid) + ability.manaCost);
            } else {
                source.abilityManaCosts.set(ability.hrid, ability.manaCost);
            }
        }

        source.combatDetails.currentManapoints -= ability.manaCost;

        ability.lastUsed = this.simulationTime;

        let haste = source.combatDetails.combatStats.abilityHaste;
        let cooldownDuration = ability.cooldownDuration;
        if (haste > 0) {
            cooldownDuration = cooldownDuration * 100 / (100 + haste);
        }

        /*-if (source.isPlayer) {
            let castDuration = ability.castDuration;
            castDuration /= (1 + source.combatDetails.combatStats.castSpeed)
            // console.log((this.simulationTime / 1000000000) + " Used ability " + ability.hrid + " Cast time " + (castDuration / 1e9));
        }*/

        let todoAbilities = [ability];

        if (source.combatDetails.combatStats.blaze > 0 && Math.random() < source.combatDetails.combatStats.blaze) {
            todoAbilities.push(new Ability("blaze"));
        }

        if (source.combatDetails.combatStats.bloom > 0 && Math.random() < source.combatDetails.combatStats.bloom) {
            todoAbilities.push(new Ability("bloom"));
        }

        for (const todoAbility of todoAbilities) {
            for (const abilityEffect of todoAbility.abilityEffects) {
                switch (abilityEffect.effectType) {
                    case "/ability_effect_types/buff":
                        this.processAbilityBuffEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/damage":
                        this.processAbilityDamageEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/heal":
                        this.processAbilityHealEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/spend_hp":
                        this.processAbilitySpendHpEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/revive":
                        this.processAbilityReviveEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/promote":
                        this.eventQueue.clearEventsForUnit(source);
                        source = this.processAbilityPromoteEffect(source, todoAbility, abilityEffect);
                        this.addNextAttackEvent(source);
                        break;
                    default:
                        throw new Error("Unsupported effect type for ability: " + todoAbility.hrid + " effectType: " + abilityEffect.effectType);
                }
            }
        }

        if (source.combatDetails.combatStats.ripple > 0 && Math.random() < source.combatDetails.combatStats.ripple) {
            let manapointsAdded = source.addManapoints(10);
            this.simResult.addManapointsGained(source, "ripple", manapointsAdded);
            for (const ability of source.abilities) {
                if (ability && ability.lastUsed) {
                    const remainingCooldown = ability.lastUsed + ability.cooldownDuration - this.simulationTime;
                    if (remainingCooldown > 0) {
                        ability.lastUsed = Math.max(ability.lastUsed - ONE_SECOND * 2, this.simulationTime - ability.cooldownDuration);
                    }
                }
            }
        }

        this.addNextAttackEvent(source);

        // Could die from reflect damage
        if (source.combatDetails.currentHitpoints == 0) {
            this.eventQueue.clearEventsForUnit(source);
            this.simResult.addDeath(source);
            if (!source.isPlayer) {
                this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
            }
        }

        this.checkEncounterEnd();

        return true;
    }

    processAbilityBuffEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType == "allAllies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                for (const buff of abilityEffect.buffs) {
                    if (ability.isSpecialAbility && buff.multiplierForSkillHrid && buff.multiplierPerSkillLevel > 0) {
                        let multiplier = 1.0 + source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level'] * buff.multiplierPerSkillLevel;
                        let currentBuff = structuredClone(buff);
                        currentBuff.flatBoost *= multiplier;
                        currentBuff.ratioBoost *= multiplier;
                        target.addBuff(currentBuff, this.simulationTime);
                    } else {
                        target.addBuff(buff, this.simulationTime);
                    }
                    let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, target);
                    this.eventQueue.addEvent(checkBuffExpirationEvent);
                }
            }
            return;
        }

        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for buff ability effect: " + ability.hrid);
        }

        for (const buff of abilityEffect.buffs) {
            source.addBuff(buff, this.simulationTime);
            // console.log("Added buff:", abilityEffect.buff);
            let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, source);
            this.eventQueue.addEvent(checkBuffExpirationEvent);
        }
    }

    processAbilityDamageEffect(source, ability, abilityEffect) {
        let targets;
        switch (abilityEffect.targetType) {
            case "enemy":
            case "allEnemies":
                targets = source.isPlayer ? this.enemies : this.players;
                break;
            default:
                throw new Error("Unsupported target type for damage ability effect: " + ability.hrid);
        }

        if (!targets) {
            return;
        }

        let avoidTarget = [];

        let isSkipParry = false;

        for (let target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
            let parryTarget = undefined;
            if (!isSkipParry) {
                parryTarget = this.checkParry(targets);
                isSkipParry = true; //  parry check only once on first target
            }

            if (parryTarget) {
                let tempTarget = source;
                let tempSource = parryTarget;

                let attackResult = CombatUtilities.processAttack(tempSource, tempTarget);

                this.simResult.addAttack(
                    tempSource,
                    tempTarget,
                    "parry",
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );

                if (attackResult.lifeStealHeal > 0) {
                    this.simResult.addHitpointsGained(tempSource, "lifesteal", attackResult.lifeStealHeal);
                }

                if (attackResult.manaLeechMana > 0) {
                    this.simResult.addManapointsGained(tempSource, "manaLeech", attackResult.manaLeechMana);
                }

                if (attackResult.thornDamageDone > 0) {
                    this.simResult.addAttack(tempTarget, tempSource, attackResult.thornType, attackResult.thornDamageDone);
                }
                if (tempTarget.combatDetails.combatStats.retaliation > 0) {
                    this.simResult.addAttack(tempTarget, tempSource, "retaliation", attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : "miss");
                }

                if (tempTarget.combatDetails.currentHitpoints == 0) {
                    this.eventQueue.clearEventsForUnit(tempTarget);
                    this.simResult.addDeath(tempTarget);
                    if (!tempTarget.isPlayer) {
                        this.simResult.updateTimeSpentAlive(tempTarget.hrid, false, this.simulationTime);
                    }
                    // console.log(tempTarget.hrid, "died");
                }

                // Could die from reflect damage
                if (tempSource.combatDetails.currentHitpoints == 0 &&
                    (attackResult.thornDamageDone != 0 || attackResult.retaliationDamageDone != 0)
                ) {
                    this.eventQueue.clearEventsForUnit(tempSource);
                    this.simResult.addDeath(tempSource);
                    if (!tempSource.isPlayer) {
                        this.simResult.updateTimeSpentAlive(tempSource.hrid, false, this.simulationTime);
                    }
                }
            } else {
                targets = targets.filter((unit) => unit && !avoidTarget.includes(unit.hrid) && unit.combatDetails.currentHitpoints > 0);
                if (!source.isPlayer && targets.length > 0 && abilityEffect.targetType == "enemy") {
                    let cumulativeThreat = 0;
                    let cumulativeRanges = [];
                    targets.forEach(player => {
                        let playerThreat = player.combatDetails.combatStats.threat;
                        cumulativeThreat += playerThreat;
                        cumulativeRanges.push({
                            player: player,
                            rangeStart: cumulativeThreat - playerThreat,
                            rangeEnd: cumulativeThreat
                        });
                    });
                    let randomValueHit = Math.random() * cumulativeThreat;
                    target = cumulativeRanges.find(range => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd).player;
                    avoidTarget.push(target.hrid);
                }
                if (targets.length <= 0) {
                    break;
                }

                let attackResult = CombatUtilities.processAttack(source, target, abilityEffect);

                if (this.zone?.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {
                    const log = this.generateCombatLog(source, ability.hrid, target, attackResult);
                    this.addToWipeLogs(log);
                }

                if (attackResult.hpDrain > 0) {
                    this.simResult.addHitpointsGained(source, ability.hrid, attackResult.hpDrain);
                }

                if (attackResult.didHit && abilityEffect.buffs) {
                    for (const buff of abilityEffect.buffs) {
                        target.addBuff(buff, this.simulationTime);
                        let checkBuffExpirationEvent = new CheckBuffExpirationEvent(
                            this.simulationTime + buff.duration,
                            target
                        );
                        this.eventQueue.addEvent(checkBuffExpirationEvent);
                    }
                }

                if (abilityEffect.damageOverTimeRatio > 0 && attackResult.damageDone > 0) {
                    let damageOverTimeEvent = new DamageOverTimeEvent(
                        this.simulationTime + DOT_TICK_INTERVAL,
                        source,
                        target,
                        attackResult.damageDone * abilityEffect.damageOverTimeRatio,
                        abilityEffect.damageOverTimeDuration / DOT_TICK_INTERVAL,
                        1, abilityEffect.combatStyleHrid
                    );
                    this.eventQueue.addEvent(damageOverTimeEvent);
                }

                if (attackResult.didHit && abilityEffect.stunChance > 0 && Math.random() < (abilityEffect.stunChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isStunned = true;
                    target.stunExpireTime = this.simulationTime + abilityEffect.stunDuration;
                    this.eventQueue.clearMatching((event) => (event.type == AutoAttackEvent.type || event.type == AbilityCastEndEvent.type || event.type == StunExpirationEvent.type) && event.source == target);
                    let stunExpirationEvent = new StunExpirationEvent(target.stunExpireTime, target);
                    this.eventQueue.addEvent(stunExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.blindChance > 0 && Math.random() < (abilityEffect.blindChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isBlinded = true;
                    target.blindExpireTime = this.simulationTime + abilityEffect.blindDuration;
                    this.eventQueue.clearMatching((event) => event.type == BlindExpirationEvent.type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == AutoAttackEvent.type && event.source == target)) {
                        // console.log("Blind " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let blindExpirationEvent = new BlindExpirationEvent(target.blindExpireTime, target);
                    this.eventQueue.addEvent(blindExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.silenceChance > 0 && Math.random() < (abilityEffect.silenceChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isSilenced = true;
                    target.silenceExpireTime = this.simulationTime + abilityEffect.silenceDuration;
                    this.eventQueue.clearMatching((event) => event.type == SilenceExpirationEvent.type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == AbilityCastEndEvent.type && event.source == target)) {
                        // console.log("Silence " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let silenceExpirationEvent = new SilenceExpirationEvent(target.silenceExpireTime, target);
                    this.eventQueue.addEvent(silenceExpirationEvent);
                }

                if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {
                    const curseExpireTime = 15000000000;
                    let currentCurseEvent = this.eventQueue.getMatching((event) => event.type == CurseExpirationEvent.type && event.source == target);
                    let currentCurseAmount = 0;
                    if (currentCurseEvent) currentCurseAmount = currentCurseEvent.curseAmount;
                    this.eventQueue.clearMatching((event) => event.type == CurseExpirationEvent.type && event.source == target);

                    let curseExpirationEvent = new CurseExpirationEvent(this.simulationTime + curseExpireTime, currentCurseAmount, target);
                    const curseBuff = {
                        "uniqueHrid": "/buff_uniques/curse",
                        "typeHrid": "/buff_types/damage_taken",
                        "ratioBoost": 0,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": source.combatDetails.combatStats.curse * curseExpirationEvent.curseAmount,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": curseExpireTime
                    };
                    target.addBuff(curseBuff, this.simulationTime);
                    this.eventQueue.addEvent(curseExpirationEvent);
                }

                if (source.combatDetails.combatStats.fury > 0) {
                    let currentFuryEvent = this.eventQueue.getMatching((event) => event.type == FuryExpirationEvent.type && event.source == source);
                    this.eventQueue.clearMatching((event) => event.type == FuryExpirationEvent.type && event.source == source);

                    const furyExpireTime = 15000000000;
                    const maxFuryStack = 5;

                    let furyAmount = 0;
                    if (currentFuryEvent) furyAmount = currentFuryEvent.furyAmount;

                    if (attackResult.didHit) {
                        furyAmount = Math.min(furyAmount + 1, maxFuryStack);
                    } else {
                        furyAmount = furyAmount / 2;
                    }

                    const furyAccuracyBuf = {
                        "uniqueHrid": "/buff_uniques/fury_accuracy",
                        "typeHrid": "/buff_types/fury_accuracy",
                        "ratioBoost": furyAmount * source.combatDetails.combatStats.fury,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": 0,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": furyExpireTime
                    };
                    const furyDamageBuf = {
                        "uniqueHrid": "/buff_uniques/fury_damage",
                        "typeHrid": "/buff_types/fury_damage",
                        "ratioBoost": furyAmount * source.combatDetails.combatStats.fury,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": 0,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": furyExpireTime
                    };

                    if (furyAmount > 0) {
                        let furyExpirationEvent = new FuryExpirationEvent(this.simulationTime + furyExpireTime, furyAmount, source);
                        this.eventQueue.addEvent(furyExpirationEvent);

                        source.addBuffs([furyAccuracyBuf, furyDamageBuf], this.simulationTime);
                        // source.addBuff(furyAccuracyBuf, this.simulationTime);
                        // source.addBuff(furyDamageBuf, this.simulationTime);
                    }
                    else {
                        source.removeBuffs([furyAccuracyBuf, furyDamageBuf]);
                        // source.removeBuff(furyAccuracyBuf);
                        // source.removeBuff(furyDamageBuf);
                    }
                }

                if (target.combatDetails.combatStats.weaken > 0) {
                    const weakenExpireTime = 15000000000;
                    source.weakenExpireTime = this.simulationTime + weakenExpireTime;
                    let currentWeakenEvent = this.eventQueue.getMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
                    let weakenAmount = 0;
                    if (currentWeakenEvent)
                        weakenAmount = currentWeakenEvent.weakenAmount;
                    this.eventQueue.clearMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
                    let weakenExpirationEvent = new WeakenExpirationEvent(this.simulationTime + weakenExpireTime, weakenAmount, source);
                    const weakenBuff = {
                        "uniqueHrid": "/buff_uniques/weaken",
                        "typeHrid": "/buff_types/damage",
                        "ratioBoost": -1 * target.combatDetails.combatStats.weaken * weakenExpirationEvent.weakenAmount,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": 0,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": weakenExpireTime
                    };
                    source.addBuff(weakenBuff, this.simulationTime);
                    this.eventQueue.addEvent(weakenExpirationEvent);
                }

                this.simResult.addAttack(
                    source,
                    target,
                    ability.hrid,
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );

                if (attackResult.thornDamageDone > 0) {
                    this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);
                }
                if (this.zone?.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {
                    const log = this.buildCombatLog(target, attackResult.thornType, source, attackResult.thornDamageDone);
                    this.addToWipeLogs(log);
                }

                if (target.combatDetails.combatStats.retaliation > 0) {
                    this.simResult.addAttack(target, source, "retaliation", attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : "miss");
                }
                if (this.zone?.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {
                    const log = this.buildCombatLog(target, "retaliation", source, attackResult.retaliationDamageDone);
                    this.addToWipeLogs(log);
                }

                if (target.combatDetails.currentHitpoints == 0) {
                    this.eventQueue.clearEventsForUnit(target);
                    this.simResult.addDeath(target);
                    if (!target.isPlayer) {
                        this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);
                    }
                    // console.log(target.hrid, "died");
                }


                if (attackResult.didHit && abilityEffect.pierceChance > Math.random()) {
                    continue;
                }
            }

            if (parryTarget)
            {
                break;
            }

            if (abilityEffect.targetType == "enemy") {
                break;
            }
        }
    }

    processAbilityHealEffect(source, ability, abilityEffect) {

        if (abilityEffect.targetType == "allAllies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                let amountHealed = CombatUtilities.processHeal(source, abilityEffect, target);

                this.simResult.addHitpointsGained(target, ability.hrid, amountHealed);
            }
            return;
        }

        if (abilityEffect.targetType == "lowestHpAlly") {
            let targets = source.isPlayer ? this.players : this.enemies;
            let healTarget;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                if (!healTarget) {
                    healTarget = target;
                    continue;
                }
                // 按HP百分比比较，选择百分比最低的目标
                const targetHpPercent = target.combatDetails.currentHitpoints / target.combatDetails.maxHitpoints;
                const healTargetHpPercent = healTarget.combatDetails.currentHitpoints / healTarget.combatDetails.maxHitpoints;
                if (targetHpPercent < healTargetHpPercent) {
                    healTarget = target;
                }
            }

            if (healTarget) {
                let amountHealed = CombatUtilities.processHeal(source, abilityEffect, healTarget);

                this.simResult.addHitpointsGained(healTarget, ability.hrid, amountHealed);
            }
            return;
        }

        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for heal ability effect: " + ability.hrid);
        }

        let amountHealed = CombatUtilities.processHeal(source, abilityEffect, source);

        this.simResult.addHitpointsGained(source, ability.hrid, amountHealed);
    }

    processAbilityReviveEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "deadAlly") {
            throw new Error("Unsupported target type for revive ability effect: " + ability.hrid);
        }

        let targets = source.isPlayer ? this.players : this.enemies;
        let reviveTarget = targets.find((unit) => unit && unit.combatDetails.currentHitpoints <= 0);

        if (reviveTarget) {
            this.eventQueue.clearMatching((event) => event.type == PlayerRespawnEvent.type && event.hrid == reviveTarget.hrid);

            reviveTarget.removeExpiredBuffs(this.simulationTime);

            let amountHealed = CombatUtilities.processRevive(source, abilityEffect, reviveTarget);

            this.simResult.addHitpointsGained(reviveTarget, ability.hrid, amountHealed);

            this.addNextAttackEvent(reviveTarget);

            if (!source.isPlayer) {
                this.simResult.updateTimeSpentAlive(reviveTarget.hrid, true, this.simulationTime);
            }

            // console.log(source.hrid + " revived " + reviveTarget.hrid + " with " + amountHealed + " HP." + ' at wave #' + (this.zone.encountersKilled - 1) + ' at time ' + this.simulationTime / 1000000000 + 's');
        }
        return;
    }

    processAbilityPromoteEffect(source, ability, abilityEffect) {
        const promotionHrids = ["/monsters/enchanted_rook", "/monsters/enchanted_knight", "/monsters/enchanted_bishop"];
        let randomPromotionIndex = Math.floor(Math.random() * promotionHrids.length);
        return new Monster(promotionHrids[randomPromotionIndex], source.difficultyTier);
    }

    processAbilitySpendHpEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for spend hp ability effect: " + ability.hrid);
        }

        let hpSpent = CombatUtilities.processSpendHp(source, abilityEffect);

        this.simResult.addHitpointsSpent(source, ability.hrid, hpSpent);
    }
}

module.exports = CombatSimulator;
},
"combatUtilities.js": function(module, exports, __require) {
class CombatUtilities {
    static getTarget(enemies) {
        if (!enemies) {
            return null;
        }
        let target = enemies.find((enemy) => enemy.combatDetails.currentHitpoints > 0);

        return target ?? null;
    }

    static randomInt(min, max) {
        if (max < min) {
            let temp = min;
            min = max;
            max = temp;
        }

        let minCeil = Math.ceil(min);
        let maxFloor = Math.floor(max);

        if (Math.floor(min) == maxFloor) {
            return Math.floor((min + max) / 2 + Math.random());
        }

        let minTail = -1 * (min - minCeil);
        let maxTail = max - maxFloor;

        let balancedWeight = 2 * minTail + (maxFloor - minCeil);
        let balancedAverage = (maxFloor + minCeil) / 2;
        let average = (max + min) / 2;
        let extraTailWeight = (balancedWeight * (average - balancedAverage)) / (maxFloor + 1 - average);
        let extraTailChance = Math.abs(extraTailWeight / (extraTailWeight + balancedWeight));

        if (Math.random() < extraTailChance) {
            if (maxTail > minTail) {
                return Math.floor(maxFloor + 1);
            } else {
                return Math.floor(minCeil - 1);
            }
        }

        if (maxTail > minTail) {
            return Math.floor(min + Math.random() * (maxFloor + minTail - min + 1));
        } else {
            return Math.floor(minCeil - maxTail + Math.random() * (max - (minCeil - maxTail) + 1));
        }
    }

    static processAttack(source, target, abilityEffect = null) {
        let combatStyle = abilityEffect
            ? abilityEffect.combatStyleHrid
            : source.combatDetails.combatStats.combatStyleHrid;
        let damageType = abilityEffect ? abilityEffect.damageType : source.combatDetails.combatStats.damageType;

        let sourceAccuracyRating = 1;
        let sourceAutoAttackMaxDamage = 1;
        let targetEvasionRating = 1;

        switch (combatStyle) {
            case "/combat_styles/stab":
                sourceAccuracyRating = source.combatDetails.stabAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;
                targetEvasionRating = target.combatDetails.stabEvasionRating;
                break;
            case "/combat_styles/slash":
                sourceAccuracyRating = source.combatDetails.slashAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;
                targetEvasionRating = target.combatDetails.slashEvasionRating;
                break;
            case "/combat_styles/smash":
                sourceAccuracyRating = source.combatDetails.smashAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;
                targetEvasionRating = target.combatDetails.smashEvasionRating;
                break;
            case "/combat_styles/ranged":
                sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;
                targetEvasionRating = target.combatDetails.rangedEvasionRating;
                break;
            case "/combat_styles/magic":
                sourceAccuracyRating = source.combatDetails.magicAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;
                targetEvasionRating = target.combatDetails.magicEvasionRating;
                break;
            default:
                throw new Error("Unknown combat style: " + combatStyle);
        }

        let sourceDamageMultiplier = 1;
        let sourceResistance = 0;
        let sourcePenetration = 0;
        let targetResistance = 0;
        let targetThornPower = 0;
        let targetPenetration = 0;
        let thornType;

        switch (damageType) {
            case "/damage_types/physical":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.physicalAmplify;
                sourceResistance = source.combatDetails.totalArmor;
                sourcePenetration = source.combatDetails.combatStats.armorPenetration;
                targetResistance = target.combatDetails.totalArmor;
                targetThornPower = target.combatDetails.combatStats.physicalThorns;
                targetPenetration = target.combatDetails.combatStats.armorPenetration;
                thornType = "physicalThorns";
                break;
            case "/damage_types/water":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.waterAmplify;
                sourceResistance = source.combatDetails.totalWaterResistance;
                sourcePenetration = source.combatDetails.combatStats.waterPenetration;
                targetResistance = target.combatDetails.totalWaterResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.waterPenetration;
                thornType = "elementalThorns";
                break;
            case "/damage_types/nature":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;
                sourceResistance = source.combatDetails.totalNatureResistance;
                sourcePenetration = source.combatDetails.combatStats.naturePenetration;
                targetResistance = target.combatDetails.totalNatureResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.naturePenetration;
                thornType = "elementalThorns";
                break;
            case "/damage_types/fire":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;
                sourceResistance = source.combatDetails.totalFireResistance;
                sourcePenetration = source.combatDetails.combatStats.firePenetration;
                targetResistance = target.combatDetails.totalFireResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.firePenetration;
                thornType = "elementalThorns";
                break;
            default:
                throw new Error("Unknown damage type: " + damageType);
        }

        let hitChance = 1;
        let critChance = 0;
        let isCrit = false;
        let bonusCritChance = source.combatDetails.combatStats.criticalRate;
        let bonusCritDamage = source.combatDetails.combatStats.criticalDamage;

        if (abilityEffect) {
            sourceAccuracyRating *= (1 + abilityEffect.bonusAccuracyRatio);
        }

        if (source.isWeakened) {
            sourceAccuracyRating = sourceAccuracyRating - (source.weakenPercentage * sourceAccuracyRating);
        }

        hitChance =
            Math.pow(sourceAccuracyRating, 1.4) /
            (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

        if (combatStyle == "/combat_styles/ranged") {
            critChance = 0.3 * hitChance;
        }

        critChance = critChance + bonusCritChance;

        let baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
        let baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;

        let armorDamageRatioFlat = abilityEffect ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor : 0;

        let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
        let sourceMaxDamage = sourceDamageMultiplier * (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);

        if (Math.random() < critChance) {
            sourceMaxDamage = sourceMaxDamage * (1 + bonusCritDamage);
            sourceMinDamage = sourceMaxDamage;
            isCrit = true;
        }

        let damageRoll = CombatUtilities.randomInt(sourceMinDamage, sourceMaxDamage);
        damageRoll *= (1 + source.combatDetails.combatStats.taskDamage);
        damageRoll *= (1 + target.combatDetails.combatStats.damageTaken);
        if (!abilityEffect) {
            damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
        } else {
            damageRoll *= (1 + source.combatDetails.combatStats.abilityDamage);
        }

        let damageDone = 0;
        let thornDamageDone = 0;

        let didHit = false;
        if (Math.random() < hitChance) {
            didHit = true;
            let penetratedTargetResistance = targetResistance;

            if (sourcePenetration > 0 && targetResistance > 0) {
                penetratedTargetResistance = targetResistance / (1 + sourcePenetration);
            }

            let targetDamageTakenRatio = 100 / (100 + penetratedTargetResistance);
            if (penetratedTargetResistance < 0) {
                targetDamageTakenRatio = (100 - penetratedTargetResistance) / 100;
            }

            let mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);
            damageDone = Math.min(mitigatedDamage, target.combatDetails.currentHitpoints);
            target.combatDetails.currentHitpoints -= damageDone;
        }

        if (targetThornPower > 0.0 && targetResistance > -99.0) {
            let penetratedSourceResistance = sourceResistance

            if (sourceResistance > 0) {
                penetratedSourceResistance = sourceResistance / (1 + targetPenetration);
            }

            let sourceDamageTakenRatio = 100.0 / (100 + penetratedSourceResistance);
            if (penetratedSourceResistance < 0) {
                sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;
            }

            let targetTaskDamageMultiplier = 1.0 + target.combatDetails.combatStats.taskDamage;
            let sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
            let targetDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

            let thornsDamageRoll = CombatUtilities.randomInt(1,
                targetDamageMultiplier
                * target.combatDetails.defensiveMaxDamage
                * (1.0 + targetResistance / 100.0)
                * targetThornPower);

            let mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);

            thornDamageDone = Math.min(mitigatedThornsDamage, source.combatDetails.currentHitpoints);
            source.combatDetails.currentHitpoints -= thornDamageDone;
        }

        let retaliationDamageDone = 0;
        if (target.combatDetails.combatStats.retaliation > 0) {
            let retaliationHitChance =
                Math.pow(target.combatDetails.smashAccuracyRating, 1.4) /
                (Math.pow(target.combatDetails.smashAccuracyRating, 1.4) + Math.pow(source.combatDetails.smashEvasionRating, 1.4));

            if (retaliationHitChance > Math.random()) {
                let sourceEffectiveArmor = source.combatDetails.totalArmor;
                if (sourceEffectiveArmor > 0) {
                    sourceEffectiveArmor = sourceEffectiveArmor / (1.0 + target.combatDetails.combatStats.armorPenetration);
                }

                let sourceDamageTakenRatio = 100.0 / (100.0 + sourceEffectiveArmor);
                if (sourceEffectiveArmor < 0) {
                    sourceDamageTakenRatio = (100.0 - sourceEffectiveArmor) / 100.0;
                }

                let targetTaskDamageMultiplier = 1.0 + target.combatDetails.combatStats.taskDamage;
                let sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
                let retaliationDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

                let premitigatedDamage = damageRoll;
                premitigatedDamage = Math.min(premitigatedDamage, target.combatDetails.defensiveMaxDamage * 5);

                let retaliationMinDamage = retaliationDamageMultiplier * target.combatDetails.combatStats.retaliation * premitigatedDamage;
                let retaliationMaxDamage = retaliationDamageMultiplier * target.combatDetails.combatStats.retaliation * (target.combatDetails.defensiveMaxDamage + premitigatedDamage);

                let retaliationDamageRoll = CombatUtilities.randomInt(retaliationMinDamage, retaliationMaxDamage);
                let mitigatedRetaliationDamage = Math.ceil(sourceDamageTakenRatio * retaliationDamageRoll);
                retaliationDamageDone = Math.min(mitigatedRetaliationDamage, source.combatDetails.currentHitpoints);
                source.combatDetails.currentHitpoints -= retaliationDamageDone;
            }
        }

        let lifeStealHeal = 0;
        if (!abilityEffect && didHit && source.combatDetails.combatStats.lifeSteal > 0) {
            lifeStealHeal = source.addHitpoints(Math.floor(source.combatDetails.combatStats.lifeSteal * damageDone));
        }

        let hpDrain = 0;
        if (abilityEffect && didHit && abilityEffect.hpDrainRatio > 0) {
            let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
            hpDrain = source.addHitpoints(Math.floor(abilityEffect.hpDrainRatio * damageDone * healingAmplify));
        }

        let manaLeechMana = 0;
        if (!abilityEffect && didHit && source.combatDetails.combatStats.manaLeech > 0) {
            manaLeechMana = source.addManapoints(Math.floor(source.combatDetails.combatStats.manaLeech * damageDone));
        }

        return { damageDone, didHit, thornDamageDone, thornType, retaliationDamageDone, lifeStealHeal, hpDrain, manaLeechMana, isCrit};
    }

    static processHeal(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
            throw new Error("Heal ability effect not supported for combat style: " + abilityEffect.combatStyleHrid);
        }

        let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        let magicMaxDamage = source.combatDetails.magicMaxDamage;

        let baseHealFlat = abilityEffect.damageFlat;
        let baseHealRatio = abilityEffect.damageRatio;

        let minHeal = healingAmplify * (1 + baseHealFlat);
        let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        let heal = this.randomInt(minHeal, maxHeal);
        let amountHealed = target.addHitpoints(heal);

        return amountHealed;
    }

    static processRevive(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
            throw new Error("Heal ability effect not supported for combat style: " + abilityEffect.combatStyleHrid);
        }

        let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        let magicMaxDamage = source.combatDetails.magicMaxDamage;

        let baseHealFlat = abilityEffect.damageFlat;
        let baseHealRatio = abilityEffect.damageRatio;

        let minHeal = healingAmplify * (1 + baseHealFlat);
        let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        let heal = this.randomInt(minHeal, maxHeal);
        let amountHealed = target.addHitpoints(heal);
        target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;
        target.clearCCs();

        // target.clearBuffs();

        return amountHealed;
    }

    static processSpendHp(source, abilityEffect) {
        let currentHp = source.combatDetails.currentHitpoints;
        let spendHpRatio = abilityEffect.spendHpRatio;

        let spentHp = Math.floor(currentHp * spendHpRatio);

        source.combatDetails.currentHitpoints -= spentHp;

        return spentHp;
    }

    static calculateTickValue(totalValue, totalTicks, currentTick) {
        let currentSum = Math.floor((currentTick * totalValue) / totalTicks);
        let previousSum = Math.floor(((currentTick - 1) * totalValue) / totalTicks);

        return currentSum - previousSum;
    }
}

module.exports = CombatUtilities;
},
"events/autoAttackEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class AutoAttackEvent extends CombatEvent {
    static type = "autoAttack";

    constructor(time, source) {
        super(AutoAttackEvent.type, time);

        this.source = source;
    }
}

module.exports = AutoAttackEvent;
},
"events/combatEvent.js": function(module, exports, __require) {
class CombatEvent {
    constructor(type, time) {
        this.type = type;
        this.time = time;
    }
}

module.exports = CombatEvent;
},
"events/damageOverTimeEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class DamageOverTimeEvent extends CombatEvent {
    static type = "damageOverTime";

    constructor(time, sourceRef, target, damage, totalTicks, currentTick, combatStyleHrid) {
        super(DamageOverTimeEvent.type, time);

        // Calling it 'source' would wrongly clear Damage Over Time when the source dies
        this.sourceRef = sourceRef;
        this.target = target;
        this.damage = damage;
        this.totalTicks = totalTicks;
        this.currentTick = currentTick;
        this.combatStyleHrid = combatStyleHrid;
    }
}

module.exports = DamageOverTimeEvent;
},
"events/checkBuffExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class CheckBuffExpirationEvent extends CombatEvent {
    static type = "checkBuffExpiration";

    constructor(time, source) {
        super(CheckBuffExpirationEvent.type, time);

        this.source = source;
    }
}

module.exports = CheckBuffExpirationEvent;
},
"events/combatStartEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class CombatStartEvent extends CombatEvent {
    static type = "combatStart";

    constructor(time) {
        super(CombatStartEvent.type, time);
    }
}

module.exports = CombatStartEvent;
},
"events/consumableTickEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class ConsumableTickEvent extends CombatEvent {
    static type = "consumableTick";

    constructor(time, source, consumable, totalTicks, currentTick) {
        super(ConsumableTickEvent.type, time);

        this.source = source;
        this.consumable = consumable;
        this.totalTicks = totalTicks;
        this.currentTick = currentTick;
    }
}

module.exports = ConsumableTickEvent;
},
"events/cooldownReadyEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class CooldownReadyEvent extends CombatEvent {
    static type = "cooldownReady";

    constructor(time) {
        super(CooldownReadyEvent.type, time);
    }
}

module.exports = CooldownReadyEvent;
},
"events/enemyRespawnEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class EnemyRespawnEvent extends CombatEvent {
    static type = "enemyRespawn";

    constructor(time) {
        super(EnemyRespawnEvent.type, time);
    }
}

module.exports = EnemyRespawnEvent;
},
"events/eventQueue.js": function(module, exports, __require) {
class Heap {
    constructor(compare) {
        this.compare = compare;
        this.items = [];
    }

    push(item) {
        this.items.push(item);
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (!this.items.length) return undefined;
        const first = this.items[0];
        const last = this.items.pop();
        if (this.items.length) {
            this.items[0] = last;
            this.bubbleDown(0);
        }
        return first;
    }

    remove(item) {
        const index = this.items.indexOf(item);
        if (index < 0) return false;
        const last = this.items.pop();
        if (index < this.items.length) {
            this.items[index] = last;
            this.bubbleUp(index);
            this.bubbleDown(index);
        }
        return true;
    }

    toArray() {
        return [...this.items];
    }

    bubbleUp(start) {
        let index = start;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.items[index], this.items[parent]) >= 0) break;
            [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
            index = parent;
        }
    }

    bubbleDown(start) {
        let index = start;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) smallest = left;
            if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) smallest = right;
            if (smallest === index) break;
            [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
            index = smallest;
        }
    }
}

class EventQueue {
    constructor() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
    }

    addEvent(event) {
        this.minHeap.push(event);
    }

    getNextEvent() {
        return this.minHeap.pop();
    }

    containsEventOfType(type) {
        let heapEvents = this.minHeap.toArray();

        return heapEvents.some((event) => event.type == type);
    }

    containsEventOfTypeAndHrid(type, hrid) {
        let heapEvents = this.minHeap.toArray();
        return heapEvents.some((event) => event.type == type && event.hrid == hrid);
    }

    clear() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
    }

    clearEventsForUnit(unit) {
        this.clearMatching((event) => event.source == unit || event.target == unit);
    }

    clearEventsOfType(type) {
        this.clearMatching((event) => event.type == type);
    }

    clearMatching(fn) {
        let cleared = false;
        let heapEvents = this.minHeap.toArray();

        for (const event of heapEvents) {
            if (fn(event)) {
                this.minHeap.remove(event);
                cleared = true;
            }
        }
        return cleared;
    }

    getMatching(fn) {
        let heapEvents = this.minHeap.toArray();

        for (const event of heapEvents) {
            if (fn(event)) {
                return event;
            }
        }

        return null;
    }
}

module.exports = EventQueue;
},
"events/playerRespawnEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class PlayerRespawnEvent extends CombatEvent {
    static type = "playerRespawn";

    constructor(time, hrid) {
        super(PlayerRespawnEvent.type, time);
        this.hrid = hrid;
    }
}

module.exports = PlayerRespawnEvent;
},
"events/regenTickEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class RegenTickEvent extends CombatEvent {
    static type = "regenTick";

    constructor(time) {
        super(RegenTickEvent.type, time);
    }
}

module.exports = RegenTickEvent;
},
"events/stunExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class StunExpirationEvent extends CombatEvent {
    static type = "stunExpiration";

    constructor(time, source) {
        super(StunExpirationEvent.type, time);

        this.source = source;
    }
}

module.exports = StunExpirationEvent;
},
"events/blindExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class BlindExpirationEvent extends CombatEvent {
    static type = "blindExpiration";

    constructor(time, source) {
        super(BlindExpirationEvent.type, time);

        this.source = source;
    }
}

module.exports = BlindExpirationEvent;
},
"events/silenceExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class SilenceExpirationEvent extends CombatEvent {
    static type = "silenceExpiration";

    constructor(time, source) {
        super(SilenceExpirationEvent.type, time);

        this.source = source;
    }
}

module.exports = SilenceExpirationEvent;
},
"events/curseExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class CurseExpirationEvent extends CombatEvent {
    static type = "curseExpiration";
    static maxCurseStacks = 5;

    constructor(time, curseAmount, source) {
        super(CurseExpirationEvent.type, time);

        this.curseAmount = Math.min(curseAmount + 1, CurseExpirationEvent.maxCurseStacks);

        this.source = source;
    }
}

module.exports = CurseExpirationEvent;
},
"events/weakenExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class WeakenExpirationEvent extends CombatEvent {
    static type = "weakenExpiration";
    static maxWeakenStacks = 5;

    constructor(time, weakenAmount, source) {
        super(WeakenExpirationEvent.type, time);
        this.weakenAmount = Math.min(
            weakenAmount + 1,
            WeakenExpirationEvent.maxWeakenStacks
        );
        this.source = source;
    }
}

module.exports = WeakenExpirationEvent;
},
"events/furyExpirationEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class FuryExpirationEvent extends CombatEvent {
    static type = "furyExpiration";

    constructor(time, furyAmount, source) {
        super(FuryExpirationEvent.type, time);

        this.furyAmount = furyAmount;
        this.source = source;
    }
}

module.exports = FuryExpirationEvent;
},
"events/enrageTickEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class EnrageTickEvent extends CombatEvent {
    static type = "enrageTick";

    constructor(time, encounterTime) {

        super(EnrageTickEvent.type, time);

        this.encounterTime = encounterTime;
    }
}

module.exports = EnrageTickEvent;
},
"simResult.js": function(module, exports, __require) {
const combatStyleDetailMap = __require("data/combatStyleDetailMap.json");
class SimResult {
    constructor(zone, labyrinth, numberOfPlayers) {
        this.deaths = {};
        this.experienceGained = {};
        this.encounters = 0;
        this.attacks = {};
        this.consumablesUsed = {};
        this.hitpointsGained = {};
        this.manapointsGained = {};
        this.debuffOnLevelGap = {};
        this.dropRateMultiplier = {};
        this.rareFindMultiplier = {};
        this.combatDropQuantity = {};
        this.playerRanOutOfMana = {
            "player1": false,
            "player2": false,
            "player3": false,
            "player4": false,
            "player5": false
        };
        this.playerRanOutOfManaTime = {};
        this.manaUsed = {};
        this.timeSpentAlive = [];
        this.bossSpawns = [];
        this.hitpointsSpent = {};
        this.zoneName = zone?.hrid;
        this.difficultyTier = zone?.difficultyTier;
        this.labyrinthName = labyrinth?.monsterHrid;
        this.roomLevel = labyrinth?.roomLevel;
        this.isDungeon = false;
        this.isLabyrinth = labyrinth ? true : false;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.maxWaveReached = 0;
        this.numberOfPlayers = numberOfPlayers;
        this.maxEnrageStack = 0;
        this.minDungenonTime = 0;
        this.maxDungenonTime = 0;
        this.lastDungeonFinishTime = 0;
        this.lastEncounterFinishTime = 0;
        this.labyAttemptCount = 0;

        this.wipeEvents = [];

        // 时间序列数据用于图表显示
        this.timeSeriesData = {
            timestamps: [],
            players: {}
        };
    }

    addWipeEvent(logs, simulationTime, wave) {
        this.wipeEvents.push({
            simulationTime: simulationTime,
            logs: logs,
            wave: wave,
            timestamp: new Date().toISOString()
        });
    }

    addDeath(unit) {
        if (!this.deaths[unit.hrid]) {
            this.deaths[unit.hrid] = 0;
        }

        this.deaths[unit.hrid] += 1;
    }

    updateTimeSpentAlive(name, alive, time) {
        const i = this.timeSpentAlive.findIndex(e => e.name === name);
        if (alive) {
            if (i !== -1) {
                this.timeSpentAlive[i].alive = true;
                this.timeSpentAlive[i].spawnedAt = time;
            } else {
                this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });
            }
        } else {
            const timeAlive = time - this.timeSpentAlive[i].spawnedAt;
            this.timeSpentAlive[i].alive = false;
            this.timeSpentAlive[i].timeSpentAlive += timeAlive;
            this.timeSpentAlive[i].count += 1;
        }
    }

    updateDungenonFinish(beginFlag, finishTime) {
        const i = this.timeSpentAlive.findIndex(e => e.name === beginFlag);
        if (i == -1) {
            return;
        }

        const currentDungenonTime = finishTime - this.timeSpentAlive[i].spawnedAt;

        if (this.minDungenonTime == 0 || this.minDungenonTime > currentDungenonTime) {
            this.minDungenonTime = currentDungenonTime;
        }

        if (this.maxDungenonTime < currentDungenonTime) {
            this.maxDungenonTime = currentDungenonTime;
        }
    }

    addExperienceGain(unit, experience) {
        if (!unit.isPlayer) {
            return;
        }

        if (!this.experienceGained[unit.hrid]) {
            this.experienceGained[unit.hrid] = {
                stamina: 0,
                intelligence: 0,
                attack: 0,
                melee: 0,
                defense: 0,
                ranged: 0,
                magic: 0,
            };
        }

        let experienceGainedRate = {
            "stamina": 0,
            "intelligence": 0,
            "attack": 0,
            "melee": 0,
            "defense": 0,
            "ranged": 0,
            "magic": 0,
        };

        const primaryTraining = unit.combatDetails.combatStats.primaryTraining;
        experienceGainedRate[primaryTraining.split("/")[2]] = .3;

        const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;
        const skillExpMapLength = Object.keys(skillExpMap).length;

        const focusTraining = unit.combatDetails.combatStats.focusTraining;
        if (focusTraining && skillExpMap[focusTraining]) {
            experienceGainedRate[focusTraining.split("/")[2]] += .7;
        } else {
            Object.keys(skillExpMap).forEach(skillHrid => {
                experienceGainedRate[skillHrid.split("/")[2]] += .7 / skillExpMapLength;
            });
        }

        for (const [type, rate] of Object.entries(experienceGainedRate)) {
            if (rate <= 0) continue;

            const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + "Experience"]);

            this.experienceGained[unit.hrid][type] += (
                experience
                * (1 + unit.combatDetails.combatStats.combatExperience)
                * skillExperience
                * (1 + unit.debuffOnLevelGap)

            );
        }
    }

    addEncounterEnd() {
        this.encounters++;
    }

    addAttack(source, target, ability, hit) {
        if (!this.attacks[source.hrid]) {
            this.attacks[source.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid]) {
            this.attacks[source.hrid][target.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid][ability]) {
            this.attacks[source.hrid][target.hrid][ability] = {};
        }

        if (!this.attacks[source.hrid][target.hrid][ability][hit]) {
            this.attacks[source.hrid][target.hrid][ability][hit] = 0;
        }

        this.attacks[source.hrid][target.hrid][ability][hit] += 1;
    }

    addConsumableUse(unit, consumable) {
        if (!this.consumablesUsed[unit.hrid]) {
            this.consumablesUsed[unit.hrid] = {};
        }
        if (!this.consumablesUsed[unit.hrid][consumable.hrid]) {
            this.consumablesUsed[unit.hrid][consumable.hrid] = 0;
        }

        this.consumablesUsed[unit.hrid][consumable.hrid] += 1;
    }

    addHitpointsGained(unit, source, amount) {
        if (!this.hitpointsGained[unit.hrid]) {
            this.hitpointsGained[unit.hrid] = {};
        }
        if (!this.hitpointsGained[unit.hrid][source]) {
            this.hitpointsGained[unit.hrid][source] = 0;
        }

        this.hitpointsGained[unit.hrid][source] += amount;
    }

    addManapointsGained(unit, source, amount) {
        if (!this.manapointsGained[unit.hrid]) {
            this.manapointsGained[unit.hrid] = {};
        }
        if (!this.manapointsGained[unit.hrid][source]) {
            this.manapointsGained[unit.hrid][source] = 0;
        }

        this.manapointsGained[unit.hrid][source] += amount;
    }

    setDropRateMultipliers(unit) {
        if (!this.dropRateMultiplier[unit.hrid]) {
            this.dropRateMultiplier[unit.hrid] = {};
        }
        this.dropRateMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;

        if (!this.rareFindMultiplier[unit.hrid]) {
            this.rareFindMultiplier[unit.hrid] = {};
        }
        this.rareFindMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;

        if (!this.combatDropQuantity[unit.hrid]) {
            this.combatDropQuantity[unit.hrid] = {};
        }
        this.combatDropQuantity[unit.hrid] = unit.combatDetails.combatStats.combatDropQuantity;

        if (!this.debuffOnLevelGap[unit.hrid]) {
            this.debuffOnLevelGap[unit.hrid] = {};
        }
        this.debuffOnLevelGap[unit.hrid] = unit.debuffOnLevelGap;
    }

    setManaUsed(unit) {
        this.manaUsed[unit.hrid] = {};
        for (let [key, value] of unit.abilityManaCosts.entries()) {
            this.manaUsed[unit.hrid][key] = value;
        }
    }

    addHitpointsSpent(unit, source, amount) {
        if (!this.hitpointsSpent[unit.hrid]) {
            this.hitpointsSpent[unit.hrid] = {};
        }
        if (!this.hitpointsSpent[unit.hrid][source]) {
            this.hitpointsSpent[unit.hrid][source] = 0;
        }

        this.hitpointsSpent[unit.hrid][source] += amount;
    }

    addRanOutOfManaCount(unit, isOutOfMana, time) {
        if (isOutOfMana) this.playerRanOutOfMana[unit.hrid] = true;

        if (!this.playerRanOutOfManaTime[unit.hrid]) {
            this.playerRanOutOfManaTime[unit.hrid] = {isOutOfMana: false, startTimeForOutOfMana:0, totalTimeForOutOfMana:0};
        }

        if (isOutOfMana) {
            if (!this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = true;
                this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana = time;
            }
        } else {
            if (this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
                this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = false;
                this.playerRanOutOfManaTime[unit.hrid].totalTimeForOutOfMana += time - this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana;
            }
        }
    }

    // 添加时间序列数据点
    addTimeSeriesSnapshot(time, players) {
        this.timeSeriesData.timestamps.push(time);

        players.forEach(player => {
            if (!this.timeSeriesData.players[player.hrid]) {
                this.timeSeriesData.players[player.hrid] = {
                    hp: [],
                    mp: [],
                    maxHp: [],
                    maxMp: []
                };
            }

            const playerData = this.timeSeriesData.players[player.hrid];
            playerData.hp.push(player.combatDetails.currentHitpoints);
            playerData.mp.push(player.combatDetails.currentManapoints);
            playerData.maxHp.push(player.combatDetails.maxHitpoints);
            playerData.maxMp.push(player.combatDetails.maxManapoints);
        });
    }
}

module.exports = SimResult;
},
"data/combatStyleDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"events/abilityCastEndEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class AbilityCastEndEvent extends CombatEvent {
    static type = "abilityCastEndEvent";

    constructor(time, source, ability) {
        super(AbilityCastEndEvent.type, time);

        this.source = source;
        this.ability = ability;
    }
}

module.exports = AbilityCastEndEvent;
},
"events/awaitCooldownEvent.js": function(module, exports, __require) {
const CombatEvent = __require("events/combatEvent.js");
class AwaitCooldownEvent extends CombatEvent {
    static type = "awaitCooldownEvent";

    constructor(time, source) {
        super(AwaitCooldownEvent.type, time);

        this.source = source;
    }
}

module.exports = AwaitCooldownEvent;
},
"monster.js": function(module, exports, __require) {
const Ability = __require("ability.js");
const CombatUnit = __require("combatUnit.js");
const combatMonsterDetailMap = __require("data/combatMonsterDetailMap.json");
const Drops = __require("drops.js");
class Monster extends CombatUnit {

    difficultyTier = 0;

    LabyrinthMonsterBaseRoomLevel = 100; //Base stats are designed for room level 100, and scale proportionally
    roomLevel = 0;

    constructor(hrid, difficultyTier = 0, roomLevel = 0, hitpointMultiplier = 1) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;
        this.roomLevel = roomLevel
        this.hitpointMultiplier = Math.max(1, Number(hitpointMultiplier) || 1);
        if (this.roomLevel <= 0) {
            this.roomLevel = this.LabyrinthMonsterBaseRoomLevel;
        }

        let gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        this.enrageTime = gameMonster.enrageTime;

        let labyrinthScaleFactor = this.roomLevel / this.LabyrinthMonsterBaseRoomLevel;
        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {
                continue;
            }
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, Math.floor(gameMonster.abilities[i].level * labyrinthScaleFactor));
        }
        if(gameMonster.dropTable)
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].difficultyTier);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            let dropTableItem = (gameMonster.dropTable && i < gameMonster.dropTable.length) ? gameMonster.dropTable[i] : null;
            let difficultyTier = dropTableItem?.difficultyTier ?? gameMonster.rareDropTable[i].minDifficultyTier;

            this.rareDropTable[i] = new Drops(gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, difficultyTier);
        }
    }

    updateCombatDetails() {
        let gameMonster = combatMonsterDetailMap[this.hrid];

        let levelMultiplier = 1.0 + 0.25 * this.difficultyTier;
        let defLevelMultiplier = 1.0 + 0.15 * this.difficultyTier;
        let levelBonus = 20.0 * this.difficultyTier;

        let labyrinthScaleFactor = this.roomLevel / this.LabyrinthMonsterBaseRoomLevel;

        this.staminaLevel = levelMultiplier * (gameMonster.combatDetails.staminaLevel + levelBonus) * labyrinthScaleFactor;
        this.intelligenceLevel = levelMultiplier * (gameMonster.combatDetails.intelligenceLevel + levelBonus) * labyrinthScaleFactor;
        this.attackLevel = levelMultiplier * (gameMonster.combatDetails.attackLevel + levelBonus) * labyrinthScaleFactor;
        this.meleeLevel = levelMultiplier * (gameMonster.combatDetails.meleeLevel + levelBonus) * labyrinthScaleFactor;
        this.defenseLevel = defLevelMultiplier * (gameMonster.combatDetails.defenseLevel + levelBonus) * labyrinthScaleFactor;
        this.rangedLevel = levelMultiplier * (gameMonster.combatDetails.rangedLevel + levelBonus) * labyrinthScaleFactor;
        this.magicLevel = levelMultiplier * (gameMonster.combatDetails.magicLevel + levelBonus) * labyrinthScaleFactor;

        let expMultiplier = 1.0 + 0.5 * this.difficultyTier;
        let expBonus = 5.0 * this.difficultyTier;

        this.experience = expMultiplier * (gameMonster.experience + expBonus);

        this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

        for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
            this.combatDetails.combatStats[key] = value;
        }

        this.combatDetails.combatStats.armor *= labyrinthScaleFactor;
        this.combatDetails.combatStats.waterResistance *= labyrinthScaleFactor;
        this.combatDetails.combatStats.natureResistance *= labyrinthScaleFactor;
        this.combatDetails.combatStats.fireResistance *= labyrinthScaleFactor;

        [
            "stabAccuracy",
            "slashAccuracy",
            "smashAccuracy",
            "rangedAccuracy",
            "magicAccuracy",
            "stabDamage",
            "slashDamage",
            "smashDamage",
            "rangedDamage",
            "magicDamage",
            "defensiveDamage",
            "taskDamage",
            "physicalAmplify",
            "waterAmplify",
            "natureAmplify",
            "fireAmplify",
            "healingAmplify",
            "stabEvasion",
            "slashEvasion",
            "smashEvasion",
            "rangedEvasion",
            "magicEvasion",
            "armor",
            "waterResistance",
            "natureResistance",
            "fireResistance",
            "maxHitpoints",
            "maxManapoints",
            "lifeSteal",
            "hpRegenPer10",
            "mpRegenPer10",
            "physicalThorns",
            "elementalThorns",
            "combatDropRate",
            "combatRareFind",
            "combatDropQuantity",
            "combatExperience",
            "criticalRate",
            "criticalDamage",
            "armorPenetration",
            "waterPenetration",
            "naturePenetration",
            "firePenetration",
            "abilityHaste",
            "tenacity",
            "manaLeech",
            "castSpeed",
            "threat",
            "parry",
            "mayhem",
            "pierce",
            "curse",
            "fury",
            "weaken",
            "ripple",
            "bloom",
            "blaze",
            "attackSpeed",
            "foodHaste",
            "drinkConcentration",
            "autoAttackDamage",
            "abilityDamage",
            "retaliation"
        ].forEach((stat) => {
            if (gameMonster.combatDetails.combatStats[stat] == null) {
                this.combatDetails.combatStats[stat] = 0;
            }
        });

        if (this.combatDetails.combatStats.attackInterval == 0) {
            this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;
        }

        super.updateCombatDetails();
        this.combatDetails.maxHitpoints = Math.floor(this.combatDetails.maxHitpoints * this.hitpointMultiplier);
    }
}

module.exports = Monster;
},
"ability.js": function(module, exports, __require) {
const Buff = __require("buff.js");
const abilityDetailMap = __require("data/abilityDetailMap.json");
const Trigger = __require("trigger.js");
const abilityFromCombatStat = {
    "blaze":
    {
        "hrid": "/abilities/blaze",
        "name": "Blaze",
        "description": "",
        "isSpecialAbility": false,
        "manaCost": 0,
        "cooldownDuration": 0,
        "castDuration": 0,
        "abilityEffects": [
            {
                "targetType": "allEnemies",
                "effectType": "/ability_effect_types/damage",
                "combatStyleHrid": "/combat_styles/magic",
                "damageType": "/damage_types/fire",
                "baseDamageFlat": 0,
                "baseDamageFlatLevelBonus": 0.0,
                "baseDamageRatio": 0.3,
                "baseDamageRatioLevelBonus": 0,
                "bonusAccuracyRatio": 0,
                "bonusAccuracyRatioLevelBonus": 0,
                "damageOverTimeRatio": 0,
                "damageOverTimeDuration": 0,
                "armorDamageRatio": 0,
                "armorDamageRatioLevelBonus": 0,
                "hpDrainRatio": 0,
                "pierceChance": 0,
                "blindChance": 0,
                "blindDuration": 0,
                "silenceChance": 0,
                "silenceDuration": 0,
                "stunChance": 0,
                "stunDuration": 0,
                "spendHpRatio": 0,
                "buffs": null
            }
        ],
        "defaultCombatTriggers": [
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_enemies",
                "conditionHrid": "/combat_trigger_conditions/number_of_active_units",
                "comparatorHrid": "/combat_trigger_comparators/greater_than_equal",
                "value": 1
            },
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_enemies",
                "conditionHrid": "/combat_trigger_conditions/current_hp",
                "comparatorHrid": "/combat_trigger_comparators/greater_than_equal",
                "value": 1
            }
        ],
    },
    "bloom":
    {
        "hrid": "/abilities/bloom",
        "name": "Bloom",
        "description": "",
        "isSpecialAbility": false,
        "manaCost": 0,
        "cooldownDuration": 0,
        "castDuration": 0,
        "abilityEffects": [
            {
                "targetType": "lowestHpAlly",
                "effectType": "/ability_effect_types/heal",
                "combatStyleHrid": "/combat_styles/magic",
                "damageType": "",
                "baseDamageFlat": 10,
                "baseDamageFlatLevelBonus": 0,
                "baseDamageRatio": 0.15,
                "baseDamageRatioLevelBonus": 0,
                "bonusAccuracyRatio": 0,
                "bonusAccuracyRatioLevelBonus": 0,
                "damageOverTimeRatio": 0,
                "damageOverTimeDuration": 0,
                "armorDamageRatio": 0,
                "armorDamageRatioLevelBonus": 0,
                "hpDrainRatio": 0,
                "pierceChance": 0,
                "blindChance": 0,
                "blindDuration": 0,
                "silenceChance": 0,
                "silenceDuration": 0,
                "stunChance": 0,
                "stunDuration": 0,
                "spendHpRatio": 0,
                "buffs": null
            }
        ],
        "defaultCombatTriggers": [
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_allies",
                "conditionHrid": "/combat_trigger_conditions/lowest_hp_percentage",
                "comparatorHrid": "/combat_trigger_comparators/less_than_equal",
                "value": 100
            }
        ],
    }
}

class Ability {
    constructor(hrid, level = 1, triggers = null) {
        this.hrid = hrid;
        this.level = level;

        let gameAbility = abilityDetailMap[hrid];
        if (!gameAbility) {
            gameAbility = abilityFromCombatStat[hrid];
        }
        if (!gameAbility) {
            throw new Error("No ability found for hrid: " + this.hrid);
        }

        this.manaCost = gameAbility.manaCost;
        this.cooldownDuration = gameAbility.cooldownDuration;
        this.castDuration = gameAbility.castDuration;
        this.isSpecialAbility = gameAbility.isSpecialAbility;

        this.abilityEffects = [];

        for (const effect of gameAbility.abilityEffects) {
            let abilityEffect = {
                targetType: effect.targetType,
                effectType: effect.effectType,
                combatStyleHrid: effect.combatStyleHrid,
                damageType: effect.damageType,
                damageFlat: effect.baseDamageFlat + (this.level - 1) * effect.baseDamageFlatLevelBonus,
                damageRatio: effect.baseDamageRatio + (this.level - 1) * effect.baseDamageRatioLevelBonus,
                bonusAccuracyRatio: effect.bonusAccuracyRatio + (this.level - 1) * effect.bonusAccuracyRatioLevelBonus,
                damageOverTimeRatio: effect.damageOverTimeRatio,
                damageOverTimeDuration: effect.damageOverTimeDuration,
                armorDamageRatio: effect.armorDamageRatio + (this.level - 1) * effect.armorDamageRatioLevelBonus,
                hpDrainRatio: effect.hpDrainRatio,
                pierceChance: effect.pierceChance,
                blindChance: effect.blindChance,
                blindDuration: effect.blindDuration,
                silenceChance: effect.silenceChance,
                silenceDuration: effect.silenceDuration,
                stunChance: effect.stunChance,
                stunDuration: effect.stunDuration,
                spendHpRatio: effect.spendHpRatio,
                buffs: null,
            };
            if (effect.buffs) {
                abilityEffect.buffs = [];
                for (const buff of effect.buffs) {
                    abilityEffect.buffs.push(new Buff(buff, this.level));
                }
            }
            this.abilityEffects.push(abilityEffect);
        }

        if (triggers) {
            this.triggers = triggers;
        } else {
            this.triggers = [];
            for (const defaultTrigger of gameAbility.defaultCombatTriggers) {
                let trigger = new Trigger(
                    defaultTrigger.dependencyHrid,
                    defaultTrigger.conditionHrid,
                    defaultTrigger.comparatorHrid,
                    defaultTrigger.value
                );
                this.triggers.push(trigger);
            }
        }

        this.lastUsed = Number.MIN_SAFE_INTEGER;
    }

    static createFromDTO(dto) {
        let triggers = dto.triggers.map((trigger) => Trigger.createFromDTO(trigger));
        let ability = new Ability(dto.hrid, dto.level, triggers);

        return ability;
    }

    shouldTrigger(currentTime, source, target, friendlies, enemies) {
        if (source.isStunned) {
            return false;
        }

        if (source.isSilenced) {
            return false;
        }

        let haste = source.combatDetails.combatStats.abilityHaste;
        let cooldownDuration = this.cooldownDuration;
        if (haste > 0) {
            cooldownDuration = cooldownDuration * 100 / (100 + haste);
        }

        if (this.lastUsed + cooldownDuration > currentTime) {
            return false;
        }

        if (this.triggers.length == 0) {
            return true;
        }

        let shouldTrigger = true;
        for (const trigger of this.triggers) {
            if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
                shouldTrigger = false;
            }
        }

        return shouldTrigger;
    }
}

module.exports = Ability;
},
"buff.js": function(module, exports, __require) {
class Buff {
    startTime;

    constructor(buff, level = 1) {
        this.uniqueHrid = buff.uniqueHrid;
        this.typeHrid = buff.typeHrid;
        this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
        this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        this.duration = buff.duration;
        this.multiplierForSkillHrid = buff.multiplierForSkillHrid ?? "";
        this.multiplierPerSkillLevel = buff.multiplierPerSkillLevel ?? 0;
    }
}

module.exports = Buff;
},
"data/abilityDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"trigger.js": function(module, exports, __require) {
const combatTriggerDependencyDetailMap = __require("data/combatTriggerDependencyDetailMap.json");
class Trigger {
    constructor(dependencyHrid, conditionHrid, comparatorHrid, value = 0) {
        this.dependencyHrid = dependencyHrid;
        this.conditionHrid = conditionHrid;
        this.comparatorHrid = comparatorHrid;
        this.value = value;
    }

    static createFromDTO(dto) {
        let trigger = new Trigger(dto.dependencyHrid, dto.conditionHrid, dto.comparatorHrid, dto.value);

        return trigger;
    }

    isActive(source, target, friendlies, enemies, currentTime) {
        if (combatTriggerDependencyDetailMap[this.dependencyHrid].isSingleTarget) {
            return this.isActiveSingleTarget(source, target, currentTime);
        } else {
            return this.isActiveMultiTarget(friendlies, enemies, currentTime);
        }
    }

    isActiveSingleTarget(source, target, currentTime) {
        let dependencyValue;
        switch (this.dependencyHrid) {
            case "/combat_trigger_dependencies/self":
                dependencyValue = this.getDependencyValue(source, currentTime);
                break;
            case "/combat_trigger_dependencies/targeted_enemy":
                if (!target) {
                    return false;
                }
                dependencyValue = this.getDependencyValue(target, currentTime);
                break;
            default:
                throw new Error("Unknown dependencyHrid in trigger: " + this.dependencyHrid);
        }

        return this.compareValue(dependencyValue);
    }

    isActiveMultiTarget(friendlies, enemies, currentTime) {
        let dependency;
        switch (this.dependencyHrid) {
            case "/combat_trigger_dependencies/all_allies":
                dependency = friendlies;
                break;
            case "/combat_trigger_dependencies/all_enemies":
                if (!enemies) {
                    return false;
                }
                dependency = enemies;
                break;
            default:
                throw new Error("Unknown dependencyHrid in trigger: " + this.dependencyHrid);
        }

        let dependencyValue;
        switch (this.conditionHrid) {
            case "/combat_trigger_conditions/number_of_active_units":
                dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints > 0).length;
                break;
            case "/combat_trigger_conditions/number_of_dead_units":
                dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints <= 0).length;
                break;
            case "/combat_trigger_conditions/lowest_hp_percentage":
                dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints > 0).reduce((prev, curr) => {
                    let currentHpPercentage = curr.combatDetails.currentHitpoints / curr.combatDetails.maxHitpoints;
                    return currentHpPercentage < prev ? currentHpPercentage : prev;
                }, 2) * 100;
                break;
            default:
                dependencyValue = dependency
                    .filter((unit) => unit.combatDetails.currentHitpoints > 0)
                    .map((unit) => this.getDependencyValue(unit, currentTime))
                    .reduce((prev, cur) => prev + cur, 0);
                break;
        }

        return this.compareValue(dependencyValue);
    }

    getDependencyValue(source, currentTime) {
        switch (this.conditionHrid) {
            case "/combat_trigger_conditions/berserk":
            case "/combat_trigger_conditions/frenzy":
            case "/combat_trigger_conditions/precision":
            case "/combat_trigger_conditions/vampirism":
            case "/combat_trigger_conditions/attack_coffee":
            case "/combat_trigger_conditions/defense_coffee":
            case "/combat_trigger_conditions/lucky_coffee":
            case "/combat_trigger_conditions/magic_coffee":
            case "/combat_trigger_conditions/melee_coffee":
            case "/combat_trigger_conditions/ranged_coffee":
            case "/combat_trigger_conditions/swiftness_coffee":
            case "/combat_trigger_conditions/wisdom_coffee":
            case "/combat_trigger_conditions/ice_spear":
            case "/combat_trigger_conditions/puncture":
            case "/combat_trigger_conditions/frost_surge":
            case "/combat_trigger_conditions/elusiveness":
            case "/combat_trigger_conditions/channeling_coffee":
            case "/combat_trigger_conditions/fierce_aura":
            case "/combat_trigger_conditions/invincible_armor":
            case "/combat_trigger_conditions/invincible_fire_resistance":
            case "/combat_trigger_conditions/invincible_nature_resistance":
            case "/combat_trigger_conditions/invincible_water_resistance":
            case "/combat_trigger_conditions/provoke":
            case "/combat_trigger_conditions/taunt":
            case "/combat_trigger_conditions/crippling_slash":
            case "/combat_trigger_conditions/mana_spring":
            case "/combat_trigger_conditions/retribution":
            case "/combat_trigger_conditions/fracturing_impact":
            case "/combat_trigger_conditions/maim":
            case "/combat_trigger_conditions/curse":
            case "/combat_trigger_conditions/weaken":
                let buffHrid = "/buff_uniques";
                buffHrid += this.conditionHrid.slice(this.conditionHrid.lastIndexOf("/"));
                return source.combatBuffs[buffHrid];
            case "/combat_trigger_conditions/critical_aura":
            case "/combat_trigger_conditions/critical_coffee":
            case "/combat_trigger_conditions/intelligence_coffee":
            case "/combat_trigger_conditions/stamina_coffee":
            case "/combat_trigger_conditions/elemental_affinity":
            case "/combat_trigger_conditions/fury":
            case "/combat_trigger_conditions/guardian_aura":
            case "/combat_trigger_conditions/insanity":
            case "/combat_trigger_conditions/spike_shell":
            case "/combat_trigger_conditions/toxic_pollen":
            case "/combat_trigger_conditions/invincible":
            case "/combat_trigger_conditions/mystic_aura":
            case "/combat_trigger_conditions/pestilent_shot":
            case "/combat_trigger_conditions/smoke_burst":
            case "/combat_trigger_conditions/speed_aura":
            case "/combat_trigger_conditions/toughness":
            case "/combat_trigger_conditions/enrage":
                let buffPrefix = "/buff_uniques";
                buffPrefix += this.conditionHrid.slice(this.conditionHrid.lastIndexOf("/"));
                let buffs = Object.keys(source.combatBuffs).filter(buff => buff.startsWith(buffPrefix));
                return source.combatBuffs[buffs?.[0]];
            case "/combat_trigger_conditions/current_hp":
                return source.combatDetails.currentHitpoints;
            case "/combat_trigger_conditions/current_mp":
                return source.combatDetails.currentManapoints;
            case "/combat_trigger_conditions/missing_hp":
                return source.combatDetails.maxHitpoints - source.combatDetails.currentHitpoints;
            case "/combat_trigger_conditions/missing_mp":
                return source.combatDetails.maxManapoints - source.combatDetails.currentManapoints;
            case "/combat_trigger_conditions/stun_status":
                // Replicate the game's behaviour of "stun status active" triggers activating
                // immediately after the stun has worn off
                return source.isStunned || source.stunExpireTime == currentTime;
            case "/combat_trigger_conditions/blind_status":
                return source.isBlinded || source.blindExpireTime == currentTime;
            case "/combat_trigger_conditions/silence_status":
                return source.isSilenced || source.silenceExpireTime == currentTime;
            default:
                throw new Error("Unknown conditionHrid in trigger: " + this.conditionHrid);
        }
    }

    compareValue(dependencyValue) {
        switch (this.comparatorHrid) {
            case "/combat_trigger_comparators/greater_than_equal":
                return dependencyValue >= this.value;
            case "/combat_trigger_comparators/less_than_equal":
                return dependencyValue <= this.value;
            case "/combat_trigger_comparators/is_active":
                return !!dependencyValue;
            case "/combat_trigger_comparators/is_inactive":
                return !dependencyValue;
            default:
                throw new Error("Unknown comparatorHrid in trigger: " + this.comparatorHrid);
        }
    }
}

module.exports = Trigger;
},
"data/combatTriggerDependencyDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"combatUnit.js": function(module, exports, __require) {
class CombatUnit {
    isPlayer;
    isStunned = false;
    stunExpireTime = null;
    isBlinded = false;
    blindExpireTime = null;
    isSilenced = false;
    silenceExpireTime = null;

    isOutOfMana = false;

    // Base levels which don't change after initialization
    staminaLevel = 1;
    intelligenceLevel = 1;
    attackLevel = 1;
    meleeLevel = 1;
    defenseLevel = 1;
    rangedLevel = 1;
    magicLevel = 1;

    experience = 0;
    experienceRate = 0;
    enrageTime = 0;

    abilities = [null, null, null, null];
    food = [null, null, null];
    drinks = [null, null, null];
    houseRooms = [];
    achievements = null;
    dropTable = [];
    rareDropTable = [];
    abilityManaCosts = new Map();

    // Calculated combat stats including temporary buffs
    combatDetails = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        maxHitpoints: 110,
        currentHitpoints: 110,
        maxManapoints: 110,
        currentManapoints: 110,
        stabAccuracyRating: 11,
        slashAccuracyRating: 11,
        smashAccuracyRating: 11,
        rangedAccuracyRating: 11,
        magicAccuracyRating: 11,
        stabMaxDamage: 11,
        slashMaxDamage: 11,
        smashMaxDamage: 11,
        rangedMaxDamage: 11,
        magicMaxDamage: 11,
        stabEvasionRating: 11,
        slashEvasionRating: 11,
        smashEvasionRating: 11,
        rangedEvasionRating: 11,
        magicEvasionRating: 11,
        defensiveMaxDamage: 0,
        totalArmor: 0.2,
        totalWaterResistance: 0.4,
        totalNatureResistance: 0.4,
        totalFireResistance: 0.4,
        abilityHaste: 0,
        tenacity: 0,
        totalThreat: 100,
        combatStats: {
            combatStyleHrid: "/combat_styles/smash",
            damageType: "/damage_types/physical",
            attackInterval: 3000000000,
            autoAttackDamage: 0,
            abilityDamage: 0,
            criticalRate: 0,
            criticalDamage: 0,
            stabAccuracy: 0,
            slashAccuracy: 0,
            smashAccuracy: 0,
            rangedAccuracy: 0,
            magicAccuracy: 0,
            stabDamage: 0,
            slashDamage: 0,
            smashDamage: 0,
            rangedDamage: 0,
            magicDamage: 0,
            defensiveDamage: 0,
            taskDamage: 0,
            physicalAmplify: 0,
            waterAmplify: 0,
            natureAmplify: 0,
            fireAmplify: 0,
            healingAmplify: 0,
            physicalThorns: 0,
            elementalThorns: 0,
            maxHitpoints: 0,
            maxManapoints: 0,
            stabEvasion: 0,
            slashEvasion: 0,
            smashEvasion: 0,
            rangedEvasion: 0,
            magicEvasion: 0,
            armor: 0,
            waterResistance: 0,
            natureResistance: 0,
            fireResistance: 0,
            lifeSteal: 0,
            hpRegenPer10: 0.01,
            mpRegenPer10: 0.01,
            combatDropRate: 0,
            combatDropQuantity: 0,
            combatRareFind: 0,
            combatExperience: 0,
            foodSlots: 1,
            drinkSlots: 1,
            armorPenetration: 0,
            waterPenetration: 0,
            naturePenetration: 0,
            firePenetration: 0,
            manaLeech: 0,
            castSpeed: 0,
            threat: 100,
            parry: 0,
            mayhem: 0,
            pierce: 0,
            curse: 0,
            ripple: 0,
            bloom: 0,
            blaze: 0,
            weaken: 0,
            fury: 0,
            foodHaste: 0,
            drinkConcentration: 0,
            damageTaken: 0,
            attackSpeed: 0,
            armorDamageRatio: 0,
            hpDrainRatio: 0,
            primaryTraining: "",
            focusTraining: "",
            staminaExperience: 0,
            intelligenceExperience: 0,
            attackExperience: 0,
            defenseExperience: 0,
            meleeExperience: 0,
            rangedExperience: 0,
            magicExperience: 0,
            retaliation: 0,
            maxHitpointsRatio: 0,
            maxManapointsRatio: 0,
        },
    };
    combatBuffs = {};
    permanentBuffs = {};
    zoneBuffs = {};
    extraBuffs = {};

    constructor() { }

    updateCombatDetails() {
        if (this.isPlayer) {
            if (this.combatDetails.combatStats.hpRegenPer10 === 0) {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01 + this.combatDetails.combatStats.hpRegenPer10;
            }
            if (this.combatDetails.combatStats.mpRegenPer10 === 0) {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01 + this.combatDetails.combatStats.mpRegenPer10;
            }
        }

        ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((stat) => {
            this.combatDetails[stat + "Level"] = this[stat + "Level"];
            let boosts = this.getBuffBoosts("/buff_types/" + stat + "_level");
            boosts.forEach((buff) => {
                this.combatDetails[stat + "Level"] += (this[stat + "Level"] * buff.ratioBoost);
                this.combatDetails[stat + "Level"] += buff.flatBoost;
            });
        });

        this.combatDetails.maxHitpoints = Math.floor(
            (10 * (10 + this.combatDetails.staminaLevel) + this.combatDetails.combatStats.maxHitpoints)
            * (1 + this.combatDetails.combatStats.maxHitpointsRatio)
        );
        this.combatDetails.maxManapoints = Math.floor(
            (10 * (10 + this.combatDetails.intelligenceLevel) + this.combatDetails.combatStats.maxManapoints)
            * (1 + this.combatDetails.combatStats.maxManapointsRatio)
        );

        let accuracyRatioBoostFromFury = this.getBuffBoost("/buff_types/fury_accuracy").ratioBoost;
        let damageRatioBoostFromFury = this.getBuffBoost("/buff_types/fury_damage").ratioBoost;
        // if (accuracyRatioBoostFromFury > 0) {
        //     console.log("Fury Boost: " + accuracyRatioBoostFromFury);
        // }

        let accuracyRatioBoost = this.getBuffBoost("/buff_types/accuracy").ratioBoost;
        let damageRatioBoost = this.getBuffBoost("/buff_types/damage").ratioBoost;

        ["stab", "slash", "smash"].forEach((style) => {
            this.combatDetails[style + "AccuracyRating"] =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats[style + "Accuracy"]) *
                (1 + accuracyRatioBoost) *
                (1 + accuracyRatioBoostFromFury);
            this.combatDetails[style + "MaxDamage"] =
                (10 + this.combatDetails.meleeLevel) *
                (1 + this.combatDetails.combatStats[style + "Damage"]) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);
            let baseEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + "Evasion"]);
            this.combatDetails[style + "EvasionRating"] = baseEvasion;
            let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
            for (const boost of evasionBoosts) {
                this.combatDetails[style + "EvasionRating"] += boost.flatBoost;
                this.combatDetails[style + "EvasionRating"] += baseEvasion * boost.ratioBoost;
            }
        });

        this.combatDetails.defensiveMaxDamage =
            (10 + this.combatDetails.defenseLevel) *
            (1 + this.combatDetails.combatStats.defensiveDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        // when equiped bulwark
        if (this.equipment?.['/equipment_types/two_hand']?.hrid.includes("bulwark")) {
            this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;
        }

        this.combatDetails.rangedAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.rangedAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.rangedMaxDamage =
            (10 + this.combatDetails.rangedLevel) *
            (1 + this.combatDetails.combatStats.rangedDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        let baseRangedEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
        this.combatDetails.rangedEvasionRating = baseRangedEvasion;
        let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
        for (const boost of evasionBoosts) {
            this.combatDetails.rangedEvasionRating += boost.flatBoost;
            this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.damageTaken = this.getBuffBoost("/buff_types/damage_taken").flatBoost;
        // if (this.combatDetails.combatStats.damageTaken > 0) {
        //     console.log("Damage taken: " + this.combatDetails.combatStats.damageTaken);
        // }

        this.combatDetails.magicAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.magicAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.magicMaxDamage =
            (10 + this.combatDetails.magicLevel) *
            (1 + this.combatDetails.combatStats.magicDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        let baseMagicEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);
        this.combatDetails.magicEvasionRating = baseMagicEvasion;
        for (const boost of evasionBoosts) {
            this.combatDetails.magicEvasionRating += boost.flatBoost;
            this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost("/buff_types/physical_amplify").flatBoost;
        this.combatDetails.combatStats.waterAmplify += this.getBuffBoost("/buff_types/water_amplify").flatBoost;
        this.combatDetails.combatStats.natureAmplify += this.getBuffBoost("/buff_types/nature_amplify").flatBoost;
        this.combatDetails.combatStats.fireAmplify += this.getBuffBoost("/buff_types/fire_amplify").flatBoost;
        this.combatDetails.combatStats.healingAmplify += this.getBuffBoost("/buff_types/healing_amplify").flatBoost;

        this.combatDetails.combatStats.attackInterval /= (1 + (this.combatDetails.attackLevel / 2000));

        let baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
        this.combatDetails.combatStats.attackInterval /= (1 + baseAttackSpeed);
        let attackIntervalBoosts = this.getBuffBoosts("/buff_types/attack_speed");
        let attackIntervalRatioBoost = attackIntervalBoosts
            .map((boost) => boost.ratioBoost)
            .reduce((prev, cur) => prev + cur, 0);
        this.combatDetails.combatStats.attackInterval /= (1 + attackIntervalRatioBoost);

        let baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
        this.combatDetails.totalArmor = baseArmor;
        let armorBoosts = this.getBuffBoosts("/buff_types/armor");
        for (const boost of armorBoosts) {
            this.combatDetails.totalArmor += boost.flatBoost;
            this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
        }

        let baseWaterResistance =
            0.2 * this.combatDetails.defenseLevel +
            this.combatDetails.combatStats.waterResistance;
        this.combatDetails.totalWaterResistance = baseWaterResistance;
        let waterResistanceBoosts = this.getBuffBoosts("/buff_types/water_resistance");
        for (const boost of waterResistanceBoosts) {
            this.combatDetails.totalWaterResistance += boost.flatBoost;
            this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
        }

        let baseNatureResistance =
            0.2 * this.combatDetails.defenseLevel +
            this.combatDetails.combatStats.natureResistance;
        this.combatDetails.totalNatureResistance = baseNatureResistance;
        let natureResistanceBoosts = this.getBuffBoosts("/buff_types/nature_resistance");
        for (const boost of natureResistanceBoosts) {
            this.combatDetails.totalNatureResistance += boost.flatBoost;
            this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
        }

        let baseFireResistance =
            0.2 * this.combatDetails.defenseLevel +
            this.combatDetails.combatStats.fireResistance;
        this.combatDetails.totalFireResistance = baseFireResistance;
        let fireResistanceBoosts = this.getBuffBoosts("/buff_types/fire_resistance");
        for (const boost of fireResistanceBoosts) {
            this.combatDetails.totalFireResistance += boost.flatBoost;
            this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
        }

        let hpRegenBoosts = this.getBuffBoost("/buff_types/hp_regen");
        this.combatDetails.combatStats.hpRegenPer10 += this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

        let mpRegenBoosts = this.getBuffBoost("/buff_types/mp_regen");
        this.combatDetails.combatStats.mpRegenPer10 += this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

        this.combatDetails.combatStats.lifeSteal += this.getBuffBoost("/buff_types/life_steal").flatBoost;
        this.combatDetails.combatStats.physicalThorns += this.getBuffBoost(
            "/buff_types/physical_thorns"
        ).flatBoost;
        this.combatDetails.combatStats.elementalThorns += this.getBuffBoost(
            "/buff_types/elemental_thorns"
        ).flatBoost;
        this.combatDetails.combatStats.combatExperience += this.getBuffBoost("/buff_types/wisdom").flatBoost;
        this.combatDetails.combatStats.criticalRate += this.getBuffBoost("/buff_types/critical_rate").flatBoost;
        this.combatDetails.combatStats.criticalDamage += this.getBuffBoost("/buff_types/critical_damage").flatBoost;

        this.combatDetails.combatStats.castSpeed += this.getBuffBoost("/buff_types/cast_speed").flatBoost;
        this.combatDetails.combatStats.castSpeed += this.combatDetails["attackLevel"] / 2000;

        let combatDropRateBoosts = this.getBuffBoost("/buff_types/combat_drop_rate");
        this.combatDetails.combatStats.combatDropRate += (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
        let combatRareFindBoosts = this.getBuffBoost("/buff_types/rare_find");
        this.combatDetails.combatStats.combatRareFind += (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
        this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;
        let combatDropQuantityBoosts = this.getBuffBoost("/buff_types/combat_drop_quantity");
        this.combatDetails.combatStats.combatDropQuantity += (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;

        let baseThreat = 100 + this.combatDetails.combatStats.threat;
        this.combatDetails.totalThreat = baseThreat;
        let threatBoosts = this.getBuffBoost("/buff_types/threat");
        if (threatBoosts.ratioBoost !== 0) {
            this.combatDetails.combatStats.threat += baseThreat * threatBoosts.ratioBoost;
        } else {
            this.combatDetails.combatStats.threat = baseThreat;
        }
        this.combatDetails.combatStats.threat += threatBoosts.flatBoost;

        this.combatDetails.combatStats.retaliation += this.getBuffBoost("/buff_types/retaliation").flatBoost;
        this.combatDetails.combatStats.tenacity += this.getBuffBoost("/buff_types/tenacity").flatBoost;
    }

    addBuffs(buffs, currentTime) {
        buffs.forEach(buff => buff.startTime = currentTime);

        let needUpdate = false;
        for (const buff of buffs) {
            if (!this.combatBuffs[buff.uniqueHrid] || this.combatBuffs[buff.uniqueHrid].ratioBoost != buff.ratioBoost || this.combatBuffs[buff.uniqueHrid].flatBoost != buff.flatBoost) {
                needUpdate = true;
            }
            this.combatBuffs[buff.uniqueHrid] = buff;
        }

        if (needUpdate) {
            this.updateCombatDetails();
        }
    }

    addBuff(buff, currentTime) {
        buff.startTime = currentTime;

        let needUpdate = true;
        if (this.combatBuffs[buff.uniqueHrid] && this.combatBuffs[buff.uniqueHrid].ratioBoost === buff.ratioBoost && this.combatBuffs[buff.uniqueHrid].flatBoost === buff.flatBoost) {
            needUpdate = false;
        }

        this.combatBuffs[buff.uniqueHrid] = buff;

        if (needUpdate) {
            this.updateCombatDetails();
        }
    }

    removeBuffs(buffs) {
        let needUpdate = false;
        buffs.forEach(buff => {
            if (!this.combatBuffs[buff.uniqueHrid]) {
                return;
            }
            delete this.combatBuffs[buff.uniqueHrid];
            needUpdate = true;
        })

        if (needUpdate) {
            this.updateCombatDetails();
        }

    }

    removeBuff(buff) {
        if (!this.combatBuffs[buff.uniqueHrid]) {
            return;
        }
        delete this.combatBuffs[buff.uniqueHrid];

        this.updateCombatDetails();
    }

    addPermanentBuff(buff) {
        if (this.permanentBuffs[buff.typeHrid]) {
            this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
            this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
        } else {
            this.permanentBuffs[buff.typeHrid] = {
                uniqueHrid: buff.uniqueHrid,
                typeHrid: buff.typeHrid,
                flatBoost: buff.flatBoost,
                ratioBoost: buff.ratioBoost,
                duration: buff.duration
            };
        }
    }

    generatePermanentBuffs() {
        for (let i = 0; i < this.houseRooms.length; i++) {
            const houseRoom = this.houseRooms[i];
            houseRoom.buffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }

        if (this.achievements) {
            this.achievements.buffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.zoneBuffs) {
            this.zoneBuffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.extraBuffs) {
            this.extraBuffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }
    }

    removeExpiredBuffs(currentTime) {
        let expiredBuffs = Object.values(this.combatBuffs).filter(
            (buff) => buff.startTime + buff.duration <= currentTime
        );
        expiredBuffs.forEach((buff) => {
            delete this.combatBuffs[buff.uniqueHrid];
        });

        this.updateCombatDetails();
    }

    clearBuffs() {
        this.combatBuffs = structuredClone(this.permanentBuffs);
        this.updateCombatDetails();
    }

    clearCCs() {
        this.isStunned = false;
        this.stunExpireTime = null;
        this.isSilenced = false;
        this.silenceExpireTime = null;
        this.isBlinded = false;
        this.blindExpireTime = null;
        this.combatDetails.combatStats.damageTaken = 0;
    }

    getBuffBoosts(type) {
        let boosts = [];
        Object.values(this.combatBuffs)
            .filter((buff) => buff.typeHrid == type)
            .forEach((buff) => {
                boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });
            });

        return boosts;
    }

    getBuffBoost(type) {
        let boosts = this.getBuffBoosts(type);

        let boost = {
            ratioBoost: 0,
            flatBoost: 0,
        };

        for (let i = 0; i < boosts.length; i++) {
            boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
            boost.flatBoost += boosts[i]?.flatBoost ?? 0;
        }

        return boost;
    }

    reset(currentTime = 0) {
        this.clearCCs();

        // 只有玩家在地下城团灭重开时保留buff和CD，敌人始终完全重置
        if (currentTime == 0 || !this.isPlayer) {
            // 首次战斗开始 或 敌人重置：完全重置
            this.clearBuffs();
            // this.updateCombatDetails();
            this.resetCooldowns(currentTime);
        } else {
            // 地下城团灭重开（仅玩家）：只移除过期buff，保留CD
            this.removeExpiredBuffs(currentTime);
            // this.updateCombatDetails();
        }

        this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
        this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
    }

    resetCooldowns(currentTime = 0) {
        this.food.filter((food) => food != null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));
        this.drinks.filter((drink) => drink != null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));

        let haste = this.combatDetails.combatStats.abilityHaste;

        this.abilities
            .filter((ability) => ability != null)
            .forEach((ability) => {
                if (this.isPlayer) {
                    ability.lastUsed = Number.MIN_SAFE_INTEGER;
                } else {
                    let cooldownDuration = ability.cooldownDuration;
                    if (haste > 0) {
                        cooldownDuration = cooldownDuration * 100 / (100 + haste);
                    }
                    ability.lastUsed = currentTime - Math.floor(cooldownDuration * 0.5) + Math.floor(Math.random() * cooldownDuration * 0.5);
                }
            });
    }

    addHitpoints(hitpoints) {
        let hitpointsAdded = 0;

        if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {
            return hitpointsAdded;
        }

        let newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);
        hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
        this.combatDetails.currentHitpoints = newHitpoints;

        return hitpointsAdded;
    }

    addManapoints(manapoints) {
        let manapointsAdded = 0;

        if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {
            return manapointsAdded;
        }

        let newManapoints = Math.min(
            this.combatDetails.currentManapoints + manapoints,
            this.combatDetails.maxManapoints
        );
        manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
        this.combatDetails.currentManapoints = newManapoints;

        return manapointsAdded;
    }
}

module.exports = CombatUnit;
},
"data/combatMonsterDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"drops.js": function(module, exports, __require) {
class Drops {

    constructor(itemHrid, dropRate, minCount, maxCount, difficultyTier) {
        this.itemHrid = itemHrid;
        this.dropRate = dropRate;
        this.minCount = minCount;
        this.maxCount = maxCount;
        this.difficultyTier = difficultyTier;
    }
}

module.exports = Drops;
},
"player.js": function(module, exports, __require) {
const Ability = __require("ability.js");
const CombatUnit = __require("combatUnit.js");
const Consumable = __require("consumable.js");
const Equipment = __require("equipment.js");
const HouseRoom = __require("houseRoom.js");
const Achievement = __require("achievement.js");
class Player extends CombatUnit {
    equipment = {
        "/equipment_types/head": null,
        "/equipment_types/body": null,
        "/equipment_types/legs": null,
        "/equipment_types/feet": null,
        "/equipment_types/hands": null,
        "/equipment_types/main_hand": null,
        "/equipment_types/two_hand": null,
        "/equipment_types/off_hand": null,
        "/equipment_types/pouch": null,
        "/equipment_types/back": null,
    };

    constructor() {
        super();

        this.isPlayer = true;
        this.hrid = "player";
    }

    static createFromDTO(dto) {
        let player = new Player();

        player.staminaLevel = dto.staminaLevel;
        player.intelligenceLevel = dto.intelligenceLevel;
        player.attackLevel = dto.attackLevel;
        player.meleeLevel = dto.meleeLevel;
        player.defenseLevel = dto.defenseLevel;
        player.rangedLevel = dto.rangedLevel;
        player.magicLevel = dto.magicLevel;

        player.hrid = dto.hrid;

        for (const [key, value] of Object.entries(dto.equipment)) {
            player.equipment[key] = value ? Equipment.createFromDTO(value) : null;
        }

        player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));
        player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));
        player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));
        Object.entries(dto.houseRooms).forEach(houseRoom => {
            if (houseRoom[1] > 0) {
                player.houseRooms.push(new HouseRoom(houseRoom[0], houseRoom[1]))
            }
        });

        player.achievements = new Achievement(dto.achievements);

        player.debuffOnLevelGap = dto.debuffOnLevelGap;

        return player;
    }

    updateCombatDetails() {
        if (this.equipment["/equipment_types/main_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/main_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/main_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/main_hand"].getCombatStat("attackInterval");
            this.combatDetails.combatStats.primaryTraining =
                this.equipment["/equipment_types/main_hand"].getPrimaryTraining();
        } else if (this.equipment["/equipment_types/two_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/two_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/two_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/two_hand"].getCombatStat("attackInterval");
            this.combatDetails.combatStats.primaryTraining =
                this.equipment["/equipment_types/two_hand"].getPrimaryTraining();
        } else {
            this.combatDetails.combatStats.combatStyleHrid = "/combat_styles/smash";
            this.combatDetails.combatStats.damageType = "/damage_types/physical";
            this.combatDetails.combatStats.attackInterval = 3000000000;
            this.combatDetails.combatStats.primaryTraining = "/skills/melee";
        }

        if (this.equipment["/equipment_types/charm"]) {
            this.combatDetails.combatStats.focusTraining = this.equipment["/equipment_types/charm"].getFocusTraining();
        } else {
            this.combatDetails.combatStats.focusTraining = "";
        }

        [
            "stabAccuracy",
            "slashAccuracy",
            "smashAccuracy",
            "rangedAccuracy",
            "magicAccuracy",
            "stabDamage",
            "slashDamage",
            "smashDamage",
            "rangedDamage",
            "magicDamage",
            "defensiveDamage",
            "taskDamage",
            "physicalAmplify",
            "waterAmplify",
            "natureAmplify",
            "fireAmplify",
            "healingAmplify",
            "stabEvasion",
            "slashEvasion",
            "smashEvasion",
            "rangedEvasion",
            "magicEvasion",
            "armor",
            "waterResistance",
            "natureResistance",
            "fireResistance",
            "maxHitpoints",
            "maxManapoints",
            "lifeSteal",
            "hpRegenPer10",
            "mpRegenPer10",
            "physicalThorns",
            "elementalThorns",
            "combatDropRate",
            "combatRareFind",
            "combatDropQuantity",
            "combatExperience",
            "criticalRate",
            "criticalDamage",
            "armorPenetration",
            "waterPenetration",
            "naturePenetration",
            "firePenetration",
            "abilityHaste",
            "tenacity",
            "manaLeech",
            "castSpeed",
            "threat",
            "parry",
            "mayhem",
            "pierce",
            "curse",
            "fury",
            "weaken",
            "ripple",
            "bloom",
            "blaze",
            "attackSpeed",
            "foodHaste",
            "drinkConcentration",
            "autoAttackDamage",
            "abilityDamage",
            "staminaExperience",
            "intelligenceExperience",
            "attackExperience",
            "defenseExperience",
            "meleeExperience",
            "rangedExperience",
            "magicExperience",
            "retaliation"
        ].forEach((stat) => {
            this.combatDetails.combatStats[stat] = Object.values(this.equipment)
                .filter((equipment) => equipment != null)
                .map((equipment) => equipment.getCombatStat(stat))
                .reduce((prev, cur) => prev + cur, 0);
        });

        if (this.equipment["/equipment_types/pouch"]) {
            this.combatDetails.combatStats.foodSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("foodSlots");
            this.combatDetails.combatStats.drinkSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("drinkSlots");
        } else {
            this.combatDetails.combatStats.foodSlots = 1;
            this.combatDetails.combatStats.drinkSlots = 1;
        }

        super.updateCombatDetails();
    }
}

module.exports = Player;
},
"consumable.js": function(module, exports, __require) {
const Buff = __require("buff.js");
const itemDetailMap = __require("data/itemDetailMap.json");
const Trigger = __require("trigger.js");
class Consumable {
    constructor(hrid, triggers = null) {
        this.hrid = hrid;

        let gameConsumable = itemDetailMap[this.hrid];
        if (!gameConsumable) {
            throw new Error("No consumable found for hrid: " + this.hrid);
        }

        this.cooldownDuration = gameConsumable.consumableDetail.cooldownDuration;
        this.hitpointRestore = gameConsumable.consumableDetail.hitpointRestore;
        this.manapointRestore = gameConsumable.consumableDetail.manapointRestore;
        this.recoveryDuration = gameConsumable.consumableDetail.recoveryDuration;
        this.catagoryHrid = gameConsumable.categoryHrid;

        this.buffs = [];
        if (gameConsumable.consumableDetail.buffs) {
            for (const consumableBuff of gameConsumable.consumableDetail.buffs) {
                let buff = new Buff(consumableBuff);
                this.buffs.push(buff);
            }
        }

        if (triggers) {
            this.triggers = triggers;
        } else {
            this.triggers = [];
            for (const defaultTrigger of gameConsumable.consumableDetail.defaultCombatTriggers) {
                let trigger = new Trigger(
                    defaultTrigger.dependencyHrid,
                    defaultTrigger.conditionHrid,
                    defaultTrigger.comparatorHrid,
                    defaultTrigger.value
                );
                this.triggers.push(trigger);
            }
        }

        this.lastUsed = Number.MIN_SAFE_INTEGER;
    }

    static createFromDTO(dto) {
        let triggers = dto.triggers.map((trigger) => Trigger.createFromDTO(trigger));
        let consumable = new Consumable(dto.hrid, triggers);

        return consumable;
    }

    shouldTrigger(currentTime, source, target, friendlies, enemies) {
        if (source.isStunned) {
            return false;
        }
        let consumableHaste;
        if (this.catagoryHrid.includes("food")) {
            consumableHaste = source.combatDetails.combatStats.foodHaste
        } else {
            consumableHaste = source.combatDetails.combatStats.drinkConcentration;
        }
        let cooldownDuration = this.cooldownDuration;
        if (consumableHaste > 0) {
            cooldownDuration = cooldownDuration / (1 + consumableHaste);
        }

        if (this.lastUsed + cooldownDuration > currentTime) {
            return false;
        }

        if (this.triggers.length == 0) {
            return true;
        }

        let shouldTrigger = true;
        for (const trigger of this.triggers) {
            if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
                shouldTrigger = false;
            }
        }

        return shouldTrigger;
    }
}

module.exports = Consumable;
},
"data/itemDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"equipment.js": function(module, exports, __require) {
const itemDetailMap = __require("data/itemDetailMap.json");
const enhancementLevelTotalMultiplierTable = __require("data/enhancementLevelTotalBonusMultiplierTable.json");
class Equipment {
    constructor(hrid, enhancementLevel) {
        this.hrid = hrid;
        let gameItem = itemDetailMap[this.hrid];
        if (!gameItem) {
            throw new Error("No equipment found for hrid: " + this.hrid);
        }
        this.gameItem = gameItem;
        this.enhancementLevel = enhancementLevel;
    }

    static createFromDTO(dto) {
        let equipment = new Equipment(dto.hrid, dto.enhancementLevel);

        return equipment;
    }

    getCombatStat(combatStat) {
        let multiplier = enhancementLevelTotalMultiplierTable[this.enhancementLevel];
        if(this.gameItem.equipmentDetail.combatStats[combatStat]) {
            let enhancementBonus = this.gameItem.equipmentDetail.combatEnhancementBonuses[combatStat] || 0;
            let stat = this.gameItem.equipmentDetail.combatStats[combatStat] + multiplier * enhancementBonus;
            return stat;
        }
        return 0;
    }

    getCombatStyle() {
        return this.gameItem.equipmentDetail.combatStats.combatStyleHrids[0];
    }

    getDamageType() {
        return this.gameItem.equipmentDetail.combatStats.damageType;
    }

    getPrimaryTraining() {
        return this.gameItem.equipmentDetail.combatStats.primaryTraining;
    }

    getFocusTraining(){
        return this.gameItem.equipmentDetail.combatStats.focusTraining;
    }
}

module.exports = Equipment;
},
"data/enhancementLevelTotalBonusMultiplierTable.json": function(module, exports, __require) {
module.exports = {};
},
"houseRoom.js": function(module, exports, __require) {
const Buff = __require("buff.js");
const houseRoomDetailMap = __require("data/houseRoomDetailMap.json");
class HouseRoom {
    constructor(hrid, level) {
        this.hrid = hrid;
        this.level = level;

        let gameHouseRoom = houseRoomDetailMap[this.hrid];
        if (!gameHouseRoom) {
            throw new Error("No house room found for hrid: " + this.hrid);
        }

        this.buffs = [];
        if (gameHouseRoom.actionBuffs) {
            for (const actionBuff of gameHouseRoom.actionBuffs) {
                let buff = new Buff(actionBuff, level);
                this.buffs.push(buff);
            }
        }
        if (gameHouseRoom.globalBuffs) {
            for (const globalBuff of gameHouseRoom.globalBuffs) {
                let buff = new Buff(globalBuff, level);
                this.buffs.push(buff);
            }
        }
    }
}

module.exports = HouseRoom;
},
"data/houseRoomDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"achievement.js": function(module, exports, __require) {
const Buff = __require("buff.js");
const achievementTierDetailMap = __require("data/achievementTierDetailMap.json");
const achievementDetailMap = __require("data/achievementDetailMap.json");
class Achievement {
    constructor(achievements) {
        this.achievements = achievements;
        this.buffs = [];

        for(const tier of Object.values(achievementTierDetailMap)) {
            let isGetAll = true;
            let detailMap = Object.values(achievementDetailMap).filter((detail) => detail.tierHrid == tier.hrid)
            for(const achievement of Object.values(detailMap)) {
                if(!this.achievements[achievement.hrid] || this.achievements[achievement.hrid] == false) {
                    isGetAll = false;
                    break;
                }
            }
            if(isGetAll) {
                let buff = new Buff(tier.buff);
                this.buffs.push(buff);
            }
        }
    }
}

module.exports = Achievement;
},
"data/achievementTierDetailMap.json": function(module, exports, __require) {
module.exports = {};
},
"data/achievementDetailMap.json": function(module, exports, __require) {
module.exports = {};
}
};
const __cache = {};
function __require(id) {
  if (__cache[id]) return __cache[id].exports;
  const module = { exports: {} };
  __cache[id] = module;
  __modules[id](module, module.exports, __require);
  return module.exports;
}
__require("trialWorker.js");
})();
