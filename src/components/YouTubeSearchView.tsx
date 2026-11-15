import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ListVideo,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import { YouTubeSearchPlaylist, YouTubeSearchVideo } from '../types';
import { searchYouTubeApi } from '../services/api';
import {
  ToggleFavoritePayload,
  YouTubePlaylistCard,
  YouTubeVideoCard,
} from './YouTubeMediaCards';

interface YouTubeSearchViewProps {
  query: string;
  onQuerySelect: (q: string) => void;
  onSelectVideo: (video: YouTubeSearchVideo) => void;
  onSelectPlaylist: (playlist: YouTubeSearchPlaylist) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: ToggleFavoritePayload) => void;
  onBackHome: () => void;
}

const SUGGESTIONS = [
  'Nihongo no Mori N3',
  'Japanese anime with Japanese subtitles',
  'Mushoku Tensei ep 1',
  'Vlog in Japanese subtitles',
  'NHK Easy News Japanese',
  'Doraemon Japanese',
];

export const YouTubeSearchView: React.FC<YouTubeSearchViewProps> = ({
  query,
  onQuerySelect,
  onSelectVideo,
  onSelectPlaylist,
  favoriteKeys,
  onToggleFavorite,
  onBackHome,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [videos, setVideos] = useState<YouTubeSearchVideo[]>([]);
  const [playlists, setPlaylists] = useState<YouTubeSearchPlaylist[]>([]);
  const [tab, setTab] = useState<'all' | 'videos' | 'playlists'>('all');

  useEffect(() => {
    const clean = query.trim();
    if (!clean) {
      setVideos([]);
      setPlaylists([]);
      setErrorMsg('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMsg('');
    searchYouTubeApi(clean)
      .then((res) => {
        if (cancelled) return;
        setVideos(res.videos || []);
        setPlaylists(res.playlists || []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setErrorMsg(err?.message || 'Không thể tìm kiếm YouTube lúc này.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const showPlaylists =
    (tab === 'all' || tab === 'playlists') && playlists.length > 0;
  const showVideos = (tab === 'all' || tab === 'videos') && videos.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0f0f0f] overflow-y-auto">
      {/* Sticky Filter Bar (YouTube Search Results style — single search box stays in Header) */}
      <div className="sticky top-0 z-20 bg-[#0f0f0f]/95 backdrop-blur-md border-b border-white/[0.06] px-4 sm:px-6 py-3">
        <div className="max-w-[1096px] mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              onClick={onBackHome}
              className="px-3 py-1.5 rounded-lg bg-[#272727] hover:bg-[#3f3f3f] text-xs font-medium text-[#f1f1f1] flex items-center gap-1.5 transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Trang chủ
            </button>
            {(
              [
                ['all', 'Tất cả'],
                ['videos', `Video (${videos.length})`],
                ['playlists', `Danh sách phát (${playlists.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                  tab === k
                    ? 'bg-[#f1f1f1] text-[#0f0f0f]'
                    : 'bg-[#272727] hover:bg-[#3f3f3f] text-[#f1f1f1]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {query.trim() && (
            <div className="text-xs text-[#aaaaaa] truncate max-w-xs sm:max-w-md">
              Kết quả cho: <span className="text-white font-medium">"{query}"</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1096px] w-full mx-auto px-4 sm:px-6 py-5 space-y-6">
        {!query.trim() && (
          <div className="py-12 space-y-5 text-center">
            <Search className="w-10 h-10 text-[#606575] mx-auto" />
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-white">
                Tìm video & Playlist học tiếng Nhật trên YouTube
              </h2>
              <p className="text-xs text-[#aaaaaa]">
                Nhập từ khóa hoặc dán trực tiếp link YouTube vào thanh tìm kiếm ở trên đầu trang.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap max-w-2xl mx-auto">
              <Sparkles className="w-3.5 h-3.5 text-[#f7c873]" />
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onQuerySelect(s)}
                  className="px-3 py-1.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-xs text-[#f1f1f1] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-[#aaaaaa]">
            <Loader2 className="w-5 h-5 animate-spin text-[#e04f3e]" />
            <span>Đang tìm trên YouTube...</span>
          </div>
        )}

        {!loading && query.trim() && !showPlaylists && !showVideos && !errorMsg && (
          <div className="py-16 text-center text-sm text-[#8a8f9e]">
            Không tìm thấy video hay playlist nào cho "{query}". Thử từ khóa khác nhé!
          </div>
        )}

        {/* Playlists Section */}
        {!loading && showPlaylists && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[#f1f1f1] flex items-center gap-2">
              <ListVideo className="w-4 h-4 text-[#e04f3e]" />
              Playlist YouTube ({playlists.length})
            </h2>
            <div className="space-y-3">
              {playlists.map((pl) => (
                <YouTubePlaylistCard
                  key={pl.listId}
                  playlist={pl}
                  variant="row"
                  isFavorited={favoriteKeys.has(`playlist:${pl.listId}`)}
                  onSelect={onSelectPlaylist}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {/* Divider when showing both playlists & videos */}
        {!loading && showPlaylists && showVideos && (
          <div className="border-t border-white/[0.08]" />
        )}

        {/* Videos List (YouTube Search Horizontal Cards) */}
        {!loading && showVideos && (
          <section className="space-y-3">
            <div className="space-y-3">
              {videos.map((v) => (
                <YouTubeVideoCard
                  key={v.videoId}
                  video={v}
                  variant="row"
                  isFavorited={favoriteKeys.has(`video:${v.videoId}`)}
                  onSelect={onSelectVideo}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
