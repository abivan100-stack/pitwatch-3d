import { useEffect } from 'react'
import { useAppStore } from '../../state/store'
import { useTerrain } from '../../state/terrain'
import { LG, XL } from '../breakpoints'
import { toggleFullscreen } from '../fullscreen'
import { LayerPanel } from '../LayerPanel'
import { SidePanel } from '../SidePanel'
import { findingFromHash, isMonitorHash, monitorHash } from '../route'
import { Viewport } from '../Viewport'

/**
 * Folds a side panel while the window is narrower than `query`, and unfolds it when the window
 * grows past it, until the visitor has chosen; after that their choice wins and nothing moves.
 */
function useFoldBelow(query: string, userSet: boolean, setHidden: (hidden: boolean) => void) {
  useEffect(() => {
    if (userSet) return
    const wide = window.matchMedia(query)
    const apply = () => setHidden(!wide.matches)
    apply()
    wide.addEventListener('change', apply)
    return () => wide.removeEventListener('change', apply)
  }, [query, userSet, setHidden])
}

/** Full-bleed 3D map with the layer card and the details panel floating above it. */
export function MapPage() {
  const layersHidden = useAppStore((s) => s.layersHidden)
  const detailsHidden = useAppStore((s) => s.detailsHidden)
  const layersUserSet = useAppStore((s) => s.layersUserSet)
  const detailsUserSet = useAppStore((s) => s.detailsUserSet)
  const ready = useTerrain((s) => s.status === 'ready')
  const findings = useTerrain((s) => s.findings)

  // On a laptop-width screen the model is the point of the map, and the two floating panels
  // leave it a narrow stage: at 1100 px the stage would be 372 px wide. Below `xl` the findings
  // panel is therefore folded, and the visible header button opens it. Below `lg` the map card
  // folds as well (at 800 px it floats over the western part of the block); the header's Map
  // panel button, or `[`, brings it back. Both follow the window across the breakpoint until the
  // visitor chooses, and then their choice sticks.
  useFoldBelow(XL, detailsUserSet, useAppStore.getState().setDetailsHidden)
  useFoldBelow(LG, layersUserSet, useAppStore.getState().setLayersHidden)

  // Apply a linked finding after the initial width rules so it can open its details panel.
  useEffect(() => {
    if (!ready) return

    let applyingHash = false
    const applyHash = () => {
      const { hash } = window.location
      if (!isMonitorHash(hash)) return
      const id = findingFromHash(hash)
      const finding = findings.find((f) => f.id === id)
      const nextId = finding?.id ?? null
      const { selectedFinding, focus, selectFinding } = useAppStore.getState()

      // Re-entering the map can restore the same finding after its camera request was cleared.
      if (nextId === selectedFinding && (!finding || focus)) return
      applyingHash = true
      try {
        selectFinding(nextId)
      } finally {
        applyingHash = false
      }
    }

    applyHash()
    const unsubscribe = useAppStore.subscribe(({ selectedFinding }, previous) => {
      // Back and Forward own their history entries. Map selections replace the current entry.
      if (applyingHash || selectedFinding === previous.selectedFinding) return
      const { hash } = window.location
      const next = monitorHash(selectedFinding)
      if (isMonitorHash(hash) && hash !== next) {
        window.history.replaceState(window.history.state, '', next)
      }
    })
    window.addEventListener('hashchange', applyHash)
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', applyHash)
    }
  }, [ready, findings])

  // [ and ] collapse the side panels, F toggles full screen, R resets the view.
  // The navigation drawer and editable fields take priority over map shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const { menuOpen, tool, toggleLayers, toggleDetails, requestView, setTool, clearPicks } =
        useAppStore.getState()
      if (menuOpen) return
      if (e.key === '[') toggleLayers()
      else if (e.key === ']') toggleDetails()
      else if (e.key === 'm' || e.key === 'M') setTool(tool === 'measure' ? 'inspect' : 'measure')
      else if (e.key === 'Escape') clearPicks()
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
      else if ((e.key === 'r' || e.key === 'R') && useTerrain.getState().status === 'ready')
        requestView('oblique')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Leaving the map forgets old camera requests. Defer cleanup by one microtask so React
  // StrictMode's development-only effect replay does not erase a finding selected on entry.
  useEffect(
    () => () => {
      queueMicrotask(() => {
        if (!document.querySelector('.monitor')) useAppStore.getState().leaveMap()
      })
    },
    [],
  )

  return (
    <div
      className="monitor relative min-h-0 flex-1 overflow-hidden"
      data-layers={layersHidden ? 'hidden' : undefined}
      data-details={detailsHidden ? 'hidden' : undefined}
    >
      <Viewport />
      <LayerPanel />
      <SidePanel />
    </div>
  )
}
