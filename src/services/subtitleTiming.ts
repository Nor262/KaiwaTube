export interface CueTimingLike {
  start: number;
  end: number;
  ja: string;
}

/**
 * Strips bracketed/parenthetical sound/stage annotations (e.g. [音楽], (拍手), ♪)
 * and punctuation so spoken dialogue can be distinguished from pure SFX/BGM cues.
 */
export function stripNonSpeechMarkup(text: string): string {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/［[^］]*］/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/[♪♫〜～・…\s,.。、!！?？「」『』\-—~]+/g, '')
    .trim();
}

export function isNonSpeechTagCue(text: string): boolean {
  return stripNonSpeechMarkup(text).length === 0;
}

/**
 * Normalizes subtitle cue timings while preventing concurrent SFX/BGM tags ([音楽], etc.)
 * from cutting off active spoken lines, and expanding unrealistically compressed long YouTube
 * captions into trailing silence before the next spoken cue.
 */
export function normalizeSubtitleCueTimings<T extends CueTimingLike>(rawCues: T[]): T[] {
  if (!Array.isArray(rawCues) || rawCues.length === 0) return [];

  const sorted = rawCues
    .map((c) => {
      const start = Math.max(0, Number(c.start) || 0);
      const end = Math.max(start, Number(c.end) || start);
      return { ...c, start, end };
    })
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const aTag = isNonSpeechTagCue(a.ja) ? 1 : 0;
      const bTag = isNonSpeechTagCue(b.ja) ? 1 : 0;
      if (aTag !== bTag) return aTag - bTag;
      return a.end - b.end;
    });

  // Precompute the next spoken cue's start time so compressed 3s YouTube captions
  // can expand naturally into dead air without intruding on subsequent speech.
  const nextSpokenStarts = new Array<number>(sorted.length).fill(Number.POSITIVE_INFINITY);
  let nextSpoken = Number.POSITIVE_INFINITY;
  for (let i = sorted.length - 1; i >= 0; i--) {
    nextSpokenStarts[i] = nextSpoken;
    if (!isNonSpeechTagCue(sorted[i].ja)) {
      nextSpoken = sorted[i].start;
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (isNonSpeechTagCue(cur.ja)) continue;
    const spokenLen = stripNonSpeechMarkup(cur.ja).length;
    const dur = cur.end - cur.start;
    if (spokenLen >= 25 && spokenLen / Math.max(0.5, dur) > 11.5) {
      const estimatedDur = Math.min(18, Math.max(dur, spokenLen * 0.16 + 0.6));
      const limitEnd = Number.isFinite(nextSpokenStarts[i])
        ? Math.max(cur.end, nextSpokenStarts[i] - 0.05)
        : Number.POSITIVE_INFINITY;
      cur.end = Math.min(cur.start + estimatedDur, limitEnd);
    }
  }

  const cleaned: T[] = [];
  for (const cur of sorted) {
    if (cleaned.length === 0) {
      cleaned.push(cur);
      continue;
    }

    const prev = cleaned[cleaned.length - 1];
    const prevNonSpeech = isNonSpeechTagCue(prev.ja);
    const curNonSpeech = isNonSpeechTagCue(cur.ja);

    if (curNonSpeech) {
      if (cur.start < prev.end) {
        if (!prevNonSpeech) {
          // Keep the active spoken cue intact; defer SFX only if it meaningfully outlasts speech.
          if (cur.end > prev.end + 0.4) {
            cur.start = prev.end;
            cleaned.push(cur);
          }
          continue;
        }
        if (cur.start > prev.start + 0.05) {
          prev.end = cur.start;
          cleaned.push(cur);
        } else {
          prev.end = Math.max(prev.end, cur.end);
        }
        continue;
      }
      cleaned.push(cur);
      continue;
    }

    // Spoken cue: trim or drop any overlapping preceding pure non-speech cue.
    while (cleaned.length > 0 && isNonSpeechTagCue(cleaned[cleaned.length - 1].ja)) {
      const lastSfx = cleaned[cleaned.length - 1];
      if (lastSfx.end <= cur.start) break;
      if (cur.start - lastSfx.start > 0.25) {
        lastSfx.end = cur.start;
        break;
      }
      cleaned.pop();
    }

    if (cleaned.length > 0) {
      const lastSpoken = cleaned[cleaned.length - 1];
      if (cur.start > lastSpoken.start + 0.05 && lastSpoken.end > cur.start) {
        lastSpoken.end = cur.start;
      }
    }

    cleaned.push(cur);
  }

  return cleaned;
}

/**
 * Picks the cue covering time `t`, preferring spoken dialogue over concurrent
 * pure non-speech tags (e.g. [音楽]) if any legacy/imported track overlaps.
 */
export function findActiveSubtitleCue<T extends CueTimingLike>(cues: T[], t: number): T | null {
  let fallbackNonSpeech: T | null = null;
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (t >= c.start && t < c.end) {
      if (!isNonSpeechTagCue(c.ja)) {
        return c;
      }
      if (!fallbackNonSpeech) {
        fallbackNonSpeech = c;
      }
    }
  }
  return fallbackNonSpeech;
}

/**
 * Finds the active cue at time `t`, or falls back to the latest cue that started
 * at or before `t` (preferring spoken lines) so scroll restoration anchors to the
 * current video segment even during pauses/gaps between lines.
 */
export function findCueAtOrBeforeTime<T extends CueTimingLike>(cues: T[], t: number): T | null {
  const active = findActiveSubtitleCue(cues, t);
  if (active) return active;
  if (t <= 0 || cues.length === 0) return null;

  let fallbackNonSpeech: T | null = null;
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.start <= t) {
      if (!isNonSpeechTagCue(c.ja)) {
        return c;
      }
      if (!fallbackNonSpeech) {
        fallbackNonSpeech = c;
      }
    }
  }
  return fallbackNonSpeech;
}
