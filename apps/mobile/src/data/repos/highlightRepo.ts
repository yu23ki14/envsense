import { Highlight } from '../schemas';
import { StorageKeys } from '../storage/keys';
import { deleteKey, getJSON, setJSON } from '../storage/mmkv';
import { registerHighlight, unregisterHighlight } from './dayIndex';

export function getHighlight(id: string): Highlight | null {
  return getJSON(StorageKeys.highlight(id), Highlight);
}

export function saveHighlight(highlight: Highlight): void {
  const existing = getHighlight(highlight.id);
  setJSON(StorageKeys.highlight(highlight.id), Highlight, highlight);
  if (existing == null) {
    registerHighlight(highlight.id, highlight.sourceAt);
  }
}

export function deleteHighlight(id: string): void {
  const highlight = getHighlight(id);
  if (highlight == null) return;
  deleteKey(StorageKeys.highlight(id));
  unregisterHighlight(id, highlight.sourceAt);
}

export function getHighlightsByIds(ids: readonly string[]): Highlight[] {
  const out: Highlight[] = [];
  for (const id of ids) {
    const highlight = getHighlight(id);
    if (highlight != null) out.push(highlight);
  }
  return out;
}
