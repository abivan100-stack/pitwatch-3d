/*
 * The scene's sun, shared by the map and the landing model so their shadows agree. A low sun from
 * the north-west, the cartographic convention, so relief reads correctly.
 */

export const SUN_POSITION: readonly [number, number, number] = [-1700, 1400, -1100]

/** Sun height above the horizon, radians (about 35°). */
const SUN_ELEVATION = Math.atan2(SUN_POSITION[1], Math.hypot(SUN_POSITION[0], SUN_POSITION[2]))

/** Half the diagonal of the 2048 m block: the furthest a feature of the block can stand from its centre. */
const BLOCK_RADIUS = Math.hypot(1024, 1024)

/** The tallest feature of the block that can throw a shadow onto the ground around it, metres. */
const TALLEST_RELIEF = 120

/**
 * Half the side of the shadow camera's frustum. It has to reach the block's farthest corner plus the
 * longest shadow a feature there can throw outward at this sun height, or the shadow of the block
 * ends in a straight line on the apron. The apron itself casts none: its hills and the ridge's flank
 * are far gentler than the sun's slope, so nothing on it shades anything. Rounded up to 50 m.
 */
export const SHADOW_HALF =
  Math.ceil((BLOCK_RADIUS + TALLEST_RELIEF / Math.tan(SUN_ELEVATION)) / 50) * 50
