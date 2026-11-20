import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import type { RuleId } from '../domain/types'
import { SURVEY_EPOCHS } from '../data/fixtures/mine'
import { resetView } from '../state/homeView'
import { tweenStory, useStory } from '../state/story'
import { useTerrain } from '../state/terrain'
import { countText, GLYPH, worstTone } from './findings'
import { daysBetween } from './format'
import { ModelControls, TurnButtons } from './home/ModelControls'
import { FindingNames, ModelFrame, ModelScale } from './home/ModelFrame'
import { WorkedCase } from './home/WorkedCase'
import { ArrowRightIcon, BoundaryIcon, FloorIcon, PitMark, TerrainIcon } from './icons'
import { MONITOR_HREF, OVERVIEW_HREF, ROUTE_HREF } from './route'
import { Relief } from './schematic'
import { SceneErrorBoundary } from './viewport/SceneErrorBoundary'

/*
 * The landing page: what PitWatch does, shown on the live 3D model of the simulated surveys,
 * and one click into the dashboard. The model is driven by a before/after slider and two overlay
 * switches, and the sections below it are wired back to the model, so the page reads as one piece.
 */

// three.js is large; fetch it only for the landing model.
const HomeScene = lazy(() => import('../scene/HomeScene'))

const [BASELINE, CURRENT] = SURVEY_EPOCHS
const DAYS = BASELINE && CURRENT ? daysBetween(BASELINE.date, CURRENT.date) : 0

/** The three rules, one line each. Their full wording lives on the Permit rules page. */
const RULES: { rule: RuleId; Icon: ComponentType<SVGProps<SVGSVGElement>>; title: string }[] = [
  { rule: 'R1', Icon: BoundaryIcon, title: 'Stay inside the lease' },
  { rule: 'R2', Icon: FloorIcon, title: 'Stop at the approved floor' },
  { rule: 'R3', Icon: TerrainIcon, title: 'Dump only where allowed' },
]

