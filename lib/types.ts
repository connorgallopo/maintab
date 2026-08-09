export type Tone = 'accent' | 'crit' | 'warn' | 'good' | 'dim';

export interface RowItem {
  id: string;
  href: string;
  repo?: string;
  primary: string;
  badge?: { kind: 'pill' | 'tag'; text: string; tone: Tone };
  spark?: number[];
  value?: string;
  delta?: string;
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

export interface Config {
  pat: string;
  pollMinutes: number;
  themePin: 'system' | 'light' | 'dark';
  modules: { stars: { trackedRepos: string[] } };
}

export interface SyncState {
  lastSyncAt: number;
  inFlightSince: number;
  backoffUntil: number;
  pollIntervalHint: number;
  authError: boolean;
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
  graphql?: {
    fragment: (config: Config, cursor: string | null) => string;
    map: (resp: unknown, prev: Data | undefined) => Data & { nextCursor?: string | null };
  };
  fetchData?: (ctx: FetchCtx, stored: Stored | undefined, now: number) => Promise<Data>;
  derive: (data: Data, stored: Stored | undefined, now: number) => { slice: Slice; stored: Stored };
}
