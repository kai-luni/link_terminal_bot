import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Dateiname, nach dem im Workspace gesucht wird. */
export const KNOWLEDGE_FILE_NAME = 'azure_knowledge.md';

/** Wie viele Zeichen der Datei höchstens in den Prompt gehen. */
export const KNOWLEDGE_MAX_CHARS = 5000;

/** Obergrenze für die Suche, damit große Workspaces nicht ausgebremst werden. */
const MAX_ENTRIES_PER_DIR = 500;

/**
 * Sucht azure_knowledge.md im Workspace-Root und in allen Unterordnern der ersten
 * Ebene. Erste Fundstelle in dieser Reihenfolge gewinnt. Fehler (fehlender Ordner,
 * Rechte) werden geschluckt — eine fehlende Datei ist kein Fehlerfall.
 */
export async function findKnowledgeFile(rootDir: string): Promise<string | undefined> {
  const rootCandidate = path.join(rootDir, KNOWLEDGE_FILE_NAME);
  if (await isFile(rootCandidate)) {
    return rootCandidate;
  }

  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .slice(0, MAX_ENTRIES_PER_DIR)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of dirs) {
    const candidate = path.join(rootDir, dir.name, KNOWLEDGE_FILE_NAME);
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Liest die Datei und kappt sie auf `maxChars` (Ende wird abgeschnitten, mit Hinweis). */
export async function readKnowledgeFile(
  filePath: string,
  maxChars: number = KNOWLEDGE_MAX_CHARS,
): Promise<string | undefined> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    if (trimmed.length <= maxChars) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxChars)}\n\n[... gekürzt, Datei ist ${trimmed.length} Zeichen lang]`;
  } catch {
    return undefined;
  }
}

/** Baut den Block, der an die Prompts gehängt wird. */
export function renderKnowledge(filePath: string, content: string): string {
  return `### Azure-Wissen (aus ${path.basename(filePath)})\n${content}`;
}

/** Sucht und liest in einem Schritt; `undefined`, wenn es nichts gibt. */
export async function loadKnowledge(
  rootDir: string,
  maxChars: number = KNOWLEDGE_MAX_CHARS,
): Promise<{ filePath: string; content: string } | undefined> {
  const found = await findKnowledgeFile(rootDir);
  if (!found) {
    return undefined;
  }
  const content = await readKnowledgeFile(found, maxChars);
  if (!content) {
    return undefined;
  }
  return { filePath: found, content };
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isFile();
  } catch {
    return false;
  }
}