/**
 * nootropic.fm v7.1 — Progressive Ogg/Opus HTTP Range -> WebCodecs AudioDecoder Feeder
 *
 * Parses Ogg page headers progressively from a fetch() ReadableStream, extracts Opus packets,
 * strips RFC 7845 OpusHead `preSkip` frames, decodes directly via WebCodecs `AudioDecoder`
 * at 48 kHz stereo without main-thread decodeAudioData stalls, and pumps 16,384-frame chunks
 * into `NootropicStemPlayer` via backpressure (`need_chunk`) for <200 ms startup & low RAM.
 */

export interface ParsedOggPage {
  headerType: number;
  granulePosition: bigint;
  serial: number;
  sequence: number;
  segments: Uint8Array[];
  byteLength: number;
}

/**
 * Parses as many complete Ogg pages as exist in `buffer`.
 * Returns parsed pages and the number of consumed bytes from the start of `buffer`.
 */
export function parseOggOpusPages(buffer: Uint8Array): {
  pages: ParsedOggPage[];
  consumedBytes: number;
} {
  const pages: ParsedOggPage[] = [];
  let offset = 0;

  while (offset + 27 <= buffer.length) {
    // Capture pattern "OggS" (0x4F 0x67 0x67 0x53)
    if (
      buffer[offset] !== 0x4f ||
      buffer[offset + 1] !== 0x67 ||
      buffer[offset + 2] !== 0x67 ||
      buffer[offset + 3] !== 0x53
    ) {
      // Scan forward if unaligned
      const nextSync = buffer.indexOf(0x4f, offset + 1);
      if (nextSync === -1) {
        offset = buffer.length;
        break;
      }
      offset = nextSync;
      continue;
    }

    const headerType = buffer[offset + 5];
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 27);
    const granulePosition = view.getBigInt64(6, true);
    const serial = view.getUint32(14, true);
    const sequence = view.getUint32(18, true);
    const pageSegments = buffer[offset + 26];

    const segTableStart = offset + 27;
    const payloadStart = segTableStart + pageSegments;
    if (payloadStart > buffer.length) break;

    let payloadBytes = 0;
    for (let s = 0; s < pageSegments; s++) {
      payloadBytes += buffer[segTableStart + s];
    }
    const pageEnd = payloadStart + payloadBytes;
    if (pageEnd > buffer.length) break;

    const segments: Uint8Array[] = [];
    let cursor = payloadStart;
    for (let s = 0; s < pageSegments; s++) {
      const segLen = buffer[segTableStart + s];
      segments.push(buffer.subarray(cursor, cursor + segLen));
      cursor += segLen;
    }

    pages.push({
      headerType,
      granulePosition,
      serial,
      sequence,
      segments,
      byteLength: pageEnd - offset,
    });
    offset = pageEnd;
  }

  return { pages, consumedBytes: offset };
}

/**
 * Reassembles logical Opus packets spanning Ogg lacing segments, extracting
 * `OpusHead` metadata (`channels`, `preSkip`, `inputSampleRate`) and audio packets.
 */
export function extractOggOpusPackets(
  pages: ParsedOggPage[],
  state?: {
    pending?: Uint8Array[];
    seenHead?: boolean;
    seenTags?: boolean;
    preSkip?: number;
    channels?: number;
  }
): {
  head?: { channels: number; preSkip: number; inputSampleRate: number };
  audioPackets: Uint8Array[];
  pending: Uint8Array[];
  seenHead: boolean;
  seenTags: boolean;
  preSkip: number;
  channels: number;
} {
  let pending = state?.pending ? [...state.pending] : [];
  let seenHead = state?.seenHead ?? false;
  let seenTags = state?.seenTags ?? false;
  let preSkip = state?.preSkip ?? 312;
  let channels = state?.channels ?? 2;
  let head: { channels: number; preSkip: number; inputSampleRate: number } | undefined;
  const audioPackets: Uint8Array[] = [];

  const concatParts = (parts: Uint8Array[]): Uint8Array => {
    if (parts.length === 1) return parts[0];
    let total = 0;
    for (const p of parts) total += p.length;
    const merged = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      merged.set(p, pos);
      pos += p.length;
    }
    return merged;
  };

  for (const page of pages) {
    for (const seg of page.segments) {
      pending.push(seg);
      if (seg.length < 255) {
        const packet = concatParts(pending);
        pending = [];
        if (packet.length === 0) continue;

        if (
          !seenHead &&
          packet.length >= 19 &&
          packet[0] === 0x4f &&
          packet[1] === 0x70 &&
          packet[2] === 0x75 &&
          packet[3] === 0x73 &&
          packet[4] === 0x48 &&
          packet[5] === 0x65 &&
          packet[6] === 0x61 &&
          packet[7] === 0x64
        ) {
          seenHead = true;
          channels = Math.max(1, packet[9] || 2);
          const dv = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
          preSkip = dv.getUint16(10, true);
          const inputSampleRate = dv.getUint32(12, true) || 48000;
          head = { channels, preSkip, inputSampleRate };
        } else if (
          !seenTags &&
          packet.length >= 8 &&
          packet[0] === 0x4f &&
          packet[1] === 0x70 &&
          packet[2] === 0x75 &&
          packet[3] === 0x73 &&
          packet[4] === 0x54 &&
          packet[5] === 0x61 &&
          packet[6] === 0x67 &&
          packet[7] === 0x73
        ) {
          seenTags = true;
        } else {
          audioPackets.push(packet);
        }
      }
    }
  }

  return { head, audioPackets, pending, seenHead, seenTags, preSkip, channels };
}

