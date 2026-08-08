import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

import type { Frame, FrameState } from '../shared/contracts.js'

interface ChannelState {
  seq: number
  /** Last full payload — served to every new subscriber as its snapshot. */
  snapshot: unknown
  /** Content hash of the last broadcast; identical payloads are not re-sent. */
  hash: string
  /** When the vendor payload behind `snapshot` was fetched. */
  fetchedAt: number
  state: FrameState
  message?: string
}

const hashOf = (value: unknown) =>
  createHash('sha1').update(JSON.stringify(value) ?? 'null').digest('hex')

/**
 * Hot snapshot store + pub/sub. In-memory because v1 runs exactly one server
 * process for one user — Redis buys nothing until there are multiple processes.
 * The interface is deliberately Redis-shaped (get snapshot / publish / subscribe)
 * so swapping in `ioredis` touches this file only.
 */
class ChannelBus {
  private readonly channels = new Map<string, ChannelState>()
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  /**
   * Store a fresh full payload. Returns false when the content is byte-identical
   * to the last one — dashboards idle for minutes and bandwidth should follow
   * the market, not the clock.
   */
  publishSnapshot(channel: string, data: unknown): boolean {
    const hash = hashOf(data)
    const prev = this.channels.get(channel)
    const now = Date.now()

    if (prev && prev.hash === hash && prev.state === 'live') {
      prev.fetchedAt = now // content unchanged but it IS fresh — reset staleness
      return false
    }

    const next: ChannelState = {
      seq: (prev?.seq ?? 0) + 1,
      snapshot: data,
      hash,
      fetchedAt: now,
      state: 'live',
    }
    this.channels.set(channel, next)

    this.emitter.emit(channel, {
      type: 'snapshot',
      channel,
      seq: next.seq,
      ts: now,
      staleMs: 0,
      state: 'live',
      data,
    } satisfies Frame)

    return true
  }

  /**
   * Append-only delta (the tape). `merge` folds it into the stored snapshot so a
   * late subscriber still gets a complete view.
   */
  publishPatch(channel: string, delta: unknown, merge: (snapshot: unknown) => unknown): void {
    const prev = this.channels.get(channel)
    if (!prev) return // no snapshot yet — the next poll will produce one

    const now = Date.now()
    prev.seq += 1
    prev.snapshot = merge(prev.snapshot)
    prev.hash = hashOf(prev.snapshot)
    prev.fetchedAt = now
    prev.state = 'live'

    this.emitter.emit(channel, {
      type: 'patch',
      channel,
      seq: prev.seq,
      ts: now,
      staleMs: 0,
      state: 'live',
      data: delta,
    } satisfies Frame)
  }

  /**
   * A poll failed. Never blank the panel — keep last-good and mark it. Amber
   * once past one cadence, red past 3×; the client decides from `staleMs`.
   */
  publishError(channel: string, message: string): void {
    const prev = this.channels.get(channel)
    const now = Date.now()
    const seq = (prev?.seq ?? 0) + 1

    if (prev) {
      prev.seq = seq
      prev.state = 'error'
      prev.message = message
    }

    this.emitter.emit(channel, {
      type: 'status',
      channel,
      seq,
      ts: now,
      staleMs: prev ? now - prev.fetchedAt : 0,
      state: 'error',
      message,
    } satisfies Frame)
  }

  /** Full frame for a newly-subscribed client, or null if nothing polled yet. */
  snapshotFrame(channel: string): Frame | null {
    const state = this.channels.get(channel)
    if (!state) return null

    return {
      type: 'snapshot',
      channel,
      seq: state.seq,
      ts: Date.now(),
      staleMs: Date.now() - state.fetchedAt,
      state: state.state,
      data: state.snapshot,
    }
  }

  subscribe(channel: string, listener: (frame: Frame) => void): () => void {
    this.emitter.on(channel, listener)
    return () => this.emitter.off(channel, listener)
  }

  has(channel: string) {
    return this.channels.has(channel)
  }
}

export const bus = new ChannelBus()
