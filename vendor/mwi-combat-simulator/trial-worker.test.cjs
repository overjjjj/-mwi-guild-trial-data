const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const bundlePath = path.resolve(__dirname, "../../public/trial-worker.js");
const dataMapNames = [
  "itemDetailMap",
  "abilityDetailMap",
  "combatMonsterDetailMap",
  "houseRoomDetailMap",
  "achievementDetailMap",
  "achievementTierDetailMap",
  "combatStyleDetailMap",
  "combatTriggerDependencyDetailMap",
  "enhancementLevelTotalBonusMultiplierTable",
];
const dataMaps = Object.fromEntries(dataMapNames.map((name) => [name, require(`./data/${name}.json`)]));
const wrapper = `
  const { parentPort, workerData } = require("node:worker_threads");
  globalThis.self = globalThis;
  self.postMessage = (message) => parentPort.postMessage(message);
  eval(require("node:fs").readFileSync(workerData.bundlePath, "utf8"));
  parentPort.on("message", (data) => self.onmessage({ data }));
`;

assert.equal(fs.existsSync(bundlePath), true);
const worker = new Worker(wrapper, { eval: true, workerData: { bundlePath } });
const result = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("trial worker smoke test timed out")), 30000);
  worker.on("message", (message) => {
    if (message.type === "trial_simulation_progress") return;
    clearTimeout(timeout);
    if (message.type === "trial_simulation_error") reject(new Error(message.error));
    else resolve(message);
  });
  worker.on("error", reject);
});

worker.postMessage({
  type: "trial_simulation_start",
  trialKey: "smoke",
  trialName: "模拟冒烟测试",
  monsterHrids: ["/monsters/abyssal_imp"],
  levels: [100],
  hpMultiplier: 1.01,
  players: [{
    hrid: "player1",
    staminaLevel: 200,
    intelligenceLevel: 200,
    attackLevel: 200,
    meleeLevel: 200,
    defenseLevel: 200,
    rangedLevel: 1,
    magicLevel: 1,
    equipment: {},
    food: [null, null, null],
    drinks: [null, null, null],
    abilities: [null, null, null, null, null],
    houseRooms: {},
    achievements: {},
    debuffOnLevelGap: 0,
  }],
  dataMaps,
});

result.then((message) => {
  assert.equal(message.type, "trial_simulation_result");
  assert.equal(message.trialKey, "smoke");
  assert.equal(message.results.length, 1);
  assert.equal(message.results[0].level, 100);
  assert.equal(Number.isFinite(message.results[0].winRate), true);
  worker.terminate();
  console.log("trial worker smoke test passed");
}).catch((error) => {
  worker.terminate();
  console.error(error);
  process.exitCode = 1;
});
