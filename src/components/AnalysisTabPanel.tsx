import React, { useState } from 'react';
import {
  GraduationCap,
  Sparkles,
  Loader2,
  AlertCircle,
  EyeOff,
  GitFork,
  Layers,
  Puzzle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import { JapaneseAnalysisResult } from '../types';
import { InteractiveJapaneseText } from './InteractiveJapaneseText';

interface AnalysisTabPanelProps {
  geminiModel: string;
  apiKey: string;
  analyzing: boolean;
  analysisError: string | null;
  analysis: JapaneseAnalysisResult | null;
  onOpenSettings: () => void;
  onRetry?: () => void;
}

export const AnalysisTabPanel: React.FC<AnalysisTabPanelProps> = ({
  geminiModel,
  apiKey,
  analyzing,
  analysisError,
  analysis,
  onOpenSettings,
  onRetry,
}) => {
  const [collapsedKanji, setCollapsedKanji] = useState<Record<string, boolean>>({});

  const toggleKanjiExpand = (kanji: string) => {
    setCollapsedKanji((prev) => ({ ...prev, [kanji]: !prev[kanji] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-[#262830]">
        <div className="flex items-center gap-1.5">
          <GraduationCap className="w-4 h-4 text-[#e04f3e]" />
          <span className="text-xs text-white uppercase font-bold tracking-wider">
            Phân tích ngữ pháp & bộ thủ
          </span>
        </div>
        <button
          onClick={onOpenSettings}
          className="text-[10px] text-[#a0a4b0] hover:text-white bg-[#22242c] hover:bg-[#2c2f38] px-2 py-0.5 rounded-lg border border-[#323642] flex items-center gap-1.5 transition-colors"
          title="Bấm để đổi model Gemini trong Cài đặt"
        >
          <Sparkles className="w-3 h-3 text-[#e04f3e]" />
          <span className="font-mono">{geminiModel}</span>
        </button>
      </div>

      {analyzing ? (
        <div className="flex flex-col items-center justify-center py-16 text-xs text-[#9ca1af] gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#e04f3e]" />
          <span className="font-medium text-center">
            Gemini đang phân tích chi tiết ngữ pháp, chia thể, chiết tự bộ thủ & mẹo nhớ Kanji...
          </span>
        </div>
      ) : analysisError ? (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-xs text-red-200 space-y-2">
          <div className="font-bold flex items-center gap-1.5 text-red-400">
            <AlertCircle className="w-4 h-4" />
            Chưa thể hoàn tất phân tích
          </div>
          <div>{analysisError}</div>
          <div className="pt-1 flex flex-wrap items-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-3 py-1.5 rounded-lg bg-[#272a34] text-white text-xs font-semibold hover:bg-[#343845] border border-[#3e4252] flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Thử phân tích lại
              </button>
            )}
            <button
              onClick={onOpenSettings}
              className="px-3 py-1.5 rounded-lg bg-[#e04f3e] text-white text-xs font-semibold hover:bg-[#c94333]"
            >
              Mở Cài đặt API Key
            </button>
          </div>
        </div>
      ) : analysis ? (
        <div className="space-y-4">
          {/* Sentence Overview Card */}
          <div className="p-3.5 rounded-2xl bg-[#1c1e26] border border-[#2e323f] space-y-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-[#a0a4b2]">{analysis.reading}</span>
              {analysis.jlptLevel && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#e04f3e]/20 text-[#f7c873] border border-[#e04f3e]/30">
                  {analysis.jlptLevel}
                </span>
              )}
            </div>

            <div className="text-lg font-bold text-[#f7c873] leading-snug">
              <InteractiveJapaneseText
                text={analysis.text}
                apiKey={apiKey}
                geminiModel={geminiModel}
              />
            </div>

            <div className="pt-1.5 border-t border-[#282a35] text-sm font-medium text-white">
              {analysis.translation}
            </div>

            {analysis.ellipsis && analysis.ellipsis.trim() !== '' && (
              <div className="pt-2 border-t border-[#282a35] flex items-start gap-2 text-xs text-[#b0b4c3] bg-[#15161d] p-2.5 rounded-xl border border-[#272a36]">
                <EyeOff className="w-4 h-4 text-[#f7c873] shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold text-[#f7c873] mr-1">Thành phần tỉnh lược:</span>
                  {analysis.ellipsis}
                </div>
              </div>
            )}
          </div>

          {/* 1. Conjugations & Morphology */}
          {analysis.conjugations && analysis.conjugations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#f7c873]">
                <GitFork className="w-4 h-4 text-[#e04f3e]" />
                <span>Biến đổi & Cách chia từ ({analysis.conjugations.length})</span>
              </div>

              <div className="space-y-2">
                {analysis.conjugations.map((conj, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-[#1c1e26] border border-[#2d313e] space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-bold text-[#f7c873]">
                        {conj.surface}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#4e6ef2]/20 text-[#8cb0ff] border border-[#4e6ef2]/30">
                        {conj.formName}
                      </span>
                    </div>

                    <div className="text-xs text-[#dcdfe8] flex items-center gap-1.5 flex-wrap">
                      <span className="text-[#8b909e]">Từ gốc:</span>
                      <span className="font-semibold text-white bg-[#14161d] px-2 py-0.5 rounded border border-[#2a2d39]">
                        {conj.baseForm}
                      </span>
                    </div>

                    {conj.chain && (
                      <div className="text-xs font-mono text-[#a0e46b] bg-[#12141a] px-2.5 py-1.5 rounded-lg border border-[#222736] flex items-center gap-1.5 flex-wrap">
                        <span className="text-[#8b909e] font-sans text-[10px] uppercase font-bold tracking-wider">
                          Chuỗi chia:
                        </span>
                        <span className="font-semibold">{conj.chain}</span>
                      </div>
                    )}

                    <div className="text-xs text-[#c0c4d2] leading-relaxed pt-1.5 border-t border-[#262832]">
                      <span className="font-bold text-[#e04f3e] mr-1">
                        Tại sao chia như vậy:
                      </span>
                      {conj.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Grammar Points & Particles */}
          {analysis.grammarPoints?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#f7c873]">
                <GraduationCap className="w-4 h-4 text-[#e04f3e]" />
                <span>Cấu trúc ngữ pháp & Trợ từ ({analysis.grammarPoints.length})</span>
              </div>

              <div className="space-y-2">
                {analysis.grammarPoints.map((g, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-[#1c1e26] border border-[#2d313e] space-y-1.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[#f7c873]">{g.pattern}</span>
                      {g.jlpt && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#282a36] text-[#8b909e] border border-[#353948]">
                          {g.jlpt}
                        </span>
                      )}
                    </div>

                    {g.formula && (
                      <div className="text-xs font-mono text-[#8cb0ff] bg-[#14161d] px-2.5 py-1 rounded-lg border border-[#252836]">
                        <span className="text-[#8b909e] font-sans mr-1">Công thức:</span>
                        {g.formula}
                      </div>
                    )}

                    <div className="text-xs font-semibold text-white">{g.meaning}</div>
                    <div className="text-xs text-[#c0c4d2] leading-relaxed">{g.explanation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Kanji & Radicals + 1-line Mnemonic */}
          {analysis.kanjiList?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#f7c873]">
                <Layers className="w-4 h-4 text-[#e04f3e]" />
                <span>Chữ Hán, Chiết tự & Mẹo nhớ ({analysis.kanjiList.length})</span>
              </div>

              <div className="space-y-2.5">
                {analysis.kanjiList.map((k, i) => {
                  const isCollapsed = collapsedKanji[`${k.kanji}-${i}`] === true;
                  const kanjiText = String(k.kanji || '').trim();
                  const kanjiCount = Array.from(kanjiText).length;
                  const glyphClass =
                    kanjiCount <= 1 ? 'text-[22px]' : kanjiCount === 2 ? 'text-base' : 'text-xs';
                  return (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-[#1c1e26] border border-[#2d313e] space-y-2 shadow-sm"
                    >
                      <div
                        onClick={() => toggleKanjiExpand(`${k.kanji}-${i}`)}
                        className="flex items-start gap-3 cursor-pointer select-none"
                        title="Chạm để thu gọn / mở rộng chiết tự & mẹo nhớ"
                      >
                        <div className="min-w-12 min-h-12 w-auto max-w-[92px] px-1.5 py-1 rounded-xl bg-[#15161b] flex flex-col items-center justify-center shrink-0 border border-[#3b3f4f] shadow-inner overflow-hidden">
                          <span
                            className={`${glyphClass} font-bold font-serif text-[#f7c873] leading-tight whitespace-nowrap`}
                          >
                            {kanjiText}
                          </span>
                          {k.strokes && (
                            <span className="text-[9px] text-[#8b909e] leading-none mt-0.5 whitespace-nowrap">
                              {k.strokes} nét
                            </span>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-[#e04f3e] tracking-wide">
                              {k.hanViet}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {k.jlpt && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#e04f3e]/15 text-[#f7c873]">
                                  {k.jlpt}
                                </span>
                              )}
                              {isCollapsed ? (
                                <ChevronDown className="w-3.5 h-3.5 text-[#8b909e]" />
                              ) : (
                                <ChevronUp className="w-3.5 h-3.5 text-[#8b909e]" />
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-[#dcdfe8] font-medium mt-0.5">
                            {k.meaning}
                          </div>
                          <div className="text-[11px] text-[#8b909e] flex flex-wrap gap-2 mt-1">
                            {(Array.isArray(k.onyomi) ? k.onyomi.length > 0 : Boolean(k.onyomi)) && (
                              <span>
                                <b className="text-[#a0a4b0]">On:</b>{' '}
                                {Array.isArray(k.onyomi) ? k.onyomi.join(', ') : k.onyomi}
                              </span>
                            )}
                            {(Array.isArray(k.kunyomi) ? k.kunyomi.length > 0 : Boolean(k.kunyomi)) && (
                              <span>
                                <b className="text-[#a0a4b0]">Kun:</b>{' '}
                                {Array.isArray(k.kunyomi) ? k.kunyomi.join(', ') : k.kunyomi}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div className="space-y-2 pt-1.5 border-t border-[#262832]">
                          {/* Radical Breakdown String */}
                          {k.decomposition && (
                            <div className="p-2 rounded-lg bg-[#15161c] border border-[#282b36] text-xs text-[#dcdfe8] flex items-start gap-2">
                              <Puzzle className="w-3.5 h-3.5 text-[#e04f3e] shrink-0 mt-0.5" />
                              <div>
                                <span className="text-[10px] uppercase text-[#f7c873] font-bold tracking-wider mr-1.5">
                                  Chiết tự:
                                </span>
                                <span>{k.decomposition}</span>
                              </div>
                            </div>
                          )}

                          {/* 1-line Mnemonic */}
                          {k.mnemonic && (
                            <div className="p-2 rounded-lg bg-emerald-950/35 border border-emerald-800/40 text-xs text-emerald-100 flex items-start gap-2 leading-relaxed">
                              <Lightbulb className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="text-[10px] uppercase text-emerald-300 font-bold tracking-wider mr-1.5">
                                  Mẹo nhớ:
                                </span>
                                <span>{k.mnemonic}</span>
                              </div>
                            </div>
                          )}

                          {/* Structured Radicals Chips */}
                          {k.radicals?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {k.radicals.map((r, ri) => (
                                <div
                                  key={ri}
                                  className="px-2 py-1 rounded-lg bg-[#15161c] border border-[#282b36] flex items-center gap-1.5 text-[11px]"
                                >
                                  <span className="font-bold font-serif text-[#f7c873]">
                                    {r.radical}
                                  </span>
                                  <span className="text-[#dcdfe8] font-medium">{r.name}</span>
                                  <span className="text-[#8b909e] text-[10px]">
                                    ({r.meaning})
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Vocabulary Breakdown (Tầng 1 - hover/click Kanji enabled) */}
          {analysis.tokens?.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#262832]">
              <div className="text-xs font-bold uppercase tracking-wider text-[#8b909e]">
                Tách từ vựng trong câu ({analysis.tokens.length}) • Chạm chữ Hán để xem chiết tự
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {analysis.tokens.map((tok, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-xl bg-[#1c1e26] border border-[#2a2d39] text-left space-y-0.5"
                  >
                    <div className="text-[10px] text-[#8b909e] font-mono">{tok.reading}</div>
                    <div className="text-xs font-bold text-white">
                      <InteractiveJapaneseText
                        text={tok.surface}
                        apiKey={apiKey}
                        geminiModel={geminiModel}
                      />
                    </div>
                    <div className="text-[10px] text-[#e04f3e] font-semibold">{tok.pos}</div>
                    <div className="text-[11px] text-[#d0d3dc] leading-tight">
                      {tok.meaning}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-[#8b909e] text-center py-16 space-y-2">
          <GraduationCap className="w-8 h-8 text-[#3b3f4f] mx-auto" />
          <div>
            Chọn một câu hoặc bấm <b>"✨ AI Giải thích"</b> để bóc tách chi tiết ngữ pháp, chiết tự bộ thủ & mẹo nhớ Kanji.
          </div>
        </div>
      )}
    </div>
  );
};
