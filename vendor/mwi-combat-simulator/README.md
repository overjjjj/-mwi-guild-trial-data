# MWI Combat Simulator Worker

This directory vendors the MIT-licensed combat engine from
`https://github.com/shykai/MWICombatSimulatorTest` (originally by AmVoidGuy).

`trialWorker.js` adds guild-trial monster injection, level scaling, participant
HP scaling, and local worker messages. Run `npm run build` in this directory to
rebuild `public/trial-worker.js`; no package installation is required. Game data
maps are intentionally omitted from the bundle and injected from the current
browser `initClientData` when a simulation starts.
