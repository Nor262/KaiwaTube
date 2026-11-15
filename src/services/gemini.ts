import { JapaneseAnalysisResult, SubtitleCue } from '../types';
import {
  getKanjiMnemonicFromCache,
  saveKanjiMnemonicsToCache,
  translateBatchServer,
} from './api';
import { updateCachedKanjiMnemonic } from './kanji';
import { normalizeCueTimings } from './youtube';

export interface DiscoveredModel {
  id: string;
  name: string;
  description: string;
}

const analysisCache = new Map<string, JapaneseAnalysisResult>();

function cleanGeminiJsonRaw(rawText: string): string {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!cleaned) return '';
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  let start = -1;
  if (firstObj !== -1 && firstArr !== -1) {
    start = Math.min(firstObj, firstArr);
  } else {
    start = firstObj !== -1 ? firstObj : firstArr;
  }
  if (start > 0) {
    return cleaned.slice(start);
  }
  return cleaned;
}

function extractGeminiResponse(data: any): { rawText: string; finishReason: string } {
  const candidate = data?.candidates?.[0];
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const answerParts = parts.filter((p) => !p?.thought && typeof p?.text === 'string');
  const textParts = answerParts.length > 0 ? answerParts : parts.filter((p) => typeof p?.text === 'string');
  const rawText = textParts.map((p) => p.text).join('') || '{}';
  const finishReason = String(candidate?.finishReason || '');
  return { rawText, finishReason };
}

async function requestGeminiGenerateContent(
  apiKey: string,
  activeModel: string,
  prompt: string,
  maxOutputTokens: number,
  disableThinking: boolean
): Promise<Response> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    temperature: 0.1,
    maxOutputTokens,
  };
  if (disableThinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey.trim()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );
}

async function callGeminiJson(
  apiKey: string,
  model: string,
  prompt: string,
  maxOutputTokens = 4096
): Promise<any> {
  const activeModel = model?.trim() || 'gemini-2.5-flash';
  // Gemini 2.5 Flash / Flash-Lite spend output budget on hidden thinking tokens unless capped.
  let disableThinking = /gemini-2\.5-flash/i.test(activeModel);
  let tokenBudget = Math.max(256, maxOutputTokens);

  for (let attempt = 0; attempt < 3; attempt++) {
    let res = await requestGeminiGenerateContent(
      apiKey,
      activeModel,
      prompt,
      tokenBudget,
      disableThinking
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = String(err?.error?.message || `Gemini API error (${res.status})`);
      // If a specific model rejects thinkingConfig, fall back gracefully without it.
      if (res.status === 400 && disableThinking && /thinking/i.test(msg)) {
        disableThinking = false;
        res = await requestGeminiGenerateContent(apiKey, activeModel, prompt, tokenBudget, false);
        if (!res.ok) {
          const retryErr = await res.json().catch(() => ({}));
          throw new Error(retryErr?.error?.message || `Gemini API error (${res.status})`);
        }
      } else {
        throw new Error(msg);
      }
    }

    const data = await res.json();
    const { rawText, finishReason } = extractGeminiResponse(data);
    const cleaned = cleanGeminiJsonRaw(rawText);

    try {
      const parsed = JSON.parse(cleaned || '{}');
      if (finishReason === 'MAX_TOKENS' && attempt === 0) {
        tokenBudget = Math.min(16384, Math.max(tokenBudget * 2, 8192));
        continue;
      }
      return parsed;
    } catch {
      const canExpandBudget = tokenBudget < 8192 || (finishReason === 'MAX_TOKENS' && tokenBudget < 16384);
      if (attempt < 2 && canExpandBudget) {
        tokenBudget = Math.min(16384, Math.max(tokenBudget * 2, 8192));
        continue;
      }
      if (finishReason === 'MAX_TOKENS') {
        throw new Error(
          'Phản hồi AI bị cắt giữa chừng do vượt giới hạn token. Hãy bấm "Thử phân tích lại" hoặc chuyển sang model gemini-2.5-flash.'
        );
      }
      if (finishReason && finishReason !== 'STOP') {
        throw new Error(`Gemini dừng phản hồi (${finishReason}). Vui lòng thử lại hoặc đổi model khác.`);
      }
      throw new Error(
        'Dữ liệu JSON từ Gemini trả về chưa hoàn chỉnh. Vui lòng bấm "Thử phân tích lại" hoặc thử model gemini-2.5-flash.'
      );
    }
  }

  throw new Error('Không thể hoàn tất yêu cầu Gemini JSON sau nhiều lần thử.');
}

export async function fetchGeminiModels(apiKey: string): Promise<DiscoveredModel[]> {
  if (!apiKey.trim()) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data?.models)) {
      return data.models
        .filter((m: any) =>
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map((m: any) => {
          const id = m.name?.replace(/^models\//, '') || '';
          return {
            id,
            name: m.displayName || id,
            description: m.description || '',
          };
        });
    }
    return [];
  } catch {
    return [];
  }
}

