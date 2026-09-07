// soak-evaluator.mjs: Production qualification evaluators for soak resource metrics.
// Used by both soak-cli.mjs and soak-metrics-eval.mjs tests.

import { execFileSync } from "node:child_process";
import { caseResult } from "./report-schema.mjs";

let cachedClockTicks = undefined;

/**
 * Obtain OS CPU clock ticks per second using supported mechanisms.
 * On Linux, getconf CLK_TCK is standard (USER_HZ).
 * Returns null if measurement facility is unsupported or unavailable.
 */
export function getCpuClockTicksPerSecond() {
  if (cachedClockTicks !== undefined) return cachedClockTicks;

  if (process.platform === "linux") {
    try {
      const out = execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 2000 }).trim();
      const val = parseInt(out, 10);
      if (Number.isFinite(val) && val > 0) {
        cachedClockTicks = val;
        return cachedClockTicks;
      }
    } catch {}
    // Fallback standard for Linux USER_HZ
    cachedClockTicks = 100;
    return cachedClockTicks;
  }

  // Unsupported or unavailable platform
  cachedClockTicks = null;
  return null;
}

/** Override clock ticks for testing or mock environments */
export function setCpuClockTicksForTesting(ticks) {
  cachedClockTicks = ticks;
}

export function resetCpuClockTicksForTesting() {
  cachedClockTicks = undefined;
}

/**
 * Evaluates idle CPU usage over a sustained idle window.
 * Criteria: idle CPU mean <= 2% of one core and p95 <= 5% over a real window (default 10 min).
 */
