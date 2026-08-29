"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { authedHeaders } from "../components/video-utils";

type Summary = {
  runs: number;
  errors: number;
  errorRatePercent: number;
  totalMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

type Operation = {
  name: string;
  calls: number;
  traces: number;
  errors: number;
  totalMs: number;
  averageCallMs: number;
  p95CallMs: number;
  averagePerRunMs: number;
  p95PerRunMs: number;
  workflowTimePercent: number;
};

type Report = {
  generatedAt: string;
  since: string;
  retentionDays: number;
  overview: Summary;
  workflows: Array<Summary & { workflow: string; operations: Operation[] }>;
  recentRuns: Array<{
    id: string;
    workflow: string;
    status: string;
    durationMs: number;
    startedAt: string;
    slowestOperations: Array<{ name: string; durationMs: number; status: string }>;
  }>;
};

const windows = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 }
];

export default function DiagnosticsPage() {
  const [hours, setHours] = useState(24 * 7);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    fetch(`/api/performance?hours=${hours}`, { cache: "no-store", headers: authedHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load performance metrics.");
        return response.json();
      })
      .then((data) => active && setReport(data))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : String(caught)));
    return () => { active = false; };
  }, [hours]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Gretel optimization telemetry</p>
          <h1>Performance diagnostics</h1>
          <p>Durable workflow percentiles and operation-level hotspots from real app runs.</p>
        </div>
        <div className={styles.actions}>
          <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
            {windows.map((window) => <option key={window.hours} value={window.hours}>{window.label}</option>)}
          </select>
          <Link href="/">Back to feed</Link>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {!report && !error && <p className={styles.empty}>Loading metrics…</p>}
      {report && (
        <>
          <section className={styles.summaryGrid}>
            <Metric label="Runs" value={String(report.overview.runs)} />
            <Metric label="P50" value={formatMs(report.overview.p50Ms)} />
            <Metric label="P95" value={formatMs(report.overview.p95Ms)} accent />
            <Metric label="P99" value={formatMs(report.overview.p99Ms)} />
            <Metric label="Total measured" value={formatMs(report.overview.totalMs)} />
            <Metric label="Error rate" value={`${report.overview.errorRatePercent}%`} />
          </section>

          {report.workflows.length === 0 ? (
            <p className={styles.empty}>No completed critical workflows in this window yet.</p>
          ) : report.workflows.map((workflow) => (
            <section className={styles.panel} key={workflow.workflow}>
              <div className={styles.panelHeading}>
                <div>
                  <h2>{humanize(workflow.workflow)}</h2>
                  <p>{workflow.runs} runs · {workflow.errors} errors · {formatMs(workflow.totalMs)} total</p>
                </div>
                <div className={styles.workflowStats}>
                  <span>P50 <strong>{formatMs(workflow.p50Ms)}</strong></span>
                  <span>P95 <strong>{formatMs(workflow.p95Ms)}</strong></span>
                  <span>MAX <strong>{formatMs(workflow.maxMs)}</strong></span>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Operation</th><th>Calls</th><th>Total</th><th>Avg / run</th><th>P95 / run</th><th>P95 / call</th><th>Workflow time*</th></tr></thead>
                  <tbody>
                    {workflow.operations.map((operation) => (
                      <tr key={operation.name}>
                        <td><code>{operation.name}</code>{operation.errors > 0 && <small>{operation.errors} errors</small>}</td>
                        <td>{operation.calls}</td>
                        <td>{formatMs(operation.totalMs)}</td>
                        <td>{formatMs(operation.averagePerRunMs)}</td>
                        <td className={styles.hot}>{formatMs(operation.p95PerRunMs)}</td>
                        <td>{formatMs(operation.p95CallMs)}</td>
                        <td><Bar value={operation.workflowTimePercent} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Recent runs</h2><p>The slowest operations for each completed workflow.</p></div></div>
            <div className={styles.runs}>
              {report.recentRuns.map((run) => (
                <article key={run.id}>
                  <div><strong>{humanize(run.workflow)}</strong><time>{new Date(run.startedAt).toLocaleString()}</time></div>
                  <b>{formatMs(run.durationMs)}</b>
                  <p>{run.slowestOperations.map((operation) => `${operation.name} ${formatMs(operation.durationMs)}`).join(" · ") || "No child operations"}</p>
                </article>
              ))}
            </div>
          </section>

          <p className={styles.note}>* Operations can be nested or concurrent, so percentages are hotspot indicators and do not necessarily add to 100%. Data is retained locally for {report.retentionDays} days.</p>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <article className={accent ? styles.metricAccent : styles.metric}><span>{label}</span><strong>{value}</strong></article>;
}

function Bar({ value }: { value: number }) {
  return <div className={styles.bar}><i style={{ width: `${Math.min(100, value)}%` }} /><span>{value}%</span></div>;
}

function formatMs(value: number) {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function humanize(value: string) {
  return value.split(".").map((part) => part.replaceAll("_", " ")).join(" / ");
}
