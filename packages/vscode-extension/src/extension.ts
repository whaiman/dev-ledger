import * as vscode from "vscode";
import { Tracker } from "./tracker";

let tracker: Tracker | undefined;

export function activate(context: vscode.ExtensionContext) {
  tracker = new Tracker(context, {
    idleTimeoutMs: 2 * 60_000,
    idleCheckMs: 10_000,
    editThrottleMs: 800,
  });

  tracker.start();
}

export function deactivate() {
  tracker?.dispose();
}