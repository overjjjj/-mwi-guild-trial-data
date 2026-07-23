import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(root, "trialWorker.js");
const modules = new Map();

function moduleId(filePath) {
    return path.relative(root, filePath).replaceAll("\\", "/");
}

function resolveImport(parentPath, request) {
    if (!request.startsWith(".")) throw new Error(`Unsupported external import: ${request}`);
    const base = path.resolve(path.dirname(parentPath), request);
    for (const candidate of [base, `${base}.js`, `${base}.json`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`Cannot resolve ${request} from ${parentPath}`);
}

function collect(filePath) {
    const id = moduleId(filePath);
    if (modules.has(id)) return id;
    if (filePath.endsWith(".json")) {
        modules.set(id, "module.exports = {};");
        return id;
    }
    let source = fs.readFileSync(filePath, "utf8");
    modules.set(id, "");
    source = source.replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?\s*$/gm, (_match, localName, request) => {
        const dependencyId = collect(resolveImport(filePath, request));
        return `const ${localName} = __require(${JSON.stringify(dependencyId)});`;
    });
    source = source.replace(/^export\s+default\s+([A-Za-z_$][\w$]*);?\s*$/gm, "module.exports = $1;");
    if (/^import\s/m.test(source) || /^export\s/m.test(source)) throw new Error(`Unsupported module syntax in ${filePath}`);
    modules.set(id, source);
    return id;
}

const entryId = collect(entryPath);
const definitions = [...modules.entries()].map(([id, source]) => `${JSON.stringify(id)}: function(module, exports, __require) {\n${source}\n}`).join(",\n");
const bundle = `/* MWI Combat Simulator, MIT License, Copyright (c) 2024 AmVoidGuy. Trial integration by zc. */\n(function () {\nconst __modules = {\n${definitions}\n};\nconst __cache = {};\nfunction __require(id) {\n  if (__cache[id]) return __cache[id].exports;\n  const module = { exports: {} };\n  __cache[id] = module;\n  __modules[id](module, module.exports, __require);\n  return module.exports;\n}\n__require(${JSON.stringify(entryId)});\n})();\n`;
const outputDirectory = path.resolve(root, "../../public");
fs.mkdirSync(outputDirectory, { recursive: true });
const normalizedBundle = bundle.replace(/[\t ]+$/gm, "");
fs.writeFileSync(path.join(outputDirectory, "trial-worker.js"), normalizedBundle, "utf8");
console.log(`Built public/trial-worker.js (${Math.round(normalizedBundle.length / 1024)} KiB)`);