export async function quickTranslateJaToVi(text: string): Promise<string> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(
      text
    )}`;
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data?.[0])) {
      return data[0].map((item: any) => item[0]).join('');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Optimized fast analyzer with Kanji Radical Breakdown (decomposition) + 1-line Mnemonic
 */
export async function analyzeJapaneseWithGemini(
  apiKey: string,
  text: string,
  model = 'gemini-2.5-flash'
): Promise<JapaneseAnalysisResult> {
  const activeModel = model?.trim() || 'gemini-2.5-flash';
  const cacheKey = `${activeModel}:${text.trim()}`;

  if (analysisCache.has(cacheKey)) {
    return analysisCache.get(cacheKey)!;
  }

  const safeQuotedText = JSON.stringify(text);
  const prompt = `Phân tích câu tiếng Nhật sau một cách súc tích, chuẩn ngữ pháp, tối ưu cho học qua Anime:
${safeQuotedText}

Chỉ trả về JSON hợp lệ (không markdown, không sinh văn phong thừa):
{
  "text": ${safeQuotedText},
  "reading": "toàn bộ câu bằng Hiragana",
  "translation": "nghĩa tiếng Việt chuẩn sát ngữ cảnh",
  "jlptLevel": "N5|N4|N3|N2|N1",
  "ellipsis": "Chỉ rõ thành phần bị lược bỏ nếu có (chủ ngữ ẩn, hoặc kết thúc lửng cuối câu như lược bỏ だ/です, thể て, trợ từ lửng...); để rỗng \\"\\" nếu câu hoàn chỉnh",
  "conjugations": [
    {
      "surface": "từ trong câu (vd: 伴っている hoặc 伴ってる)",
      "baseForm": "dạng từ điển (reading) • [Tự động từ (自動詞) hoặc Ngoại động từ (他動詞) hoặc Động từ N1/N2/N3 hoặc Tính từ -i/-na]",
      "formName": "tên thể (vd: Thể tiếp diễn V-ている, Bị động, Sai khiến, Thể て...)",
      "chain": "chuỗi mũi tên ngắn gọn từng bước: Gốc → Bước 1 (tên thể) → Rút gọn khẩu ngữ nếu có → Dạng cuối",
      "reason": "tại sao chia như vậy trong ngữ cảnh câu (1-2 câu súc tích)"
    }
  ],
  "tokens": [
    { "surface": "từ", "reading": "hiragana", "pos": "loại từ", "meaning": "nghĩa ngắn" }
  ],
  "kanjiList": [
    {
      "kanji": "CHỈ 1 chữ Hán đơn lẻ duy nhất (vd: '伴', KHÔNG gộp từ ghép 2 chữ như '本日')",
      "hanViet": "ÂM HÁN VIỆT IN HOA",
      "meaning": "nghĩa ngắn",
      "onyomi": ["âm On"],
      "kunyomi": ["âm Kun"],
      "strokes": 7,
      "jlpt": "N3",
      "decomposition": "Chiết tự bộ thủ ngắn gọn kiểu: Bộ 1 (tên - nghĩa) + Bộ 2 (tên - nghĩa). Vd: 亻 (Nhân đứng - người) + 半 (Bán - một nửa)",
      "mnemonic": "Câu mẹo nhớ nhanh 1 dòng (<25 chữ) gắn kết các bộ thủ với nghĩa chữ Hán/từ. Vd: Một nửa (半) kia luôn đi cùng người (亻) mình → Bạn đồng hành / Kèm theo (伴う)",
      "radicals": [
        { "radical": "bộ", "name": "tên bộ", "meaning": "nghĩa" }
      ]
    }
  ],
  "grammarPoints": [
    {
      "pattern": "tên cấu trúc/trợ từ",
      "formula": "công thức ngắn",
      "meaning": "nghĩa tiếng Việt",
      "explanation": "giải thích ngắn gọn 1-2 câu",
      "jlpt": "N3"
    }
  ]
}
Chỉ tạo danh sách 'conjugations' cho các động từ, tính từ có chia thể hoặc biến âm thực sự trong câu (nếu câu chỉ có danh từ thì để mảng rỗng []). Mỗi phần tử trong 'kanjiList' PHẢI là đúng 1 ký tự Kanji đơn lẻ (tách riêng từng chữ như '本' và '日', tuyệt đối không gộp từ ghép). Giữ phần giải thích ngắn gọn, mỗi Kanji chỉ liệt kê tối đa 3 bộ thủ chính trong 'radicals' và 1 câu ngắn trong 'mnemonic' để JSON luôn đầy đủ.`;

  const parsed: JapaneseAnalysisResult = await callGeminiJson(apiKey, activeModel, prompt, 4096);
  analysisCache.set(cacheKey, parsed);

  // Cache single-Kanji mnemonics in shared SQLite cache & local memory cache
  if (Array.isArray(parsed.kanjiList) && parsed.kanjiList.length > 0) {
    const items = parsed.kanjiList
      .filter(
        (k) =>
          k.kanji &&
          Array.from(String(k.kanji).trim()).length === 1 &&
          (k.decomposition || k.mnemonic)
      )
      .map((k) => {
        if (k.decomposition || k.mnemonic) {
          updateCachedKanjiMnemonic(k.kanji, k.decomposition || '', k.mnemonic || '');
        }
        return {
          kanji: k.kanji,
          hanViet: k.hanViet,
          decomposition: k.decomposition || '',
          mnemonic: k.mnemonic || '',
        };
      });
    void saveKanjiMnemonicsToCache(items);
  }

  return parsed;
}

/**
 * On-demand single-Kanji radical breakdown + 1-line mnemonic (checks SQLite cache first)
 */
export async function generateKanjiMnemonicWithGemini(
  apiKey: string,
  kanji: string,
  context: {
    wordContext?: string;
    hanViet?: string;
    meaning?: string;
    compDetail?: Array<{ w: string; h: string | null }>;
  },
  model = 'gemini-2.5-flash'
): Promise<{ decomposition: string; mnemonic: string }> {
  const cached = await getKanjiMnemonicFromCache(kanji);
  if (cached && cached.mnemonic) {
    updateCachedKanjiMnemonic(kanji, cached.decomposition, cached.mnemonic);
    return { decomposition: cached.decomposition, mnemonic: cached.mnemonic };
  }

  if (!apiKey.trim()) {
    throw new Error('Cần Gemini API Key để tạo mẹo nhớ Kanji (chỉ tốn ~30 token và lưu cache vĩnh viễn).');
  }

  const comps = (context.compDetail || [])
    .map((c) => `${c.w}${c.h ? ` (${c.h})` : ''}`)
    .join(' + ');

  const prompt = `Tạo chiết tự bộ thủ và mẹo nhớ 1 dòng cực kỳ dễ nhớ cho chữ Kanji "${kanji}"${
    context.hanViet ? ` (Âm Hán Việt: ${context.hanViet})` : ''
  }${context.meaning ? `, nghĩa: ${context.meaning}` : ''}${
    context.wordContext ? `, trong từ "${context.wordContext}"` : ''
  }${comps ? `. Gợi ý bộ thành phần: ${comps}` : ''}.

