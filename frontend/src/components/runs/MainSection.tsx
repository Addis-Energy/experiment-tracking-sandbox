import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { isSectionTab, type RunTab, type SectionTab } from './runView'

const SECTION_ID: Record<SectionTab, string> = {
  results: 'section-results',
  conditions: 'section-conditions',
  xrd: 'section-xrd',
}
const TAB_BAR_ID = 'tab-bar'
const TAB_CONTENT_ID = 'tab-content'

/** How long a section scroll keeps correcting itself while the page above it loads. */
const SETTLE_MS = 2000

/** Props of the sticky tab bar: the section tabs stay in reach while Main scrolls.
 *  -top-6 cancels the page's p-6 (sticky offsets start inside the scroller's
 *  padding), so the bar sits flush with the top and nothing shows above it. */
export const TAB_BAR = {
  id: TAB_BAR_ID,
  className: 'sticky -top-6 z-20 bg-surface-base border-b border-surface-border flex gap-0',
}

/** The card around a record section (conditions, XRD, notes, entry logs). */
export const PANEL = 'bg-surface-card border border-surface-border rounded-lg overflow-hidden'

// Land below the sticky tab bar, not under it.
const BELOW_BAR = 'scroll-mt-12'

/** Everything under the tab bar. */
export function TabContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div id={TAB_CONTENT_ID} className={`${BELOW_BAR} ${className ?? ''}`}>
      {children}
    </div>
  )
}

interface Props {
  tab: SectionTab
  /** Shown above the section; omit when the content carries its own headings. */
  heading?: string
  children: ReactNode
}

/** One section of the Main tab; its tab scrolls here. */
export function MainSection({ tab, heading, children }: Props) {
  return (
    <section id={SECTION_ID[tab]} aria-label={heading} className={`${BELOW_BAR} space-y-2`}>
      {/* A caption, not a heading: the cards inside carry the headings. */}
      {heading && <p className="text-xs text-ink-muted">{heading}</p>}
      {children}
    </section>
  )
}

/** Keeps the scroll position in step with the tab, once the page content is ready.
 *  - A section tab scrolls Main to its section. Keyed on the location, so clicking
 *    the same tab again scrolls again. While charts and tables above the section
 *    are still loading it re-aligns, until the user scrolls or SETTLE_MS passes.
 *  - Any other change of tab brings the top of the new content back under the tab
 *    bar when the page was scrolled past it (Notes must not open halfway down). */
export function useTabScroll(tab: RunTab, ready: boolean): void {
  const { key } = useLocation()
  const shown = useRef(tab)
  useEffect(() => {
    if (!ready) return
    const changed = shown.current !== tab
    shown.current = tab

    if (!isSectionTab(tab)) {
      const content = document.getElementById(TAB_CONTENT_ID)
      const bar = document.getElementById(TAB_BAR_ID)
      if (!changed || !content?.scrollIntoView || !bar) return
      if (content.getBoundingClientRect().top < bar.getBoundingClientRect().bottom) {
        content.scrollIntoView({ block: 'start' })
      }
      return
    }

    const section = document.getElementById(SECTION_ID[tab])
    if (!section?.scrollIntoView) return
    const align = () => section.scrollIntoView({ block: 'start' })
    align()
    if (typeof ResizeObserver === 'undefined' || !section.parentElement) return

    const observer = new ResizeObserver(align)
    observer.observe(section.parentElement)
    const stop = () => observer.disconnect()
    const timer = window.setTimeout(stop, SETTLE_MS)
    const userScrolls = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    userScrolls.forEach((type) => window.addEventListener(type, stop, { once: true, passive: true }))
    return () => {
      stop()
      window.clearTimeout(timer)
      userScrolls.forEach((type) => window.removeEventListener(type, stop))
    }
  }, [tab, key, ready])
}
