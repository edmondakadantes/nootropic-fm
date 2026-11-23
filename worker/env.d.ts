export interface D1Meta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface R2HttpMetadata {
  contentType?: string;
  cacheControl?: string;
}

export interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

export interface R2ObjectInfo {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: R2HttpMetadata;
}

export interface R2ObjectBody extends R2ObjectInfo {
  body: ReadableStream<Uint8Array>;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2Objects {
  objects: R2ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  get(key: string, options?: { range?: R2Range }): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>,
    options?: { httpMetadata?: R2HttpMetadata; customMetadata?: Record<string, string> }
  ): Promise<R2ObjectInfo>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2Objects>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AUDIO_BUCKET?: R2Bucket;
  AI?: WorkersAiBinding;
  APP_ENV?: string;
  ENABLE_LLM_PARSE?: string;
  GEMINI_API_KEY?: string;
  GEMINI_DAILY_CAP?: string;
  GEMINI_MUSIC_API_KEY?: string;
  MUSIC_PROVIDER?: string;
  MUSIC_GEN_DAILY_CAP?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_ENTERPRISE_APPROVED?: string;
  NCBI_API_KEY?: string;
  OPENALEX_API_KEY?: string;
  ADMIN_EXPORT_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_ANNUAL?: string;
}
