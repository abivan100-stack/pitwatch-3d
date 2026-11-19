import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import type { TerrainSurvey } from '../domain/types'
import { surveyEdgeLine } from './overlayGeometry'
import { OVERLAY } from './palette'

/**
 * A hairline along the edge of the surveyed area. Outside it the ground is decoration (the apron),
 * so this is what answers "where does the survey end?" on the model itself.
 */
export function SurveyEdge({ survey, ex }: { survey: TerrainSurvey; ex: number }) {
  const points = useMemo(() => surveyEdgeLine(survey, ex), [survey, ex])
  return <Line points={points} color={OVERLAY.surveyEdge} lineWidth={1} />
}
