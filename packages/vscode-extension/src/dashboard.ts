import * as vscode from "vscode";
import path from "node:path";
import { readEvents, aggregate, verifyChain } from "@devledger/core";
import type { DevStats } from "@devledger/core";
import { findProjectRoot } from "./project.js";

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, private readonly logPath: string) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._update();
  }

  public static createOrShow(extensionUri: vscode.Uri, logPath: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      DashboardPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "devledgerDashboard",
      "DevLedger Dashboard",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, logPath);
  }

  private async _update() {
    const webview = this._panel.webview;
    this._panel.title = "DevLedger Dashboard";

    try {
      const events = await readEvents(this.logPath);
      let project = vscode.workspace.workspaceFolders?.[0]?.name;

      // Attempt to resolve more accurately if we have an active editor
      const activeFile = vscode.window.activeTextEditor?.document.fileName;
      if (activeFile) {
        const root = await findProjectRoot(activeFile);
        if (root) project = path.basename(root);
      }

      const stats = aggregate(events, project);
      const proof = verifyChain(events, { project });

      this._panel.webview.html = this._getHtmlForWebview(webview, stats, proof, project);
    } catch (e) {
      this._panel.webview.html = `<h2>Error loading dashboard</h2><p>${e}</p>`;
    }
  }

  public dispose() {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, stats: DevStats, proof: any, project?: string) {
    const formatDuration = (ms: number) => {
      const totalMinutes = Math.floor(ms / 1000 / 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const langs = Object.keys(stats.byLanguage);
    const langValues = Object.values(stats.byLanguage).map((ms) => Math.floor(ms / 60000)); // in minutes

    const hours = Array.from({ length: 24 }, (_, i) => i);
    const hourValues = hours.map((h) => Math.floor((stats.byHour[h] ?? 0) / 60000));

    const humanityPct = Math.round(stats.humanityScore.score * 100);
    const humanityColor = humanityPct >= 75 ? "#22c55e" : humanityPct >= 50 ? "#f59e0b" : "#ef4444";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevLedger</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }
    .header {
      margin-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .header h1 { font-size: 24px; margin: 0; color: var(--vscode-textPreformat-foreground); }
    .header .subtitle { font-size: 13px; opacity: 0.7; margin-top: 5px; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 15px;
      text-align: center;
    }
    .card h3 { margin: 0; font-size: 12px; text-transform: uppercase; opacity: 0.8; }
    .card .value { font-size: 24px; font-weight: bold; margin-top: 10px; }
    
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    @media (max-width: 800px) { .charts { grid-template-columns: 1fr; } }
    .chart-container {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 15px;
      position: relative;
    }
    
    .integrity {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 15px;
    }
    .integrity h3 { margin-top: 0; }
    .hash { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all; opacity: 0.8; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .badge.verified { background: #14532d; color: #86efac; }
    .badge.unverified { background: #7c2d12; color: #fdba74; }
  </style>
</head>
<body>
  <div class="header">
    <h1>DevLedger Dashboard</h1>
    <div class="subtitle">Project: <strong>${project || "All Projects"}</strong></div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Coding Time</h3>
      <div class="value">${formatDuration(stats.totalMs)}</div>
    </div>
    <div class="card">
      <h3>Events Logged</h3>
      <div class="value">${stats.eventCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Humanity Score</h3>
      <div class="value" style="color: ${humanityColor}">${humanityPct}%</div>
    </div>
    <div class="card">
      <h3>Status</h3>
      <div class="value" style="margin-top: 12px;">
        <span class="badge ${proof.valid ? "verified" : "unverified"}">${
      proof.valid ? "✓ VERIFIED" : "⚠ UNVERIFIED"
    }</span>
      </div>
    </div>
  </div>

  <div class="charts">
    <div class="chart-container">
      <canvas id="langChart"></canvas>
    </div>
    <div class="chart-container">
      <canvas id="hourChart"></canvas>
    </div>
  </div>

  <div class="integrity">
    <h3>Integrity</h3>
    <p><strong>Hash Chain:</strong> <span class="hash">${proof.integrityHash}</span></p>
    ${
      stats.signals.length > 0
        ? `<p><strong>Signals:</strong><ul>${stats.signals
            .map((s) => `<li>${s}</li>`)
            .join("")}</ul></p>`
        : ""
    }
  </div>

  <script>
    Chart.defaults.color = 'var(--vscode-editor-foreground)';
    Chart.defaults.font.family = 'var(--vscode-font-family)';

    // Language Doughnut Chart
    new Chart(document.getElementById('langChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(langs)},
        datasets: [{
          data: ${JSON.stringify(langValues)},
          backgroundColor: [
            '#3178c6', '#f0db4f', '#3572a5', '#dea584', '#00add8', '#083fa1', '#8b5cf6', '#6b7280', '#cb171e', '#e44d26'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' },
          title: { display: true, text: 'Time by Language (minutes)', color: 'var(--vscode-editor-foreground)' }
        }
      }
    });

    // Hourly Bar Chart
    new Chart(document.getElementById('hourChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(hours.map((h) => h + ":00"))},
        datasets: [{
          label: 'Coding Time (mins)',
          data: ${JSON.stringify(hourValues)},
          backgroundColor: '#6366f1',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Activity by Hour', color: 'var(--vscode-editor-foreground)' }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: 'var(--vscode-panel-border)' } },
          x: { grid: { display: false } }
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
