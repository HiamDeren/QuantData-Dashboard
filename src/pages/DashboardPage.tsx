import FilterBar from '@/components/FilterBar'
import { useFilters } from '@/hooks/useFilters'
import ExposureProfilePanel from '@/panels/ExposureProfilePanel'
import NetDriftPanel from '@/panels/NetDriftPanel'
import PricePanel from '@/panels/PricePanel'
import TapePanel from '@/panels/TapePanel'
import { StreamProvider } from '@/stream/StreamProvider'

export default function DashboardPage() {
  const { filters, setFilters } = useFilters()

  return (
    // Remounting on filter change is deliberate: it tears down the SSE
    // connection and every panel's state at once, so no panel can render
    // yesterday's ticker under today's header.
    <StreamProvider key={`${filters.ticker}:${filters.sessionDate}`} {...filters}>
      <div className="min-h-dvh">
        <FilterBar filters={filters} onChange={setFilters} />

        <main className="mx-auto grid max-w-[1800px] gap-3 p-3 xl:grid-cols-[minmax(340px,1fr)_2fr]">
          <ExposureProfilePanel />

          <div className="grid min-w-0 gap-3">
            <PricePanel />
            <NetDriftPanel />
          </div>

          <div className="xl:col-span-2">
            <TapePanel />
          </div>
        </main>

        <footer className="text-ink-3 mx-auto max-w-[1800px] px-3 pb-4 text-[10px]">
          Dữ liệu options qua Quant Data. Các mức Call Wall / Put Wall / Gamma Flip là giá trị{' '}
          <strong className="text-ink-2">suy diễn từ mô hình</strong>, phụ thuộc quy ước dấu vị thế dealer — không
          phải dữ liệu quan sát trực tiếp. Công cụ cá nhân, không phải khuyến nghị đầu tư.
        </footer>
      </div>
    </StreamProvider>
  )
}
