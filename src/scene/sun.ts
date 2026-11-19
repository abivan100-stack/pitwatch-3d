/*
 * The scene's sun, shared by the map and the landing model so their shadows agree. A low sun from
 * the north-west, the cartographic convention, so relief reads correctly.
 */

export const SUN_POSITION: readonly [number, number, number] = [-1700, 1400, -1100]

/**
 * Half the side of the shadow camera's frustum. A directional light throws a feature's shadow along
 * its own light ray, so the frustum only has to hold the shadow casters: the 2048 m block, whose
 * half diagonal is 1,448 m. The apron casts none (its slopes are far gentler than the sun's).
 */
export const SHADOW_HALF = 1500
