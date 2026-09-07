const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const ignoredDirs = new Set([".git", "node_modules", "data"]);

function collectJavaScriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirs.has(entry.name)) return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

const files = collectJavaScriptFiles(rootDir).sort();
let hasErrors = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) hasErrors = true;
}

if (hasErrors) process.exit(1);
console.log(`Checked ${files.length} JavaScript files`);
