import type { DatasetId } from '../../../shared/contracts.js'

export type ToolGroup = 'options' | 'equities'

export interface ToolSpec {
  group: ToolGroup
  /** Vendor tool name, exactly as documented. Never invent one. */
  tool: string
}

/**
 * Dataset -> vendor tool. This map is the ONLY place a vendor tool name appears;
 * `/stream` allowlists against it so no user-supplied path can reach the vendor.
 *
 * Path shape `POST /v1/options/tool/<tool>` is documented. The equities path is
 * mirrored from it by symmetry and is NOT confirmed — probe it once against the
 * live key before trusting the price panel (see README "Probe checklist").
 */
export const TOOLS: Record<DatasetId, ToolSpec> = {
  'order-flow': { group: 'options', tool: 'order-flow/consolidated' },
  'exposure-by-strike': { group: 'options', tool: 'exposure-by-strike' },
  'net-drift': { group: 'options', tool: 'net-drift' },
  price: { group: 'equities', tool: 'stock-price-over-time' },
}

export const toolPath = ({ group, tool }: ToolSpec) => `/${group}/tool/${tool}`

/**
 * Vendor accepts singular/plural and scalar/array interchangeably, plus four
 * spellings of every field name. Normalize once, here, so no call site has to
 * remember which variant it picked.
 */
export interface VendorRequest {
  sessionDate?: string
  aggregationPeriod?: string
  filter?: Record<string, unknown>
  size?: number
  includes?: string[]
  excludes?: string[]
  dataMode?: string
}

export function buildRequest(input: VendorRequest & { ticker?: string }): VendorRequest {
  const { ticker, filter, ...rest } = input
  return {
    ...rest,
    filter: {
      ...(ticker ? { ticker: ticker.toUpperCase() } : {}),
      ...filter,
    },
  }
}
