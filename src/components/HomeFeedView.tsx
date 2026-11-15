import React, { useEffect, useState } from 'react';
import { AlertCircle, History, ListVideo, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { YouTubeSearchPlaylist, YouTubeSearchVideo } from '../types';
import { fetchHomeFeedApi } from '../services/api';
import {
  ToggleFavoritePayload,
  YouTubePlaylistCard,
  YouTubeVideoCard,
} from './YouTubeMediaCards';

export interface RecentWatchItem {
  videoId: string;
  listId?: string;
  title: string;
  author?: string;
  thumbnail: string;
  lastTime?: number;
  updatedAt: number;
}

interface HomeFeedViewProps {
  onSelectVideo: (video: YouTubeSearchVideo) => void;
  onSelectPlaylist: (playlist: YouTubeSearchPlaylist) => void;
  onOpenRecent: (item: RecentWatchItem) => void;
  recentItems: RecentWatchItem[];
  onClearRecent: () => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (payload: ToggleFavoritePayload) => void;
}

const DEFAULT_CATEGORIES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'anime', label: 'Anime học tiếng Nhật' },
  { id: 'jlpt_n5_n4', label: 'JLPT N5 – N4' },
  { id: 'jlpt_n3_n1', label: 'JLPT N3 – N1' },
  { id: 'vlog', label: 'Vlog & Đời sống Nhật' },
  { id: 'news', label: 'Tin tức & Nghe hiểu' },
  { id: 'music', label: 'Âm nhạc Nhật' },
];

export const HomeFeedView: React.FC<HomeFeedViewProps> = ({
  onSelectVideo,
  onSelectPlaylist,
  onOpenRecent,
  recentItems,
  onClearRecent,
  favoriteKeys,
  onToggleFavorite,
}) => {
  const [topic, setTopic] = useState('all');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [videos, setVideos] = useState<YouTubeSearchVideo[]>([]);
  const [playlists, setPlaylists] = useState<YouTubeSearchPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loadTopic = async (targetTopic: string) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await fetchHomeFeedApi(targetTopic);
      if (Array.isArray(data.categories) && data.categories.length > 0) {
        setCategories(data.categories);
      }
      setVideos(data.videos || []);
      setPlaylists(data.playlists || []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không tải được bảng tin YouTube.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopic(topic);
  }, [topic]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0f0f0f] overflow-y-auto">
      {/* YouTube-style Sticky Category Chips Bar */}
      <div className="sticky top-0 z-20 bg-[#0f0f0f]/95 backdrop-blur-md border-b border-white/[0.06] px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
          {categories.map((cat) => {
            const active = topic === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setTopic(cat.id)}
                data-testid={`home-chip-${cat.id}`}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#f1f1f1] text-[#0f0f0f]'
                    : 'bg-[#272727] hover:bg-[#3f3f3f] text-[#f1f1f1]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-5 space-y-8 max-w-[1680px] w-full mx-auto">
        {/* Recent watch history from real user clicks (localStorage, never fake mockdata) */}
        {recentItems.length > 0 && topic === 'all' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-[#f1f1f1] flex items-center gap-2">
                <History className="w-4 h-4 text-[#e04f3e]" />
                Tiếp tục xem gần đây
              </h2>
              <button
                onClick={onClearRecent}
                className="text-xs text-[#9ca1af] hover:text-white flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa lịch sử
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {recentItems.slice(0, 4).map((item) => (
                <button
                  key={`${item.listId || ''}-${item.videoId}`}
                  onClick={() => onOpenRecent(item)}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-[#18191e] hover:bg-[#23252d] border border-white/5 text-left transition-colors group"
                >
                  <img
                    src={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`}
                    alt={item.title}
                    className="w-24 aspect-video rounded-lg object-cover shrink-0 bg-black"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[#f1f1f1] line-clamp-2 group-hover:text-white">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[#aaaaaa] mt-1 truncate">
                      {item.author || 'YouTube'}
                      {item.lastTime && item.lastTime > 5
                        ? ` • Tiếp tục từ ${Math.floor(item.lastTime / 60)}:${String(
                            Math.floor(item.lastTime % 60)
                          ).padStart(2, '0')}`
                        : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-red-200">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => loadTopic(topic)}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs font-semibold text-white flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử lại
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-7">
            {Array.from({ length: 12 }).map((_, idx) => (
              <div key={idx} className="space-y-3 animate-pulse">
                <div className="aspect-video w-full rounded-xl bg-[#202127]" />
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#202127] shrink-0" />
                  <div className="flex-1 space-y-2 pt-0.5">
                    <div className="h-3.5 bg-[#202127] rounded w-11/12" />
                    <div className="h-3.5 bg-[#202127] rounded w-7/12" />
                    <div className="h-3 bg-[#1b1c21] rounded w-5/12" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Main YouTube Video Grid */}
            <section className="space-y-4">
              {videos.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-7">
                  {videos.map((v) => (
                    <YouTubeVideoCard
                      key={v.videoId}
                      video={v}
                      variant="grid"
                      isFavorited={favoriteKeys.has(`video:${v.videoId}`)}
                      onSelect={onSelectVideo}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-[#8a8f9e] space-y-2">
                  <Sparkles className="w-8 h-8 text-[#e04f3e] mx-auto" />
                  <p>Không có video nào trong chủ đề này. Hãy thử chủ đề khác hoặc tìm kiếm ở thanh trên!</p>
                </div>
              )}
            </section>

            {/* Real YouTube Playlists Shelf */}
            {playlists.length > 0 && (
              <section className="space-y-4 pt-4 border-t border-white/[0.06]">
                <h2 className="text-[16px] font-semibold text-[#f1f1f1] flex items-center gap-2">
                  <ListVideo className="w-5 h-5 text-[#e04f3e]" />
                  Playlist YouTube ({playlists.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-7">
                  {playlists.map((pl) => (
                    <YouTubePlaylistCard
                      key={pl.listId}
                      playlist={pl}
                      variant="grid"
                      isFavorited={favoriteKeys.has(`playlist:${pl.listId}`)}
                      onSelect={onSelectPlaylist}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
