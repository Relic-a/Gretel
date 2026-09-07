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

// Deliberately emits a stale run ID and wrong artifact hash to test validation rejection
const report = {
  schemaVersion: 1,
  runner: "stale-native-protocol-runner",
  runId: "stale-run-id-from-earlier-execution-12345",
  targetOs: args.targetOs || "linux",
  packageFormat: args.packageFormat || "deb",
  oldArtifactHash: "tampered-or-mismatched-old-hash",
  newArtifactHash: "tampered-or-mismatched-new-hash",
  qualification: "protocol-test-fixture-not-native-qualification",
  cases: [
    {
      id: "native.fresh-install",
      status: "pass",
      durationMs: 10,
      evidence: [],
      failureReason: null
    }
  ]
};

mkdirSync(path.dirname(args.reportFile), { recursive: true });
writeFileSync(args.reportFile, JSON.stringify(report, null, 2) + "\n");
process.stdout.write("Stale report written\n");
