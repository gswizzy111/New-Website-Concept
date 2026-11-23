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
import net from "node:net";
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
  // services.test.ts runs the in-memory Supabase/Resend stand-in on this port.
  // The Resend SDK reads RESEND_BASE_URL when it loads, so it is set here.
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const run = spawnSync(process.execPath, ["--enable-source-maps", "--test", "--test-timeout=60000", "--test-reporter=spec", ...outputs], {
    stdio: "inherit",
    cwd: root,
    env: {
      ...process.env,
      TZ: process.env.TZ ?? "UTC",
      INTAKE_TEST_MOCK_PORT: String(port),
      RESEND_BASE_URL: `http://localhost:${port}/__resend`,
      RESEND_API_KEY: "re_test_key",
    },
  });
  status = run.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  status = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(status);