Trả về duy nhất JSON:
{
  "decomposition": "Bộ 1 (tên tiếng Việt - nghĩa) + Bộ 2 (tên - nghĩa). Vd: 亻 (Nhân đứng - người) + 半 (Bán - một nửa)",
  "mnemonic": "1 câu chuyện ngắn (<25 chữ) gắn kết các bộ thủ thành nghĩa của từ. Vd: Một nửa (半) kia luôn đi cùng người (亻) mình → Bạn đồng hành (伴う)"
}`;

  const parsed = await callGeminiJson(apiKey, model, prompt, 512);
  const decomposition = String(parsed?.decomposition || comps || '').trim();
  const mnemonic = String(parsed?.mnemonic || '').trim();

  if (decomposition || mnemonic) {
    updateCachedKanjiMnemonic(kanji, decomposition, mnemonic);
    void saveKanjiMnemonicsToCache([
      {
        kanji,
        hanViet: context.hanViet || '',
        decomposition,
        mnemonic,
      },
    ]);
  }

  return { decomposition, mnemonic };
}

function joinJapaneseFragments(fragments: string[]): string {
  let out = '';
  for (const raw of fragments) {
    const part = raw.trim();
    if (!part) continue;
    if (!out) {
      out = part;
      continue;
    }
    const prevLast = out[out.length - 1];
    const nextFirst = part[0];
    const needsSpace = /[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(nextFirst);
    out += (needsSpace ? ' ' : '') + part;
  }
  return out;
}

function normalizeWindowGroups(
  rawGroups: unknown,
  windowStart: number,
  windowEnd: number
): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  if (Array.isArray(rawGroups)) {
    for (const item of rawGroups) {
      if (!Array.isArray(item) || item.length < 2) continue;
      let a = Math.floor(Number(item[0]));
      let b = Math.floor(Number(item[1]));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a > b) [a, b] = [b, a];
      a = Math.max(windowStart, Math.min(windowEnd, a));
      b = Math.max(windowStart, Math.min(windowEnd, b));
      groups.push([a, b]);
    }
  }

  groups.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  // Ensure monotonic, contiguous, non-overlapping coverage from windowStart to windowEnd
  const repaired: Array<[number, number]> = [];
  let cursor = windowStart;
  for (const [rawA, rawB] of groups) {
    if (rawB < cursor) continue;
    const a = Math.max(cursor, rawA);
    if (a > cursor) {
      repaired.push([cursor, a - 1]);
    }
    const b = Math.max(a, rawB);
    repaired.push([a, b]);
    cursor = b + 1;
  }
  while (cursor <= windowEnd) {
    repaired.push([cursor, cursor]);
    cursor += 1;
  }
  return repaired;
}

/**
 * AI Subtitle Merging via Index Grouping + Parallel Vietnamese Batch Translation
 * Guarantees 0 timestamp hallucination and 0 dropped lines.
 */
export async function mergeSubtitlesWithGemini(
  apiKey: string,
  rawCues: SubtitleCue[],
  model = 'gemini-2.5-flash',
  onProgress?: (stage: 'grouping' | 'translating', detail: string) => void
): Promise<SubtitleCue[]> {
  if (!apiKey.trim()) {
    throw new Error('Vui lòng nhập Gemini API Key trong Cài đặt để AI gộp câu phụ đề.');
  }
  if (!rawCues.length) {
    throw new Error('Không có dòng phụ đề gốc nào để xử lý.');
  }

  const cleanRawCues = normalizeCueTimings(rawCues);
  const N = cleanRawCues.length;
  const WINDOW_SIZE = 140;
  const finalGroups: Array<[number, number]> = [];
  let cursor = 0;

  while (cursor < N) {
    const windowEnd = Math.min(N - 1, cursor + WINDOW_SIZE - 1);
    const isLastWindow = windowEnd === N - 1;
    const progressPct = Math.round(((cursor + 1) / N) * 100);
    onProgress?.(
      'grouping',
      `Bước 1/2: AI đang gom câu theo ngữ pháp (${cursor + 1}–${windowEnd + 1}/${N} dòng • ${progressPct}%)...`
    );

    const indexedLines = cleanRawCues
      .slice(cursor, windowEnd + 1)
      .map((c, idx) => `[${cursor + idx}] ${c.ja.replace(/\s+/g, ' ').trim()}`)
      .join('\n');

    const prompt = `Bạn là chuyên gia biên tập phụ đề Anime/YouTube tiếng Nhật.
