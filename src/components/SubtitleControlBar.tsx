import React, { useState } from 'react';
import {
  Sparkles,
  Crown,
  Trash2,
  Flag,
  Loader2,
  Pencil,
  Lock,
  Check,
  Save,
} from 'lucide-react';
import {
  ActiveSubtitleSourceKind,
  SavedSubtitleTrack,
  User,
} from '../types';

interface SubtitleControlBarProps {
  currentUser: User | null;
  activeSourceKind: ActiveSubtitleSourceKind;
  activeTrackId: number | null;
  hasRawYouTubeSub: boolean;
  communityTracks: SavedSubtitleTrack[];
  personalTracks: SavedSubtitleTrack[];
  sessionTrackTitle: string | null;
  aiMergingStatus: string | null;
  editMode: boolean;
  hasUnsavedEdits: boolean;
  onSelectYouTubeCC: () => void;
  onSelectCommunityTrack: (track: SavedSubtitleTrack) => void;
  onSelectPersonalTrack: (track: SavedSubtitleTrack) => void;
  onSelectSessionTrack: () => void;
  onRunAiMerge: () => void;
  onPublishCommunity: (title: string) => Promise<void>;
  onDeleteCommunityTrack: (trackId: number) => Promise<void>;
  onDeletePersonalTrack: (trackId: number) => Promise<void>;
  onReportCommunityTrack: (trackId: number, reason: string) => Promise<void>;
  onToggleEditMode: () => void;
  onSaveEdits: () => Promise<void>;
}

