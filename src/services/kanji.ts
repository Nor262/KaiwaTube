import { BoundedMemoryCache, sanitizeAiText } from '../utils/aiSecurity';
import { resolveApiUrl } from './api';

export interface KanjiInfo {
  type: 'kanji';
  kanji: string;
  hanViet: string;
  meaning: string;
  fullDetail?: string;
  on?: string;
  kun?: string;
  jlpt?: string;
  strokes?: string;
  compDetail?: Array<{ w: string; h: string | null }>;
  decomposition?: string;
  mnemonic?: string;
}

export interface WordInfo {
  type: 'word';
  word: string;
  reading: string;
  meanings: Array<{
    kind?: string;
    mean: string;
  }>;
}

export interface ComprehensiveHoverData {
  wordInfo?: WordInfo | null;
  kanjiList: KanjiInfo[];
  singleChar?: KanjiInfo | null;
}

const memoryCache = new BoundedMemoryCache<string, any>(500);

export function updateCachedKanjiMnemonic(
  kanji: string,
  decomposition: string,
  mnemonic: string
): void {
  const cacheKey = `kanji:${kanji}`;
  const existing = memoryCache.get(cacheKey);
  if (existing) {
    memoryCache.set(cacheKey, {
      ...existing,
      decomposition,
      mnemonic,
    });
  }
}

export async function lookupKanji(char: string): Promise<KanjiInfo | null> {
  const safeChar = sanitizeAiText(char, 4);
  if (!safeChar) return null;
  const cacheKey = `kanji:${safeChar}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(resolveApiUrl(`/api/kanji?q=${encodeURIComponent(safeChar)}&type=kanji`));
    if (!res.ok) return null;
    const data = await res.json();
    if (data && !data.notFound) {
      memoryCache.set(cacheKey, data);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function lookupWord(word: string): Promise<WordInfo | null> {
  const safeWord = sanitizeAiText(word, 64);
  if (!safeWord) return null;
  const cacheKey = `word:${safeWord}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(resolveApiUrl(`/api/kanji?q=${encodeURIComponent(safeWord)}&type=word`));
    if (!res.ok) return null;
    const data = await res.json();
    if (data && !data.notFound) {
      memoryCache.set(cacheKey, data);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns BOTH the compound word and the breakdown of each individual Kanji!
 */
export async function lookupComprehensive(
  wordOrChar: string
): Promise<ComprehensiveHoverData> {
  const isKanji = (ch: string) => /[\u3400-\u4dbf\u4e00-\u9faf]/.test(ch);
  const clean = sanitizeAiText(
    wordOrChar.replace(/[（）\(\)\[\]「」『』【】、。！？!?\s\.,:;]+/g, ''),
    64
  );
  if (!clean) {
    return { kanjiList: [] };
  }

  const chars = Array.from(clean);
  const kanjiChars = Array.from(new Set(chars.filter(isKanji)));

  const [wordInfo, ...kanjis] = await Promise.all([
    lookupWord(clean),
    ...kanjiChars.map((ch) => lookupKanji(ch)),
  ]);

  return {
    wordInfo: wordInfo || null,
    kanjiList: kanjis.filter(Boolean) as KanjiInfo[],
  };
}
