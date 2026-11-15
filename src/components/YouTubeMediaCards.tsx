import React from 'react';
import { Heart, ListVideo, Play } from 'lucide-react';
import { FavoriteItemType, YouTubeSearchPlaylist, YouTubeSearchVideo } from '../types';

export interface ToggleFavoritePayload {
  itemType: FavoriteItemType;
  itemId: string;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  meta?: Record<string, any>;
}

export function formatViewsCompact(views?: number): string {
  if (!views || views <= 0) return '';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, '')}M lượt xem`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K lượt xem`;
  return `${views} lượt xem`;
}

const AVATAR_TONES = [
  'bg-red-600/80 text-white',
  'bg-orange-600/80 text-white',
  'bg-emerald-600/80 text-white',
  'bg-sky-600/80 text-white',
  'bg-indigo-600/80 text-white',
  'bg-amber-600/80 text-white',
];

function getAvatarTone(name?: string): string {
  const s = name || 'Y';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

const handleThumbError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = '1';
  if (img.src.includes('hq720.jpg')) {
    img.src = img.src.replace('hq720.jpg', 'hqdefault.jpg');
  } else if (img.src.includes('hqdefault.jpg')) {
    img.src = img.src.replace('hqdefault.jpg', 'mqdefault.jpg');
  }
};

