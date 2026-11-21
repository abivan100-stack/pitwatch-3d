/*
 * The scene's sun, shared by the map and the landing model so their shadows agree. A low sun from
 * the north-west, the cartographic convention, so relief reads correctly.
 */

export const SUN_POSITION: readonly [number, number, number] = [-2125, 1750, -1375]

/**
 * Half the side of the shadow camera's frustum. A directional light throws a feature's shadow along
 * its own light ray, so the frustum only has to hold the shadow casters: the 2560 m block, whose
 * half diagonal is 1,810 m. The apron casts none (its slopes are far gentler than the sun's).
 */
export const SHADOW_HALF = 1850
