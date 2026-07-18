import { diffWordsWithSpace } from 'diff';

/**
 * Animates the Code tab from one full-file string to another by replaying
 * the diff between them as a sequence of "delete old text, then type new
 * text" hunks, in order, so the user can watch what actually changed instead
 * of the file just flashing to its new contents.
 *
 * Pure client-side utility — no dependency on React or the socket layer.
 * The caller supplies `onUpdate` (write the current intermediate string
 * somewhere visible, e.g. `setHtmlSource`) and an `isCancelled` check so a
 * newer turn (or Stop/New Project) can abandon a stale animation cleanly.
 */

export interface AnimateHtmlDiffOptions {
  before: string;
  after: string;
  /** Called with the current intermediate buffer on every animation tick. */
  onUpdate: (text: string) => void;
  /**
   * Called right before a hunk's delete/type animation starts, with the
   * 1-based line number (in the buffer as it stands at that moment) the
   * hunk is about to touch. Use this to scroll the code panel into view.
   */
  onScrollToLine?: (lineNumber: number) => void;
  /**
   * Polled between animation steps. Once it returns true the animation
   * stops immediately WITHOUT writing anything further via `onUpdate` —
   * the caller is assumed to already own/overwrite the buffer at that
   * point (e.g. a newer turn has started), so we must not clobber it.
   */
  isCancelled?: () => boolean;
  /** Target duration for a single hunk's delete+type animation, in ms. */
  msPerHunk?: number;
  /** Delay between animation ticks, in ms. */
  tickIntervalMs?: number;
  /**
   * If the total number of changed characters across all hunks exceeds
   * this, skip the animation entirely and snap straight to `after` (avoids
   * a degenerate multi-minute animation on a whole-file regeneration).
   */
  maxAnimatedChars?: number;
}

interface Hunk {
  /** Offset into the working buffer, as it stands right before this hunk runs. */
  offset: number;
  removedText: string;
  addedText: string;
}

const DEFAULT_MS_PER_HUNK = 700;
const DEFAULT_TICK_INTERVAL_MS = 20;
const DEFAULT_MAX_ANIMATED_CHARS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk the ordered word-level diff and coalesce an adjacent removed+added
 * pair into a single "replace" hunk (delete old, then type new at the same
 * spot). A lone removed part is a pure deletion; a lone added part is a
 * pure insertion. `offset` for each hunk is computed against the buffer as
 * it will exist once every prior hunk has fully resolved.
 */
function buildHunks(before: string, after: string): Hunk[] {
  const parts = diffWordsWithSpace(before, after);
  const hunks: Hunk[] = [];
  let offset = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (!part.added && !part.removed) {
      offset += part.value.length;
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        hunks.push({ offset, removedText: part.value, addedText: next.value });
        offset += next.value.length;
        i++; // consumed the paired "added" part too
        continue;
      }
      hunks.push({ offset, removedText: part.value, addedText: '' });
      // A pure deletion doesn't advance the offset — whatever came after it
      // now sits at the same position once the delete animation finishes.
      continue;
    }

    // part.added, with no immediately preceding removed part.
    hunks.push({ offset, removedText: '', addedText: part.value });
    offset += part.value.length;
  }

  return hunks;
}

function lineNumberAtOffset(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

function charsPerTick(totalChars: number, msPerHunk: number, tickIntervalMs: number): number {
  const ticks = Math.max(1, Math.round(msPerHunk / tickIntervalMs));
  return Math.max(1, Math.ceil(totalChars / ticks));
}

export async function animateHtmlDiff({
  before,
  after,
  onUpdate,
  onScrollToLine,
  isCancelled = () => false,
  msPerHunk = DEFAULT_MS_PER_HUNK,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  maxAnimatedChars = DEFAULT_MAX_ANIMATED_CHARS,
}: AnimateHtmlDiffOptions): Promise<void> {
  if (before === after) {
    if (!isCancelled()) onUpdate(after);
    return;
  }
  if (isCancelled()) return;

  const hunks = buildHunks(before, after);
  const totalChangedChars = hunks.reduce(
    (sum, h) => sum + h.removedText.length + h.addedText.length,
    0,
  );

  // Nothing to animate, or the diff is too large to animate reasonably —
  // snap straight to the final content instead of a degenerate long run.
  if (hunks.length === 0 || totalChangedChars > maxAnimatedChars) {
    if (!isCancelled()) onUpdate(after);
    return;
  }

  let buffer = before;

  for (const hunk of hunks) {
    if (isCancelled()) return;

    onScrollToLine?.(lineNumberAtOffset(buffer, hunk.offset));

    // Delete phase — shrink the old text from its tail backwards, like a
    // backspace, so the removal reads as a deliberate edit.
    if (hunk.removedText.length > 0) {
      const base = buffer;
      const step = charsPerTick(hunk.removedText.length, msPerHunk, tickIntervalMs);
      let remaining = hunk.removedText.length;
      while (remaining > 0) {
        if (isCancelled()) return;
        remaining = Math.max(0, remaining - step);
        buffer =
          base.slice(0, hunk.offset + remaining) +
          base.slice(hunk.offset + hunk.removedText.length);
        onUpdate(buffer);
        if (remaining > 0) await sleep(tickIntervalMs);
      }
    }

    // Type phase — insert the new text left-to-right at the same spot.
    if (hunk.addedText.length > 0) {
      const base = buffer;
      const step = charsPerTick(hunk.addedText.length, msPerHunk, tickIntervalMs);
      let typed = 0;
      while (typed < hunk.addedText.length) {
        if (isCancelled()) return;
        typed = Math.min(hunk.addedText.length, typed + step);
        buffer = base.slice(0, hunk.offset) + hunk.addedText.slice(0, typed) + base.slice(hunk.offset);
        onUpdate(buffer);
        if (typed < hunk.addedText.length) await sleep(tickIntervalMs);
      }
    }
  }

  // Guarantee no drift between the animation and the real data.
  if (!isCancelled()) onUpdate(after);
}

/** True when the user's OS/browser prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
