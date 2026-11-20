import {
  useId,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react'
import { useAppStore, type LayerId } from '../state/store'
import { useTerrain } from '../state/terrain'
import {
  BoundaryIcon,
  BufferIcon,
  ChangeIcon,
  ContourIcon,
  FindingIcon,
  FloorIcon,
  TerrainIcon,
  TintIcon,
} from './icons'

/**
 * The list of map layers and their switches, shared by the floating Map card and the mobile
 * Details drawer. One list, two placements: the card shows from `md` up, the drawer below it,
 * so a given width never shows the same control twice.
 */
const LAYERS: { id: LayerId; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: 'terrain', label: 'Terrain', Icon: TerrainIcon },
  { id: 'tint', label: 'Elevation tint', Icon: TintIcon },
  { id: 'contours', label: 'Contours', Icon: ContourIcon },
]

const OVERLAYS: typeof LAYERS = [
  { id: 'lease', label: 'Lease boundary', Icon: BoundaryIcon },
  { id: 'buffer', label: 'Safety buffer', Icon: BufferIcon },
  { id: 'zones', label: 'Permitted zones', Icon: FloorIcon },
  { id: 'change', label: 'Change since baseline', Icon: ChangeIcon },
  { id: 'findings', label: 'Findings', Icon: FindingIcon },
]

function LayerSwitch({ id, label, Icon, i }: (typeof LAYERS)[number] & { i: number }) {
  const on = useAppStore((s) => s.layers[id])
  const toggleLayer = useAppStore((s) => s.toggleLayer)
  const ready = useTerrain((s) => s.status === 'ready')
  return (
    <li style={{ '--i': i } as CSSProperties}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!ready}
        className={`layer-row live ${on ? 'on' : ''}`}
        onClick={() => toggleLayer(id)}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true" />
      </button>
    </li>
  )
}

/**
 * A button that opens a block below it with a 200 ms height transition (`.fold`). The body is
 * `visibility: hidden` once closed, so its controls leave the tab order and the accessibility
 * tree; focus stays on the button.
 */
export function Fold({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className="fold-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fold-caret" aria-hidden="true" />
        {label}
      </button>
      <div id={id} className="fold" data-open={open ? '' : undefined}>
        <div className="fold-inner">{children}</div>
      </div>
    </>
  )
}

/** One primary switch, then the rest behind a button that counts them and how many are on. */
function Group({
  title,
  primary,
  more,
  first,
}: {
  title: string
  primary: (typeof LAYERS)[number]
  more: typeof LAYERS
  first?: boolean
}) {
  const hiddenOn = useAppStore((s) => more.filter((l) => s.layers[l.id]).length)
  return (
    <>
      <h2 className={`panel-title px-1 ${first ? '' : 'mt-2.5'}`}>{title}</h2>
      <ul role="list" className="mt-1 flex flex-col gap-px">
        <LayerSwitch {...primary} i={0} />
      </ul>
      <Fold label={`${more.length} more${hiddenOn ? ` · ${hiddenOn} on` : ''}`}>
        <ul role="list" className="flex flex-col gap-px">
          {more.map((l, i) => (
            <LayerSwitch key={l.id} {...l} i={i + 1} />
          ))}
        </ul>
      </Fold>
    </>
  )
}

/** The layer switches in the two groups the Map card has always used, folded to one primary each. */
export function LayerSwitches() {
  const [terrain, ...layers] = LAYERS
  const findings = OVERLAYS[OVERLAYS.length - 1]
  return (
    <>
      <Group title="Layers" primary={terrain} more={layers} first />
      <Group title="Permit and change" primary={findings} more={OVERLAYS.slice(0, -1)} />
    </>
  )
}
