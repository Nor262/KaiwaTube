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
  const tParsed = tRaw ? Math.max(0, Math.floor(Number(tRaw))) : 0;
  const t = Number.isFinite(tParsed) ? tParsed : 0;

  const q = params.get('q') || undefined;
  const view = params.get('view');

  if (path === '/search' || view === 'search') {
    return { mode: 'search', q: q || '' };
  }
  if (path === '/favorites' || view === 'favorites') {
    return { mode: 'favorites' };
  }

  const anime = params.get('anime') || undefined;
  const epRaw = params.get('ep');
  const ep = epRaw ? Math.max(1, parseInt(epRaw, 10) || 1) : 1;
  const list = params.get('list') || undefined;
  const v = params.get('v') || undefined;

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
    if (state.q) params.set('q', state.q);
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  }

  if (state.mode === 'favorites') {
    return '/favorites';
  }

  if (state.anime) {
    params.set('anime', state.anime);
    params.set('ep', String(state.ep || 1));
  } else {
    if (state.list) params.set('list', state.list);
    if (state.v) params.set('v', state.v);
  }

  if (state.t && state.t > 0) {
    params.set('t', String(Math.floor(state.t)));
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
