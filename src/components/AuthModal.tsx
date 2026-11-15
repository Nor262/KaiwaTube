import React, { useState } from 'react';
import { X, UserCheck, ShieldCheck, KeyRound, Loader2, AlertCircle } from 'lucide-react';
import { User } from '../types';
import { claimAdminAccess, loginAccount, registerAccount } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onAuthSuccess: (user: User) => void;
  onLogout: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onLogout,
}) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await loginAccount({ username, password });
        onAuthSuccess(res.user);
        onClose();
      } else {
        const res = await registerAccount({
          username,
          displayName: displayName || username,
          password,
          adminSecret: showAdminInput ? adminSecret : undefined,
        });
        onAuthSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Thao tác thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const updated = await claimAdminAccess(adminSecret.trim());
      onAuthSuccess(updated);
      setAdminSecret('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Mã kích hoạt Admin không chính xác.');
    } finally {
      setLoading(false);
    }
  };

  const roleBadge = (role: User['role']) => {
    if (role === 'admin') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#e04f3e]/20 text-[#f7c873] border border-[#e04f3e]/40">
          👑 Admin
        </span>
      );
    }
    if (role === 'contributor') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-700/50">
          ✓ Được cấp phép up Sub Cộng đồng
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#252834] text-[#b0b4c4] border border-[#353949]">
        Thành viên (Lưu cá nhân)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#17181c] border border-[#2a2d36] rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-[#262830]">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-[#e04f3e]" />
            <h2 className="text-base font-bold text-white">
              {currentUser ? 'Tài khoản & Phân quyền' : 'Đăng nhập / Đăng ký'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#252832] text-[#8b909e] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {currentUser ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#1c1e26] border border-[#2d313e] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white">
                      {currentUser.displayName}
                    </div>
                    <div className="text-xs text-[#8b909e] font-mono">
                      @{currentUser.username}
                    </div>
                  </div>
                  {roleBadge(currentUser.role)}
                </div>

                <div className="pt-2 border-t border-[#262832] text-xs text-[#a0a4b2] leading-relaxed">
                  {currentUser.role === 'admin'
                    ? 'Bạn có toàn quyền đăng Sub Cộng đồng, xóa/duyệt sub lỗi và cấp quyền cho tài khoản khác.'
                    : currentUser.role === 'contributor'
                    ? 'Tài khoản của bạn được phép xuất bản phụ đề AI & file .SRT/.VTT lên kho Cộng đồng.'
                    : 'Bạn có thể lưu danh sách Yêu thích, lưu Playlist và giữ bản sub AI/.SRT riêng trong tài khoản cá nhân.'}
                </div>
              </div>

              {currentUser.role !== 'admin' && (
                <form
                  onSubmit={handleClaimAdmin}
                  className="p-3.5 rounded-xl bg-[#131418] border border-[#282b36] space-y-2.5"
                >
                  <div className="text-xs font-semibold text-[#f7c873] flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-[#e04f3e]" />
                    Nâng cấp lên Admin bằng mã bí mật
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={adminSecret}
                      onChange={(e) => setAdminSecret(e.target.value)}
                      placeholder="Nhập ADMIN_SECRET..."
                      className="flex-1 bg-[#1b1d24] border border-[#2d313d] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                    />
                    <button
                      type="submit"
                      disabled={loading || !adminSecret.trim()}
                      className="px-3 py-1.5 rounded-lg bg-[#e04f3e] hover:bg-[#c94333] text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Kích hoạt
                    </button>
                  </div>
                </form>
              )}

              {error && (
                <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[#262830]">
                <button
                  onClick={() => {
                    onLogout();
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-[#252834] hover:bg-red-900/50 hover:text-red-200 text-xs font-semibold text-[#c5c9d6] transition-colors"
                >
                  Đăng xuất
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-[#e04f3e] hover:bg-[#c94333] text-xs font-semibold text-white"
                >
                  Đóng
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex rounded-xl bg-[#121316] p-1 border border-[#262830]">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError(null);
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    tab === 'login'
                      ? 'bg-[#e04f3e] text-white'
                      : 'text-[#8b909e] hover:text-white'
                  }`}
                >
                  Đăng nhập
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setError(null);
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    tab === 'register'
                      ? 'bg-[#e04f3e] text-white'
                      : 'text-[#8b909e] hover:text-white'
                  }`}
                >
                  Đăng ký tài khoản
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#9ca1af] block mb-1">
                    Tên đăng nhập
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="vd: sakurachan"
                    className="w-full bg-[#121316] border border-[#2c2f38] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                  />
                </div>

                {tab === 'register' && (
                  <div>
                    <label className="text-[11px] font-semibold text-[#9ca1af] block mb-1">
                      Tên hiển thị (tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="vd: Sakura Học Tiếng Nhật"
                      className="w-full bg-[#121316] border border-[#2c2f38] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[11px] font-semibold text-[#9ca1af] block mb-1">
                    Mật khẩu (tối thiểu 6 ký tự)
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-[#121316] border border-[#2c2f38] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                  />
                </div>

                {tab === 'register' && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAdminInput((v) => !v)}
                      className="text-[11px] text-[#8b909e] hover:text-[#f7c873] flex items-center gap-1"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#e04f3e]" />
                      {showAdminInput ? 'Ẩn mã kích hoạt Admin' : 'Có mã kích hoạt Admin?'}
                    </button>
                    {showAdminInput && (
                      <input
                        type="password"
                        value={adminSecret}
                        onChange={(e) => setAdminSecret(e.target.value)}
                        placeholder="Nhập ADMIN_SECRET (để trống nếu là người dùng thường)"
                        className="mt-2 w-full bg-[#121316] border border-[#2c2f38] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#e04f3e]"
                      />
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-[#e04f3e] hover:bg-[#c94333] text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {tab === 'login' ? 'Đăng nhập ngay' : 'Tạo tài khoản'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
