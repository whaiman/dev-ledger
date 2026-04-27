import path from "node:path";
import { promises as fs } from "node:fs";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startPath: string): Promise<string | null> {
  let current = path.dirname(startPath);
  const root = path.parse(current).root;

  while (true) {
    if (await exists(path.join(current, ".devledger"))) return current;
    if (current === root) return null;
    current = path.dirname(current);
  }
}