export const YouTubeVideoCard: React.FC<{
  video: YouTubeSearchVideo;
  variant?: 'grid' | 'row';
  isFavorited: boolean;
  onSelect: (video: YouTubeSearchVideo) => void;
  onToggleFavorite: (payload: ToggleFavoritePayload) => void;
}> = ({ video, variant = 'grid', isFavorited, onSelect, onToggleFavorite }) => {
  const metaParts = [
    formatViewsCompact(video.views),
    video.ago || '',
  ].filter(Boolean);

  const thumbUrl = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
  const authorName = video.author || 'YouTube';
  const authorLetter = authorName.trim().charAt(0).toUpperCase() || 'Y';

  const handleHeart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite({
      itemType: 'video',
      itemId: video.videoId,
      title: video.title,
      subtitle: authorName,
      thumbnail: thumbUrl,
      meta: { duration: video.duration, author: video.author },
    });
  };

  if (variant === 'row') {
    return (
      <div
        onClick={() => onSelect(video)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(video);
          }
        }}
        data-testid={`yt-video-card-${video.videoId}`}
        className="group flex flex-col sm:flex-row gap-4 rounded-xl p-2 -mx-2 hover:bg-[#1f2026] transition-colors cursor-pointer"
      >
        <div className="relative w-full sm:w-[320px] md:w-[360px] shrink-0 aspect-video rounded-xl bg-[#0d0e11] overflow-hidden">
          <img
            src={thumbUrl}
            alt={video.title}
            onError={handleThumbError}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
          {video.duration && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/85 text-[11px] font-semibold text-white">
              {video.duration}
            </span>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity w-11 h-11 rounded-full bg-black/75 flex items-center justify-center text-white shadow-lg">
              <Play className="w-5 h-5 fill-white ml-0.5" />
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 py-0.5 flex flex-col justify-between gap-2">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-medium text-[#f1f1f1] line-clamp-2 leading-snug group-hover:text-white">
                {video.title}
              </h3>
              <button
                type="button"
                onClick={handleHeart}
                title={isFavorited ? 'Bỏ yêu thích' : 'Lưu vào Yêu thích'}
                className={`shrink-0 p-1.5 rounded-full transition-colors ${
                  isFavorited
                    ? 'bg-[#e04f3e] text-white'
                    : 'bg-[#262832] text-[#a0a5b5] hover:text-white hover:bg-[#343746]'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorited ? 'fill-white' : ''}`} />
              </button>
            </div>

            {metaParts.length > 0 && (
              <div className="text-xs text-[#aaaaaa]">{metaParts.join(' • ')}</div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${getAvatarTone(
                  authorName
                )}`}
              >
                {authorLetter}
              </div>
              <span className="text-xs text-[#aaaaaa] truncate">{authorName}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#272727] group-hover:bg-[#e04f3e] text-[11px] font-semibold text-[#e6e6e6] group-hover:text-white transition-colors">
              <Play className="w-3 h-3 fill-current" />
              Xem & Học phụ đề
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(video)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(video);
        }
      }}
      data-testid={`yt-video-card-${video.videoId}`}
      className="group flex flex-col gap-2.5 cursor-pointer"
    >
      <div className="relative aspect-video w-full rounded-xl bg-[#18191e] overflow-hidden">
        <img
          src={thumbUrl}
          alt={video.title}
          onError={handleThumbError}
          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
        />
        {video.duration && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/85 text-[11px] font-semibold text-white">
            {video.duration}
          </span>
        )}
        <button
          type="button"
          onClick={handleHeart}
          title={isFavorited ? 'Bỏ yêu thích' : 'Lưu vào Yêu thích'}
          className={`absolute top-2 right-2 p-1.5 rounded-full transition-all ${
            isFavorited
              ? 'bg-[#e04f3e] text-white opacity-100'
              : 'bg-black/70 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-[#e04f3e] hover:text-white'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`} />
        </button>
      </div>

      <div className="flex gap-3 items-start px-0.5">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${getAvatarTone(
            authorName
          )}`}
        >
          {authorLetter}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-medium text-[#f1f1f1] line-clamp-2 leading-[1.35] group-hover:text-white">
            {video.title}
          </h3>
          <div className="text-[12px] text-[#aaaaaa] mt-1 truncate">{authorName}</div>
          {metaParts.length > 0 && (
            <div className="text-[12px] text-[#aaaaaa] truncate">{metaParts.join(' • ')}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export const YouTubePlaylistCard: React.FC<{
  playlist: YouTubeSearchPlaylist;
  variant?: 'grid' | 'row';
  isFavorited: boolean;
  onSelect: (playlist: YouTubeSearchPlaylist) => void;
  onToggleFavorite: (payload: ToggleFavoritePayload) => void;
}> = ({ playlist, variant = 'grid', isFavorited, onSelect, onToggleFavorite }) => {
  const thumbUrl = playlist.thumbnail || '';
  const authorName = playlist.author || 'YouTube Playlist';

  const handleHeart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite({
      itemType: 'playlist',
      itemId: playlist.listId,
      title: playlist.title,
      subtitle: `${playlist.videoCount || '?'} video • ${authorName}`,
      thumbnail: thumbUrl,
      meta: { videoCount: playlist.videoCount, author: playlist.author },
    });
  };

  if (variant === 'row') {
    return (
      <div
        onClick={() => onSelect(playlist)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(playlist);
          }
        }}
        data-testid={`yt-playlist-card-${playlist.listId}`}
        className="group flex flex-col sm:flex-row gap-4 rounded-xl p-2 -mx-2 hover:bg-[#1f2026] transition-colors cursor-pointer"
      >
        <div className="relative w-full sm:w-[320px] md:w-[360px] shrink-0 pt-2">
          <div className="absolute top-0 inset-x-3 h-3 rounded-t-xl bg-[#343642] border-t border-white/10" />
          <div className="absolute top-1 inset-x-1.5 h-3 rounded-t-xl bg-[#272932] border-t border-white/10" />
          <div className="relative aspect-video rounded-xl bg-[#0d0e11] overflow-hidden">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={playlist.title}
                onError={handleThumbError}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#555b6e]">
                <ListVideo className="w-10 h-10" />
              </div>
            )}
            <div className="absolute inset-y-0 right-0 w-24 bg-black/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-1">
              <span className="text-sm font-bold">{playlist.videoCount || '∞'}</span>
              <ListVideo className="w-5 h-5" />
              <span className="text-[10px] text-white/80">Danh sách phát</span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 py-1 flex flex-col justify-between gap-2">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-[#f1f1f1] line-clamp-2 leading-snug group-hover:text-white">
                {playlist.title}
              </h3>
              <button
                type="button"
                onClick={handleHeart}
                title={isFavorited ? 'Bỏ lưu' : 'Lưu Playlist'}
                className={`shrink-0 p-1.5 rounded-full transition-colors ${
                  isFavorited
                    ? 'bg-[#e04f3e] text-white'
                    : 'bg-[#262832] text-[#a0a5b5] hover:text-white hover:bg-[#343746]'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorited ? 'fill-white' : ''}`} />
              </button>
            </div>

            <div className="text-xs text-[#aaaaaa]">{authorName}</div>
            <div className="text-xs text-[#aaaaaa]">
              Xem toàn bộ danh sách phát ({playlist.videoCount || 'Nhiều'} video)
            </div>
          </div>

          <div className="pt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e04f3e]/15 text-[#ff8678] group-hover:bg-[#e04f3e] group-hover:text-white text-[11px] font-semibold transition-colors">
              <Play className="w-3 h-3 fill-current" />
              Mở toàn bộ Playlist
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(playlist)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(playlist);
        }
      }}
      data-testid={`yt-playlist-card-${playlist.listId}`}
      className="group flex flex-col gap-2 cursor-pointer"
    >
      <div className="relative pt-2">
        <div className="absolute top-0 inset-x-3 h-3 rounded-t-xl bg-[#343642] border-t border-white/10" />
        <div className="absolute top-1 inset-x-1.5 h-3 rounded-t-xl bg-[#272932] border-t border-white/10" />
        <div className="relative aspect-video rounded-xl bg-[#18191e] overflow-hidden">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={playlist.title}
              onError={handleThumbError}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#555b6e]">
              <ListVideo className="w-10 h-10" />
            </div>
          )}
          <div className="absolute inset-y-0 right-0 w-20 bg-black/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-1">
            <ListVideo className="w-4 h-4 text-white" />
            <span className="text-[11px] font-bold">{playlist.videoCount || ''} video</span>
          </div>
          <button
            type="button"
            onClick={handleHeart}
            title={isFavorited ? 'Bỏ lưu' : 'Lưu Playlist'}
            className={`absolute top-2 left-2 p-1.5 rounded-full transition-all ${
              isFavorited
                ? 'bg-[#e04f3e] text-white opacity-100'
                : 'bg-black/70 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-[#e04f3e] hover:text-white'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`} />
          </button>
        </div>
      </div>

      <div className="px-0.5">
        <h3 className="text-[14px] font-medium text-[#f1f1f1] line-clamp-2 leading-[1.35] group-hover:text-white">
          {playlist.title}
        </h3>
        <div className="text-[12px] text-[#aaaaaa] mt-1 truncate">{authorName}</div>
        <div className="text-[12px] text-[#aaaaaa]">Xem danh sách phát đầy đủ</div>
      </div>
    </div>
  );
};
