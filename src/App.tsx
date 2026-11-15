import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Upload,
  Sparkles,
  BookOpen,
  ListVideo,
  MessageSquareText,
  Settings,
  Home,
  Loader2,
  AlertCircle,
  PanelLeftClose,
  PanelLeft,
  Search,
  Heart,
  UserCheck,
  Shield,
  X,
} from 'lucide-react';
import {
  ActiveSubtitleSourceKind,
  FavoriteItem,
  FavoriteItemType,
  JapaneseAnalysisResult,
  PlaylistItem,
  SavedSubtitleTrack,
  SubtitleCue,
  User,
  YouTubeSearchPlaylist,
  YouTubeSearchVideo,
} from './types';
import {
  fetchAkaiwaSeriesData,
  fetchSubtitlesForVideo,
  fetchVideoMetadata,
  fetchYouTubePlaylistData,
  findRestoreCueForTime,
  normalizeCueTimings,
  parseAkaiwaUrl,
  parseSrtOrVtt,
  parseYouTubeUrl,
} from './services/youtube';
import {
  analyzeJapaneseWithGemini,
  mergeSubtitlesWithGemini,
  quickTranslateJaToVi,
} from './services/gemini';
import {
  deleteCommunitySubtitle,
  deleteFavorite,
  deletePersonalSubtitle,
  fetchCurrentUser,
  fetchFavorites,
  fetchVideoSubtitles,
  publishCommunitySubtitle,
  reportCommunitySubtitle,
  saveFavorite,
  savePersonalSubtitle,
  setAuthToken,
  translateBatchServer,
  updateCommunitySubtitle,
} from './services/api';
import {
  AppUrlState,
  parseAppUrl,
  pushAppUrl,
  replaceAppUrl,
} from './utils/urlState';
import { InteractiveJapaneseText } from './components/InteractiveJapaneseText';
import { TranscriptCueCard } from './components/TranscriptCueCard';
import { AuthModal } from './components/AuthModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { HomeFeedView, RecentWatchItem } from './components/HomeFeedView';
import { YouTubeSearchView } from './components/YouTubeSearchView';
import { FavoritesView } from './components/FavoritesView';
import { SubtitleControlBar } from './components/SubtitleControlBar';
import { AnalysisTabPanel } from './components/AnalysisTabPanel';
import { SettingsModal } from './components/SettingsModal';

const RECENT_STORAGE_KEY = 'nihongo_recent_watch';