export const SubtitleControlBar: React.FC<SubtitleControlBarProps> = ({
  currentUser,
  activeSourceKind,
  activeTrackId,
  hasRawYouTubeSub,
  communityTracks,
  personalTracks,
  sessionTrackTitle,
  aiMergingStatus,
  editMode,
  hasUnsavedEdits,
  onSelectYouTubeCC,
  onSelectCommunityTrack,
  onSelectPersonalTrack,
  onSelectSessionTrack,
  onRunAiMerge,
  onPublishCommunity,
  onDeleteCommunityTrack,
  onDeletePersonalTrack,
  onReportCommunityTrack,
  onToggleEditMode,
  onSaveEdits,
}) => {
  const [showPublishBox, setShowPublishBox] = useState(false);
  const [publishTitle, setPublishTitle] = useState('AI Gộp câu chuẩn ngữ pháp');
  const [publishing, setPublishing] = useState(false);

  const [showReportBox, setShowReportBox] = useState(false);
  const [reportReason, setReportReason] = useState('Lệch thời gian hoặc ghép sai câu');
  const [reportDone, setReportDone] = useState(false);

  const canPublish = Boolean(
    currentUser && (currentUser.role === 'admin' || currentUser.role === 'contributor')
  );

  const selectedValue =
    activeSourceKind === 'youtube_cc'
      ? 'youtube_cc'
      : activeSourceKind === 'community' && activeTrackId
      ? `community:${activeTrackId}`
      : activeSourceKind === 'user_saved' && activeTrackId
      ? `personal:${activeTrackId}`
      : 'session';

  const activeCommunityTrack =
    activeSourceKind === 'community'
      ? communityTracks.find((t) => t.id === activeTrackId) || null
      : null;

  const activePersonalTrack =
    activeSourceKind === 'user_saved'
      ? personalTracks.find((t) => t.id === activeTrackId) || null
      : null;

  const canDeleteActiveCommunity = Boolean(
    activeCommunityTrack &&
      currentUser &&
      (currentUser.role === 'admin' ||
        (currentUser.role === 'contributor' &&
          activeCommunityTrack.authorId === currentUser.id))
  );

  const canPublishCurrent =
    canPublish &&
    (activeSourceKind === 'session_ai' ||
      activeSourceKind === 'session_upload' ||
      activeSourceKind === 'user_saved');

  const handleSelectChange = (val: string) => {
    setShowPublishBox(false);
    setShowReportBox(false);
    setReportDone(false);

    if (val === 'youtube_cc') {
      onSelectYouTubeCC();
    } else if (val.startsWith('community:')) {
      const id = Number(val.split(':')[1]);
      const tr = communityTracks.find((t) => t.id === id);
      if (tr) onSelectCommunityTrack(tr);
    } else if (val.startsWith('personal:')) {
      const id = Number(val.split(':')[1]);
      const tr = personalTracks.find((t) => t.id === id);
      if (tr) onSelectPersonalTrack(tr);
    } else if (val === 'session') {
      onSelectSessionTrack();
    }
  };

  return (
    <div className="p-2.5 border-b border-[#262830] bg-[#14151a] space-y-2 shrink-0">
      {/* Row 1: Track Switcher Dropdown */}
      <div className="flex items-center gap-2">
        <select
          aria-label="Chọn nguồn phụ đề"
          value={selectedValue}
          onChange={(e) => handleSelectChange(e.target.value)}
          className="flex-1 min-w-0 bg-[#1b1d24] border border-[#313544] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
        >
          <option value="youtube_cc">
            📄 Sub gốc YouTube CC (Mặc định{hasRawYouTubeSub ? '' : ' - trống'})
          </option>

          {communityTracks.length > 0 && (
            <optgroup label="👑 Sub Cộng đồng (Admin / CTV duyệt)">
              {communityTracks.map((t) => (
                <option key={`c-${t.id}`} value={`community:${t.id}`}>
                  👑 {t.title} • {t.authorName} ({t.cueCount} câu)
                </option>
              ))}
            </optgroup>
          )}

          {personalTracks.length > 0 && (
            <optgroup label="💾 Sub cá nhân đã lưu của tôi">
              {personalTracks.map((t) => (
                <option key={`p-${t.id}`} value={`personal:${t.id}`}>
                  {t.sourceType === 'ai_merged' ? '🤖' : '📁'} {t.title} ({t.cueCount} câu)
                </option>
              ))}
            </optgroup>
          )}

          {sessionTrackTitle &&
            (activeSourceKind === 'session_ai' || activeSourceKind === 'session_upload') && (
              <option value="session">✨ {sessionTrackTitle} (Phiên hiện tại)</option>
            )}
        </select>

        {/* AI Merge Button */}
        <button
          type="button"
          onClick={onRunAiMerge}
          disabled={Boolean(aiMergingStatus)}
          className="px-2.5 py-1.5 rounded-lg bg-[#e04f3e] hover:bg-[#c94333] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
          title="Dùng Gemini AI gộp các mảnh YouTube CC thành câu hoàn chỉnh + dịch mượt toàn tập"
        >
          {aiMergingStatus ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          AI Gộp câu
        </button>
      </div>

      {/* Live AI Progress Status */}
      {aiMergingStatus && (
        <div className="text-[11px] text-[#f7c873] bg-[#201f1b] border border-[#f7c873]/30 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#e04f3e]" />
          <span>{aiMergingStatus}</span>
        </div>
      )}

      {/* Row 2: Contextual Actions (Publish Community / Save Personal / Edit / Delete / Report) */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeSourceKind !== 'youtube_cc' && (
            <button
              type="button"
              onClick={onToggleEditMode}
              className={`px-2 py-1 rounded-md border flex items-center gap-1 transition-colors ${
                editMode
                  ? 'bg-[#e04f3e]/20 border-[#e04f3e] text-[#f7c873]'
                  : 'bg-[#1d1f27] border-[#2e3240] text-[#b4b9c8] hover:text-white'
              }`}
              title="Bật chế độ chỉnh sửa trực tiếp câu thoại hoặc gộp 2 câu liền kề"
            >
              <Pencil className="w-3 h-3" />
              {editMode ? 'Đang bật Sửa câu' : 'Sửa / Gộp nhanh'}
            </button>
          )}

          {hasUnsavedEdits && (
            <button
              type="button"
              onClick={() => void onSaveEdits()}
              className="px-2 py-1 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white font-semibold flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              Lưu chỉnh sửa
            </button>
          )}

          {canPublishCurrent && (
            <button
              type="button"
              onClick={() => {
                setPublishTitle(
                  activeSourceKind === 'session_upload' ||
                    activePersonalTrack?.sourceType === 'uploaded'
                    ? 'Phụ đề .SRT/.VTT chuẩn'
                    : 'AI Gộp câu hoàn chỉnh'
                );
                setShowPublishBox((v) => !v);
              }}
              className="px-2 py-1 rounded-md bg-[#f7c873]/15 hover:bg-[#f7c873]/25 border border-[#f7c873]/40 text-[#f7c873] font-semibold flex items-center gap-1"
            >
              <Crown className="w-3 h-3" />
              Công khai Cộng đồng
            </button>
          )}

          {!canPublish &&
            (activeSourceKind === 'user_saved' ||
              activeSourceKind === 'session_ai' ||
              activeSourceKind === 'session_upload') && (
              <span className="text-[10.5px] text-[#8b909e] flex items-center gap-1">
                <Lock className="w-3 h-3 text-[#7a7f8c]" />
                {currentUser
                  ? 'Chỉ lưu tài khoản cá nhân'
                  : 'Đăng nhập để lưu vào tài khoản cá nhân'}
              </span>
            )}
        </div>

        {/* Right: Report / Delete active track */}
        <div className="flex items-center gap-1.5">
          {activeCommunityTrack && currentUser && (
            <button
              type="button"
              onClick={() => setShowReportBox((v) => !v)}
              className="px-2 py-1 rounded-md bg-[#1d1f27] hover:bg-amber-950/50 border border-[#2e3240] text-[#b4b9c8] hover:text-amber-300 flex items-center gap-1"
              title="Báo cáo Admin nếu bản sub cộng đồng này bị sai hoặc lệch"
            >
              {reportDone ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  Đã báo lỗi
                </>
              ) : (
                <>
                  <Flag className="w-3 h-3" />
                  Báo sai
                </>
              )}
            </button>
          )}

          {canDeleteActiveCommunity && activeCommunityTrack && (
            <button
              type="button"
              onClick={() => void onDeleteCommunityTrack(activeCommunityTrack.id)}
              className="px-2 py-1 rounded-md bg-red-950/50 hover:bg-red-900/70 border border-red-800/40 text-red-200 flex items-center gap-1"
              title="Xóa bản sub Cộng đồng này"
            >
              <Trash2 className="w-3 h-3" />
              Xóa
            </button>
          )}

          {activePersonalTrack && (
            <button
              type="button"
              onClick={() => void onDeletePersonalTrack(activePersonalTrack.id)}
              className="px-2 py-1 rounded-md bg-[#1d1f27] hover:bg-red-950/50 border border-[#2e3240] text-[#b4b9c8] hover:text-red-300 flex items-center gap-1"
              title="Xóa bản sub cá nhân này"
            >
              <Trash2 className="w-3 h-3" />
              Xóa cá nhân
            </button>
          )}
        </div>
      </div>

      {/* Inline Publish Community Form */}
      {showPublishBox && canPublishCurrent && (
        <div className="p-2 rounded-lg bg-[#1b1d24] border border-[#f7c873]/40 flex items-center gap-2">
          <input
            type="text"
            value={publishTitle}
            onChange={(e) => setPublishTitle(e.target.value)}
            placeholder="Tên bản sub cộng đồng..."
            className="flex-1 bg-[#121316] border border-[#2e3240] rounded-md px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#f7c873]"
          />
          <button
            type="button"
            disabled={publishing}
            onClick={async () => {
              setPublishing(true);
              try {
                await onPublishCommunity(publishTitle.trim() || 'Sub Cộng đồng');
                setShowPublishBox(false);
              } finally {
                setPublishing(false);
              }
            }}
            className="px-2.5 py-1 rounded-md bg-[#f7c873] text-[#121316] font-bold text-xs hover:bg-[#ffe099] disabled:opacity-50"
          >
            {publishing ? 'Đang đăng...' : 'Xác nhận đăng'}
          </button>
        </div>
      )}

      {/* Inline Report Form */}
      {showReportBox && activeCommunityTrack && (
        <div className="p-2 rounded-lg bg-[#1b1d24] border border-amber-700/40 flex items-center gap-2">
          <input
            type="text"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="Mô tả lỗi phụ đề..."
            className="flex-1 bg-[#121316] border border-[#2e3240] rounded-md px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={async () => {
              await onReportCommunityTrack(activeCommunityTrack.id, reportReason);
              setShowReportBox(false);
              setReportDone(true);
            }}
            className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs"
          >
            Gửi báo cáo
          </button>
        </div>
      )}
    </div>
  );
};
