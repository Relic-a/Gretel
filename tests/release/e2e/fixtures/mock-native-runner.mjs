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

const fallbackMatrix = [
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

const matrix = args.caseIds ? args.caseIds.split(",") : fallbackMatrix;

if (args.evidenceDir) {
  mkdirSync(args.evidenceDir, { recursive: true });
  writeFileSync(path.join(args.evidenceDir, "protocol-mock.log"), "Harmless native protocol fixture executed. No installer or container was run.\n");
}

const report = {
  schemaVersion: 1,
  runner: "mock-native-protocol-runner",
  runId: args.runId || "mock-run-id",
  targetOs: args.targetOs || "linux",
  packageFormat: args.packageFormat || "deb",
  oldArtifactHash: args.oldHash || "mock-old-hash",
  newArtifactHash: args.newHash || "mock-new-hash",
  qualification: "protocol-test",
  architecture: args.architecture,
  cases: matrix.map((id) => ({
    id,
    status: "pass",
    durationMs: 15,
    evidence: ["protocol-mock.log"],
    failureReason: null
  }))
};

mkdirSync(path.dirname(args.reportFile), { recursive: true });
writeFileSync(args.reportFile, JSON.stringify(report, null, 2) + "\n");
process.stdout.write("Mock runner completed successfully\n");
