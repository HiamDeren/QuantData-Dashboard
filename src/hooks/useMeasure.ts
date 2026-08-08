import { useEffect, useRef, useState } from 'react'

/** Đo bề rộng thật của container để vẽ SVG theo pixel (không scale méo stroke). */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)

    return () => ro.disconnect()
  }, [])

  return { ref, width }
}
