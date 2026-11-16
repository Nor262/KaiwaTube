import {
  CommunityReportItem,
  FavoriteItem,
  FavoriteItemType,
  PlaylistItem,
  SavedSubtitleTrack,
  SubtitleCue,
  User,
  UserRole,
  YouTubeSearchPlaylist,
  YouTubeSearchVideo,
} from '../types';

const TOKEN_STORAGE_KEY = 'nihongo_auth_token';
const API_BASE_OVERRIDE_KEY = 'kaiwatube_api_base_url';

export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/api/')) return path;
  const runtimeOverride =
    typeof window !== 'undefined'
      ? (localStorage.getItem(API_BASE_OVERRIDE_KEY) || '').trim()
      : '';
  const envBase = String(
    (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || ''
  ).trim();
  const base = (runtimeOverride || envBase).replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base)) return path;
  return `${base}${path}`;
}

export function getAuthToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setAuthToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(resolveApiUrl(url), { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Lỗi máy chủ (${res.status})`);
  }
  return data as T;
}

// --- Auth & Admin ---

export async function registerAccount(params: {
  username: string;
  displayName?: string;
  password: string;
  adminSecret?: string;
}): Promise<{ token: string; user: User }> {
  const data = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setAuthToken(data.token);
  return data;
}

export async function loginAccount(params: {
  username: string;
  password: string;
}): Promise<{ token: string; user: User }> {
  const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setAuthToken(data.token);
  return data;
}

export async function fetchCurrentUser(): Promise<User | null> {
  if (!getAuthToken()) return null;
  try {
    const data = await apiFetch<{ user: User }>('/api/auth/me');
    return data.user;
  } catch {
    setAuthToken('');
    return null;
  }
}

export async function claimAdminAccess(adminSecret: string): Promise<User> {
  const data = await apiFetch<{ user: User }>('/api/auth/claim-admin', {
    method: 'POST',
    body: JSON.stringify({ adminSecret }),
  });
  return data.user;
}

export async function fetchAdminUsers(query = ''): Promise<User[]> {
  const data = await apiFetch<{ users: User[] }>(
    `/api/admin/users?q=${encodeURIComponent(query)}`
  );
  return data.users || [];
}

export async function updateUserRole(userId: number, role: UserRole): Promise<User> {
  const data = await apiFetch<{ user: User }>(`/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  return data.user;
}

export async function fetchCommunityReports(): Promise<CommunityReportItem[]> {
  const data = await apiFetch<{ reports: CommunityReportItem[] }>('/api/admin/reports');
  return data.reports || [];
}

// --- Favorites ---

export async function fetchFavorites(type?: FavoriteItemType): Promise<FavoriteItem[]> {
  if (!getAuthToken()) return [];
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  const data = await apiFetch<{ favorites: FavoriteItem[] }>(`/api/favorites${qs}`);
  return data.favorites || [];
}

export async function saveFavorite(item: {
  itemType: FavoriteItemType;
  itemId: string;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  meta?: Record<string, any>;
}): Promise<FavoriteItem> {
  const data = await apiFetch<{ favorite: FavoriteItem }>('/api/favorites', {
    method: 'POST',
    body: JSON.stringify(item),
  });
  return data.favorite;
}

export async function deleteFavorite(itemType: FavoriteItemType, itemId: string): Promise<void> {
  await apiFetch(
    `/api/favorites?type=${encodeURIComponent(itemType)}&id=${encodeURIComponent(itemId)}`,
    { method: 'DELETE' }
  );
}

// --- Subtitles (Community & Personal) ---

export async function fetchVideoSubtitles(videoId: string): Promise<{
  community: SavedSubtitleTrack[];
  personal: SavedSubtitleTrack[];
}> {
  if (!videoId) return { community: [], personal: [] };
  return apiFetch(`/api/subtitles?v=${encodeURIComponent(videoId)}`);
}

export async function savePersonalSubtitle(params: {
  videoId: string;
  title: string;
  sourceType: 'ai_merged' | 'uploaded';
  cues: SubtitleCue[];
}): Promise<SavedSubtitleTrack> {
  const data = await apiFetch<{ track: SavedSubtitleTrack }>('/api/subtitles/user', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.track;
}

export async function deletePersonalSubtitle(id: number): Promise<void> {
  await apiFetch(`/api/subtitles/user/${id}`, { method: 'DELETE' });
}

export async function publishCommunitySubtitle(params: {
  videoId: string;
  title: string;
  sourceType: 'ai_merged' | 'uploaded';
  cues: SubtitleCue[];
}): Promise<SavedSubtitleTrack> {
  const data = await apiFetch<{ track: SavedSubtitleTrack }>('/api/subtitles/community', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.track;
}

export async function updateCommunitySubtitle(
  id: number,
  params: { title?: string; cues: SubtitleCue[] }
): Promise<SavedSubtitleTrack> {
  const data = await apiFetch<{ track: SavedSubtitleTrack }>(
    `/api/subtitles/community/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(params),
    }
  );
  return data.track;
}

export async function deleteCommunitySubtitle(id: number): Promise<void> {
  await apiFetch(`/api/subtitles/community/${id}`, { method: 'DELETE' });
}

export async function reportCommunitySubtitle(id: number, reason: string): Promise<void> {
  await apiFetch(`/api/subtitles/community/${id}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// --- YouTube Home Feed, Search, Playlists & Translation ---

export async function fetchHomeFeedApi(topic = 'all'): Promise<{
  topic: string;
  label: string;
  categories: Array<{ id: string; label: string }>;
  videos: YouTubeSearchVideo[];
  playlists: YouTubeSearchPlaylist[];
}> {
  return apiFetch(`/api/yt-home?topic=${encodeURIComponent(topic)}`);
}

export async function searchYouTubeApi(query: string): Promise<{
  query: string;
  videos: YouTubeSearchVideo[];
  playlists: YouTubeSearchPlaylist[];
}> {
  return apiFetch(`/api/yt-search?q=${encodeURIComponent(query)}`);
}

export async function fetchYouTubePlaylistApi(listId: string): Promise<{
  listId: string;
  title: string;
  author: string;
  thumbnail: string;
  videos: PlaylistItem[];
}> {
  return apiFetch(`/api/yt-playlist?list=${encodeURIComponent(listId)}`);
}

export async function fetchYouTubeVideoApi(videoId: string): Promise<{
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
}> {
  return apiFetch(`/api/yt-video?v=${encodeURIComponent(videoId)}`);
}

export async function translateBatchServer(texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const BATCH_LIMIT = 150;
  const output: string[] = [];
  for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
    const slice = texts.slice(i, i + BATCH_LIMIT);
    const data = await apiFetch<{ translations: string[] }>('/api/translate-batch', {
      method: 'POST',
      body: JSON.stringify({ texts: slice }),
    });
    const chunkOut = Array.isArray(data.translations) ? data.translations : slice.map(() => '');
    for (let j = 0; j < slice.length; j++) {
      output.push(chunkOut[j] || '');
    }
  }
  return output;
}

// --- Kanji Mnemonics Shared Cache ---

export async function saveKanjiMnemonicsToCache(
  items: Array<{
    kanji: string;
    hanViet?: string;
    decomposition: string;
    mnemonic: string;
  }>
): Promise<void> {
  if (!items.length) return;
  try {
    await apiFetch('/api/kanji-mnemonic', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  } catch {
    // Non-critical cache failure
  }
}

export async function getKanjiMnemonicFromCache(kanji: string): Promise<{
  kanji: string;
  han_viet: string;
  decomposition: string;
  mnemonic: string;
} | null> {
  try {
    const data = await apiFetch<{ mnemonicData: any }>(
      `/api/kanji-mnemonic?kanji=${encodeURIComponent(kanji)}`
    );
    return data.mnemonicData || null;
  } catch {
    return null;
  }
}
