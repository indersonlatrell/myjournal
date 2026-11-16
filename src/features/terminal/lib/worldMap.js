// ─── Stylized world map ─────────────────────────────────────────────────
// A coarse dot-matrix continent silhouette (not geographically precise —
// decorative, in the spirit of a terminal's session map) plus grid
// coordinates for the four session cities, on a 40×20 grid.

export const GRID_COLS = 40;
export const GRID_ROWS = 20;

// [row, colStart, colEnd] land bands, hand-approximated per row.
const LAND_BANDS = [
  [2,  4, 9],   [2, 19, 22], [2, 26, 34],
  [3,  3, 10],  [3, 19, 25], [3, 25, 35],
  [4,  3, 11],  [4, 18, 24], [4, 24, 35],
  [5,  3, 12],  [5, 17, 24], [5, 24, 27], [5, 27, 36], [5, 37, 38],
  [6,  4, 13],  [6, 17, 22], [6, 18, 26], [6, 25, 28], [6, 28, 36], [6, 37, 38],
  [7,  5, 14],  [7, 18, 27], [7, 26, 29], [7, 29, 33], [7, 33, 37],
  [8,  7, 12],  [8, 18, 27], [8, 29, 34], [8, 34, 38],
  [9, 10, 15],  [9, 19, 28], [9, 30, 33], [9, 33, 38],
  [10, 10, 16], [10, 20, 28], [10, 33, 39],
  [11, 10, 17], [11, 21, 29], [11, 33, 39],
  [12, 11, 17], [12, 21, 27], [12, 33, 39],
  [13, 11, 16], [13, 22, 26], [13, 33, 38],
  [14, 12, 15], [14, 34, 37],
  [15, 13, 14], [15, 39, 39],
];

export const WORLD_DOTS = LAND_BANDS.flatMap(([row, start, end]) => {
  const dots = [];
  for (let col = start; col <= end; col += 1) dots.push({ row, col });
  return dots;
});

// lat/long → grid position, roughly equirectangular.
function toGrid(lat, long) {
  const col = Math.round(((long + 180) / 360) * (GRID_COLS - 1));
  const row = Math.round(((90 - lat) / 180) * (GRID_ROWS - 1));
  return { row, col };
}

export const SESSION_CITIES = {
  Sydney:   toGrid(-33.87, 151.21),
  Tokyo:    toGrid(35.68, 139.65),
  London:   toGrid(51.51, -0.13),
  "New York": toGrid(40.71, -74.01),
};
