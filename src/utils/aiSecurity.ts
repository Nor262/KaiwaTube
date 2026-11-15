import { JapaneseAnalysisResult, KanjiBreakdown } from '../types';

const GEMINI_MODEL_ID_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const SINGLE_KANJI_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2ebef}]$/u;

const UNSAFE_CTRL_INLINE_RE =
  /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const UNSAFE_CTRL_MULTILINE_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function isValidGeminiModelId(model: unknown): model is string {
  if (typeof model !== 'string') return false;
  const trimmed = model.trim();
  return GEMINI_MODEL_ID_RE.test(trimmed) && !trimmed.includes('..');
}

export function isValidGeminiApiKeyFormat(apiKey: unknown): boolean {
  if (typeof apiKey !== 'string') return false;
  const trimmed = apiKey.trim();
  return trimmed.length >= 10 && trimmed.length <= 256 && !/[\r\n\s]/.test(trimmed);
}

export function isSingleKanjiChar(ch: unknown): ch is string {
  if (typeof ch !== 'string') return false;
  const trimmed = ch.trim();
  return Array.from(trimmed).length === 1 && SINGLE_KANJI_RE.test(trimmed);
}

export function sanitizeAiText(
  raw: unknown,
  maxLength: number,
  options: { preserveNewlines?: boolean } = {}
): string {
  const str = typeof raw === 'string' ? raw : String(raw ?? '');
  const re = options.preserveNewlines ? UNSAFE_CTRL_MULTILINE_RE : UNSAFE_CTRL_INLINE_RE;
  return str.replace(re, '').trim().slice(0, maxLength);
}

/**
 * Wraps untrusted text inside explicit XML-style boundary markers and strips
 * any nested boundary tags so prompt data cannot impersonate system instructions.
 */
export function wrapUntrustedAiBlock(tagName: string, content: string): string {
  const safeTag = tagName.replace(/[^a-z0-9_]/gi, '_');
  const escaped = content.replace(new RegExp(`<\\/?untrusted_${safeTag}>`, 'gi'), '');
  return `<untrusted_${safeTag}>\n${escaped}\n</untrusted_${safeTag}>`;
}

export function sanitizeAnalysisResult(
  raw: unknown,
  originalSafeText: string
): JapaneseAnalysisResult {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};

  const conjugations = Array.isArray(obj.conjugations)
    ? obj.conjugations.slice(0, 24).map((c: any) => ({
        surface: sanitizeAiText(c?.surface, 120),
        baseForm: sanitizeAiText(c?.baseForm, 160),
        posType: c?.posType ? sanitizeAiText(c.posType, 80) : undefined,
        formName: sanitizeAiText(c?.formName, 120),
        chain: sanitizeAiText(c?.chain, 240),
        reason: sanitizeAiText(c?.reason, 360),
      }))
    : [];

  const tokens = Array.isArray(obj.tokens)
    ? obj.tokens.slice(0, 120).map((t: any) => ({
        surface: sanitizeAiText(t?.surface, 80),
        reading: sanitizeAiText(t?.reading, 120),
        pos: sanitizeAiText(t?.pos, 80),
        meaning: sanitizeAiText(t?.meaning, 160),
        baseForm: t?.baseForm ? sanitizeAiText(t.baseForm, 80) : undefined,
      }))
    : [];

  const kanjiList: KanjiBreakdown[] = Array.isArray(obj.kanjiList)
    ? obj.kanjiList
        .slice(0, 32)
        .filter((k: any) => isSingleKanjiChar(k?.kanji))
        .map((k: any) => ({
          kanji: k.kanji.trim(),
          hanViet: sanitizeAiText(k?.hanViet, 64).toUpperCase(),
          meaning: sanitizeAiText(k?.meaning, 200),
          onyomi: Array.isArray(k?.onyomi)
            ? k.onyomi.slice(0, 8).map((r: unknown) => sanitizeAiText(r, 32)).filter(Boolean)
            : [],
          kunyomi: Array.isArray(k?.kunyomi)
            ? k.kunyomi.slice(0, 8).map((r: unknown) => sanitizeAiText(r, 32)).filter(Boolean)
            : [],
          jlpt: k?.jlpt ? sanitizeAiText(k.jlpt, 16) : undefined,
          strokes:
            typeof k?.strokes === 'number' && Number.isFinite(k.strokes) && k.strokes > 0
              ? Math.min(64, Math.floor(k.strokes))
              : undefined,
          decomposition: k?.decomposition ? sanitizeAiText(k.decomposition, 400) : undefined,
          mnemonic: k?.mnemonic ? sanitizeAiText(k.mnemonic, 500) : undefined,
          radicals: Array.isArray(k?.radicals)
            ? k.radicals.slice(0, 6).map((r: any) => ({
                radical: sanitizeAiText(r?.radical, 16),
                name: sanitizeAiText(r?.name, 80),
                meaning: sanitizeAiText(r?.meaning, 120),
              }))
            : [],
        }))
    : [];

  const grammarPoints = Array.isArray(obj.grammarPoints)
    ? obj.grammarPoints.slice(0, 20).map((g: any) => ({
        pattern: sanitizeAiText(g?.pattern, 120),
        formula: g?.formula ? sanitizeAiText(g.formula, 160) : undefined,
        meaning: sanitizeAiText(g?.meaning, 240),
        explanation: sanitizeAiText(g?.explanation, 500),
        jlpt: g?.jlpt ? sanitizeAiText(g.jlpt, 16) : undefined,
      }))
    : [];

  return {
    text: originalSafeText,
    reading: sanitizeAiText(obj.reading, 1000),
    translation: sanitizeAiText(obj.translation, 1000),
    jlptLevel: obj.jlptLevel ? sanitizeAiText(obj.jlptLevel, 16) : undefined,
    ellipsis: obj.ellipsis ? sanitizeAiText(obj.ellipsis, 400) : '',
    conjugations,
    tokens,
    kanjiList,
    grammarPoints,
  };
}

export class BoundedMemoryCache<K, V> {
  private readonly store = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const val = this.store.get(key);
    if (val === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }
}
