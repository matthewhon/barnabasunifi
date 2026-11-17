export interface CameraGridDimensions {
  cols: number;
  rows: number;
}

export interface CameraGridOptions {
  gap?: number;
  padding?: number;
  footerHeight?: number;
  aspectRatio?: number;
}

/**
 * Computes the optimal (cols, rows) grid that fits `count` cameras inside a
 * container of `width` x `height` pixels without vertical scrolling, maximizing
 * the rendered 16:9 video area per camera.
 */
export function computeOptimalCameraGrid(
  count: number,
  width: number,
  height: number,
  options: CameraGridOptions = {}
): CameraGridDimensions {
  if (count <= 1) {
    return { cols: 1, rows: 1 };
  }

  if (width <= 0 || height <= 0) {
    const cols = Math.ceil(Math.sqrt(count));
    return { cols, rows: Math.ceil(count / cols) };
  }

  const {
    gap = 10,
    padding = 0,
    footerHeight = 0,
    aspectRatio = 16 / 9,
  } = options;

  let bestCols = Math.ceil(Math.sqrt(count));
  let bestRows = Math.ceil(count / bestCols);
  let bestArea = -1;
  let bestWaste = Infinity;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - gap * (cols - 1)) / cols - padding;
    const cellH = (height - gap * (rows - 1)) / rows - padding - footerHeight;

    if (cellW <= 0 || cellH <= 0) continue;

    const videoW = Math.min(cellW, cellH * aspectRatio);
    const videoH = videoW / aspectRatio;
    const area = videoW * videoH;
    const waste = cols * rows - count;

    if (area > bestArea * 1.005 || (Math.abs(area - bestArea) <= bestArea * 0.005 && waste < bestWaste)) {
      bestArea = area;
      bestCols = cols;
      bestRows = rows;
      bestWaste = waste;
    }
  }

  return { cols: bestCols, rows: bestRows };
}
