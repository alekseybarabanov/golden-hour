// Оценка высоты таблицы для PNG (ширина карточки 1080px).
const CHAR_WIDTH_RATIO = 0.52;
const LINE_HEIGHT = 1.25;
const CELL_PAD_V = 24;
const CELL_PAD_H = 32;
const BODY_WIDTH = 1080;
const SIDE_PAD = 40;
const CONTENT_WIDTH = BODY_WIDTH - SIDE_PAD * 2;
const PAD_TOP = 48;
const PAD_BOTTOM = 40;
const BADGE_H = 52;
const BADGE_GAP = 16;
const SUBTITLE_GAP = 24;
const HEIGHT_BUFFER = 32;

function estimateWrappedLines(text, colWidthPx, fontSizePx) {
  const usable = Math.max(24, colWidthPx - CELL_PAD_H);
  const charWidth = fontSizePx * CHAR_WIDTH_RATIO;
  const charsPerLine = Math.max(1, Math.floor(usable / charWidth));
  const s = String(text ?? '');
  if (!s) return 1;

  let total = 0;
  for (const segment of s.split('\n')) {
    const words = segment.split(/\s+/).filter(Boolean);
    if (!words.length) {
      total += 1;
      continue;
    }
    let lineLen = 0;
    let lines = 1;
    for (const word of words) {
      if (word.length > charsPerLine) {
        if (lineLen > 0) {
          lines += 1;
          lineLen = 0;
        }
        lines += Math.ceil(word.length / charsPerLine) - 1;
        lineLen = word.length % charsPerLine || charsPerLine;
      } else {
        const extra = lineLen ? 1 : 0;
        if (lineLen + extra + word.length > charsPerLine) {
          lines += 1;
          lineLen = word.length;
        } else {
          lineLen += extra + word.length;
        }
      }
    }
    total += lines;
  }
  return Math.max(1, total);
}

function textBlockHeight(lines, fontSizePx, padV = CELL_PAD_V) {
  return Math.ceil(lines * fontSizePx * LINE_HEIGHT + padV);
}

function estimateTitleBlockHeight(text, fontSizePx, widthPx = CONTENT_WIDTH) {
  const lines = estimateWrappedLines(text, widthPx, fontSizePx);
  return textBlockHeight(lines, fontSizePx, 8);
}

function layoutMetrics(headers, rows) {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const fontSize = colCount > 6 ? 20 : colCount > 4 ? 24 : 28;
  const headerSize = colCount > 6 ? 22 : colCount > 4 ? 26 : 24;
  const totalWidth = CONTENT_WIDTH;
  let colWidths;
  if (colCount === 4) {
    const side = [100, 110, 160];
    const main = totalWidth - side[0] - side[1] - side[2];
    colWidths = [side[0], main, side[1], side[2]];
  } else {
    colWidths = new Array(colCount).fill(Math.floor(totalWidth / colCount));
  }
  return { colCount, fontSize, headerSize, colWidths, totalWidth };
}

function rowHeight(cells, colCount, colWidths, sizePx) {
  let maxH = 0;
  for (let c = 0; c < colCount; c++) {
    const lines = estimateWrappedLines(cells[c], colWidths[c], sizePx);
    maxH = Math.max(maxH, textBlockHeight(lines, sizePx));
  }
  return maxH;
}

/** @param {{ title?: string, subtitle?: string, headers: string[], rows: string[][] }} table */
function estimateTableHeight(table) {
  const { title = '', subtitle = '', headers = [], rows = [] } = table;
  const { colCount, fontSize, headerSize, colWidths } = layoutMetrics(headers, rows);
  const headerH = rowHeight(headers, colCount, colWidths, headerSize);
  const bodyH = rows.reduce((sum, row) => sum + rowHeight(row, colCount, colWidths, fontSize), 0);
  const titleH = estimateTitleBlockHeight(title, 42);
  const subtitleH = subtitle ? estimateTitleBlockHeight(subtitle, 26) + SUBTITLE_GAP : 0;
  return (
    PAD_TOP
    + BADGE_H
    + BADGE_GAP
    + titleH
    + subtitleH
    + headerH
    + bodyH
    + PAD_BOTTOM
    + HEIGHT_BUFFER
  );
}

/** Разбить большую таблицу на страницы по расчётной высоте PNG. */
function chunkTableByHeight(table, maxHeight = 4200, meta = {}) {
  const { headers, rows } = table;
  if (!rows.length) {
    return [{ headers, rows: [], page: 1, pages: 1 }];
  }

  const boundaries = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end < rows.length) {
      const h = estimateTableHeight({
        title: meta.title || '',
        subtitle: meta.subtitle || '',
        headers,
        rows: rows.slice(start, end + 1),
      });
      if (h > maxHeight && end > start) break;
      if (h > maxHeight && end === start) {
        end += 1;
        break;
      }
      end += 1;
    }
    boundaries.push([start, end]);
    start = end;
  }

  const pages = boundaries.length;
  return boundaries.map(([from, to], i) => ({
    headers,
    rows: rows.slice(from, to),
    page: i + 1,
    pages,
  }));
}

module.exports = {
  estimateTableHeight,
  estimateWrappedLines,
  layoutMetrics,
  rowHeight,
  chunkTableByHeight,
  HEIGHT_BUFFER,
  LINE_HEIGHT,
};