interface WebCodecsAudioDataLike {
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  copyTo(dest: BufferSource, opts: { planeIndex: number; format?: string }): void;
  close(): void;
}

interface WebCodecsDecoderCtor {
  isConfigSupported(cfg: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
  }): Promise<{ supported?: boolean }>;
  new (init: {
    output: (data: WebCodecsAudioDataLike) => void;
    error: (err: unknown) => void;
  }): {
    state: string;
    configure(cfg: { codec: string; sampleRate: number; numberOfChannels: number }): void;
    decode(chunk: unknown): void;
    flush(): Promise<void>;
    close(): void;
  };
}

interface WebCodecsChunkCtor {
  new (init: { type: 'key'; timestamp: number; data: Uint8Array }): unknown;
}

let cachedWebCodecsOpusOk: boolean | null = null;

export async function canUseWebCodecsOpus(): Promise<boolean> {
  if (cachedWebCodecsOpusOk !== null) return cachedWebCodecsOpusOk;
  try {
    const g = globalThis as unknown as {
      AudioDecoder?: WebCodecsDecoderCtor;
      EncodedAudioChunk?: WebCodecsChunkCtor;
    };
    if (!g.AudioDecoder || !g.EncodedAudioChunk) {
      cachedWebCodecsOpusOk = false;
      return false;
    }
    const res = await g.AudioDecoder.isConfigSupported({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    cachedWebCodecsOpusOk = Boolean(res?.supported);
    return cachedWebCodecsOpusOk;
  } catch {
    cachedWebCodecsOpusOk = false;
    return false;
  }
}

export interface StreamingOpusHandle {
  sampleRate: number;
  abortController: AbortController;
  requestChunk: (count?: number) => void;
}

/**
 * Fetches an Ogg Opus stem progressively via ReadableStream + WebCodecs AudioDecoder
 * and pushes stereo 16,384-frame chunks directly to `onChunk` with backpressure,
 * resolving as soon as the initial ~200 ms of PCM is buffered and ready for gapless playback.
 */
export async function streamOpusIntoWorklet(opts: {
  url: string;
  signal?: AbortSignal;
  onChunk: (left: Float32Array, right: Float32Array) => void;
  onEnd: (totalFrames: number) => void;
  onError?: (err: unknown) => void;
}): Promise<StreamingOpusHandle | null> {
  if (!(await canUseWebCodecsOpus())) return null;

  const g = globalThis as unknown as {
    AudioDecoder: WebCodecsDecoderCtor;
    EncodedAudioChunk: WebCodecsChunkCtor;
  };

  const abortController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort();
    else opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  const res = await fetch(opts.url, { signal: abortController.signal }).catch(() => null);
  if (!res || !res.ok || !res.body) return null;

  const CHUNK_FRAMES = 16384;
  const queuedChunks: Array<{ left: Float32Array; right: Float32Array }> = [];
  let credits = 2; // Start with 2 pre-roll chunks (32,768 frames)
  let accL = new Float32Array(CHUNK_FRAMES);
  let accR = new Float32Array(CHUNK_FRAMES);
  let accLen = 0;
  let totalStreamedFrames = 0;
  let preSkipRemaining = 312;
  let decoderErrored = false;
  let streamFinished = false;
  let endEmitted = false;
  let startupSettled = false;

  const emitChunk = (left: Float32Array, right: Float32Array) => {
    if (abortController.signal.aborted) return;
    totalStreamedFrames += left.length;
    if (credits > 0) {
      credits--;
      opts.onChunk(left, right);
    } else {
      queuedChunks.push({ left, right });
    }
  };

  const maybeEmitEnd = () => {
    if (!endEmitted && streamFinished && queuedChunks.length === 0) {
      endEmitted = true;
      opts.onEnd(totalStreamedFrames);
    }
  };

  const requestChunk = (count = 1) => {
    credits += count;
    while (credits > 0 && queuedChunks.length > 0) {
      const next = queuedChunks.shift()!;
      credits--;
      opts.onChunk(next.left, next.right);
    }
    maybeEmitEnd();
  };

  let resolveStartup!: (ok: boolean) => void;
  const startupPromise = new Promise<boolean>((resolve) => {
    resolveStartup = resolve;
  });

  const settleStartup = (ok: boolean) => {
    if (!startupSettled) {
      startupSettled = true;
      resolveStartup(ok);
    }
  };

  const startupTimer = setTimeout(() => settleStartup(false), 6500);

  const decoder = new g.AudioDecoder({
    output: (audioData) => {
      try {
        const frames = audioData.numberOfFrames;
        const ch = audioData.numberOfChannels;
        const tmpL = new Float32Array(frames);
        const tmpR = new Float32Array(frames);
        // Handle planar f32 (`f32-planar`) or interleaved (`f32`) safely
        try {
          audioData.copyTo(tmpL, { planeIndex: 0, format: 'f32-planar' });
          if (ch > 1) {
            audioData.copyTo(tmpR, { planeIndex: 1, format: 'f32-planar' });
          } else {
            tmpR.set(tmpL);
          }
        } catch {
          const inter = new Float32Array(frames * ch);
          audioData.copyTo(inter, { planeIndex: 0, format: 'f32' });
          for (let i = 0; i < frames; i++) {
            tmpL[i] = inter[i * ch];
            tmpR[i] = ch > 1 ? inter[i * ch + 1] : tmpL[i];
          }
        }
        audioData.close();

        const skip = Math.min(preSkipRemaining, frames);
        preSkipRemaining -= skip;
        let idx = skip;
        while (idx < frames) {
          const take = Math.min(CHUNK_FRAMES - accLen, frames - idx);
          accL.set(tmpL.subarray(idx, idx + take), accLen);
          accR.set(tmpR.subarray(idx, idx + take), accLen);
          accLen += take;
          idx += take;

          if (accLen === CHUNK_FRAMES) {
            emitChunk(accL, accR);
            accL = new Float32Array(CHUNK_FRAMES);
            accR = new Float32Array(CHUNK_FRAMES);
            accLen = 0;
            clearTimeout(startupTimer);
            settleStartup(true);
          }
        }
      } catch (err) {
        decoderErrored = true;
        opts.onError?.(err);
        clearTimeout(startupTimer);
        settleStartup(false);
      }
    },
    error: (err) => {
      decoderErrored = true;
      opts.onError?.(err);
      clearTimeout(startupTimer);
      settleStartup(false);
    },
  });

  decoder.configure({
    codec: 'opus',
    sampleRate: 48000,
    numberOfChannels: 2,
  });

  const reader = res.body.getReader();
  void (async () => {
    let tail = new Uint8Array(0);
    let parserState: {
      pending: Uint8Array[];
      seenHead: boolean;
      seenTags: boolean;
      preSkip: number;
      channels: number;
    } = {
      pending: [],
      seenHead: false,
      seenTags: false,
      preSkip: 312,
      channels: 2,
    };
    let timestampUs = 0;

    try {
      while (!abortController.signal.aborted && !decoderErrored) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        const merged = new Uint8Array(tail.length + value.length);
        merged.set(tail);
        merged.set(value, tail.length);

        const { pages, consumedBytes } = parseOggOpusPages(merged);
        tail = merged.subarray(consumedBytes);
        if (pages.length === 0) continue;

        const extracted = extractOggOpusPackets(pages, parserState);
        if (extracted.head) {
          preSkipRemaining = extracted.head.preSkip;
        }
        parserState = {
          pending: extracted.pending,
          seenHead: extracted.seenHead,
          seenTags: extracted.seenTags,
          preSkip: extracted.preSkip,
          channels: extracted.channels,
        };

        for (const pkt of extracted.audioPackets) {
          if (decoder.state === 'closed' || decoderErrored || abortController.signal.aborted) break;
          decoder.decode(
            new g.EncodedAudioChunk({
              type: 'key',
              timestamp: timestampUs,
              data: pkt,
            })
          );
          timestampUs += 20000; // 20 ms nominal Opus frame spacing
        }
      }

      if (!abortController.signal.aborted && !decoderErrored && decoder.state === 'configured') {
        await decoder.flush();
        if (accLen > 0) {
          emitChunk(accL.slice(0, accLen), accR.slice(0, accLen));
          accLen = 0;
          clearTimeout(startupTimer);
          settleStartup(true);
        }
        streamFinished = true;
        maybeEmitEnd();
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        opts.onError?.(err);
      }
      clearTimeout(startupTimer);
      settleStartup(false);
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      try {
        if (decoder.state !== 'closed') decoder.close();
      } catch {
        // ignore
      }
    }
  })();

  const ok = await startupPromise;
  if (!ok || decoderErrored) {
    abortController.abort();
    return null;
  }

  return {
    sampleRate: 48000,
    abortController,
    requestChunk,
  };
}
