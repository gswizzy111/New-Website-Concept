#!/usr/bin/env node
/**
 * Unit tests of the intake system (lib/intake): bundles each
 * tests/intake/*.test.ts with esbuild (resolving the "@/..." alias) into a
 * temporary folder under tests/intake/out/ (git-ignored; packages stay
 * external and resolve from the repo's node_modules) and runs them with
 * node:test. No Next.js, no database.
 *
 *   node scripts/test-intake.mjs            all tests/intake/*.test.ts
 *   node scripts/test-intake.mjs receiving  only files whose name contains "receiving"
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests", "intake");
const filter = process.argv[2] ?? "";
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts") && f.includes(filter))
  .sort();
if (!files.length) {
  console.error(`No tests/intake/*.test.ts files${filter ? ` matching "${filter}"` : ""}.`);
  process.exit(1);
}

mkdirSync(path.join(testDir, "out"), { recursive: true });
const outDir = mkdtempSync(path.join(testDir, "out", "unit-"));
const aliases = {
  name: "intake-aliases",
  setup(b) {
    // "@/lib/x" -> <repo>/lib/x (tsconfig paths)
    b.onResolve({ filter: /^@\// }, async (args) => {
      const r = await b.resolve(`./${args.path.slice(2)}`, { kind: args.kind, resolveDir: root });
      return r.errors.length ? { errors: r.errors } : { path: r.path };
    });
    // Next.js's server-only marker is not a package here: an empty module in tests
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "intake-empty" }));
    b.onLoad({ filter: /.*/, namespace: "intake-empty" }, () => ({ contents: "", loader: "js" }));
  },
};

let status = 0;
try {
  await build({
    entryPoints: files.map((f) => path.join(testDir, f)),
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: "inline",
    packages: "external",
    plugins: [aliases],
    logLevel: "warning",
  });
  const outputs = files.map((f) => path.join(outDir, f.replace(/\.ts$/, ".mjs")));
  const run = spawnSync(process.execPath, ["--enable-source-maps", "--test", "--test-reporter=spec", ...outputs], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, TZ: process.env.TZ ?? "UTC" },
  });
  status = run.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  status = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(status);
