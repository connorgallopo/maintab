export type Tone = 'accent' | 'crit' | 'warn' | 'good' | 'dim' | 'mid';

export interface RowItem {
  id: string;
  href: string;
  repo?: string;
  primary: string;
  badge?: { kind: 'pill' | 'tag'; text: string; tone: Tone };
  spark?: number[];
  value?: string;
  delta?: string;
  counts?: { value: number; tone: Tone }[];
}

export interface Tile {
  n: number;
  label: string;
  note?: string;
  noteTone?: Tone;
  accent?: boolean;
}

export interface Slice {
  status: 'ok' | 'empty' | 'error';
  emptyText?: string;
  headerHref: string;
  headerLabel: string;
  items: RowItem[];
  tile?: Tile;
}

export type RepoAffiliation = 'OWNER' | 'COLLABORATOR' | 'ORGANIZATION_MEMBER';
export type RepoPermission = 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface RepoScopeConfig {
  affiliations: RepoAffiliation[];
  minPermission: RepoPermission;
  includeForks: boolean;
  ignored: string[];
  pinned: string[];
}

export interface Config {
  pat: string;
  pollMinutes: number;
  themePin: 'system' | 'light' | 'dark';
  repos: RepoScopeConfig;
  modules: {
    incoming: { enabled: boolean; rowCap: number };
    prs: { enabled: boolean; rowCap: number; includeReviewRequests: boolean; staleDays: number };
    issues: { enabled: boolean; rowCap: number; includeInvolved: boolean };
    notifications: { enabled: boolean; rowCap: number; hideReasons: string[]; participatingOnly: boolean };
    vulns: { enabled: boolean; minSeverity: Severity };
    builds: { enabled: boolean };
    stars: { enabled: boolean; trackedRepos: string[] };
  };
}

export type ModuleId = keyof Config['modules'];

export interface SyncState {
  lastSyncAt: number;
  inFlightSince: number;
  backoffUntil: number;
  authError: boolean;
  login: string;
  lastError: 'auth' | 'rate-limit' | 'error' | null;
}

export interface RepoRef {
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  viewerPermission: RepoPermission | null;
}

export interface ReposCache {
  scopeKey: string;
  discoveredAt: number;
  refs: RepoRef[];
}

export type RepoNode = RepoRef & Record<string, unknown>;

export interface RepoCtx {
  config: Config;
  login: string;
}

export interface ModuleState {
  v: number;
  slice: Slice;
  data: unknown;
}

export type ModulesState = Record<string, ModuleState>;

export interface FetchCtx {
  pat: string;
  config: Config;
}

export interface ModuleDef<Data = unknown, Stored = unknown> {
  id: string;
  title: string;
  version: number;
  migrate?: (old: unknown, oldVersion: number) => Stored;
  repoFields?: (config: Config) => string;
  graphql?: {
    fragment: (config: Config, cursor: string | null) => string;
    map: (resp: unknown, prev: Data | undefined, config?: Config) => Data & { nextCursor?: string | null };
  };
  mapRepos?: (repos: RepoNode[], prev: Data | undefined, ctx: RepoCtx) => Data;
  fetchData?: (ctx: FetchCtx, stored: Stored | undefined, now: number) => Promise<Data>;
  derive: (data: Data, stored: Stored | undefined, now: number, config?: Config) => { slice: Slice; stored: Stored };
}
