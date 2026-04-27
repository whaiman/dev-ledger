import { Command } from "commander";
import { readEvents, aggregate, verifyChain, hashLogChain, generateCharts } from "@devledger/core";
import path from "node:path";

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const program = new Command();

program
  .name("devledger")
  .description("Local append-only coding activity ledger")
  .version("0.1.0");

program
  .command("stats")
  .option("--log <path>", "Path to JSONL log")
  .option("-p, --project <name>", "Filter by project name")
  .description("Show aggregated stats")
  .action(async (opts) => {
    const events = await readEvents(opts.log);
    const project = opts.project || path.basename(process.cwd());
    const stats = aggregate(events, project);
    console.log(JSON.stringify(stats, null, 2));
  });

program
  .command("verify")
  .option("--log <path>", "Path to JSONL log")
  .option("--range <YYYY-MM>", "Verify only a specific month")
  .description("Verify hash chain integrity and produce proof")
  .action(async (opts) => {
    const events = await readEvents(opts.log);
    const result = verifyChain(events, { range: opts.range });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
  });

program
  .command("report")
  .option("--log <path>", "Path to JSONL log")
  .option("-p, --project <name>", "Filter by project name")
  .option("-o, --output <path>", "Output file path (markdown)")
  .description("Generate markdown report")
  .action(async (opts) => {
    const events = await readEvents(opts.log);
    const project = opts.project || path.basename(process.cwd());
    const stats = aggregate(events, project);
    const proof = verifyChain(events, { project });

    const md = [
      `# Dev Activity Report: ${project}`,
      ``,
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
      ...Object.entries(stats.byLanguage).map(([k, v]) => `- ${k}: ${formatDuration(v)}`),
      ``,
      `## Behavior signals`,
      ...(stats.signals.length > 0 ? stats.signals.map(s => `- 🚩 ${s}`) : ["- No abnormal patterns detected"])
    ].join("\n");

    if (opts.output) {
      const { promises: fs } = await import("node:fs");
      await fs.writeFile(opts.output, md, "utf8");
      console.log(`Report saved to ${opts.output}`);
    } else {
      console.log(md);
    }
  });

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

program
  .command("inject")
  .requiredOption("-f, --file <path>", "File to inject the report into")
  .option("-p, --project <name>", "Filter by project name")
  .option("--log <path>", "Path to JSONL log")
  .description("Inject report into a file (between <!-- DEVLEDGER_START --> and <!-- DEVLEDGER_END -->)")
  .action(async (opts) => {
    const { promises: fs } = await import("node:fs");
    const events = await readEvents(opts.log);
    const project = opts.project || path.basename(path.dirname(path.resolve(opts.file)));
    const stats = aggregate(events, project);
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
      ...Object.entries(stats.byLanguage).map(([k, v]) => `- **${k}**: ${formatDuration(v)}`),
      ``,
      `#### Behavior Signals`,
      ...(stats.signals.length > 0 ? stats.signals.map(s => `- 🚩 ${s}`) : ["- No abnormal patterns detected"]),
      `<!-- DEVLEDGER_END -->`
    ].join("\n");

    const content = await fs.readFile(opts.file, "utf8");
    const startTag = "<!-- DEVLEDGER_START -->";
    const endTag = "<!-- DEVLEDGER_END -->";

    const startIndex = content.indexOf(startTag);
    const endIndex = content.indexOf(endTag);

    if (startIndex === -1 || endIndex === -1) {
      console.error(`Error: Tags not found in ${opts.file}. Please add ${startTag} and ${endTag} to your file.`);
      process.exit(1);
    }

    const newContent = 
      content.substring(0, startIndex) + 
      reportMd + 
      content.substring(endIndex + endTag.length);

    await fs.writeFile(opts.file, newContent, "utf8");
    console.log(`Report injected into ${opts.file}`);
  });

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

program
  .command("init")
  .description("Initialize DevLedger in the current directory (enables tracking)")
  .action(async () => {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const markerPath = path.join(process.cwd(), ".devledger");
    
    try {
      await fs.writeFile(markerPath, JSON.stringify({
        createdAt: Date.now(),
        project: path.basename(process.cwd())
      }, null, 2));
      console.log(`Initialized DevLedger in ${process.cwd()}`);
    } catch (err) {
      console.error("Failed to initialize DevLedger:", err);
    }
  });

program.parseAsync(process.argv);