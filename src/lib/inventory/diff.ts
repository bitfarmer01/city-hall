import type { IndexArticleEntry, InventorySnapshot, KaNumber } from "./types";

export interface ChangedArticle {
  ka: KaNumber;
  before: { title: string; description: string };
  after: { title: string; description: string };
}

export interface SnapshotDiff {
  added: IndexArticleEntry[];
  removed: IndexArticleEntry[];
  changed: ChangedArticle[];
}

/**
 * Pure diff keyed by KA. Inputs are snapshots (articles sorted by KA), so
 * outputs are sorted without re-sorting here.
 */
export function diffSnapshots(
  before: InventorySnapshot,
  after: InventorySnapshot,
): SnapshotDiff {
  const beforeByKa = new Map(before.articles.map((a) => [a.ka, a]));
  const afterByKa = new Map(after.articles.map((a) => [a.ka, a]));

  const added = after.articles.filter((a) => !beforeByKa.has(a.ka));
  const removed = before.articles.filter((a) => !afterByKa.has(a.ka));
  const changed: ChangedArticle[] = [];
  for (const fresh of after.articles) {
    const old = beforeByKa.get(fresh.ka);
    if (!old) {
      continue;
    }
    if (old.title !== fresh.title || old.description !== fresh.description) {
      changed.push({
        ka: fresh.ka,
        before: { title: old.title, description: old.description },
        after: { title: fresh.title, description: fresh.description },
      });
    }
  }

  return { added, removed, changed };
}

export function diffIsEmpty(diff: SnapshotDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
