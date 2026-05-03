import * as vscode from "vscode";
import { Tracker } from "./tracker.js";
import { DashboardPanel } from "./dashboard.js";
import { getDefaultLogPath } from "@devledger/core";

let tracker: Tracker | undefined;

export function activate(context: vscode.ExtensionContext) {
  tracker = new Tracker(context, {
    idleTimeoutMs: 2 * 60_000,
    idleCheckMs: 10_000,
    editThrottleMs: 800,
  });

  tracker.start();

  const openDashboard = vscode.commands.registerCommand("devledger.showDashboard", () => {
    DashboardPanel.createOrShow(context.extensionUri, getDefaultLogPath());
  });

  context.subscriptions.push(openDashboard);
}

export function deactivate() {
  tracker?.dispose();
}