Dưới đây là các mảnh phụ đề gốc bị YouTube ngắt rời theo hơi thở (từ chỉ số [${cursor}] đến [${windowEnd}]):
${indexedLines}

Nhiệm vụ: Hãy gom nhóm các chỉ số liên tiếp thành các câu tiếng Nhật hoàn chỉnh, tự nhiên theo ngữ pháp và ngữ cảnh hội thoại (thường 1 đến 5 dòng/câu, giữ [♪]/[音楽] riêng).
Quy tắc BẮT BUỘC:
- Phủ kín TOÀN BỘ chỉ số từ ${cursor} đến ${windowEnd}, liên tục không bỏ sót số nào, không trùng lặp.
- Chỉ trả về JSON: {"groups": [[startIndex, endIndex], ...]}
Ví dụ: {"groups": [[${cursor}, ${cursor + 1}], [${cursor + 2}, ${Math.min(cursor + 4, windowEnd)}]]}`;

    const parsed = await callGeminiJson(apiKey, model, prompt, 4096);
    const repaired = normalizeWindowGroups(parsed?.groups, cursor, windowEnd);

    if (isLastWindow || repaired.length <= 1) {
      finalGroups.push(...repaired);
      cursor = windowEnd + 1;
    } else {
      // Keep all groups except the very last trailing one so sentence spanning window boundary merges cleanly
      const kept = repaired.slice(0, repaired.length - 1);
      finalGroups.push(...kept);
      const nextStart = kept[kept.length - 1][1] + 1;
      cursor = Math.max(cursor + 1, nextStart);
    }
  }

  // Construct merged Japanese cues deterministically from exact raw timestamps
  const mergedNoVi = normalizeCueTimings(
    finalGroups.map(([startIdx, endIdx], idx) => {
      const slice = cleanRawCues.slice(startIdx, endIdx + 1);
      const start = slice[0].start;
      const end = Math.max(start, slice[slice.length - 1].end);
      const ja = joinJapaneseFragments(slice.map((c) => c.ja));
      return {
        id: `ai-${Math.round(start * 1000)}-${idx}`,
        start,
        end,
        ja,
      };
    })
  );

  onProgress?.(
    'translating',
    `Bước 2/2: Đang dịch trọn vẹn ngữ cảnh ${mergedNoVi.length} câu hoàn chỉnh...`
  );

  const viList = await translateBatchServer(mergedNoVi.map((c) => c.ja));
  return mergedNoVi.map((c, idx) => ({
    ...c,
    vi: viList[idx] || undefined,
  }));
}
