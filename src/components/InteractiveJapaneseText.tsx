import React, { useState, useRef, useEffect, useCallback } from 'react';
import TinySegmenter from 'tiny-segmenter';
import {
  ComprehensiveHoverData,
  KanjiInfo,
  lookupComprehensive,
} from '../services/kanji';
import { generateKanjiMnemonicWithGemini } from '../services/gemini';
import { Loader2, X, Pin, Lightbulb, Puzzle } from 'lucide-react';

interface InteractiveJapaneseTextProps {
  text: string;
  className?: string;
  onSentenceClick?: () => void;
  onHoverChange?: (isHovered: boolean) => void;
  apiKey?: string;
  geminiModel?: string;
}

interface SegmentToken {
  text: string;
  isPunct: boolean;
  hasKanji: boolean;
}

const segmenter = new TinySegmenter();

const PUNCT_REGEX = /([（）\(\)\[\]「」『』【】、。！？!?\s\.,:;—…]+)/;
const KANJI_REGEX = /[\u3400-\u4dbf\u4e00-\u9faf]/;

export const InteractiveJapaneseText: React.FC<InteractiveJapaneseTextProps> = React.memo(({
  text,
  className = '',
  onHoverChange,
  apiKey,
  geminiModel,
}) => {
  const [hoverData, setHoverData] = useState<ComprehensiveHoverData | null>(null);
  const [loadingToken, setLoadingToken] = useState<string | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number; placeBelow: boolean } | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [mnemonicLoadingChar, setMnemonicLoadingChar] = useState<string | null>(null);
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);

  const hoverTimerRef = useRef<any>(null);
  const leaveTimerRef = useRef<any>(null);
  const isPinnedRef = useRef(false);
  isPinnedRef.current = isPinned;

  const closePopup = useCallback(() => {
    setIsPinned(false);
    isPinnedRef.current = false;
    setHoverData(null);
    setLoadingToken(null);
    setPopupPos(null);
    setActiveToken(null);
    setMnemonicLoadingChar(null);
    setMnemonicError(null);
    onHoverChange?.(false);
  }, [onHoverChange]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (isPinnedRef.current) {
        const target = e.target as HTMLElement;
        if (!target.closest('.interactive-kanji-popup') && !target.closest('.interactive-token-btn')) {
          closePopup();
        }
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [closePopup]);

  const tokens: SegmentToken[] = React.useMemo(() => {
    if (!text) return [];
    const parts = text.split(PUNCT_REGEX).filter(Boolean);
    const result: SegmentToken[] = [];

    for (const part of parts) {
      if (PUNCT_REGEX.test(part)) {
        result.push({ text: part, isPunct: true, hasKanji: false });
      } else {
        const subTokens = segmenter.segment(part);
        for (const st of subTokens) {
          if (!st) continue;
          result.push({
            text: st,
            isPunct: false,
            hasKanji: KANJI_REGEX.test(st),
          });
        }
      }
    }
    return result;
  }, [text]);

  const calcPosition = (rect: DOMRect) => {
    const tooltipWidth = 340;
    const estimatedHeight = 290;
    const padding = 16;

    let x = rect.left + rect.width / 2;
    if (x + tooltipWidth / 2 > window.innerWidth - padding) {
      x = window.innerWidth - tooltipWidth / 2 - padding;
    }
    if (x - tooltipWidth / 2 < padding) {
      x = tooltipWidth / 2 + padding;
    }

    const placeBelow = rect.top < estimatedHeight + 40;
    const y = placeBelow ? rect.bottom + 8 : rect.top - 8;

    return { x, y, placeBelow };
  };

  const loadTokenData = async (rawWord: string, rect: DOMRect, pin: boolean) => {
    const clean = rawWord.trim();
    if (!clean) return;

    clearTimeout(hoverTimerRef.current);
    clearTimeout(leaveTimerRef.current);

    const pos = calcPosition(rect);
    setPopupPos(pos);
    setActiveToken(clean);
    setLoadingToken(clean);
    setMnemonicError(null);
    setIsPinned(pin);
    isPinnedRef.current = pin;
    onHoverChange?.(true);

    const data = await lookupComprehensive(clean);
    setLoadingToken(null);
    setHoverData(data);
  };

  const handleLoadKanjiMnemonic = async (k: KanjiInfo) => {
    const effectiveKey = apiKey || localStorage.getItem('nihongo_gemini_key') || '';
    const effectiveModel = geminiModel || localStorage.getItem('nihongo_gemini_model') || 'gemini-2.5-flash';
    setMnemonicLoadingChar(k.kanji);
    setMnemonicError(null);

    try {
      const res = await generateKanjiMnemonicWithGemini(
        effectiveKey,
        k.kanji,
        {
          wordContext: hoverData?.wordInfo?.word || activeToken || undefined,
          hanViet: k.hanViet,
          meaning: k.meaning,
          compDetail: k.compDetail,
        },
        effectiveModel
      );
      setHoverData((prev) =>
        prev
          ? {
              ...prev,
              kanjiList: prev.kanjiList.map((item) =>
                item.kanji === k.kanji
                  ? { ...item, decomposition: res.decomposition, mnemonic: res.mnemonic }
                  : item
              ),
            }
          : prev
      );
    } catch (err: any) {
      setMnemonicError(err?.message || 'Không thể tạo mẹo nhớ lúc này.');
    } finally {
      setMnemonicLoadingChar(null);
    }
  };

  const handleMouseEnter = (token: SegmentToken, e: React.MouseEvent<HTMLSpanElement>) => {
    if (token.isPunct) return;
    if (isPinnedRef.current) return;

    clearTimeout(hoverTimerRef.current);
    clearTimeout(leaveTimerRef.current);

    const rect = e.currentTarget.getBoundingClientRect();
    onHoverChange?.(true);

    hoverTimerRef.current = setTimeout(() => {
      loadTokenData(token.text, rect, false);
    }, 70);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimerRef.current);
    if (isPinnedRef.current) return;

    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      closePopup();
    }, 90);
  };

  const handlePopupMouseEnter = () => {
    clearTimeout(leaveTimerRef.current);
    onHoverChange?.(true);
  };

  const handlePopupMouseLeave = () => {
    if (isPinnedRef.current) return;
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      closePopup();
    }, 80);
  };

  const handleClickToken = (token: SegmentToken, e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (token.isPunct) return;

    if (isPinnedRef.current && activeToken === token.text.trim()) {
      closePopup();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    loadTokenData(token.text, rect, true);
  };

  return (
    <span className={`inline relative ${className}`}>
      {tokens.map((token, idx) => {
        if (token.isPunct) {
          return (
            <span key={idx} className="text-[#a0a4b0]/70 select-none">
              {token.text}
            </span>
          );
        }

        const isTokenActive = activeToken === token.text;

        return (
          <span
            key={idx}
            onClick={(e) => handleClickToken(token, e)}
            onMouseEnter={(e) => handleMouseEnter(token, e)}
            onMouseLeave={handleMouseLeave}
            className={`interactive-token-btn inline-block cursor-pointer px-1 py-0.5 rounded transition-all duration-100 ${
              isTokenActive
                ? 'bg-[#e04f3e] text-white shadow-sm ring-1 ring-white/20'
                : token.hasKanji
                ? 'text-[#f7c873] hover:text-white hover:bg-[#e04f3e]/25 border-b border-dotted border-[#e04f3e]/80'
                : 'text-white/90 hover:text-white hover:bg-white/10'
            }`}
            title="Bấm để ghim bảng tra cứu • Rê chuột để xem nhanh"
          >
            {token.text}
          </span>
        );
      })}

      {/* Floating Dictionary + Kanji Decomposition & Mnemonic Popup */}
      {popupPos && (hoverData || loadingToken) && (
        <div
          style={{
            position: 'fixed',
            left: `${popupPos.x}px`,
            top: `${popupPos.y}px`,
            transform: popupPos.placeBelow
              ? 'translate(-50%, 0)'
              : 'translate(-50%, -100%)',
            zIndex: 999999,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
          className="interactive-kanji-popup w-[340px] max-w-[360px] bg-[#1a1b22] border border-[#3b3f4d] text-white rounded-xl shadow-2xl p-3.5 text-left pointer-events-auto font-sans text-xs"
        >
          {loadingToken && !hoverData ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-[#9ca1af]">
              <Loader2 className="w-4 h-4 animate-spin text-[#e04f3e]" />
              <span>Đang tra từ điển "{loadingToken}"...</span>
            </div>
          ) : hoverData ? (
            <div className="space-y-3">
              {/* Header: Word & Pin/Close Status */}
              <div className="border-b border-[#2b2e38] pb-2 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xl font-bold text-[#f7c873] tracking-wide">
                      {hoverData.wordInfo?.word || activeToken}
                    </span>
                    {hoverData.wordInfo?.reading && (
                      <span className="text-xs font-mono text-[#9ca1af] bg-[#23252d] px-1.5 py-0.5 rounded border border-[#323642]">
                        {hoverData.wordInfo.reading}
                      </span>
                    )}
                  </div>

                  {hoverData.wordInfo?.meanings?.[0] ? (
                    <div className="text-xs text-[#f3f2ef] font-medium leading-snug mt-1.5">
                      {hoverData.wordInfo.meanings[0].kind && (
                        <span className="text-[10px] text-[#e04f3e] mr-1 font-semibold uppercase">
                          ({hoverData.wordInfo.meanings[0].kind})
                        </span>
                      )}
                      {hoverData.wordInfo.meanings[0].mean}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#8b909e] italic mt-1">
                      (Nghĩa từ ghép đang được suy luận qua các chữ Hán bên dưới)
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isPinned ? (
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#e04f3e]/20 text-[#f7c873] border border-[#e04f3e]/40 flex items-center gap-1">
                        <Pin className="w-2.5 h-2.5" /> Đã ghim
                      </span>
                      <button
                        onClick={closePopup}
                        className="p-1 rounded hover:bg-[#2c2f38] text-[#8b909e] hover:text-white transition-colors"
                        title="Đóng (Bỏ ghim)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-[#8b909e] flex items-center gap-1 italic">
                      <Pin className="w-2.5 h-2.5 text-[#e04f3e]" /> Bấm để ghim
                    </span>
                  )}
                </div>
              </div>

              {hoverData.wordInfo?.meanings && hoverData.wordInfo.meanings.length > 1 && (
                <div className="space-y-1 max-h-20 overflow-y-auto text-[11px] text-[#b0b4c2] pr-1 bg-[#15161b] p-1.5 rounded-lg border border-[#252730]">
                  {hoverData.wordInfo.meanings.slice(1, 3).map((m, mIdx) => (
                    <div key={mIdx} className="leading-snug">
                      <span className="text-[#8b909e] font-semibold">{mIdx + 2}. </span>
                      {m.mean}
                    </div>
                  ))}
                </div>
              )}

              {/* Individual Kanji Breakdown with Radical Decomposition & 1-line Mnemonic */}
              {hoverData.kanjiList.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-[#2b2e38]">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#e04f3e] uppercase tracking-wider">
                    <span>Từng chữ Hán ({hoverData.kanjiList.length})</span>
                    <span className="text-[9px] text-[#8b909e] lowercase font-normal">
                      Chiết tự bộ thủ & Mẹo nhớ
                    </span>
                  </div>

                  {mnemonicError && (
                    <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-2 py-1">
                      {mnemonicError}
                    </div>
                  )}

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {hoverData.kanjiList.map((k, kIdx) => {
                      const freeRadicals = (k.compDetail || [])
                        .map((c) => `${c.w}${c.h ? ` (${c.h})` : ''}`)
                        .join(' + ');

                      return (
                        <div
                          key={kIdx}
                          className="p-2 rounded-lg bg-[#22242c] border border-[#2f323e] space-y-1.5"
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="min-w-10 min-h-10 w-auto px-1 py-0.5 rounded-md bg-[#17181e] flex flex-col items-center justify-center shrink-0 border border-[#3e4352] shadow-inner overflow-hidden">
                              <span className="text-lg font-bold font-serif text-[#f7c873] leading-tight whitespace-nowrap">
                                {k.kanji}
                              </span>
                              {k.strokes && (
                                <span className="text-[8px] text-[#8b909e] leading-none mt-0.5 whitespace-nowrap">
                                  {k.strokes} nét
                                </span>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[#e04f3e] tracking-wide">
                                  {k.hanViet}
                                </span>
                                {k.jlpt && (
                                  <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-[#4e6ef2]/20 text-[#7a9dff] border border-[#4e6ef2]/30">
                                    {k.jlpt}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#dcdfe6] leading-snug mt-0.5 line-clamp-2">
                                {k.meaning}
                              </div>
                              <div className="text-[10px] text-[#8b909e] flex flex-wrap gap-2 mt-0.5">
                                {k.on && <span><b className="text-[#a0a4b0]">On:</b> {k.on}</span>}
                                {k.kun && <span><b className="text-[#a0a4b0]">Kun:</b> {k.kun}</span>}
                              </div>
                            </div>
                          </div>

                          {/* Radical Breakdown + 1-line Mnemonic */}
                          {(k.decomposition || freeRadicals) && (
                            <div className="text-[10px] text-[#b8bdd0] bg-[#16171e] px-2 py-1 rounded border border-[#2a2d39] flex items-start gap-1.5">
                              <Puzzle className="w-3 h-3 text-[#e04f3e] shrink-0 mt-0.5" />
                              <span>
                                <b className="text-[#f7c873]">Chiết tự:</b>{' '}
                                {k.decomposition || freeRadicals}
                              </span>
                            </div>
                          )}

                          {k.mnemonic ? (
                            <div className="text-[10.5px] text-emerald-200 bg-emerald-950/35 px-2 py-1 rounded border border-emerald-800/40 flex items-start gap-1.5 leading-snug">
                              <Lightbulb className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{k.mnemonic}</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleLoadKanjiMnemonic(k)}
                              disabled={mnemonicLoadingChar === k.kanji}
                              className="w-full py-1 px-2 rounded bg-[#181920] hover:bg-[#2a2d3a] border border-[#323646] text-[10px] text-[#f7c873] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                              {mnemonicLoadingChar === k.kanji ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Đang tạo mẹo nhớ...
                                </>
                              ) : (
                                <>
                                  <Lightbulb className="w-3 h-3 text-emerald-400" />
                                  Chạm để xem mẹo nhớ nhanh 1 dòng
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!hoverData.wordInfo && hoverData.kanjiList.length === 0 && (
                <div className="text-xs text-[#8b909e] text-center py-2">
                  Không tìm thấy từ này trong từ điển.
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </span>
  );
});
