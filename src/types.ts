export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  ja: string;
  vi?: string;
}

export interface PlaylistItem {
  ep_number: number;
  videoId: string;
  title: string;
  thumbnail: string;
  duration?: string;
  author?: string;
}

export interface AnimeSeriesMeta {
  slug: string;
  titleVi: string;
  channel: string;
  jlptLevel: string;
  totalEpisodes: number;
  posterUrl: string;
}

export type UserRole = 'user' | 'contributor' | 'admin';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export type FavoriteItemType = 'video' | 'playlist' | 'anime';

export interface FavoriteItem {
  id: number;
  itemType: FavoriteItemType;
  itemId: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  meta: Record<string, any>;
  createdAt: string;
}

export interface SavedSubtitleTrack {
  id: number;
  videoId: string;
  title: string;
  sourceType: 'ai_merged' | 'uploaded';
  authorId?: number;
  authorName?: string;
  cueCount: number;
  reportCount?: number;
  createdAt: string;
  updatedAt: string;
  cues: SubtitleCue[];
}

export type ActiveSubtitleSourceKind =
  | 'youtube_cc'
  | 'community'
  | 'user_saved'
  | 'session_ai'
  | 'session_upload';

export interface YouTubeSearchVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  seconds: number;
  views: number;
  ago: string;
  author: string;
}

export interface YouTubeSearchPlaylist {
  listId: string;
  title: string;
  thumbnail: string;
  videoCount: number;
  author: string;
}

export interface CommunityReportItem {
  id: number;
  community_sub_id: number;
  reason: string;
  created_at: string;
  reporter_username: string;
  video_id: string;
  sub_title: string;
  author_name: string;
  source_type: string;
}

export interface KanjiRadical {
  radical: string;
  name: string;
  meaning: string;
  position?: string;
}

export interface KanjiBreakdown {
  kanji: string;
  hanViet: string;
  meaning: string;
  onyomi: string[];
  kunyomi: string[];
  jlpt?: string;
  strokes?: number;
  strokeOrder?: string;
  radicals: KanjiRadical[];
  decomposition?: string;
  mnemonic?: string;
  commonWords?: Array<{ word: string; reading: string; meaning: string }>;
}

export interface GrammarPoint {
  pattern: string;
  formula?: string;
  meaning: string;
  explanation: string;
  nuance?: string;
  jlpt?: string;
  examples?: Array<{ ja: string; vi: string }>;
}

export interface SentenceToken {
  surface: string;
  reading: string;
  pos: string;
  meaning: string;
  baseForm?: string;
}

export interface ConjugationBreakdown {
  surface: string;
  baseForm: string;
  posType?: string;
  formName: string;
  chain: string;
  reason: string;
}

export interface JapaneseAnalysisResult {
  text: string;
  reading: string;
  romaji?: string;
  translation: string;
  naturalTranslation?: string;
  jlptLevel?: string;
  nuance?: string;
  ellipsis?: string;
  conjugations?: ConjugationBreakdown[];
  tokens: SentenceToken[];
  kanjiList: KanjiBreakdown[];
  grammarPoints: GrammarPoint[];
  explanation?: string;
}
