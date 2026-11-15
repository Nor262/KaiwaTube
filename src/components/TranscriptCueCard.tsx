import React from 'react';
import { Link as LinkIcon, Sparkles, Trash2 } from 'lucide-react';
import { SubtitleCue } from '../types';
import { InteractiveJapaneseText } from './InteractiveJapaneseText';

interface TranscriptCueCardProps {
  cue: SubtitleCue;
  cueIdx: number;
  isActive: boolean;
  editMode: boolean;
  canMergeBelow: boolean;
  apiKey: string;
  geminiModel: string;
  onWordHoverChange: (hovered: boolean) => void;
  onJumpToCue: (cue: SubtitleCue) => void;
  onAnalyzeCue: (cue: SubtitleCue) => void;
  onMergeBelow: (idx: number) => void;
  onDeleteLine: (idx: number) => void;
  onUpdateField: (idx: number, field: 'ja' | 'vi', val: string) => void;
}

export const TranscriptCueCard: React.FC<TranscriptCueCardProps> = React.memo(
  ({
    cue,
    cueIdx,
    isActive,
    editMode,
    canMergeBelow,
    apiKey,
    geminiModel,
    onWordHoverChange,
    onJumpToCue,
    onAnalyzeCue,
    onMergeBelow,
    onDeleteLine,
    onUpdateField,
  }) => {
    const m = Math.floor(cue.start / 60);
    const s = Math.floor(cue.start % 60);
    const timeLabel = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    return (
      <div
        id={`cue-${cue.id}`}
        onClick={() => {
          if (!editMode) onJumpToCue(cue);
        }}
        // No CSS transition here so the red border and "Đang phát" switch atomically in the exact same frame
        className={`p-3 rounded-xl border ${editMode ? '' : 'cursor-pointer'} ${
          isActive
            ? 'bg-[#222530] border-[#e04f3e] ring-1 ring-[#e04f3e]/40 shadow-md'
            : 'bg-[#1c1e24] border-transparent hover:border-[#2e313d] hover:bg-[#20222a]'
        }`}
        title={
          editMode
            ? 'Đang bật sửa nhanh câu thoại'
            : 'Bấm vào khung này để tua video đến câu thoại'
        }
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onJumpToCue(cue);
                  }}
                  className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#15161b] text-[#8b909e] border border-[#2b2e38] cursor-pointer hover:text-white"
                >
                  {timeLabel}
                </span>
                {isActive && (
                  <span className="text-[10px] text-[#e04f3e] font-semibold">
                    • Đang phát
                  </span>
                )}
              </div>

              {editMode && (
                <div className="flex items-center gap-1">
                  {canMergeBelow && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMergeBelow(cueIdx);
                      }}
                      className="px-1.5 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#383c4e] text-[10px] text-[#f7c873] flex items-center gap-1"
                      title="Gộp câu này với câu tiếp theo"
                    >
                      <LinkIcon className="w-2.5 h-2.5" />
                      Gộp dưới
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteLine(cueIdx);
                    }}
                    className="p-1 rounded hover:bg-red-900/50 text-[#8b909e] hover:text-red-300"
                    title="Xóa dòng này"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {editMode ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={cue.ja}
                  onChange={(e) => onUpdateField(cueIdx, 'ja', e.target.value)}
                  className="w-full bg-[#121316] border border-[#323646] rounded-lg px-2.5 py-1 text-xs font-semibold text-white focus:outline-none focus:border-[#e04f3e]"
                />
                <input
                  type="text"
                  value={cue.vi || ''}
                  onChange={(e) => onUpdateField(cueIdx, 'vi', e.target.value)}
                  placeholder="Nghĩa tiếng Việt..."
                  className="w-full bg-[#121316] border border-[#2a2d39] rounded-lg px-2.5 py-1 text-xs text-[#b8bdd0] focus:outline-none focus:border-[#e04f3e]"
                />
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold text-white leading-relaxed">
                  <InteractiveJapaneseText
                    text={cue.ja}
                    apiKey={apiKey}
                    geminiModel={geminiModel}
                    onHoverChange={onWordHoverChange}
                  />
                </div>

                {cue.vi && (
                  <div className="text-xs text-[#9ca1af] mt-1 leading-normal">
                    {cue.vi}
                  </div>
                )}
              </>
            )}
          </div>

          {!editMode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAnalyzeCue(cue);
              }}
              title="AI Giải thích ngữ pháp & bộ thủ câu này"
              className="p-1 rounded hover:bg-[#2c2f38] text-[#8b909e] hover:text-[#f7c873] shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#e04f3e]" />
            </button>
          )}
        </div>
      </div>
    );
  }
);
