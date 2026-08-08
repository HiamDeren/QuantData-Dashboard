import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts'

import Panel, { PanelEmpty } from '@/components/Panel'
import { useChannel } from '@/stream/StreamProvider'
import type { ExposureProfile, PriceSeries } from '@shared/contracts'

export default function PricePanel() {
  const { data, status } = useChannel('price')
  const { data: exposure } = useChannel('exposure-by-strike')

  return (
    <Panel
      title="Giá + mức Gamma"
      tier="T1"
      status={status}
      cadenceMs={20_000}
      subtitle="nến 1 phút"
      className="min-h-[260px]"
      bodyClassName="p-0 min-h-0 flex"
    >
      {data && data.bars.length > 0 ? <Chart series={data} exposure={exposure} /> : <PanelEmpty />}
    </Panel>
  )
}

function Chart({ series, exposure }: { series: PriceSeries; exposure?: ExposureProfile }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const linesRef = useRef<IPriceLine[]>([])

  // Chart instance is created once and driven imperatively — re-creating it on
  // every frame would drop the user's zoom and read as lag.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#5d6a80',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1a2231' },
        horzLines: { color: '#1a2231' },
      },
      rightPriceScale: { borderColor: '#1e2635' },
      timeScale: { borderColor: '#1e2635', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    chartRef.current = chart
    seriesRef.current = candles

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      linesRef.current = []
    }
  }, [])

  useEffect(() => {
    seriesRef.current?.setData(
      series.bars.map((b) => ({
        time: Math.floor(b.t / 1000) as UTCTimestamp,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    )
  }, [series])

  // Gamma levels drawn as price lines on the same scale as price — this is the
  // whole point of the panel: is spot above or below the wall right now.
  useEffect(() => {
    const candles = seriesRef.current
    if (!candles) return

    for (const line of linesRef.current) candles.removePriceLine(line)
    linesRef.current = []
    if (!exposure) return

    const levels: Array<[number | null, string, string]> = [
      [exposure.callWall, 'Call Wall', '#3b82f6'],
      [exposure.putWall, 'Put Wall', '#ea580c'],
      [exposure.gammaFlip, 'Gamma Flip', '#f59e0b'],
    ]

    for (const [price, title, color] of levels) {
      if (price === null) continue
      linesRef.current.push(
        candles.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        }),
      )
    }
  }, [exposure])

  return <div ref={containerRef} className="min-h-[220px] w-full flex-1" />
}