const PROVENANCE = ['measured', 'derived', 'simulated', 'unverified'] as const

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function HomePage() {
  // The overlays on the model. It opens on the current survey with the findings, the result worth
  // seeing first.
  const [showChange, setShowChange] = useState(false)
  const [showFindings, setShowFindings] = useState(true)
  // The model only renders while it is on screen.
  const [stageVisible, setStageVisible] = useState(true)
  const stageRef = useRef<HTMLDivElement>(null)
  const findings = useTerrain((s) => s.findings)
  const status = useTerrain((s) => s.status)
  const error = useTerrain((s) => s.error)
  const retry = useTerrain((s) => s.retry)
  const ready = status === 'ready'

  // The model starts at the current survey, in the framed view.
  useEffect(() => {
    useStory.setState({ t: 1 })
    resetView()
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setStageVisible(e!.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /** The findings on the current survey, brought into view, so a step below answers on the screen above. */
  const showOnModel = () => {
    tweenStory(1)
    setShowFindings(true)
    stageRef.current?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })
  }

  const goTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
      block: 'start',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })

  return (
    <div className="landing h-full overflow-y-auto">
      <header className="landing-bar">
        <a href={ROUTE_HREF.home} className="landing-brand" aria-label="PitWatch home">
          <span className="brand-mark">
            <PitMark className="h-6 w-[38px]" />
          </span>
          <span className="cond text-[22px] font-bold text-ink">PitWatch</span>
        </a>
        <nav aria-label="On this page" className="landing-nav">
          <button type="button" onClick={() => goTo('how')}>
            How it works
          </button>
          <button type="button" onClick={() => goTo('checks')}>
            What it checks
          </button>
          <a href={MONITOR_HREF} className="max-lg:hidden">
            3D map
          </a>
          <a href={ROUTE_HREF.about} className="max-lg:hidden">
            About the data
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="sim-note">Simulated data</span>
          <a href={OVERVIEW_HREF} className="btn-primary max-sm:hidden">
            Open the dashboard
          </a>
        </div>
      </header>

      <main id="content" tabIndex={-1}>
        <section className="hero">
          <div className="hero-copy">
            <h1 className="cond hero-title">See where a mine breaks its permit.</h1>
            <p className="mt-6 max-w-[34rem] text-[18px] leading-8 text-ink-dim max-sm:hidden">
              PitWatch compares two drone surveys of an open-pit mine in 3D and checks every change
              against the lease: the boundary, the approved depth and the permitted dump zones.
            </p>
            {/* One line long, so the model and both calls to action share the phone's first screen. */}
            <p className="mt-6 max-w-[34rem] text-[18px] leading-7 text-ink-dim sm:hidden">
              Two drone surveys of one pit, compared in 3D against the lease.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={OVERVIEW_HREF} className="btn-primary btn-lg">
                Open the dashboard
              </a>
              <a href={MONITOR_HREF} className="btn btn-lg">
                Explore the 3D map
              </a>
            </div>

            {status === 'error' && (
              <div role="alert" className="load-card mt-8 max-w-[28rem]">
                <p className="cond text-[18px] font-bold text-violation">Surveys unavailable</p>
                <p className="mt-1 text-[13.5px] leading-6 text-ink-dim">
                  The simulated surveys could not be built: {error}
                </p>
                <button type="button" className="btn mt-3" onClick={() => void retry()}>
                  Try again
                </button>
              </div>
            )}

            <dl className="hero-facts">
              <div>
                <dt>Between the two surveys</dt>
                <dd>{DAYS} days</dd>
              </div>
              <div>
                <dt>Permit rules checked</dt>
                <dd>3</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>{ready ? countText(findings) : 'Building the surveys…'}</dd>
              </div>
            </dl>
          </div>

          <div ref={stageRef} className="hero-stage">
            <Relief className="opacity-60" />
            <div className="hero-model">
              {ready ? (
                <>
                  {/* Loading and failure text sit outside the model's role="img" frame, whose
                      description would otherwise hide them from a screen reader. */}
                  <SceneErrorBoundary
                    fallback={() => (
                      <p className="plan-status" role="alert">
                        The 3D model could not start.
                      </p>
                    )}
                  >
                    <Suspense
                      fallback={
                        <p className="plan-status" role="status">
                          Loading the 3D model…
                        </p>
                      }
                    >
                      <ModelFrame change={showChange} findings={showFindings}>
                        <HomeScene
                          change={showChange}
                          findings={showFindings}
                          active={stageVisible}
                        />
                      </ModelFrame>
                    </Suspense>
                  </SceneErrorBoundary>
                  <FindingNames shown={showFindings} />
                  <ModelScale />
                  <TurnButtons />
                  <p className="model-hint" aria-hidden="true">
                    Drag to turn. Click it, then scroll to zoom.
                  </p>
                </>
              ) : status === 'error' ? (
                <p className="plan-status">The simulated surveys could not be built.</p>
              ) : (
                <div className="plan-status w-full max-w-[260px]">
                  <p>Building the simulated surveys…</p>
                  <div className="loading-strata mt-3" />
                </div>
              )}
            </div>

            <ModelControls
              change={showChange}
              findings={showFindings}
              onChange={setShowChange}
              onFindings={setShowFindings}
            />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="landing-section">
          <div className="landing-inner">
            <h2 id="how-title" className="cond section-big">
              One finding, followed from survey to verdict
            </h2>
            <p className="case-lede">
              This is the largest finding in the simulated scenario, checked the way the dashboard
              checks every 4 m cell of the ground.
            </p>
            <WorkedCase onShowOnModel={showOnModel} />
          </div>
        </section>

        <section
          id="checks"
          aria-labelledby="checks-title"
          className="landing-section landing-band"
        >
          <div className="landing-inner">
            <h2 id="checks-title" className="cond ledger-title">
              What the engine tests
            </h2>
            <ol className="ledger">
              {RULES.map(({ rule, Icon, title }) => {
                const own = findings.filter((f) => f.ruleId === rule)
                const tone = own.length ? worstTone(own) : 'clear'
                const Glyph = tone === 'clear' ? null : GLYPH[tone]
                return (
                  <li key={rule} className="ledger-row">
                    <span className="ledger-id" aria-hidden="true">
                      {rule}
                    </span>
                    <span className="flex items-center gap-2.5 text-[16px] font-semibold text-ink">
                      <Icon className="h-5 w-5 shrink-0 text-accent" />
                      {title}
                    </span>
                    <span
                      className={`rule-result-line ${ready ? `tone-${tone}` : ''}`}
                      aria-live="polite"
                    >
                      {ready ? (
                        <>
                          {Glyph ? (
                            <Glyph className="h-[18px] w-[18px]" />
                          ) : (
                            <span className="status-led" data-tone="clear" aria-hidden="true" />
                          )}
                          {own.length ? countText(own) : 'Clear'}
                        </>
                      ) : (
                        'Evaluating…'
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-6 text-[14px] leading-6 text-ink-dim">
              Results are the engine’s, on simulated surveys.{' '}
              <a href={ROUTE_HREF.rules} className="text-accent underline underline-offset-3">
                How each rule is tested
              </a>
              {' · '}
              <a href={ROUTE_HREF.findings} className="text-accent underline underline-offset-3">
                All findings
              </a>
            </p>
          </div>
        </section>

        <section aria-labelledby="close-title" className="landing-close">
          <div className="landing-inner">
            <div className="close-grid">
              <div>
                <h2 id="close-title" className="cond close-title">
                  Open the dashboard and look for yourself.
                </h2>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href={OVERVIEW_HREF} className="btn-light btn-lg">
                    Open the dashboard
                  </a>
                  <a href={MONITOR_HREF} className="btn-outline-light btn-lg">
                    Explore the 3D map
                  </a>
                </div>
              </div>
              <div className="close-note">
                <p className="text-[16px] leading-7">
                  Everything here is simulated, and it says so. Venthar Ridge and Ardent Ore Works
                  are fictional, and both surveys are generated from a fixed seed. Findings point an
                  inspector at places to look; they do not prove a breach.
                </p>
                <p className="mt-5 text-[14px]">
                  Every value carries a tag for where it came from:
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {PROVENANCE.map((p) => (
                    <li key={p} className="chip-dark">
                      {p}
                    </li>
                  ))}
                </ul>
                <a href={ROUTE_HREF.about} className="link-arrow-light mt-5">
                  About the data
                  <ArrowRightIcon className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="close-foot">
              <span className="brand-mark">
                <PitMark className="h-5 w-8" />
              </span>
              <span>PitWatch, permit compliance monitoring for open-pit mines.</span>
              <nav aria-label="Legal" className="close-links">
                <a href={ROUTE_HREF.terms}>Terms and Conditions</a>
                <a href={ROUTE_HREF.license}>License</a>
                <a href={ROUTE_HREF.contact}>Contact</a>
              </nav>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
