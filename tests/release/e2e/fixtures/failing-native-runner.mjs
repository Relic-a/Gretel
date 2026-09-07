#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      result[key] = argv[++i];
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.reportFile) {
  process.stderr.write("Missing --report-file\n");
  process.exit(1);
}

const matrix = [
  "native.fresh-install",
  "native.reinstall-preserve",
  "native.upgrade-preserve",
  "native.uninstall-keep",
  "native.uninstall-remove",
  "native.gui-shutdown",
  "native.update-tamper",
  "native.update-wrong-signature",
  "native.update-interruption",
  "native.update-install-failure",
  "native.update-success",
  "native.arch-manual-update"
];

if (args.evidenceDir) {
  mkdirSync(args.evidenceDir, { recursive: true });
  writeFileSync(path.join(args.evidenceDir, "failing-runner.log"), "Simulated native installation failure.\n");
}

const report = {
  schemaVersion: 1,
  runner: "failing-native-protocol-runner",
  runId: args.runId || "mock-run-id",
  targetOs: args.targetOs || "linux",
  packageFormat: args.packageFormat || "deb",
  oldArtifactHash: args.oldHash || "mock-old-hash",
  newArtifactHash: args.newHash || "mock-new-hash",
  qualification: "protocol-test-fixture-not-native-qualification",
  cases: matrix.map((id) => ({
    id,
    status: id === "native.fresh-install" ? "fail" : "pass",
    durationMs: 15,
    evidence: ["failing-runner.log"],
    failureReason: id === "native.fresh-install" ? "Simulated package install failure in target container" : null
  }))
};

mkdirSync(path.dirname(args.reportFile), { recursive: true });
writeFileSync(args.reportFile, JSON.stringify(report, null, 2) + "\n");
process.stderr.write("Failing runner reported deliberate failure\n");
process.exit(1);
