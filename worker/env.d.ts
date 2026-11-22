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

export interface R2ObjectInfo {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: {
    contentType?: string;
  };
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
  get(key: string): Promise<R2ObjectBody | null>;
  list(options?: { prefix?: string; limit?: number }): Promise<R2Objects>;
}

export interface Env {
  DB: D1Database;
  AUDIO_BUCKET?: R2Bucket;
  APP_ENV?: string;
  GEMINI_API_KEY?: string;
  GEMINI_DAILY_CAP?: string;
  ADMIN_EXPORT_KEY?: string;
}
