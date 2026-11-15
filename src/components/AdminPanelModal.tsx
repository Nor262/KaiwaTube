import React, { useEffect, useState } from 'react';
import {
  X,
  Shield,
  Users,
  Flag,
  Trash2,
  ExternalLink,
  Search,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { CommunityReportItem, User, UserRole } from '../types';
import {
  deleteCommunitySubtitle,
  fetchAdminUsers,
  fetchCommunityReports,
  updateUserRole,
} from '../services/api';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onOpenVideoId: (videoId: string) => void;
  onCommunityChanged?: () => void;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenVideoId,
  onCommunityChanged,
}) => {
  const [tab, setTab] = useState<'users' | 'reports'>('users');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<CommunityReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'users') {
        const list = await fetchAdminUsers(query);
        setUsers(list);
      } else {
        const rep = await fetchCommunityReports();
        setReports(rep);
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải dữ liệu Admin.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, tab]);

  if (!isOpen || !currentUser || currentUser.role !== 'admin') return null;

  const handleChangeRole = async (targetUser: User, role: UserRole) => {
    try {
      const updated = await updateUserRole(targetUser.id, role);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err: any) {
      setError(err?.message || 'Không thể cập nhật quyền.');
    }
  };

  const handleDeleteSub = async (communitySubId: number) => {
    try {
      await deleteCommunitySubtitle(communitySubId);
      setReports((prev) => prev.filter((r) => r.community_sub_id !== communitySubId));
      onCommunityChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa phụ đề cộng đồng.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[85vh] bg-[#17181c] border border-[#2a2d36] rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#262830]">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-[#e04f3e]" />
            <h2 className="text-base font-bold text-white">
              Bảng quản trị Phân quyền & Kiểm duyệt Sub
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#252832] text-[#8b909e] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#262830] bg-[#141519] px-4">
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              tab === 'users'
                ? 'border-[#e04f3e] text-white'
                : 'border-transparent text-[#8b909e] hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Phân quyền tài khoản ({users.length})
          </button>
          <button
            onClick={() => setTab('reports')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
              tab === 'reports'
                ? 'border-[#e04f3e] text-white'
                : 'border-transparent text-[#8b909e] hover:text-white'
            }`}
          >
            <Flag className="w-3.5 h-3.5" />
            Báo cáo Sub lỗi ({reports.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'users' && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadData();
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#7a7f8c] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Tìm theo tên đăng nhập..."
                    className="w-full bg-[#121316] border border-[#2c2f38] rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#23252d] hover:bg-[#2d303b] text-xs font-semibold text-white"
                >
                  Tìm
                </button>
              </form>

              {loading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#e04f3e]" />
                </div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="p-3 rounded-xl bg-[#1c1e24] border border-[#2a2d37] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>{u.displayName}</span>
                          <span className="text-[11px] font-mono text-[#8b909e]">
                            @{u.username}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7a7f8c] mt-0.5">
                          {u.role === 'admin'
                            ? 'Admin • Toàn quyền'
                            : u.role === 'contributor'
                            ? 'Cộng tác viên • Được phép đăng Sub Cộng đồng'
                            : 'Thành viên • Chỉ lưu Sub cá nhân'}
                        </div>
                      </div>

                      <select
                        aria-label={`Phân quyền cho ${u.username}`}
                        value={u.role}
                        onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                        className="bg-[#121316] border border-[#343846] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                      >
                        <option value="user">Thành viên (User)</option>
                        <option value="contributor">Được phép up Sub (Contributor)</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'reports' && (
            <>
              {loading ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#e04f3e]" />
                </div>
              ) : reports.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#8b909e]">
                  Chưa có báo cáo phụ đề lỗi nào.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {reports.map((rep) => (
                    <div
                      key={rep.id}
                      className="p-3.5 rounded-xl bg-[#1c1e24] border border-[#2a2d37] flex items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                          <span>{rep.sub_title}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#14151a] text-[#f7c873]">
                            {rep.video_id}
                          </span>
                        </div>
                        <div className="text-xs text-amber-300">
                          Lý do: {rep.reason}
                        </div>
                        <div className="text-[11px] text-[#8b909e]">
                          Người báo cáo: @{rep.reporter_username} • Tác giả sub: {rep.author_name}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            onOpenVideoId(rep.video_id);
                            onClose();
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#23252d] hover:bg-[#2f323d] text-xs text-white flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Mở video
                        </button>
                        <button
                          onClick={() => handleDeleteSub(rep.community_sub_id)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 border border-red-800/50 text-xs text-red-200 flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Xóa Sub
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
