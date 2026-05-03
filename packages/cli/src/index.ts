import { Command } from "commander";
import { readEvents, aggregate, verifyChain, generateCharts } from "@devledger/core";
import type { DevEvent, DevStats } from "@devledger/core";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { version: cliVersion } = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8")
) as { version: string };

// ---------------------------------------------------------------------------
// P1 - Config cache (read once per process lifetime)
// ---------------------------------------------------------------------------

let _configCache: { ignore?: string[] } | null = null;
async function readDevLedgerConfig(): Promise<{ ignore?: string[] }> {
  if (_configCache !== null) return _configCache;
  try {
    const { promises: fs } = await import("node:fs");
    const raw = await fs.readFile(path.join(process.cwd(), ".devledger"), "utf8");
    _configCache = JSON.parse(raw) as { ignore?: string[] };
  } catch {
    _configCache = {};
  }
  return _configCache;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// P1 - date-range filtering shared by stats + report
function filterByDateRange(events: DevEvent[], since?: string, until?: string): DevEvent[] {
  let filtered = events;
  if (since) {
    const ms = new Date(since + "T00:00:00").getTime();
    if (isNaN(ms)) { console.error(`Invalid --since date: "${since}". Use YYYY-MM-DD.`); process.exit(1); }
    filtered = filtered.filter(e => e.timestamp >= ms);
  }
  if (until) {
    const ms = new Date(until + "T23:59:59.999").getTime();
    if (isNaN(ms)) { console.error(`Invalid --until date: "${until}". Use YYYY-MM-DD.`); process.exit(1); }
    filtered = filtered.filter(e => e.timestamp <= ms);
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// P2 - HTML report generator
// ---------------------------------------------------------------------------

const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6", javascript: "#f0db4f", python: "#3572a5",
  rust: "#dea584", go: "#00add8", markdown: "#083fa1", json: "#8b5cf6",
  plaintext: "#6b7280", jsonc: "#8b5cf6", yaml: "#cb171e", xml: "#e44d26",
};

function generateHtmlReport(
  stats: DevStats,
  proof: ReturnType<typeof verifyChain>,
  project: string,
  since?: string,
  until?: string
): string {
  const humanityPct = Math.round(stats.humanityScore.score * 100);
  const humanityColor = humanityPct >= 75 ? "#22c55e" : humanityPct >= 50 ? "#f59e0b" : "#ef4444";

  const langEntries = Object.entries(stats.byLanguage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const totalLangMs = langEntries.reduce((s, [, v]) => s + v, 0);

  const langBars = langEntries.map(([lang, ms]) => {
    const pct = totalLangMs > 0 ? ((ms / totalLangMs) * 100).toFixed(1) : "0";
    const color = LANG_COLORS[lang] ?? "#6366f1";
    return `
        <div class="lang-row">
          <span class="lang-name">${lang}</span>
          <div class="lang-bar-bg"><div class="lang-bar" style="width:${pct}%;background:${color}"></div></div>
          <span class="lang-pct">${pct}%</span>
          <span class="lang-time">${formatDuration(ms)}</span>
        </div>`;
  }).join("");

  const hours = Array.from({ length: 24 }, (_, h) => ({
    h,
    ms: stats.byHour[h] ?? 0,
  }));
  const maxHourMs = Math.max(...hours.map(x => x.ms), 1);
  const heatCells = hours.map(({ h, ms }) => {
    const intensity = ms / maxHourMs;
    const alpha = ms > 0 ? (0.15 + intensity * 0.85).toFixed(2) : "0.04";
    const label = `${String(h).padStart(2, "0")}:00 - ${formatDuration(ms)}`;
    return `<div class="heat-cell" title="${label}" style="background:rgba(99,102,241,${alpha})"></div>`;
  }).join("");

  const heatLabels = Array.from({ length: 24 }, (_, h) =>
    h % 6 === 0 ? `<div class="heat-label">${String(h).padStart(2, "0")}</div>` : `<div></div>`
  ).join("");

  const signalsHtml = stats.signals.length > 0
    ? stats.signals.map(s => `<li class="sig-item warn">🚩 ${s}</li>`).join("")
    : `<li class="sig-item ok">✅ No abnormal patterns detected</li>`;

  const idlePct = stats.totalMs > 0
    ? Math.round(stats.idleMs / (stats.totalMs + stats.idleMs) * 100)
    : 0;

  const dateRange = since || until
    ? `${since ?? "all time"} → ${until ?? "now"}`
    : "All time";

  const verified = proof.valid;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DevLedger - ${project}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0d0d14;color:#e2e8f0;min-height:100vh;padding:40px 20px}
    a{color:#818cf8}
    .container{max-width:920px;margin:0 auto}

    /* Header */
    .header{margin-bottom:32px}
    .header h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#818cf8 0%,#c084fc 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
    .meta{color:#475569;font-size:0.8rem;display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px}
    .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:0.7rem;font-weight:700;letter-spacing:0.04em}
    .badge-ok{background:#14532d;color:#86efac}
    .badge-warn{background:#7c2d12;color:#fdba74}

    /* Stat cards */
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;margin-bottom:28px}
    .card{background:#13131f;border:1px solid #1e1e3a;border-radius:14px;padding:22px 20px}
    .card-label{font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px}
    .card-value{font-size:1.8rem;font-weight:800;color:#f1f5f9;line-height:1}
    .card-sub{font-size:0.72rem;color:#64748b;margin-top:5px}

    /* Sections */
    .section{background:#13131f;border:1px solid #1e1e3a;border-radius:14px;padding:24px;margin-bottom:18px}
    .section-title{font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#6366f1;margin-bottom:18px}

    /* Humanity score */
    .humanity-num{font-size:2.6rem;font-weight:800;color:${humanityColor};line-height:1}
    .score-bar-bg{height:8px;background:#1e1e3a;border-radius:99px;overflow:hidden;margin:10px 0 14px}
    .score-bar{height:100%;border-radius:99px;background:linear-gradient(90deg,#ef4444 0%,#f59e0b 50%,#22c55e 100%)}

    /* Language bars */
    .lang-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
    .lang-name{width:88px;font-size:0.8rem;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lang-bar-bg{flex:1;height:7px;background:#1e1e3a;border-radius:99px;overflow:hidden}
    .lang-bar{height:100%;border-radius:99px}
    .lang-pct{width:38px;text-align:right;font-size:0.75rem;color:#64748b;font-variant-numeric:tabular-nums}
    .lang-time{width:50px;text-align:right;font-size:0.75rem;color:#475569;font-variant-numeric:tabular-nums}

    /* Heatmap */
    .heatmap{display:grid;grid-template-columns:repeat(24,1fr);gap:4px}
    .heat-cell{aspect-ratio:1;border-radius:4px;cursor:default;transition:opacity 0.2s}
    .heat-cell:hover{outline:1px solid #6366f1}
    .heat-labels{display:grid;grid-template-columns:repeat(24,1fr);margin-top:5px}
    .heat-label{font-size:0.58rem;color:#334155;text-align:center}

    /* Signals */
    .sig-list{list-style:none;display:flex;flex-direction:column;gap:7px}
    .sig-item{font-size:0.82rem;padding:9px 13px;border-radius:8px}
    .sig-item.warn{color:#fbbf24;background:rgba(251,191,36,0.07);border-left:3px solid #f59e0b}
    .sig-item.ok{color:#4ade80;background:rgba(74,222,128,0.07);border-left:3px solid #22c55e}

    /* Integrity */
    .hash-block{background:#0d0d14;border-radius:8px;padding:10px 13px;font-family:monospace;font-size:0.71rem;color:#334155;word-break:break-all;margin-top:7px}
    .hash-label{font-size:0.75rem;color:#475569;margin-top:12px}
    .hash-label:first-child{margin-top:0}

    /* Footer */
    .footer{text-align:center;color:#1e293b;font-size:0.72rem;margin-top:36px;padding-bottom:16px}
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>${project}</h1>
    <div class="meta">
      <span>📅 ${dateRange}</span>
      <span>🕐 Generated ${new Date().toLocaleString()}</span>
      <span>DevLedger v${cliVersion}</span>
      <span class="badge ${verified ? "badge-ok" : "badge-warn"}">${verified ? "✓ VERIFIED" : "⚠ UNVERIFIED"}</span>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Events</div>
      <div class="card-value">${stats.eventCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-label">Sessions</div>
      <div class="card-value">${stats.sessionCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Coding time</div>
      <div class="card-value">${formatDuration(stats.totalMs)}</div>
    </div>
    <div class="card">
      <div class="card-label">Idle time</div>
      <div class="card-value">${formatDuration(stats.idleMs)}</div>
      <div class="card-sub">${idlePct}% of total tracked time</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Humanity Score - Local Statistical AI</div>
    <div class="humanity-num">${humanityPct}%</div>
    <div class="score-bar-bg">
      <div class="score-bar" style="width:${humanityPct}%"></div>
    </div>
    <ul class="sig-list">${signalsHtml}</ul>
  </div>

  <div class="section">
    <div class="section-title">Activity by Hour</div>
    <div class="heatmap">${heatCells}</div>
    <div class="heat-labels">${heatLabels}</div>
  </div>

  <div class="section">
    <div class="section-title">Languages</div>
    ${langBars || `<p style="color:#475569;font-size:0.85rem">No language data recorded.</p>`}
  </div>

  <div class="section">
    <div class="section-title">Integrity</div>
    <div class="hash-label">Integrity hash (full chain)</div>
    <div class="hash-block">${proof.integrityHash}</div>
    <div class="hash-label">Summary hash (project events)</div>
    <div class="hash-block">${proof.summaryHash ?? "-"}</div>
  </div>

  <div class="footer">DevLedger · Local-first, cryptographically verifiable developer activity tracking</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name("devledger")
  .description("Local append-only coding activity ledger")
  .version(cliVersion);

// -- stats ------------------------------------------------------------------
program
  .command("stats")
  .option("--log <path>", "Path to JSONL log")
  .option("-p, --project <name>", "Filter by project name")
  .option("--since <YYYY-MM-DD>", "Include events on or after this date")
  .option("--until <YYYY-MM-DD>", "Include events on or before this date")
  .description("Show aggregated stats (JSON)")
  .action(async (opts) => {
    const events = filterByDateRange(await readEvents(opts.log), opts.since, opts.until);
    const project = opts.project || path.basename(process.cwd());
    const config = await readDevLedgerConfig();
    const stats = aggregate(events, project, config.ignore ?? []);
    console.log(JSON.stringify(stats, null, 2));
  });

// -- verify -----------------------------------------------------------------
program
  .command("verify")
  .option("--log <path>", "Path to JSONL log")
  .option("--range <YYYY-MM>", "Verify only a specific month")
  .option("--export-proof <path>", "Export the proof object to a JSON file")
  .description("Verify hash chain integrity and produce proof")
  .action(async (opts) => {
    const events = await readEvents(opts.log);
    const result = verifyChain(events, { range: opts.range });

    if (opts.exportProof) {
      const { promises: fs } = await import("node:fs");
      const proof = {
        ...result,
        generatedAt: new Date().toISOString(),
        cliVersion,
        eventCount: events.length,
      };
      await fs.writeFile(opts.exportProof, JSON.stringify(proof, null, 2), "utf8");
      console.log(`Proof exported to ${opts.exportProof}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exitCode = result.valid ? 0 : 1;
  });

// -- report -----------------------------------------------------------------
program
  .command("report")
  .option("--log <path>", "Path to JSONL log")
  .option("-p, --project <name>", "Filter by project name")
  .option("-o, --output <path>", "Output file path")
  .option("--html", "Generate an HTML report instead of Markdown")
  .option("--since <YYYY-MM-DD>", "Include events on or after this date")
  .option("--until <YYYY-MM-DD>", "Include events on or before this date")
  .description("Generate a Markdown or HTML activity report")
  .action(async (opts) => {
    const allEvents = await readEvents(opts.log);
    const events = filterByDateRange(allEvents, opts.since, opts.until);
    const project = opts.project || path.basename(process.cwd());

    const proof = verifyChain(events, { project });
    if (!proof.valid) {
      console.error(`⚠ UNVERIFIED DATA: ${proof.reason}`);
      console.error(`  Run 'devledger reset ${project}' to create a clean checkpoint.\n`);
    }

    const config = await readDevLedgerConfig();
    const stats = aggregate(events, project, config.ignore ?? []);

    let output: string;

    if (opts.html) {
      output = generateHtmlReport(stats, proof, project, opts.since, opts.until);
    } else {
      const warningLines = !proof.valid
        ? [`> ⚠ **UNVERIFIED DATA** - ${proof.reason}`, ``]
        : [];

      output = [
        `# Dev Activity Report: ${project}`,
        ``,
        ...warningLines,
        `- **Period**: ${opts.since ?? "all time"} → ${opts.until ?? "now"}`,
        `- Total events: ${stats.eventCount}`,
        `- Active sessions: ${stats.sessionCount}`,
        `- Total coding time: ${formatDuration(stats.totalMs)}`,
        `- Total idle time: ${formatDuration(stats.idleMs)}`,
        `- Integrity hash: \`${proof.integrityHash}\``,
        `- Summary hash: \`${proof.summaryHash}\``,
        `- Humanity score: ${Math.round(stats.humanityScore.score * 100)}%`,
        ...stats.humanityScore.reasons.map(r => `  - ${r}`),
        ``,
        `## By language`,
        ...Object.entries(stats.byLanguage)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `- ${k}: ${formatDuration(v)}`),
        ``,
        `## Behavior signals`,
        ...(stats.signals.length > 0
          ? stats.signals.map(s => `- 🚩 ${s}`)
          : ["- No abnormal patterns detected"]),
      ].join("\n");
    }

    if (opts.output) {
      const { promises: fs } = await import("node:fs");
      await fs.writeFile(opts.output, output, "utf8");
      console.log(`Report saved to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// -- inject -----------------------------------------------------------------
program
  .command("inject")
  .requiredOption("-f, --file <path>", "File to inject the report into")
  .option("-p, --project <name>", "Filter by project name")
  .option("--log <path>", "Path to JSONL log")
  .option("--since <YYYY-MM-DD>", "Include events on or after this date")
  .option("--until <YYYY-MM-DD>", "Include events on or before this date")
  .description("Inject report into a file (between <!-- DEVLEDGER_START --> and <!-- DEVLEDGER_END -->)")
  .action(async (opts) => {
    const { promises: fs } = await import("node:fs");
    const allEvents = await readEvents(opts.log);
    const events = filterByDateRange(allEvents, opts.since, opts.until);
    const project = opts.project || path.basename(path.dirname(path.resolve(opts.file)));
    const config = await readDevLedgerConfig();
    const stats = aggregate(events, project, config.ignore ?? []);
    const proof = verifyChain(events, { project });

    const svg = generateCharts(stats);
    const targetDir = path.dirname(opts.file);
    const svgPath = path.join(targetDir, "devledger-activity.svg");
    await fs.writeFile(svgPath, svg, "utf8");

    const reportMd = [
      `<!-- DEVLEDGER_START -->`,
      `### Activity Summary: ${project}`,
      ``,
      `![Activity and Languages](./devledger-activity.svg)`,
      ``,
      `- **Total Events**: ${stats.eventCount}`,
      `- **Active Sessions**: ${stats.sessionCount}`,
      `- **Total Coding Time**: ${formatDuration(stats.totalMs)}`,
      `- **Total Idle Time**: ${formatDuration(stats.idleMs)}`,
      `- **Integrity Hash**: \`${proof.integrityHash}\``,
      `- **Summary Hash**: \`${proof.summaryHash}\``,
      ``,
      `#### Integrity & Behavior (Local AI)`,
      `- **Humanity Score**: ${Math.round(stats.humanityScore.score * 100)}%`,
      ...stats.humanityScore.reasons.map(r => `- ${r}`),
      ``,
      `#### Languages`,
      ...Object.entries(stats.byLanguage)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- **${k}**: ${formatDuration(v)}`),
      ``,
      `#### Behavior Signals`,
      ...(stats.signals.length > 0
        ? stats.signals.map(s => `- 🚩 ${s}`)
        : ["- No abnormal patterns detected"]),
      `<!-- DEVLEDGER_END -->`,
    ].join("\n");

    const content = await fs.readFile(opts.file, "utf8");
    const startTag = "<!-- DEVLEDGER_START -->";
    const endTag = "<!-- DEVLEDGER_END -->";

    const startIndex = content.indexOf(startTag);
    const endIndex = content.indexOf(endTag);

    if (startIndex === -1 || endIndex === -1) {
      console.error(`Error: Tags not found in ${opts.file}. Add ${startTag} and ${endTag}.`);
      process.exit(1);
    }
    if (endIndex < startIndex) {
      console.error(`Error: ${endTag} appears before ${startTag}. Fix tag order.`);
      process.exit(1);
    }

    const newContent =
      content.substring(0, startIndex) +
      reportMd +
      content.substring(endIndex + endTag.length);

    await fs.writeFile(opts.file, newContent, "utf8");
    console.log(`Report injected into ${opts.file}`);
  });

// -- log --------------------------------------------------------------------
program
  .command("log")
  .description("Manually log an event")
  .requiredOption("-t, --type <type>", "Event type (file_focus, file_edit, file_save, idle_start, idle_end)")
  .requiredOption("-p, --project <project>", "Project name")
  .option("-f, --file <file>", "File path")
  .option("-l, --language <language>", "Language ID")
  .option("-d, --duration <ms>", "Duration in milliseconds")
  .option("--log-path <path>", "Path to JSONL log")
  .action(async (opts) => {
    const { createEvent, appendEvent, readEvents } = await import("@devledger/core");
    const events = await readEvents(opts.logPath);
    const prevHash = events.length > 0 ? events[events.length - 1].hash : "genesis";
    const input = {
      timestamp: Date.now(),
      type: opts.type,
      project: opts.project,
      file: opts.file,
      language: opts.language,
      durationMs: opts.duration ? parseInt(opts.duration, 10) : undefined,
    };
    const event = createEvent(input, prevHash);
    await appendEvent(event, opts.logPath);
    console.log(`Logged event ${event.id} with hash ${event.hash}`);
  });

// -- reset ------------------------------------------------------------------
program
  .command("reset")
  .argument("<project>", "Project to reset")
  .option("--log <path>", "Path to JSONL log")
  .description("Create a checkpoint (reset) for a project")
  .action(async (project, opts) => {
    const { createEvent, appendEvent, readEvents } = await import("@devledger/core");
    const events = await readEvents(opts.log);
    const prevHash = events.length > 0 ? events[events.length - 1].hash : "genesis";
    const input = {
      timestamp: Date.now(),
      type: "checkpoint" as const,
      project,
      label: "reset",
    };
    const event = createEvent(input, prevHash);
    await appendEvent(event, opts.log);
    console.log(`Reset checkpoint created for project ${project} at event ${event.id}`);
  });

// -- init -------------------------------------------------------------------
program
  .command("init")
  .description("Initialize DevLedger in the current directory (enables tracking)")
  .action(async () => {
    const { promises: fs } = await import("node:fs");
    const p = await import("node:path");
    const markerPath = p.join(process.cwd(), ".devledger");
    try {
      await fs.writeFile(markerPath, JSON.stringify({
        createdAt: Date.now(),
        project: p.basename(process.cwd()),
        ignore: [],
      }, null, 2));
      console.log(`Initialized DevLedger in ${process.cwd()}`);
    } catch (err) {
      console.error("Failed to initialize DevLedger:", err);
    }
  });

program.parseAsync(process.argv);