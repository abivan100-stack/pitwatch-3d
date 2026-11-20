import type { CSSProperties } from 'react'
import { useTerrain } from '../state/terrain'
import { Fold, LayerSwitches } from './LayerControls'
import { ExaggerationSlider } from './viewport/MapHud'

/** Map controls: what is drawn and the vertical scale. The key sits on the stage. */
export function LayerPanel() {
  const ready = useTerrain((s) => s.status === 'ready')
  return (
    <nav
      aria-label="Map"
      style={{ '--d': '0.15s' } as CSSProperties}
      className="layer-panel card enter-left absolute top-4 left-4 z-10 hidden max-h-[calc(100%-32px)] w-[208px] flex-col xl:w-[240px] overflow-y-auto md:flex"
    >
      <section className="px-3 pt-3 pb-2">
        <LayerSwitches />
      </section>

      {ready && (
        <section className="border-t border-line px-4 py-3">
          <ExaggerationSlider />
        </section>
      )}

      <section className="mt-auto border-t border-line px-3 py-1.5 text-[11.5px] leading-4 text-ink-faint">
        <Fold label="How to move the view">
          <p className="px-1 pt-1 pb-0.5">
            Drag to orbit, right-drag to pan, scroll to zoom. <kbd className="kbd">R</kbd> resets
            the view.
          </p>
        </Fold>
      </section>
    </nav>
  )
}