export function evaluateIdleCpu(samples, options = {}) {
  const minWindowMs = options.minWindowDurationMs ?? (10 * 60 * 1000);
  const minSamples = options.minSamples ?? 2;
  const maxMean = options.maxMeanPct ?? 2.0;
  const maxP95 = options.maxP95Pct ?? 5.0;
  const clockTicks = options.clockTicks !== undefined ? options.clockTicks : getCpuClockTicksPerSecond();

  if (clockTicks === null || !Number.isFinite(clockTicks) || clockTicks <= 0) {
    return caseResult(
      "soak-idle-cpu",
      `Idle CPU mean <= ${maxMean}% of one core, p95 <= ${maxP95}% over 10min window.`,
      "blocked", 0, ["logs/metrics.jsonl"],
      "CPU clock tick measurement facility unsupported or unavailable on this host"
    );
  }

  // Filter valid idle samples
  const idleSamples = (samples || []).filter((s) => {
    return (s.op === "idle" || s.phase === "idle") &&
      Number.isFinite(s.elapsedMs) &&
      Number.isFinite(s.cpuTicks);
  });

  if (idleSamples.length < minSamples) {
    return caseResult(
      "soak-idle-cpu",
      `Idle CPU mean <= ${maxMean}% of one core, p95 <= ${maxP95}% over 10min window.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Fewer than ${minSamples} idle CPU samples (${idleSamples.length} found)`
    );
  }

  const spanMs = idleSamples[idleSamples.length - 1].elapsedMs - idleSamples[0].elapsedMs;
  if (spanMs < minWindowMs) {
    return caseResult(
      "soak-idle-cpu",
      `Idle CPU mean <= ${maxMean}% of one core, p95 <= ${maxP95}% over 10min window.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Idle window duration ${Math.round(spanMs / 1000)}s is less than required ${Math.round(minWindowMs / 1000)}s`
    );
  }

  const cpuPercents = [];
  for (let i = 1; i < idleSamples.length; i++) {
    const current = idleSamples[i];
    const previous = idleSamples[i - 1];

    // Account for process identity/restarts: only compare samples from the same server generation/PID
    const currPid = current.serverPid ?? current.pid;
    const prevPid = previous.serverPid ?? previous.pid;
    if (currPid && prevPid && currPid !== prevPid) {
      continue;
    }
    const currGen = current.serverGeneration ?? current.generation;
    const prevGen = previous.serverGeneration ?? previous.generation;
    if (currGen !== undefined && prevGen !== undefined && currGen !== prevGen) {
      continue;
    }

    const dt = (current.elapsedMs - previous.elapsedMs) / 1000;
    if (dt <= 0) continue;

    const dTicks = current.cpuTicks - previous.cpuTicks;
    if (dTicks < 0) {
      // Process restart or counter reset occurred without PID change
      continue;
    }

    const cpuPct = (dTicks / clockTicks) / dt * 100;
    if (Number.isFinite(cpuPct)) {
      cpuPercents.push(cpuPct);
    }
  }

  if (cpuPercents.length < 1) {
    return caseResult(
      "soak-idle-cpu",
      `Idle CPU mean <= ${maxMean}% of one core, p95 <= ${maxP95}% over 10min window.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      "No valid idle CPU intervals found across process generations"
    );
  }

  const mean = cpuPercents.reduce((sum, v) => sum + v, 0) / cpuPercents.length;
  const p95 = percentile(cpuPercents, 0.95);
  const ok = mean <= maxMean && p95 <= maxP95;

  return caseResult(
    "soak-idle-cpu",
    `Idle CPU mean <= ${maxMean}% of one core, p95 <= ${maxP95}% over 10min window.`,
    ok ? "pass" : "fail", 0, ["logs/metrics.jsonl"],
    ok ? null : `mean=${mean.toFixed(2)}% (limit ${maxMean}%) p95=${p95.toFixed(2)}% (limit ${maxP95}%)`,
    { mean, p95, samples: cpuPercents.length, windowDurationMs: spanMs }
  );
}

/**
 * Evaluates idle RSS stability between first post-warm-up idle window and final idle window.
 * Criteria: final idle median RSS within max(64 MiB, 20%) of first post-warm-up idle median.
 */
export function evaluateIdleRssStability(firstPostWarmupIdleSamples, finalIdleSamples, options = {}) {
  const minWindowMs = options.minWindowDurationMs ?? (10 * 60 * 1000);
  const minSamples = options.minSamples ?? 2;
  const allowanceMiB = options.allowanceMiB ?? 64;
  const allowancePct = options.allowancePct ?? 0.20;

  const validFirst = (firstPostWarmupIdleSamples || []).filter((s) => Number.isFinite(s.rssMb) && s.rssMb > 0);
  const validFinal = (finalIdleSamples || []).filter((s) => Number.isFinite(s.rssMb) && s.rssMb > 0);

  if (validFirst.length < minSamples || validFinal.length < minSamples) {
    return caseResult(
      "soak-idle-rss-stability",
      `Final-window median idle RSS <= first post-warm-up 10min + max(${allowanceMiB}MiB, ${Math.round(allowancePct * 100)}%).`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Fewer than ${minSamples} valid samples in one required window (first: ${validFirst.length}, final: ${validFinal.length})`
    );
  }

  const firstSpanMs = validFirst[validFirst.length - 1].elapsedMs - validFirst[0].elapsedMs;
  const finalSpanMs = validFinal[validFinal.length - 1].elapsedMs - validFinal[0].elapsedMs;

  if (firstSpanMs < minWindowMs || finalSpanMs < minWindowMs) {
    return caseResult(
      "soak-idle-rss-stability",
      `Final-window median idle RSS <= first post-warm-up 10min + max(${allowanceMiB}MiB, ${Math.round(allowancePct * 100)}%).`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Window duration insufficient (first: ${Math.round(firstSpanMs / 1000)}s, final: ${Math.round(finalSpanMs / 1000)}s, required: ${Math.round(minWindowMs / 1000)}s)`
    );
  }

  const firstMedian = median(validFirst.map((s) => s.rssMb));
  const finalMedian = median(validFinal.map((s) => s.rssMb));
  const allowance = Math.max(allowanceMiB, firstMedian * allowancePct);
  const ok = finalMedian <= firstMedian + allowance;

  return caseResult(
    "soak-idle-rss-stability",
    `Final-window median idle RSS <= first post-warm-up 10min + max(${allowanceMiB}MiB, ${Math.round(allowancePct * 100)}%).`,
    ok ? "pass" : "fail", 0, ["logs/metrics.jsonl"],
    ok ? null : `firstMedian=${firstMedian.toFixed(1)}MiB finalMedian=${finalMedian.toFixed(1)}MiB allowance=${allowance.toFixed(1)}MiB (excess ${(finalMedian - firstMedian - allowance).toFixed(1)}MiB)`,
    { firstMedian, finalMedian, allowance, firstSpanMs, finalSpanMs }
  );
}

/**
 * Evaluates windowed RSS trend over >= 2 hours.
 * Criteria: p95 linear slope <= 1.0 MiB/hour over >= 2 hours with at least 12 10-minute windows.
 */
export function evaluateRssTrend(samples, options = {}) {
  const minDurationMs = options.minDurationMs ?? (2 * 60 * 60 * 1000);
  const windowMs = options.windowMs ?? (10 * 60 * 1000);
  const minWindows = options.minWindows ?? 12;
  const maxSlope = options.maxSlopeMiBPerHour ?? 1.0;

  const validSamples = (samples || []).filter((s) => Number.isFinite(s.elapsedMs) && Number.isFinite(s.rssMb));

  if (validSamples.length < 10) {
    return caseResult(
      "soak-rss-trend",
      `Windowed RSS trend p95 <= ${maxSlope}MiB/hour over >= 2h.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Insufficient samples (${validSamples.length} found, minimum 10)`
    );
  }

  const hoursSpan = (validSamples[validSamples.length - 1].elapsedMs - validSamples[0].elapsedMs) / 3600000;
  const totalMs = validSamples[validSamples.length - 1].elapsedMs - validSamples[0].elapsedMs;

  if (totalMs < minDurationMs) {
    return caseResult(
      "soak-rss-trend",
      `Windowed RSS trend p95 <= ${maxSlope}MiB/hour over >= 2h.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Duration ${hoursSpan.toFixed(2)}h is less than required 2.00h`
    );
  }

  const slopes = [];
  let windowStart = validSamples[0].elapsedMs;
  const endMs = validSamples[validSamples.length - 1].elapsedMs;

  while (windowStart + windowMs <= endMs) {
    const window = validSamples.filter((s) => s.elapsedMs >= windowStart && s.elapsedMs <= windowStart + windowMs);
    if (window.length >= 2) {
      slopes.push(linearSlope(window));
    }
    windowStart += windowMs;
  }

  if (slopes.length < minWindows) {
    return caseResult(
      "soak-rss-trend",
      `Windowed RSS trend p95 <= ${maxSlope}MiB/hour over >= 2h.`,
      "not_run", 0, ["logs/metrics.jsonl"],
      `Only ${slopes.length} complete 10-minute windows over ${hoursSpan.toFixed(2)}h (minimum ${minWindows} required)`
    );
  }

  const medianSlope = median(slopes);
  const p95Slope = percentile(slopes, 0.95);
  const ok = p95Slope <= maxSlope;

  return caseResult(
    "soak-rss-trend",
    `Windowed RSS trend p95 <= ${maxSlope}MiB/hour over >= 2h.`,
    ok ? "pass" : "fail", 0, ["logs/metrics.jsonl"],
    ok ? null : `median slope=${medianSlope.toFixed(2)} p95 slope=${p95Slope.toFixed(2)} MiB/hour (limit ${maxSlope}MiB/hour)`,
    { medianSlope, p95Slope, windowsCount: slopes.length, hoursSpan }
  );
}

export function selectWindow(samples, durationMs, side) {
  if (!samples || !samples.length) return [];
  const first = side === "start" ? samples[0].elapsedMs : samples[samples.length - 1].elapsedMs - durationMs;
  const last = first + durationMs;
  return samples.filter((sample) => sample.elapsedMs >= first && sample.elapsedMs <= last);
}

export function linearSlope(samples) {
  if (samples.length < 2) return 0;
  const xMean = samples.reduce((sum, s) => sum + s.elapsedMs, 0) / samples.length;
  const yMean = samples.reduce((sum, s) => sum + s.rssMb, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const s of samples) {
    numerator += (s.elapsedMs - xMean) * (s.rssMb - yMean);
    denominator += (s.elapsedMs - xMean) ** 2;
  }
  // Convert ms to hours (3600000 ms in an hour)
  return denominator > 0 ? (numerator / denominator) * 3600000 : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index];
}
