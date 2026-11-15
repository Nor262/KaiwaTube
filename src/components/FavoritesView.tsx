import React, { useState } from 'react';
import {
  Heart,
  Play,
  ListVideo,
  Film,
  Trash2,
  ArrowLeft,
  UserCheck,
} from 'lucide-react';
import { FavoriteItem, FavoriteItemType, User } from '../types';

interface FavoritesViewProps {
  currentUser: User | null;
  favorites: FavoriteItem[];
  onOpenFavorite: (item: FavoriteItem) => void;
  onDeleteFavorite: (itemType: FavoriteItemType, itemId: string) => void;
  onOpenAuthModal: () => void;
  onBackToPlayer: () => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  currentUser,
  favorites,
  onOpenFavorite,
  onDeleteFavorite,
  onOpenAuthModal,
  onBackToPlayer,
}) => {
  const [filter, setFilter] = useState<'all' | FavoriteItemType>('all');

  const filtered =
    filter === 'all' ? favorites : favorites.filter((f) => f.itemType === filter);

  const badgeLabel = (type: FavoriteItemType) => {
    if (type === 'playlist') return 'Playlist YouTube';
    if (type === 'anime') return 'Bộ Anime';
    return 'Video YouTube';
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0f0f0f] overflow-y-auto p-5 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToPlayer}
            className="px-3 py-1.5 rounded-xl bg-[#272727] hover:bg-[#3f3f3f] text-xs font-medium text-[#f1f1f1] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#e04f3e]" />
            Trang chủ
          </button>
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <Heart className="w-4 h-4 text-[#e04f3e] fill-[#e04f3e]" />
            Kho Yêu thích & Playlist đã lưu
          </h1>
        </div>
      </div>

      {!currentUser ? (
        <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl bg-[#17181c] border border-[#2a2d36] text-center space-y-3">
          <UserCheck className="w-10 h-10 text-[#e04f3e] mx-auto" />
          <div className="text-sm font-bold text-white">
            Đăng nhập để đồng bộ Playlist & Video yêu thích
          </div>
          <p className="text-xs text-[#9ca1af] leading-relaxed">
            Mỗi tài khoản có danh sách lưu trữ riêng gồm Video YouTube, Playlist học tiếng Nhật và các bản phụ đề AI / .SRT cá nhân.
          </p>
          <button
            onClick={onOpenAuthModal}
            className="px-5 py-2.5 rounded-xl bg-[#e04f3e] hover:bg-[#c94333] text-xs font-bold text-white"
          >
            Đăng nhập / Đăng ký ngay
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-[#252731] pb-2 flex-wrap">
            {(['all', 'playlist', 'video'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filter === t
                    ? 'bg-[#f1f1f1] text-[#0f0f0f]'
                    : 'bg-[#272727] text-[#d0d4e0] hover:bg-[#3f3f3f]'
                }`}
              >
                {t === 'all'
                  ? `Tất cả (${favorites.length})`
                  : t === 'playlist'
                  ? `Playlist (${favorites.filter((f) => f.itemType === 'playlist').length})`
                  : `Video (${favorites.filter((f) => f.itemType === 'video').length})`}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-[#8b909e]">
              Chưa có mục nào được lưu trong danh sách này. Hãy bấm biểu tượng ♥ trên video hoặc playlist để lưu lại nhé!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((item) => (
                <div
                  key={`${item.itemType}:${item.itemId}`}
                  onClick={() => onOpenFavorite(item)}
                  className="group cursor-pointer rounded-xl bg-[#17181d] border border-[#262934] hover:border-[#e04f3e] overflow-hidden flex flex-col transition-all"
                >
                  <div className="aspect-video bg-[#111216] relative overflow-hidden">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-[#606575]">
                        {badgeLabel(item.itemType)}
                      </div>
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 text-[10px] font-bold text-[#f7c873] flex items-center gap-1">
                      {item.itemType === 'playlist' ? (
                        <ListVideo className="w-3 h-3 text-[#e04f3e]" />
                      ) : item.itemType === 'anime' ? (
                        <Film className="w-3 h-3 text-[#e04f3e]" />
                      ) : (
                        <Play className="w-3 h-3 text-[#e04f3e]" />
                      )}
                      {badgeLabel(item.itemType)}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFavorite(item.itemType, item.itemId);
                      }}
                      title="Xóa khỏi Yêu thích"
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-red-700 text-white/80 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between gap-1">
                    <div className="text-xs font-bold text-white line-clamp-2 group-hover:text-[#f7c873]">
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div className="text-[11px] text-[#8b909e] truncate">
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
