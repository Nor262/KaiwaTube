import {
  isValidAkaiwaSlug,
  isValidYouTubePlaylistId,
  isValidYouTubeVideoId,
} from '../services/youtube';

export interface AppUrlState {
  mode: 'home' | 'watch' | 'search' | 'favorites';
  anime?: string;
  ep?: number;
  list?: string;
  v?: string;
  t?: number;
  q?: string;
}

export function parseAppUrl(loc: Location = window.location): AppUrlState {
  const params = new URLSearchParams(loc.search);
  const path = loc.pathname.replace(/\/+$/, '') || '/';

  const tRaw = params.get('t');
  const tParsed = tRaw ? Math.max(0, Math.min(86400 * 7, Math.floor(Number(tRaw)))) : 0;
  const t = Number.isFinite(tParsed) ? tParsed : 0;

  const rawQ = params.get('q');
  const q = rawQ ? rawQ.trim().slice(0, 120) : undefined;
  const view = params.get('view');

  if (path === '/search' || view === 'search') {
    return { mode: 'search', q: q || '' };
  }
  if (path === '/favorites' || view === 'favorites') {
    return { mode: 'favorites' };
  }

  const rawAnime = params.get('anime')?.trim();
  const anime = rawAnime && isValidAkaiwaSlug(rawAnime) ? rawAnime : undefined;
  const epRaw = params.get('ep');
  const epNum = epRaw ? parseInt(epRaw, 10) || 1 : 1;
  const ep = Math.max(1, Math.min(2000, epNum));
  const rawList = params.get('list')?.trim();
  const list = rawList && isValidYouTubePlaylistId(rawList) ? rawList : undefined;
  const rawV = params.get('v')?.trim();
  const v = rawV && isValidYouTubeVideoId(rawV) ? rawV : undefined;

  if (anime || list || v) {
    return { mode: 'watch', anime, ep, list, v, t };
  }

  // Default bare / opens YouTube-like Home feed
  return { mode: 'home' };
}

export function buildUrlString(state: AppUrlState): string {
  const params = new URLSearchParams();

  if (state.mode === 'home') {
    return '/';
  }

  if (state.mode === 'search') {
    if (state.q) params.set('q', state.q.trim().slice(0, 120));
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  }

  if (state.mode === 'favorites') {
    return '/favorites';
  }

  if (state.anime && isValidAkaiwaSlug(state.anime)) {
    params.set('anime', state.anime);
    params.set('ep', String(Math.max(1, Math.min(2000, state.ep || 1))));
  } else {
    if (state.list && isValidYouTubePlaylistId(state.list)) params.set('list', state.list);
    if (state.v && isValidYouTubeVideoId(state.v)) params.set('v', state.v);
  }

  if (state.t && state.t > 0) {
    params.set('t', String(Math.min(86400 * 7, Math.floor(state.t))));
  }

  const qs = params.toString();
  return qs ? `/watch?${qs}` : '/';
}

export function pushAppUrl(state: AppUrlState): void {
  const nextUrl = buildUrlString(state);
  const current = window.location.pathname + window.location.search;
  if (current !== nextUrl) {
    window.history.pushState(state, '', nextUrl);
  }
}

export function replaceAppUrl(state: AppUrlState): void {
  const nextUrl = buildUrlString(state);
  const current = window.location.pathname + window.location.search;
  if (current !== nextUrl) {
    window.history.replaceState(state, '', nextUrl);
  }
}