function loadRecentFromStorage(): RecentWatchItem[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function formatPlaybackClock(secFloat: number): string {
  const safe = Math.max(0, Math.floor(Number(secFloat) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function App() {
  // Navigation & Route Mode
  const [appMode, setAppMode] = useState<'home' | 'watch' | 'search' | 'favorites'>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [recentItems, setRecentItems] = useState<RecentWatchItem[]>(loadRecentFromStorage);

  // Media Player Source State
  const [sourceKind, setSourceKind] = useState<'anime' | 'yt_playlist' | 'yt_video'>('yt_video');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [currentSlug, setCurrentSlug] = useState('');
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  const [currentEpNum, setCurrentEpNum] = useState(1);
  const [videoId, setVideoId] = useState('');
  const [mediaThumbnail, setMediaThumbnail] = useState('');
  const [mediaSubtitleMeta, setMediaSubtitleMeta] = useState('');
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);

  // Subtitles & Track Selection State
  const [rawYouTubeCues, setRawYouTubeCues] = useState<SubtitleCue[]>([]);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [activeSourceKind, setActiveSourceKind] =
    useState<ActiveSubtitleSourceKind>('youtube_cc');
  const [activeTrackId, setActiveTrackId] = useState<number | null>(null);
  const [communityTracks, setCommunityTracks] = useState<SavedSubtitleTrack[]>([]);
  const [personalTracks, setPersonalTracks] = useState<SavedSubtitleTrack[]>([]);
  const [sessionAiTrack, setSessionAiTrack] = useState<{
    title: string;
    cues: SubtitleCue[];
  } | null>(null);
  const [sessionUploadTrack, setSessionUploadTrack] = useState<{
    title: string;
    cues: SubtitleCue[];
  } | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [aiMergingStatus, setAiMergingStatus] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Playback State
  const [activeCue, setActiveCue] = useState<SubtitleCue | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopCue, setLoopCue] = useState(false);
  const [rightTab, setRightTab] = useState<'transcript' | 'analysis' | 'episodes'>(
    'transcript'
  );

  // Auth, Favorites & Modals
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );

  // Gemini Settings & Analysis State
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('nihongo_gemini_key') || ''
  );
  const [geminiModel, setGeminiModel] = useState(
    () => localStorage.getItem('nihongo_gemini_model') || 'gemini-2.5-flash'
  );
  const [selectedCue, setSelectedCue] = useState<SubtitleCue | null>(null);
  const [analysis, setAnalysis] = useState<JapaneseAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Refs for player & scroll loops
  const appModeRef = useRef(appMode);
  const videoIdRef = useRef(videoId);
  const loadSeqRef = useRef(0);
  const subLoadingRef = useRef(false);
  const playerRef = useRef<any>(null);
  const autoplayPendingRef = useRef<number>(0);
  const desiredPlaybackRef = useRef<{ videoId: string; startSeconds: number } | null>(null);
  const cuesRef = useRef<SubtitleCue[]>([]);
  const lastCueRef = useRef<SubtitleCue | null>(null);
  const loopCueRef = useRef<boolean>(false);
  const selectedCueRef = useRef<SubtitleCue | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const transcriptListRef = useRef<HTMLDivElement>(null);
  const isWordHoveredRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<any>(null);
  const isSeekingUntilRef = useRef<number>(0);
  const seekTargetRef = useRef<number>(0);
  const pendingSeekTimeRef = useRef<number>(0);
  const lastUrlSyncedTimeRef = useRef<number>(0);
  const lastRecentSyncedTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const lastDisplayedSecRef = useRef<number>(-1);
  const timeDisplayRef = useRef<HTMLSpanElement | null>(null);
  const watchRouteRef = useRef<AppUrlState>({
    mode: 'home',
  });

  const syncCurrentTimeUi = useCallback((secFloat: number, force = false) => {
    currentTimeRef.current = secFloat;
    const whole = Math.max(0, Math.floor(secFloat));
    if (force || whole !== lastDisplayedSecRef.current) {
      lastDisplayedSecRef.current = whole;
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatPlaybackClock(secFloat);
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (appMode === 'watch' && timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatPlaybackClock(currentTimeRef.current);
    }
  }, [appMode, videoId]);

  useEffect(() => {
    appModeRef.current = appMode;
    if (appMode !== 'watch') {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const liveT = playerRef.current.getCurrentTime();
          if (typeof liveT === 'number' && !isNaN(liveT) && liveT >= 0) {
            currentTimeRef.current = liveT;
            if (watchRouteRef.current.mode === 'watch') {
              watchRouteRef.current = { ...watchRouteRef.current, t: Math.floor(liveT) };
            }
          }
        } catch {}
      }
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    }
  }, [appMode]);

  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  useEffect(() => {
    cuesRef.current = cues;
  }, [cues]);

  useEffect(() => {
    loopCueRef.current = loopCue;
    selectedCueRef.current = selectedCue;
  }, [loopCue, selectedCue]);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const recordRecentWatch = useCallback((item: Omit<RecentWatchItem, 'updatedAt'>) => {
    if (!item.videoId) return;
    setRecentItems((prev) => {
      const filtered = prev.filter((x) => x.videoId !== item.videoId);
      const next: RecentWatchItem[] = [
        { ...item, updatedAt: Date.now() },
        ...filtered,
      ].slice(0, 12);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => `${f.itemType}:${f.itemId}`)),
    [favorites]
  );

  // Refresh saved tracks for active videoId whenever videoId or auth user changes
  const refreshSavedTracks = useCallback(async (vid: string) => {
    if (!vid) return;
    try {
      const tracks = await fetchVideoSubtitles(vid);
      setCommunityTracks(tracks.community || []);
      setPersonalTracks(tracks.personal || []);
    } catch {
      // Ignore transient errors
    }
  }, []);

  // Load user & favorites on startup
  useEffect(() => {
    void (async () => {
      const user = await fetchCurrentUser();
      setCurrentUser(user);
      if (user) {
        const favs = await fetchFavorites().catch(() => []);
        setFavorites(favs);
      }
    })();
  }, []);

  useEffect(() => {
    if (videoId) {
      void refreshSavedTracks(videoId);
    }
  }, [currentUser?.id, videoId, refreshSavedTracks]);

  // --- Time Tracking Loop & URL Timestamp Persistence ---
  const startTimeTrackingLoop = () => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
    }

    const tick = () => {
      if (appModeRef.current !== 'watch') return;
      // Never read old video's clock or mutate active cues while awaiting subtitle gate
      if (subLoadingRef.current) {
        animFrameIdRef.current = requestAnimationFrame(tick);
        return;
      }

      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === 'function') {
        try {
          const t = p.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            if (Date.now() < isSeekingUntilRef.current) {
              // Release seek lock early once player clock actually arrives at target
              if (Math.abs(t - seekTargetRef.current) <= 1.5) {
                isSeekingUntilRef.current = 0;
              } else {
                animFrameIdRef.current = requestAnimationFrame(tick);
                return;
              }
            }

            syncCurrentTimeUi(t);

            // Sync ?t= into URL every ~2s (never clobber pending initial seek or non-watch routes)
            if (
              pendingSeekTimeRef.current <= 0 &&
              appModeRef.current === 'watch' &&
              watchRouteRef.current.mode === 'watch' &&
              Math.abs(Math.floor(t) - lastUrlSyncedTimeRef.current) >= 2
            ) {
              const sec = Math.floor(t);
              lastUrlSyncedTimeRef.current = sec;
              watchRouteRef.current = { ...watchRouteRef.current, t: sec };
              replaceAppUrl(watchRouteRef.current);

              if (sec >= 5 && Math.abs(sec - lastRecentSyncedTimeRef.current) >= 5 && videoIdRef.current) {
                lastRecentSyncedTimeRef.current = sec;
                setRecentItems((prev) => {
                  const idx = prev.findIndex((x) => x.videoId === videoIdRef.current);
                  if (idx === -1) return prev;
                  const next = prev.map((x, i) =>
                    i === idx ? { ...x, lastTime: sec, updatedAt: Date.now() } : x
                  );
                  try {
                    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
                  } catch {}
                  return next;
                });
              }
            }

            if (
              loopCueRef.current &&
              selectedCueRef.current &&
              t >= selectedCueRef.current.end
            ) {
              seekTargetRef.current = selectedCueRef.current.start;
              p.seekTo(selectedCueRef.current.start, true);
            }

            const matchedCue = findRestoreCueForTime(cuesRef.current, t);

            if (matchedCue !== lastCueRef.current) {
              lastCueRef.current = matchedCue;
              setActiveCue(matchedCue);
            }
          }
        } catch {}
      }
      animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
  };

  // --- YouTube IFrame Player Setup ---
  const playVideoId = (vid: string, startSeconds = 0, autoplay = true) => {
    desiredPlaybackRef.current = { videoId: vid, startSeconds };
    pendingSeekTimeRef.current = startSeconds > 0 ? startSeconds : 0;
    seekTargetRef.current = startSeconds;
    lastUrlSyncedTimeRef.current = Math.floor(startSeconds);
    autoplayPendingRef.current = autoplay ? 1 : 0;
    lastCueRef.current = null;
    syncCurrentTimeUi(startSeconds, true);

    let iframeInDom = false;
    try {
      const iframe = playerRef.current?.getIframe?.();
      iframeInDom = Boolean(iframe && document.body.contains(iframe));
    } catch {
      iframeInDom = false;
    }

    if (iframeInDom && playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
      try {
        // Guard against reading old video's clock during asynchronous loadVideoById transition
        isSeekingUntilRef.current = Date.now() + 1500;
        playerRef.current.loadVideoById({ videoId: vid, startSeconds: Math.max(0, startSeconds) });
        pendingSeekTimeRef.current = 0;
        startTimeTrackingLoop();
        return;
      } catch {}
    }
    initPlayer(vid, startSeconds);
  };

  const initPlayer = (vid: string, startSeconds = 0) => {
    if (subLoadingRef.current) return;
    const el = document.getElementById('youtube-player-element');
    if (!el) return;

    desiredPlaybackRef.current = { videoId: vid, startSeconds };

    if (window.YT?.Player) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }

      const startSec = Math.max(0, Math.floor(startSeconds));
      seekTargetRef.current = startSeconds;
      if (startSeconds > 0) {
        // Guard first tracking ticks until YouTube player actually arrives at startSec
        isSeekingUntilRef.current = Date.now() + 1500;
      }
      playerRef.current = new window.YT.Player('youtube-player-element', {
        videoId: vid,
        playerVars: {
          autoplay: autoplayPendingRef.current,
          modestbranding: 1,
          rel: 0,
          enablejsapi: 1,
          start: startSec > 0 ? startSec : undefined,
          origin: window.location.origin,
        },
        events: {
          onReady: (ev: any) => {
            if (subLoadingRef.current) {
              try {
                ev.target.pauseVideo?.();
              } catch {}
              return;
            }
            const resumeTarget = pendingSeekTimeRef.current > 0 ? pendingSeekTimeRef.current : startSeconds;
            let actualTime = 0;
            try {
              const t = ev.target.getCurrentTime?.();
              if (typeof t === 'number' && !isNaN(t)) actualTime = t;
            } catch {}
            if (
              pendingSeekTimeRef.current > 0 ||
              (resumeTarget > 0 && Math.abs(actualTime - resumeTarget) > 1.5)
            ) {
              seekTargetRef.current = resumeTarget;
              isSeekingUntilRef.current = Date.now() + 1500;
              try {
                ev.target.seekTo(resumeTarget, true);
                syncCurrentTimeUi(resumeTarget, true);
              } catch {}
            }
            pendingSeekTimeRef.current = 0;
            if (autoplayPendingRef.current === 1) {
              try {
                ev.target.playVideo?.();
              } catch {}
            }
            startTimeTrackingLoop();
          },
          onStateChange: (event: any) => {
            if (subLoadingRef.current && event.data === window.YT.PlayerState.PLAYING) {
              try {
                event.target.pauseVideo?.();
              } catch {}
              setIsPlaying(false);
              return;
            }
            setIsPlaying(event.data === window.YT.PlayerState.PLAYING);
            startTimeTrackingLoop();
          },
        },
      });
    } else {
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = () => {
        if (!subLoadingRef.current && appModeRef.current === 'watch') {
          const target = desiredPlaybackRef.current;
          if (target) {
            initPlayer(target.videoId, target.startSeconds);
          } else {
            initPlayer(vid, startSeconds);
          }
        }
      };
    }
  };

  // --- Auto Scroll Transcript ---
  const scrollToActiveCue = (
    cue: SubtitleCue | null,
    behavior: ScrollBehavior = 'smooth',
    force = false
  ) => {
    if (!cue) return;
    if (!force && (isWordHoveredRef.current || isUserScrollingRef.current)) return;
    const container = transcriptListRef.current;
    if (!container) return;

    const activeEl = document.getElementById(`cue-${cue.id}`);
    if (!activeEl) return;

    const activeTop = activeEl.offsetTop;
    const clientHeight = container.clientHeight;
    const currentCues = cuesRef.current.length > 0 ? cuesRef.current : cues;
    const cueIdx = currentCues.findIndex((c) => c.id === cue.id);

    const targetMinus2 = cueIdx >= 2 ? currentCues[cueIdx - 2] : null;
    const minus2El = targetMinus2 ? document.getElementById(`cue-${targetMinus2.id}`) : null;

    let targetScrollTop = minus2El
      ? minus2El.offsetTop - 12
      : activeTop - Math.min(240, clientHeight * 0.33);

    const targetPlus2 =
      cueIdx !== -1 && cueIdx + 2 < currentCues.length ? currentCues[cueIdx + 2] : null;
    const plus2El = targetPlus2 ? document.getElementById(`cue-${targetPlus2.id}`) : null;

    if (plus2El) {
      const plus2Bottom = plus2El.offsetTop + plus2El.offsetHeight;
      targetScrollTop = Math.max(targetScrollTop, plus2Bottom - clientHeight + 28);
    } else {
      const targetPlus1 =
        cueIdx !== -1 && cueIdx + 1 < currentCues.length ? currentCues[cueIdx + 1] : null;
      const plus1El = targetPlus1 ? document.getElementById(`cue-${targetPlus1.id}`) : null;
      if (plus1El) {
        const plus1Bottom = plus1El.offsetTop + plus1El.offsetHeight;
        targetScrollTop = Math.max(targetScrollTop, plus1Bottom - clientHeight + 28);
      }
    }

    targetScrollTop = Math.min(targetScrollTop, activeTop - 12);
    targetScrollTop = Math.max(0, targetScrollTop);

    const effectiveBehavior: ScrollBehavior =
      behavior === 'smooth' && Math.abs(container.scrollTop - targetScrollTop) > clientHeight * 2
        ? 'auto'
        : behavior;
    container.scrollTo({ top: targetScrollTop, behavior: effectiveBehavior });
  };

  useEffect(() => {
    if (appMode === 'watch' && rightTab === 'transcript' && !subLoading && activeCue) {
      scrollToActiveCue(activeCue, 'smooth');
    }
  }, [activeCue?.id]);

  // Restore scroll immediately to the active/current segment cue whenever returning
  // from another right-panel tab (AI / Playlist), another app page, subtitle gate, or track change.
  useEffect(() => {
    if (appMode !== 'watch' || rightTab !== 'transcript' || subLoading) return;
    const currentCues = cuesRef.current.length > 0 ? cuesRef.current : cues;
    if (currentCues.length === 0) return;

    isUserScrollingRef.current = false;
    isWordHoveredRef.current = false;
    clearTimeout(userScrollTimeoutRef.current);

    const targetCue =
      (activeCue && currentCues.some((c) => c.id === activeCue.id) ? activeCue : null) ||
      findRestoreCueForTime(currentCues, currentTimeRef.current);
    if (!targetCue) return;

    let innerRafId = 0;
    const outerRafId = requestAnimationFrame(() => {
      const container = transcriptListRef.current;
      if (container && container.clientHeight === 0) {
        innerRafId = requestAnimationFrame(() => scrollToActiveCue(targetCue, 'auto', true));
        return;
      }
      scrollToActiveCue(targetCue, 'auto', true);
    });

    return () => {
      cancelAnimationFrame(outerRafId);
      if (innerRafId) cancelAnimationFrame(innerRafId);
    };
  }, [appMode, rightTab, subLoading, activeSourceKind, activeTrackId, videoId]);

  // --- Shared Video Subtitle Track Setter (Always defaults to YouTube CC) ---
  const resetSubtitlesToYouTubeDefault = (ytCues: SubtitleCue[]) => {
    const normalized = normalizeCueTimings(ytCues);
    setRawYouTubeCues(normalized);
    setCues(normalized);
    cuesRef.current = normalized;
    setActiveSourceKind('youtube_cc');
    setActiveTrackId(null);
    setSessionAiTrack(null);
    setSessionUploadTrack(null);
    setEditMode(false);
    setHasUnsavedEdits(false);
    lastCueRef.current = null;

    const targetTime = pendingSeekTimeRef.current;
    if (normalized.length > 0) {
      const activeMatch = targetTime > 0 ? findRestoreCueForTime(normalized, targetTime) : null;
      setSelectedCue(activeMatch || normalized[0]);
      setActiveCue(activeMatch);
      if (activeMatch) lastCueRef.current = activeMatch;
    } else {
      setSelectedCue(null);
      setActiveCue(null);
    }
  };

  // --- Apply & Immediately Re-Sync Active Cue When Switching/Updating Tracks ---
  const applyTrackCues = (rawNext: SubtitleCue[]): SubtitleCue[] => {
    const normalized = normalizeCueTimings(rawNext);
    setCues(normalized);
    cuesRef.current = normalized;
    lastCueRef.current = null;

    let liveTime = currentTimeRef.current;
    try {
      const t = playerRef.current?.getCurrentTime?.();
      if (typeof t === 'number' && !isNaN(t)) liveTime = t;
    } catch {}

    const matched = findRestoreCueForTime(normalized, liveTime);
    setActiveCue(matched);
    if (matched) {
      lastCueRef.current = matched;
      setSelectedCue(matched);
    } else if (normalized.length > 0) {
      setSelectedCue(normalized[0]);
    }
    return normalized;
  };

  // --- Gate Playback Until Subtitles Finish Loading (Prevents Video/Subtitle Desync) ---
  const beginSubtitleGate = (startSec: number) => {
    pendingSeekTimeRef.current = startSec > 0 ? startSec : 0;
    seekTargetRef.current = startSec;
    isSeekingUntilRef.current = 0;
    lastUrlSyncedTimeRef.current = Math.floor(startSec);
    syncCurrentTimeUi(startSec, true);
    subLoadingRef.current = true;
    setSubLoading(true);
    setSubError(null);
    setIsPlaying(false);
    setCues([]);
    cuesRef.current = [];
    setActiveCue(null);
    setSelectedCue(null);
    lastCueRef.current = null;
    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo?.();
      } catch {}
    }
  };

  // --- Route Loaders ---
  const loadSeries = async (
    slug: string,
    ep: number = 1,
    opts: { startTime?: number; syncUrl?: 'push' | 'replace' | 'none' } = {}
  ) => {
    const seq = ++loadSeqRef.current;
    const startSec = opts.startTime || 0;
    const syncUrl = opts.syncUrl || 'push';

    setAppMode('watch');
    setRightTab('transcript');
    setSourceKind('anime');
    setCurrentPlaylistId(null);
    beginSubtitleGate(startSec);

    const nextRoute: AppUrlState = { mode: 'watch', anime: slug, ep, t: startSec };
    watchRouteRef.current = nextRoute;
    if (syncUrl === 'push') pushAppUrl(nextRoute);
    else if (syncUrl === 'replace') replaceAppUrl(nextRoute);

    try {
      const data = await fetchAkaiwaSeriesData(slug, ep);
      if (seq !== loadSeqRef.current) return;
      if (data.error) {
        setSubError(data.error);
        subLoadingRef.current = false;
        setSubLoading(false);
        return;
      }
      setSeriesTitle(data.title);
      setCurrentSlug(data.slug);
      setCurrentEpNum(data.currentEp);
      setPlaylist(data.playlist);
      setMediaSubtitleMeta(`${data.playlist.length} tập`);
      syncCurrentTimeUi(startSec, true);

      resetSubtitlesToYouTubeDefault(data.cues);
      subLoadingRef.current = false;
      setSubLoading(false);

      if (data.videoId) {
        setVideoId(data.videoId);
        setMediaThumbnail(`https://i.ytimg.com/vi/${data.videoId}/mqdefault.jpg`);
        playVideoId(data.videoId, startSec, true);
        void refreshSavedTracks(data.videoId);
      }
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setSubError(e?.message || 'Không thể tải Anime.');
      subLoadingRef.current = false;
      setSubLoading(false);
    }
  };

  const loadYouTubeVideo = async (
    vid: string,
    opts: {
      playlistId?: string | null;
      startTime?: number;
      titleHint?: string;
      syncUrl?: 'push' | 'replace' | 'none';
      preservePlaylist?: boolean;
    } = {}
  ) => {
    const seq = ++loadSeqRef.current;
    const startSec = opts.startTime || 0;
    const syncUrl = opts.syncUrl || 'push';
    const activeListId =
      opts.playlistId !== undefined
        ? opts.playlistId
        : opts.preservePlaylist
        ? currentPlaylistId
        : null;

    setAppMode('watch');
    setRightTab('transcript');
    setSourceKind(activeListId ? 'yt_playlist' : 'yt_video');
    if (!opts.preservePlaylist && opts.playlistId === undefined) {
      setCurrentPlaylistId(null);
      setPlaylist([]);
    } else if (activeListId) {
      setCurrentPlaylistId(activeListId);
    }

    const nextRoute: AppUrlState = activeListId
      ? { mode: 'watch', list: activeListId, v: vid, t: startSec }
      : { mode: 'watch', v: vid, t: startSec };
    watchRouteRef.current = nextRoute;
    if (syncUrl === 'push') pushAppUrl(nextRoute);
    else if (syncUrl === 'replace') replaceAppUrl(nextRoute);

    setVideoId(vid);
    setCurrentEpNum(0);
    syncCurrentTimeUi(startSec, true);
    if (opts.titleHint) setSeriesTitle(opts.titleHint);
    beginSubtitleGate(startSec);

    // Fetch subtitles & metadata BEFORE starting video playback so image and subtitles start in sync
    try {
      const [subRes, meta] = await Promise.all([
        fetchSubtitlesForVideo(vid),
        fetchVideoMetadata(vid),
        refreshSavedTracks(vid),
      ]);

      if (seq !== loadSeqRef.current) return;

      const resolvedTitle = opts.titleHint || meta?.title || `Video (${vid})`;
      const resolvedThumb = meta?.thumbnail || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
      const resolvedAuthor = meta?.author || 'YouTube';

      if (!activeListId) {
        setSeriesTitle(resolvedTitle);
        setMediaThumbnail(resolvedThumb);
        setMediaSubtitleMeta(resolvedAuthor);
      }

      recordRecentWatch({
        videoId: vid,
        listId: activeListId || undefined,
        title: resolvedTitle,
        author: resolvedAuthor,
        thumbnail: resolvedThumb,
        lastTime: startSec,
      });

      resetSubtitlesToYouTubeDefault(subRes.cues);
      if (subRes.cues.length === 0) {
        setSubError(subRes.error || 'Video YouTube này không có phụ đề CC.');
      }

      subLoadingRef.current = false;
      setSubLoading(false);
      playVideoId(vid, startSec, true);
    } catch (err: any) {
      if (seq !== loadSeqRef.current) return;
      setSubError(err?.message || 'Không thể tải phụ đề cho video này.');
      subLoadingRef.current = false;
      setSubLoading(false);
      playVideoId(vid, startSec, true);
    }
  };

  const loadYouTubePlaylist = async (
    listId: string,
    opts: {
      videoId?: string;
      startTime?: number;
      syncUrl?: 'push' | 'replace' | 'none';
    } = {}
  ) => {
    const seq = ++loadSeqRef.current;
    const startSec = opts.startTime || 0;
    const syncUrl = opts.syncUrl || 'push';

    setAppMode('watch');
    setSourceKind('yt_playlist');
    setCurrentPlaylistId(listId);
    beginSubtitleGate(startSec);

    try {
      const pl = await fetchYouTubePlaylistData(listId);
      if (seq !== loadSeqRef.current) return;
      setSeriesTitle(pl.title);
      setMediaThumbnail(pl.thumbnail);
      setMediaSubtitleMeta(`${pl.playlist.length} video • ${pl.author || 'Playlist'}`);
      setPlaylist(pl.playlist);

      const targetVid =
        opts.videoId && pl.playlist.some((item) => item.videoId === opts.videoId)
          ? opts.videoId
          : opts.videoId || pl.playlist[0]?.videoId;

      if (!targetVid) {
        setSubError('Playlist này không có video khả dụng.');
        subLoadingRef.current = false;
        setSubLoading(false);
        return;
      }

      const activeItem = pl.playlist.find((p) => p.videoId === targetVid);
      if (activeItem) setCurrentEpNum(activeItem.ep_number);

      await loadYouTubeVideo(targetVid, {
        playlistId: listId,
        startTime: startSec,
        titleHint: pl.title,
        syncUrl,
        preservePlaylist: true,
      });
    } catch (err: any) {
      if (seq !== loadSeqRef.current) return;
      setSubError(err?.message || 'Không thể tải Playlist YouTube.');
      subLoadingRef.current = false;
      setSubLoading(false);
    }
  };

  const applyRouteState = async (
    state: AppUrlState,
    syncUrl: 'push' | 'replace' | 'none' = 'none'
  ) => {
    if (state.mode === 'home') {
      setAppMode('home');
      if (syncUrl === 'push') pushAppUrl(state);
      else if (syncUrl === 'replace') replaceAppUrl(state);
      return;
    }
    if (state.mode === 'search') {
      const q = state.q || '';
      setSearchQuery(q);
      setUrlInput(q);
      setAppMode('search');
      if (syncUrl === 'push') pushAppUrl(state);
      else if (syncUrl === 'replace') replaceAppUrl(state);
      return;
    }
    if (state.mode === 'favorites') {
      setAppMode('favorites');
      if (syncUrl === 'push') pushAppUrl(state);
      else if (syncUrl === 'replace') replaceAppUrl(state);
      return;
    }

    if (state.anime) {
      await loadSeries(state.anime, state.ep || 1, {
        startTime: state.t || 0,
        syncUrl,
      });
    } else if (state.list) {
      await loadYouTubePlaylist(state.list, {
        videoId: state.v,
        startTime: state.t || 0,
        syncUrl,
      });
    } else if (state.v) {
      await loadYouTubeVideo(state.v, {
        startTime: state.t || 0,
        syncUrl,
      });
    } else {
      setAppMode('home');
      if (syncUrl === 'replace') replaceAppUrl({ mode: 'home' });
    }
  };

  // Mount: Restore exact URL state (F5 Persistence!) + Register Browser Back/Forward listener
  useEffect(() => {
    const initial = parseAppUrl(window.location);
    void applyRouteState(initial, 'replace');

    const handlePopState = () => {
      const next = parseAppUrl(window.location);
      void applyRouteState(next, 'none');
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, []);

  // Ensure YouTube player mounts ONLY after subtitles finish loading (prevents image/subtitle desync)
  useEffect(() => {
    if (appMode === 'watch' && videoId && !subLoading && !subLoadingRef.current) {
      const el = document.getElementById('youtube-player-element');
      if (el && el.tagName === 'DIV') {
        const resumeAt = pendingSeekTimeRef.current > 0 ? pendingSeekTimeRef.current : currentTimeRef.current;
        initPlayer(videoId, resumeAt);
      }
    }
  }, [appMode, videoId, subLoading]);

  const goHome = () => {
    setAppMode('home');
    pushAppUrl({ mode: 'home' });
  };

  const returnToWatchPlayer = () => {
    if (videoId && watchRouteRef.current.mode === 'watch') {
      isUserScrollingRef.current = false;
      isWordHoveredRef.current = false;
      clearTimeout(userScrollTimeoutRef.current);
      if (currentTimeRef.current > 0) {
        watchRouteRef.current = {
          ...watchRouteRef.current,
          t: Math.floor(currentTimeRef.current),
        };
      }
      setAppMode('watch');
      pushAppUrl(watchRouteRef.current);
    } else {
      goHome();
    }
  };

  // --- Header Omnibox Handler (URL Paste OR YouTube Search) ---
  const handleLoadUrlOrSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = urlInput.trim();
    if (!raw) {
      setSearchQuery('');
      setAppMode('search');
      pushAppUrl({ mode: 'search', q: '' });
      return;
    }

    const akaiwa = parseAkaiwaUrl(raw);
    if (akaiwa.slug) {
      await loadSeries(akaiwa.slug, akaiwa.ep, { syncUrl: 'push' });
      return;
    }

    const yt = parseYouTubeUrl(raw);
    if (yt.playlistId) {
      await loadYouTubePlaylist(yt.playlistId, {
        videoId: yt.videoId || undefined,
        startTime: yt.startSeconds,
        syncUrl: 'push',
      });
      return;
    }
    if (yt.videoId) {
      await loadYouTubeVideo(yt.videoId, {
        startTime: yt.startSeconds,
        syncUrl: 'push',
      });
      return;
    }

    // Otherwise open live YouTube Search directly!
    setSearchQuery(raw);
    setAppMode('search');
    pushAppUrl({ mode: 'search', q: raw });
  };

  // --- Upload .SRT / .VTT Handler (Same flow: immediate playback + auto-save personal if logged in + community publish for authorized) ---
  const handleUploadSubtitle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    let parsed = parseSrtOrVtt(text);
    if (parsed.length === 0) {
      showToast('File phụ đề không hợp lệ hoặc không có câu thoại nào.');
      return;
    }

    // Fill Vietnamese translations automatically if file only has Japanese lines
    const missingViIndices = parsed
      .map((c, idx) => (!c.vi ? idx : -1))
      .filter((idx) => idx !== -1);
    if (missingViIndices.length > 0) {
      const textsToTranslate = missingViIndices.map((idx) => parsed[idx].ja);
      const translations = await translateBatchServer(textsToTranslate);
      parsed = parsed.map((c) => ({ ...c }));
      missingViIndices.forEach((cueIdx, tIdx) => {
        if (translations[tIdx]) parsed[cueIdx].vi = translations[tIdx];
      });
    }

    parsed = applyTrackCues(parsed);
    setSubError(null);
    setRightTab('transcript');
    setHasUnsavedEdits(false);

    if (currentUser && videoId) {
      try {
        const saved = await savePersonalSubtitle({
          videoId,
          title: file.name.replace(/\.(srt|vtt)$/i, ''),
          sourceType: 'uploaded',
          cues: parsed,
        });
        await refreshSavedTracks(videoId);
        setActiveSourceKind('user_saved');
        setActiveTrackId(saved.id);
        showToast(`Đã nạp và lưu "${file.name}" vào tài khoản cá nhân.`);
        return;
      } catch {}
    }

    setSessionUploadTrack({ title: file.name, cues: parsed });
    setActiveSourceKind('session_upload');
    setActiveTrackId(null);
    showToast(`Đã nạp "${file.name}" (phiên hiện tại). Đăng nhập để lưu lâu dài.`);
  };

  // --- AI Subtitle Merging Handler ---
  const handleRunAiMerge = async () => {
    if (!apiKey.trim()) {
      setShowSettings(true);
      showToast('Vui lòng nhập Gemini API Key trong Cài đặt để dùng AI gộp câu.');
      return;
    }
    const sourceCues = rawYouTubeCues.length > 0 ? rawYouTubeCues : cues;
    if (sourceCues.length === 0) {
      showToast('Video chưa có phụ đề gốc để AI gộp câu.');
      return;
    }

    setAiMergingStatus('Đang chuẩn bị dữ liệu phụ đề...');
    setRightTab('transcript');
    try {
      const merged = applyTrackCues(
        await mergeSubtitlesWithGemini(
          apiKey,
          sourceCues,
          geminiModel,
          (_stage, detail) => setAiMergingStatus(detail)
        )
      );

      setSubError(null);
      setHasUnsavedEdits(false);

      if (currentUser && videoId) {
        const saved = await savePersonalSubtitle({
          videoId,
          title: 'AI Gộp câu thông minh',
          sourceType: 'ai_merged',
          cues: merged,
        });
        await refreshSavedTracks(videoId);
        setActiveSourceKind('user_saved');
        setActiveTrackId(saved.id);
        showToast(
          `AI đã gộp ${sourceCues.length} dòng → ${merged.length} câu hoàn chỉnh và lưu vào tài khoản của bạn!`
        );
      } else {
        setSessionAiTrack({ title: 'AI Gộp câu (Chưa lưu)', cues: merged });
        setActiveSourceKind('session_ai');
        setActiveTrackId(null);
        showToast(
          `AI đã gộp thành ${merged.length} câu hoàn chỉnh! Đăng nhập để lưu bản sub này.`
        );
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi chạy AI gộp phụ đề.');
    } finally {
      setAiMergingStatus(null);
    }
  };

  // --- Inline Cue Fix (Edit JA/VI & Merge with Next Cue) ---
  const handleUpdateCueField = (idx: number, field: 'ja' | 'vi', val: string) => {
    setCues((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: val } : c))
    );
    setHasUnsavedEdits(true);
  };

  const handleMergeWithNextCue = (idx: number) => {
    if (idx >= cues.length - 1) return;
    setCues((prev) => {
      const cur = prev[idx];
      const next = prev[idx + 1];
      const combined: SubtitleCue = {
        ...cur,
        end: Math.max(cur.end, next.end),
        ja: `${cur.ja}${next.ja}`.trim(),
        vi: [cur.vi, next.vi].filter(Boolean).join(' '),
      };
      return [...prev.slice(0, idx), combined, ...prev.slice(idx + 2)];
    });
    setHasUnsavedEdits(true);
  };

  const handleDeleteCueLine = (idx: number) => {
    if (cues.length <= 1) return;
    setCues((prev) => prev.filter((_, i) => i !== idx));
    setHasUnsavedEdits(true);
  };

  const handleSaveInlineEdits = async () => {
    if (!currentUser || !videoId) {
      showToast('Đã áp dụng trên phiên hiện tại (đăng nhập để lưu vào tài khoản).');
      setHasUnsavedEdits(false);
      return;
    }

    try {
      if (activeSourceKind === 'community' && activeTrackId) {
        await updateCommunitySubtitle(activeTrackId, { cues });
        await refreshSavedTracks(videoId);
        setHasUnsavedEdits(false);
        showToast('Đã cập nhật bản phụ đề Cộng đồng!');
        return;
      }

      const activePersonal = personalTracks.find((t) => t.id === activeTrackId);
      const sourceType =
        activePersonal?.sourceType ||
        (activeSourceKind === 'session_upload' ? 'uploaded' : 'ai_merged');
      const title =
        activePersonal?.title ||
        (sourceType === 'uploaded' ? 'Sub tự nạp đã chỉnh sửa' : 'Sub AI đã chỉnh sửa');

      const saved = await savePersonalSubtitle({
        videoId,
        title,
        sourceType,
        cues,
      });
      await refreshSavedTracks(videoId);
      setActiveSourceKind('user_saved');
      setActiveTrackId(saved.id);
      setHasUnsavedEdits(false);
      showToast('Đã lưu chỉnh sửa phụ đề vào tài khoản cá nhân!');
    } catch (err: any) {
      showToast(err?.message || 'Không thể lưu chỉnh sửa.');
    }
  };

  // --- Player Navigation ---
  const jumpToCue = (cue: SubtitleCue) => {
    seekTargetRef.current = cue.start;
    isSeekingUntilRef.current = Date.now() + 900;
    setSelectedCue(cue);
    setActiveCue(cue);
    lastCueRef.current = cue;
    syncCurrentTimeUi(cue.start, true);
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(cue.start, true);
    }
    if (watchRouteRef.current.mode === 'watch') {
      lastUrlSyncedTimeRef.current = Math.floor(cue.start);
      replaceAppUrl({ ...watchRouteRef.current, t: Math.floor(cue.start) });
    }
    scrollToActiveCue(cue, 'smooth', true);
  };

  const stepCue = (dir: -1 | 1) => {
    const currentId = activeCue?.id || selectedCue?.id;
    const idx = cues.findIndex((c) => c.id === currentId);
    const next = cues[idx + dir];
    if (next) jumpToCue(next);
  };

  const handleAnalyzeCue = async (cue: SubtitleCue) => {
    if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
      try {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } catch {}
    }

    setSelectedCue(cue);
    setRightTab('analysis');
    setAnalyzing(true);
    setAnalysisError(null);

    try {
      if (!cue.vi) {
        const vi = await quickTranslateJaToVi(cue.ja);
        if (vi) {
          setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, vi } : c)));
        }
      }
      if (!apiKey) {
        setAnalysisError(
          'Vui lòng nhập Gemini API Key trong Cài đặt để AI phân tích cấu trúc ngữ pháp, chiết tự bộ thủ và mẹo nhớ.'
        );
        return;
      }
      const res = await analyzeJapaneseWithGemini(apiKey, cue.ja, geminiModel);
      setAnalysis(res);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Lỗi phân tích.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Stable callbacks so React.memo skips re-rendering all cues when activeCue changes
  const jumpToCueRef = useRef(jumpToCue);
  jumpToCueRef.current = jumpToCue;
  const analyzeCueRef = useRef(handleAnalyzeCue);
  analyzeCueRef.current = handleAnalyzeCue;
  const mergeCueRef = useRef(handleMergeWithNextCue);
  mergeCueRef.current = handleMergeWithNextCue;
  const deleteCueRef = useRef(handleDeleteCueLine);
  deleteCueRef.current = handleDeleteCueLine;
  const updateCueFieldRef = useRef(handleUpdateCueField);
  updateCueFieldRef.current = handleUpdateCueField;

  const handleWordHoverChange = useCallback((hovered: boolean) => {
    isWordHoveredRef.current = hovered;
  }, []);
  const handleTranscriptJump = useCallback((cue: SubtitleCue) => {
    jumpToCueRef.current(cue);
  }, []);
  const handleTranscriptAnalyze = useCallback((cue: SubtitleCue) => {
    void analyzeCueRef.current(cue);
  }, []);
  const handleTranscriptMergeBelow = useCallback((idx: number) => {
    mergeCueRef.current(idx);
  }, []);
  const handleTranscriptDeleteLine = useCallback((idx: number) => {
    deleteCueRef.current(idx);
  }, []);
  const handleTranscriptUpdateField = useCallback(
    (idx: number, field: 'ja' | 'vi', val: string) => {
      updateCueFieldRef.current(idx, field, val);
    },
    []
  );

  // --- Favorites Toggle Helper ---
  const handleToggleFavorite = async (item: {
    itemType: FavoriteItemType;
    itemId: string;
    title: string;
    subtitle?: string;
    thumbnail?: string;
    meta?: Record<string, any>;
  }) => {
    if (!currentUser) {
      setShowAuthModal(true);
      showToast('Hãy đăng nhập để lưu mục Yêu thích về tài khoản của bạn.');
      return;
    }

    const key = `${item.itemType}:${item.itemId}`;
    try {
      if (favoriteKeys.has(key)) {
        await deleteFavorite(item.itemType, item.itemId);
        setFavorites((prev) =>
          prev.filter((f) => !(f.itemType === item.itemType && f.itemId === item.itemId))
        );
        showToast('Đã bỏ khỏi mục Yêu thích.');
      } else {
        const saved = await saveFavorite(item);
        setFavorites((prev) => [saved, ...prev]);
        showToast(`Đã lưu "${item.title}" vào Yêu thích!`);
      }
    } catch (err: any) {
      showToast(err?.message || 'Không thể cập nhật Yêu thích.');
    }
  };

  const currentMediaFavoritePayload = useMemo(() => {
    if (sourceKind === 'anime' && currentSlug) {
      return {
        itemType: 'anime' as FavoriteItemType,
        itemId: currentSlug,
        title: seriesTitle,
        subtitle: `${playlist.length} tập • Anime`,
        thumbnail: mediaThumbnail,
        meta: { lastEp: currentEpNum },
      };
    }
    if (sourceKind === 'yt_playlist' && currentPlaylistId) {
      return {
        itemType: 'playlist' as FavoriteItemType,
        itemId: currentPlaylistId,
        title: seriesTitle,
        subtitle: mediaSubtitleMeta || `${playlist.length} video`,
        thumbnail: mediaThumbnail,
        meta: { lastVideoId: videoId },
      };
    }
    return {
      itemType: 'video' as FavoriteItemType,
      itemId: videoId,
      title: seriesTitle,
      subtitle: mediaSubtitleMeta || 'YouTube Video',
      thumbnail: mediaThumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      meta: {},
    };
  }, [
    sourceKind,
    currentSlug,
    currentPlaylistId,
    videoId,
    seriesTitle,
    playlist.length,
    mediaThumbnail,
    mediaSubtitleMeta,
    currentEpNum,
  ]);

  const isCurrentMediaFavorited = favoriteKeys.has(
    `${currentMediaFavoritePayload.itemType}:${currentMediaFavoritePayload.itemId}`
  );

  return (
    <div className="h-screen flex bg-[#0f0f0f] text-[#f3f2ef] overflow-hidden select-none">
      {/* Left Sidebar (Collapsible) */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-16 items-center' : 'w-56'
        } bg-[#141519] border-r border-white/[0.06] flex flex-col justify-between p-3 shrink-0 transition-all duration-200 select-none`}
      >
        <div className="space-y-5 w-full">
          {/* Logo & Collapse Button */}
          <div
            className={`flex ${
              sidebarCollapsed ? 'flex-col gap-2 items-center' : 'items-center justify-between px-1'
            } pt-1`}
          >
            <div
              onClick={goHome}
              className="flex items-center gap-2.5 overflow-hidden cursor-pointer"
              title="Về Trang chủ KaiwaTube"
            >
              <div className="w-8 h-8 rounded-lg bg-[#e04f3e] flex items-center justify-center font-bold text-white text-base shadow-md shrink-0">
                日
              </div>
              {!sidebarCollapsed && (
                <span className="font-bold text-base tracking-tight truncate">
                  KaiwaTube
                </span>
              )}
            </div>

            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="p-1 rounded-lg text-[#8b909e] hover:text-white hover:bg-[#23252d] transition-colors shrink-0"
              title={sidebarCollapsed ? 'Mở rộng sidebar' : 'Thu nhỏ sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="w-4 h-4 text-[#e04f3e]" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Navigation */}
          <nav className="space-y-1.5 text-sm w-full">
            <button
              onClick={goHome}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              } py-2.5 rounded-xl font-medium transition-colors ${
                appMode === 'home'
                  ? 'bg-[#272727] text-white'
                  : 'text-[#a0a4b0] hover:bg-[#1f2128] hover:text-white'
              }`}
              title="Trang chủ YouTube"
            >
              <Home className="w-4 h-4 text-[#e04f3e] shrink-0" />
              {!sidebarCollapsed && <span className="ml-2.5 truncate">Trang chủ</span>}
            </button>

            {videoId && (
              <button
                onClick={returnToWatchPlayer}
                className={`w-full flex items-center ${
                  sidebarCollapsed ? 'justify-center px-0' : 'px-3'
                } py-2.5 rounded-xl font-medium transition-colors ${
                  appMode === 'watch'
                    ? 'bg-[#272727] text-white'
                    : 'text-[#a0a4b0] hover:bg-[#1f2128] hover:text-white'
                }`}
                title="Đang phát"
              >
                <Play className="w-4 h-4 text-[#e04f3e] shrink-0" />
                {!sidebarCollapsed && <span className="ml-2.5 truncate">Phòng học Video</span>}
              </button>
            )}

            <button
              onClick={() => {
                setAppMode('search');
                pushAppUrl({ mode: 'search', q: searchQuery });
              }}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              } py-2.5 rounded-xl font-medium transition-colors ${
                appMode === 'search'
                  ? 'bg-[#272727] text-white'
                  : 'text-[#a0a4b0] hover:bg-[#1f2128] hover:text-white'
              }`}
              title="Tìm kiếm YouTube"
            >
              <Search className="w-4 h-4 text-[#e04f3e] shrink-0" />
              {!sidebarCollapsed && <span className="ml-2.5 truncate">Tìm kiếm YouTube</span>}
            </button>

            <button
              onClick={() => {
                setAppMode('favorites');
                pushAppUrl({ mode: 'favorites' });
              }}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              } py-2.5 rounded-xl font-medium transition-colors ${
                appMode === 'favorites'
                  ? 'bg-[#272727] text-white'
                  : 'text-[#a0a4b0] hover:bg-[#1f2128] hover:text-white'
              }`}
              title="Yêu thích & Playlist"
            >
              <Heart className="w-4 h-4 text-[#e04f3e] shrink-0" />
              {!sidebarCollapsed && (
                <span className="ml-2.5 truncate">
                  Yêu thích {favorites.length > 0 ? `(${favorites.length})` : ''}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Bottom Account + Admin + Settings */}
        <div className="space-y-1.5 w-full pt-3 border-t border-[#24262f]">
          {currentUser?.role === 'admin' && (
            <button
              onClick={() => setShowAdminModal(true)}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              } py-2 rounded-xl text-xs font-semibold text-[#f7c873] bg-[#e04f3e]/15 hover:bg-[#e04f3e]/25 border border-[#e04f3e]/30 transition-colors`}
              title="Quản trị Phân quyền & Kiểm duyệt"
            >
              <Shield className="w-4 h-4 shrink-0 text-[#e04f3e]" />
              {!sidebarCollapsed && <span className="ml-2.5 truncate">Quản trị Admin</span>}
            </button>
          )}

          <button
            onClick={() => setShowAuthModal(true)}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center px-0' : 'px-3'
            } py-2 rounded-xl text-xs text-[#d0d4e0] hover:bg-[#1f2128] hover:text-white transition-colors`}
            title="Tài khoản & Phân quyền"
          >
            <UserCheck className="w-4 h-4 shrink-0 text-[#f7c873]" />
            {!sidebarCollapsed && (
              <div className="ml-2.5 text-left min-w-0">
                <div className="font-semibold truncate">
                  {currentUser ? currentUser.displayName : 'Đăng nhập / Đăng ký'}
                </div>
                {currentUser && (
                  <div className="text-[10px] text-[#8b909e] truncate">
                    {currentUser.role === 'admin'
                      ? '👑 Admin'
                      : currentUser.role === 'contributor'
                      ? '✓ Cộng tác viên Sub'
                      : 'Thành viên'}
                  </div>
                )}
              </div>
            )}
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center px-0' : 'px-3'
            } py-2 rounded-xl text-xs text-[#a0a4b0] hover:bg-[#1f2128] hover:text-white transition-colors`}
            title="Cài đặt API Key & Model"
          >
            <Settings className="w-4 h-4 shrink-0 text-[#8b909e]" />
            {!sidebarCollapsed && <span className="ml-2.5 truncate">Cài đặt AI & Model</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Global Status Toast */}
        {statusToast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#1f222c] border border-[#e04f3e]/60 text-xs font-medium text-white shadow-2xl">
            {statusToast}
          </div>
        )}

        {/* Top Header (YouTube-style Search Bar) */}
        <header className="h-14 border-b border-white/[0.06] bg-[#0f0f0f] px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
          <div className="hidden lg:block w-16 shrink-0" />

          <form
            onSubmit={handleLoadUrlOrSearch}
            className="flex-1 min-w-0 max-w-2xl mx-auto flex items-center rounded-full bg-[#121212] border border-[#303030] focus-within:border-[#3ea6ff] overflow-hidden"
          >
            <div className="relative flex-1 min-w-0 flex items-center">
              <Search className="hidden sm:block w-4 h-4 text-[#7a7f8c] ml-4 shrink-0" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Tìm kiếm video, playlist hoặc dán link YouTube..."
                data-testid="header-search-input"
                className="w-full min-w-0 bg-transparent px-3 py-1.5 text-sm text-white placeholder-[#888888] focus:outline-none"
              />
              {urlInput && (
                <button
                  type="button"
                  onClick={() => setUrlInput('')}
                  title="Xóa tìm kiếm"
                  className="p-1.5 mr-1 rounded-full text-[#aaaaaa] hover:text-white hover:bg-white/10 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              title="Tìm kiếm"
              data-testid="header-search-submit"
              className="px-3.5 sm:px-5 py-2 bg-[#222222] hover:bg-[#303030] border-l border-[#303030] text-[#f1f1f1] flex items-center justify-center transition-colors shrink-0"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {appMode === 'watch' && (
              <label
                title="Nạp .SRT / .VTT"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-[#222222] hover:bg-[#303030] text-xs font-medium cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-[#e04f3e]" />
                <span className="hidden sm:inline">Nạp .SRT / .VTT</span>
                <input
                  type="file"
                  accept=".srt,.vtt"
                  onChange={handleUploadSubtitle}
                  className="hidden"
                />
              </label>
            )}

            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full bg-[#222222] hover:bg-[#303030] text-xs font-semibold text-[#f7c873] transition-colors border border-white/10"
              title={currentUser ? currentUser.displayName : 'Đăng nhập'}
            >
              <UserCheck className="w-3.5 h-3.5 text-[#e04f3e]" />
              <span className="hidden sm:inline truncate max-w-[120px]">
                {currentUser ? currentUser.displayName : 'Đăng nhập'}
              </span>
            </button>
          </div>
        </header>

        {/* Workspace Area: Home Feed vs Search View vs Favorites View vs Watch View */}
        {appMode === 'home' ? (
          <HomeFeedView
            onSelectVideo={(v: YouTubeSearchVideo) => {
              void loadYouTubeVideo(v.videoId, {
                titleHint: v.title,
                syncUrl: 'push',
              });
            }}
            onSelectPlaylist={(pl: YouTubeSearchPlaylist) => {
              void loadYouTubePlaylist(pl.listId, { syncUrl: 'push' });
            }}
            onOpenRecent={(item) => {
              if (item.listId) {
                void loadYouTubePlaylist(item.listId, {
                  videoId: item.videoId,
                  startTime: item.lastTime || 0,
                  syncUrl: 'push',
                });
              } else {
                void loadYouTubeVideo(item.videoId, {
                  titleHint: item.title,
                  startTime: item.lastTime || 0,
                  syncUrl: 'push',
                });
              }
            }}
            recentItems={recentItems}
            onClearRecent={() => {
              setRecentItems([]);
              try {
                localStorage.removeItem(RECENT_STORAGE_KEY);
              } catch {}
            }}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        ) : appMode === 'search' ? (
          <YouTubeSearchView
            query={searchQuery}
            onQuerySelect={(q) => {
              setUrlInput(q);
              setSearchQuery(q);
              pushAppUrl({ mode: 'search', q });
            }}
            onSelectVideo={(v: YouTubeSearchVideo) => {
              void loadYouTubeVideo(v.videoId, {
                titleHint: v.title,
                syncUrl: 'push',
              });
            }}
            onSelectPlaylist={(pl: YouTubeSearchPlaylist) => {
              void loadYouTubePlaylist(pl.listId, { syncUrl: 'push' });
            }}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
            onBackHome={goHome}
          />
        ) : appMode === 'favorites' ? (
          <FavoritesView
            currentUser={currentUser}
            favorites={favorites}
            onOpenFavorite={(fav) => {
              if (fav.itemType === 'anime') {
                void loadSeries(fav.itemId, fav.meta?.lastEp || 1, { syncUrl: 'push' });
              } else if (fav.itemType === 'playlist') {
                void loadYouTubePlaylist(fav.itemId, {
                  videoId: fav.meta?.lastVideoId,
                  syncUrl: 'push',
                });
              } else {
                void loadYouTubeVideo(fav.itemId, {
                  titleHint: fav.title,
                  syncUrl: 'push',
                });
              }
            }}
            onDeleteFavorite={async (t, id) => {
              await deleteFavorite(t, id);
              setFavorites((prev) =>
                prev.filter((f) => !(f.itemType === t && f.itemId === id))
              );
            }}
            onOpenAuthModal={() => setShowAuthModal(true)}
            onBackToPlayer={goHome}
          />
        ) : (
          /* Watch Mode: Video + Subtitle + Right Learning Panel */
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
            {/* Left Main Player Column */}
            <main className="lg:flex-1 flex flex-col p-3 sm:p-4 gap-3 min-w-0 lg:overflow-y-auto">
              <div className="flex items-center justify-between gap-3 text-sm font-semibold text-white">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">
                    {seriesTitle}
                    {sourceKind === 'anime' && currentEpNum
                      ? ` • Tập ${currentEpNum}`
                      : sourceKind === 'yt_playlist'
                      ? (() => {
                          const cur = playlist.find((p) => p.videoId === videoId);
                          return cur ? ` • ${cur.title}` : '';
                        })()
                      : ''}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggleFavorite(currentMediaFavoritePayload)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                      isCurrentMediaFavorited
                        ? 'bg-[#e04f3e]/20 border-[#e04f3e] text-[#f7c873]'
                        : 'bg-[#1c1e24] border-[#2c303c] text-[#b4b9c8] hover:text-white hover:border-[#e04f3e]/60'
                    }`}
                    title={isCurrentMediaFavorited ? 'Đã lưu Yêu thích' : 'Lưu vào mục Yêu thích'}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        isCurrentMediaFavorited ? 'fill-[#e04f3e] text-[#e04f3e]' : ''
                      }`}
                    />
                    {isCurrentMediaFavorited ? 'Đã lưu' : 'Lưu Yêu thích'}
                  </button>

                  <span ref={timeDisplayRef} className="text-xs text-[#8b909e] font-mono" />
                </div>
              </div>

              <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[#262830] relative shadow-lg">
                <div id="youtube-player-element" className="w-full h-full" />
                {subLoading && (
                  <div
                    data-testid="player-subtitle-gate"
                    className="absolute inset-0 z-10 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center"
                  >
                    {(mediaThumbnail || videoId) && (
                      <img
                        src={mediaThumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
                      />
                    )}
                    <div className="relative z-10 flex flex-col items-center gap-2.5 max-w-sm">
                      <Loader2 className="w-8 h-8 animate-spin text-[#e04f3e]" />
                      <div className="text-sm font-semibold text-white">
                        Đang tải phụ đề trước khi phát...
                      </div>
                      <p className="text-xs text-[#b8bdd0]">
                        Video sẽ tự động bắt đầu ngay khi đồng bộ xong phụ đề để tránh lệch hình và lời thoại.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Bilingual Subtitle Box with Kanji Hover & Click */}
              <div
                onClick={() => {
                  if (activeCue) jumpToCue(activeCue);
                }}
                className="p-4 rounded-xl bg-[#1a1b20] border border-[#282a33] text-center space-y-2 min-h-[110px] flex flex-col justify-center relative shadow-sm cursor-pointer hover:border-[#383c4a] transition-colors"
                title="Bấm vào khung để phát lại từ đầu câu thoại này"
              >
                {subLoading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-[#8b909e]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#e04f3e]" />
                    Đang đồng bộ phụ đề tiếng Nhật & tiếng Việt...
                  </div>
                ) : activeCue ? (
                  <div className="space-y-1.5">
                    <div className="text-2xl font-semibold text-[#f7c873] leading-relaxed tracking-wide">
                      <InteractiveJapaneseText
                        text={activeCue.ja}
                        apiKey={apiKey}
                        geminiModel={geminiModel}
                        onHoverChange={handleWordHoverChange}
                        onSentenceClick={() => handleAnalyzeCue(activeCue)}
                      />
                    </div>
                    {activeCue.vi && (
                      <div className="text-sm font-medium text-[#c8cdd9] leading-normal">
                        {activeCue.vi}
                      </div>
                    )}
                  </div>
                ) : subError ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{subError}</span>
                  </div>
                ) : (
                  <div className="text-xs text-[#6e7382] italic">
                    (Đoạn nhạc hoặc im lặng • Chờ lời thoại tiếp theo)
                  </div>
                )}
              </div>

              {/* Learning Controls */}
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 py-1">
                <button
                  onClick={() => stepCue(-1)}
                  className="p-2 rounded-lg bg-[#1f2128] hover:bg-[#2a2d37] text-[#d0d3dc] transition-colors"
                  title="Lùi 1 câu"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    isPlaying
                      ? playerRef.current?.pauseVideo()
                      : playerRef.current?.playVideo()
                  }
                  className="p-3 rounded-full bg-[#e04f3e] hover:bg-[#c94333] text-white shadow-md transition-all active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 ml-0.5" />
                  )}
                </button>
                <button
                  onClick={() => stepCue(1)}
                  className="p-2 rounded-lg bg-[#1f2128] hover:bg-[#2a2d37] text-[#d0d3dc] transition-colors"
                  title="Tiến 1 câu"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setLoopCue((v) => !v)}
                  className={`p-2 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
                    loopCue
                      ? 'bg-[#e04f3e]/20 border-[#e04f3e] text-[#e04f3e]'
                      : 'bg-[#1f2128] border-transparent text-[#a0a4b0]'
                  }`}
                  title="Lặp lại câu này"
                >
                  <Repeat className="w-4 h-4" />
                </button>
                {(activeCue || selectedCue) && (
                  <button
                    onClick={() => handleAnalyzeCue((activeCue || selectedCue)!)}
                    className="ml-2 px-3 py-2 rounded-lg bg-[#23252d] hover:bg-[#2f323d] text-xs font-semibold text-[#f7c873] flex items-center gap-1.5 whitespace-nowrap transition-colors border border-[#3e4350]"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#e04f3e]" />
                    AI Giải thích câu này
                  </button>
                )}
              </div>
            </main>

            {/* Right Panel: Transcript + Deep Analysis + Episodes/Playlist */}
            <aside className="w-full lg:w-[460px] xl:w-[520px] 2xl:w-[580px] min-h-[420px] lg:min-h-0 border-t lg:border-t-0 lg:border-l border-[#262830] bg-[#17181c] flex flex-col shrink-0 transition-all duration-200">
              <div className="flex border-b border-[#262830] text-xs font-medium shrink-0">
                <button
                  onClick={() => setRightTab('transcript')}
                  className={`flex-1 py-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    rightTab === 'transcript'
                      ? 'border-[#e04f3e] text-white'
                      : 'border-transparent text-[#8b909e] hover:text-white'
                  }`}
                >
                  <MessageSquareText className="w-3.5 h-3.5" />
                  Hội thoại ({cues.length})
                </button>
                <button
                  onClick={() => setRightTab('analysis')}
                  className={`flex-1 py-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    rightTab === 'analysis'
                      ? 'border-[#e04f3e] text-white'
                      : 'border-transparent text-[#8b909e] hover:text-white'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Phân tích
                </button>
                <button
                  onClick={() => setRightTab('episodes')}
                  className={`flex-1 py-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    rightTab === 'episodes'
                      ? 'border-[#e04f3e] text-white'
                      : 'border-transparent text-[#8b909e] hover:text-white'
                  }`}
                >
                  <ListVideo className="w-3.5 h-3.5" />
                  {sourceKind === 'yt_playlist' ? 'Playlist' : 'Tập'} ({playlist.length})
                </button>
              </div>

              {/* Subtitle Control Bar (Only in Transcript Tab) */}
              {rightTab === 'transcript' && (
                <SubtitleControlBar
                  currentUser={currentUser}
                  activeSourceKind={activeSourceKind}
                  activeTrackId={activeTrackId}
                  hasRawYouTubeSub={rawYouTubeCues.length > 0}
                  communityTracks={communityTracks}
                  personalTracks={personalTracks}
                  sessionTrackTitle={
                    activeSourceKind === 'session_ai'
                      ? sessionAiTrack?.title || null
                      : activeSourceKind === 'session_upload'
                      ? sessionUploadTrack?.title || null
                      : null
                  }
                  aiMergingStatus={aiMergingStatus}
                  editMode={editMode}
                  hasUnsavedEdits={hasUnsavedEdits}
                  onSelectYouTubeCC={() => {
                    applyTrackCues(rawYouTubeCues);
                    setActiveSourceKind('youtube_cc');
                    setActiveTrackId(null);
                    setEditMode(false);
                    setHasUnsavedEdits(false);
                  }}
                  onSelectCommunityTrack={(tr) => {
                    applyTrackCues(tr.cues);
                    setActiveSourceKind('community');
                    setActiveTrackId(tr.id);
                    setEditMode(false);
                    setHasUnsavedEdits(false);
                  }}
                  onSelectPersonalTrack={(tr) => {
                    applyTrackCues(tr.cues);
                    setActiveSourceKind('user_saved');
                    setActiveTrackId(tr.id);
                    setEditMode(false);
                    setHasUnsavedEdits(false);
                  }}
                  onSelectSessionTrack={() => {
                    if (sessionAiTrack) {
                      applyTrackCues(sessionAiTrack.cues);
                      setActiveSourceKind('session_ai');
                      setActiveTrackId(null);
                    } else if (sessionUploadTrack) {
                      applyTrackCues(sessionUploadTrack.cues);
                      setActiveSourceKind('session_upload');
                      setActiveTrackId(null);
                    }
                  }}
                  onRunAiMerge={() => void handleRunAiMerge()}
                  onPublishCommunity={async (title) => {
                    const sourceType =
                      activeSourceKind === 'session_upload' ||
                      personalTracks.find((t) => t.id === activeTrackId)?.sourceType === 'uploaded'
                        ? 'uploaded'
                        : 'ai_merged';
                    const published = await publishCommunitySubtitle({
                      videoId,
                      title,
                      sourceType,
                      cues,
                    });
                    await refreshSavedTracks(videoId);
                    setActiveSourceKind('community');
                    setActiveTrackId(published.id);
                    setHasUnsavedEdits(false);
                    showToast(`Đã công khai "${title}" cho toàn cộng đồng!`);
                  }}
                  onDeleteCommunityTrack={async (id) => {
                    await deleteCommunitySubtitle(id);
                    await refreshSavedTracks(videoId);
                    setCues(rawYouTubeCues);
                    cuesRef.current = rawYouTubeCues;
                    setActiveSourceKind('youtube_cc');
                    setActiveTrackId(null);
                    showToast('Đã xóa bản phụ đề cộng đồng.');
                  }}
                  onDeletePersonalTrack={async (id) => {
                    await deletePersonalSubtitle(id);
                    await refreshSavedTracks(videoId);
                    setCues(rawYouTubeCues);
                    cuesRef.current = rawYouTubeCues;
                    setActiveSourceKind('youtube_cc');
                    setActiveTrackId(null);
                    showToast('Đã xóa bản phụ đề cá nhân.');
                  }}
                  onReportCommunityTrack={async (id, reason) => {
                    await reportCommunitySubtitle(id, reason);
                    showToast('Cảm ơn! Báo cáo của bạn đã được gửi tới Admin.');
                  }}
                  onToggleEditMode={() => setEditMode((v) => !v)}
                  onSaveEdits={handleSaveInlineEdits}
                />
              )}

              <div
                ref={transcriptListRef}
                onWheel={() => {
                  if (rightTab !== 'transcript') return;
                  isUserScrollingRef.current = true;
                  clearTimeout(userScrollTimeoutRef.current);
                  userScrollTimeoutRef.current = setTimeout(() => {
                    isUserScrollingRef.current = false;
                  }, 3000);
                }}
                onTouchMove={() => {
                  if (rightTab !== 'transcript') return;
                  isUserScrollingRef.current = true;
                  clearTimeout(userScrollTimeoutRef.current);
                  userScrollTimeoutRef.current = setTimeout(() => {
                    isUserScrollingRef.current = false;
                  }, 3000);
                }}
                className="relative flex-1 overflow-y-auto p-3 space-y-2.5"
              >
                {/* Tab 1: Transcript */}
                {rightTab === 'transcript' &&
                  cues.map((cue, cueIdx) => (
                    <TranscriptCueCard
                      key={cue.id}
                      cue={cue}
                      cueIdx={cueIdx}
                      isActive={activeCue?.id === cue.id}
                      editMode={editMode}
                      canMergeBelow={cueIdx < cues.length - 1}
                      apiKey={apiKey}
                      geminiModel={geminiModel}
                      onWordHoverChange={handleWordHoverChange}
                      onJumpToCue={handleTranscriptJump}
                      onAnalyzeCue={handleTranscriptAnalyze}
                      onMergeBelow={handleTranscriptMergeBelow}
                      onDeleteLine={handleTranscriptDeleteLine}
                      onUpdateField={handleTranscriptUpdateField}
                    />
                  ))}

                {/* Tab 2: Deep Analysis */}
                {rightTab === 'analysis' && (
                  <AnalysisTabPanel
                    geminiModel={geminiModel}
                    apiKey={apiKey}
                    analyzing={analyzing}
                    analysisError={analysisError}
                    analysis={analysis}
                    onOpenSettings={() => setShowSettings(true)}
                    onRetry={() => {
                      const target = selectedCue || activeCue;
                      if (target) void analyzeCueRef.current(target);
                    }}
                  />
                )}

                {/* Tab 3: Episodes / YouTube Playlist Items */}
                {rightTab === 'episodes' &&
                  (playlist.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[#8b909e]">
                      Video đơn lẻ này không thuộc Playlist nhiều tập.
                    </div>
                  ) : (
                    playlist.map((item) => {
                      const isCurrentItem =
                        sourceKind === 'yt_playlist'
                          ? item.videoId === videoId
                          : currentEpNum === item.ep_number;

                      return (
                        <div
                          key={`${item.ep_number}-${item.videoId}`}
                          onClick={() => {
                            if (sourceKind === 'yt_playlist' && currentPlaylistId) {
                              setCurrentEpNum(item.ep_number);
                              void loadYouTubeVideo(item.videoId, {
                                playlistId: currentPlaylistId,
                                titleHint: seriesTitle,
                                syncUrl: 'push',
                                preservePlaylist: true,
                              });
                            } else {
                              void loadSeries(currentSlug, item.ep_number, { syncUrl: 'push' });
                            }
                          }}
                          className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer border transition-colors ${
                            isCurrentItem
                              ? 'bg-[#222530] border-[#e04f3e]'
                              : 'bg-[#1c1e24] border-transparent hover:border-[#2e313d]'
                          }`}
                        >
                          <img
                            src={item.thumbnail}
                            alt={item.title}
                            className="w-20 h-12 object-cover rounded-lg shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-white line-clamp-2">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-[#7a7f8c] mt-0.5 flex items-center gap-2">
                              {item.duration && <span>{item.duration}</span>}
                              <span className="truncate">
                                {sourceKind === 'yt_playlist'
                                  ? item.author || 'YouTube'
                                  : currentSlug}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ))}
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* Modals */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        apiKey={apiKey}
        geminiModel={geminiModel}
        onSave={(nextKey, nextModel) => {
          setApiKey(nextKey);
          setGeminiModel(nextModel);
          localStorage.setItem('nihongo_gemini_key', nextKey);
          localStorage.setItem('nihongo_gemini_model', nextModel);
        }}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        currentUser={currentUser}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          void fetchFavorites().then(setFavorites).catch(() => {});
          showToast(`Chào mừng ${user.displayName}!`);
        }}
        onLogout={() => {
          setAuthToken('');
          setCurrentUser(null);
          setFavorites([]);
          setPersonalTracks([]);
          showToast('Đã đăng xuất.');
        }}
      />

      <AdminPanelModal
        isOpen={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        currentUser={currentUser}
        onOpenVideoId={(vid) => {
          void loadYouTubeVideo(vid, { syncUrl: 'push' });
        }}
        onCommunityChanged={() => {
          if (videoId) void refreshSavedTracks(videoId);
        }}
      />
    </div>
  );
}

export default App;
