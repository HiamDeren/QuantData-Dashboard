import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  channelKey,
  DATASETS,
  type DatasetId,
  type DatasetPayload,
  type Frame,
  type FrameState,
  type TapePatch,
  type TapeSnapshot,
} from '@shared/contracts'

const TAPE_LIMIT = 2_000

export interface ChannelStatus {
  state: FrameState
  staleMs: number
  message?: string
  receivedAt: number
}

interface StreamValue {
  data: Partial<Record<DatasetId, unknown>>
  status: Partial<Record<DatasetId, ChannelStatus>>
  connected: boolean
}

const StreamContext = createContext<StreamValue | null>(null)

/**
 * One EventSource for the whole page carrying all four channels. Opening one
 * connection per panel would multiply reconnect storms and give the server no
 * way to see them as a single view.
 */
export function StreamProvider({
  ticker,
  sessionDate,
  children,
}: {
  ticker: string
  sessionDate: string
  children: ReactNode
}) {
  const [data, setData] = useState<Partial<Record<DatasetId, unknown>>>({})
  const [status, setStatus] = useState<Partial<Record<DatasetId, ChannelStatus>>>({})
  const [connected, setConnected] = useState(false)

  // Last seq per channel — a gap means we missed a patch and must re-snapshot.
  const seqRef = useRef<Partial<Record<DatasetId, number>>>({})

  useEffect(() => {
    // Filter change = new channel keys = fresh subscription. Drop stale panel
    // data immediately so the UI never shows SPY numbers under a QQQ header.
    setData({})
    setStatus({})
    seqRef.current = {}

    const channels = DATASETS.map((d) => channelKey(d, ticker, sessionDate))
    const source = new EventSource(`/api/stream?channels=${encodeURIComponent(channels.join(','))}`)

    let reopen: number | null = null

    source.onopen = () => setConnected(true)

    source.onerror = () => {
      setConnected(false)
      // EventSource retries on its own; this only surfaces the gap in the UI.
    }

    source.onmessage = (event) => {
      let frame: Frame
      try {
        frame = JSON.parse(event.data) as Frame
      } catch {
        return
      }

      const dataset = frame.channel.split(':')[1] as DatasetId
      if (!DATASETS.includes(dataset)) return

      setConnected(true)
      setStatus((prev) => ({
        ...prev,
        [dataset]: {
          state: frame.state,
          staleMs: frame.staleMs,
          message: frame.type === 'status' ? frame.message : undefined,
          receivedAt: Date.now(),
        },
      }))

      if (frame.type === 'status') return

      const expected = seqRef.current[dataset]
      if (frame.type === 'patch' && expected !== undefined && frame.seq !== expected + 1) {
        // Sequence gap: our merged view is no longer trustworthy. Reconnecting
        // makes the server resend a full snapshot for every channel.
        seqRef.current = {}
        if (reopen === null) reopen = window.setTimeout(() => source.close(), 0)
        return
      }
      seqRef.current[dataset] = frame.seq

      setData((prev) => {
        if (frame.type === 'snapshot') return { ...prev, [dataset]: frame.data }

        // Tape is the only patching channel: prepend, then bound the buffer.
        if (dataset === 'order-flow') {
          const current = prev['order-flow'] as TapeSnapshot | undefined
          if (!current) return prev
          const incoming = (frame.data as TapePatch).prints
          return {
            ...prev,
            'order-flow': {
              ...current,
              prints: [...incoming, ...current.prints].slice(0, TAPE_LIMIT),
            } satisfies TapeSnapshot,
          }
        }

        return prev
      })
    }

    return () => {
      if (reopen !== null) clearTimeout(reopen)
      source.close()
    }
  }, [ticker, sessionDate])

  const value = useMemo<StreamValue>(() => ({ data, status, connected }), [data, status, connected])

  return <StreamContext value={value}>{children}</StreamContext>
}

export function useStream() {
  const ctx = use(StreamContext)
  if (!ctx) throw new Error('useStream phải nằm trong <StreamProvider>')
  return ctx
}

/** Typed accessor for one dataset. */
export function useChannel<K extends DatasetId>(dataset: K) {
  const { data, status } = useStream()
  return {
    data: data[dataset] as DatasetPayload[K] | undefined,
    status: status[dataset],
  }
}
