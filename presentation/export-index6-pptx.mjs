/**
 * index6.pdf → editable PPTX (text boxes positioned from PDF layout).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import PptxGenJS from 'pptxgenjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = process.argv[2] || 'C:\\Users\\screa\\Downloads\\index6.pdf';
const outPath = process.argv[3] || path.join(__dirname, 'index6.pptx');

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const DARK_SLIDES = new Set([1, 5, 20]);

const C = {
  white: 'FFFFFF',
  darkBg: '0A0A12',
  ink: '141418',
  light: 'F5F5F7',
  accent: 'FF5A36',
  muted: '6B6B78',
  mutedOnDark: 'A8A8B4',
};

const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await getDocument({ data: pdfBytes, useSystemFonts: true }).promise;

function pdfToSlideX(x, pageW) {
  return (x / pageW) * SLIDE_W;
}

function pdfToSlideY(yTop, pageH) {
  return (yTop / pageH) * SLIDE_H;
}

function pdfToSlideW(w, pageW) {
  return (w / pageW) * SLIDE_W;
}

function pdfToSlideH(h, pageH) {
  return (h / pageH) * SLIDE_H;
}

function itemTopLeft(item, pageH) {
  const [, , , , x, yBaseline] = item.transform;
  const h = item.height || 12;
  const w = item.width || item.str.length * h * 0.5;
  const yTop = pageH - yBaseline - h * 0.85;
  return { x, y: yTop, w: Math.max(w, 4), h: Math.max(h, 8), text: item.str };
}

function groupTextBlocks(items, pageW, pageH) {
  const rows = new Map();

  for (const raw of items) {
    const text = raw.str?.trim();
    if (!text) continue;
    const box = itemTopLeft(raw, pageH);
    const rowKey = Math.round(box.y / 6);
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push({ ...box, text: raw.str, fontSize: raw.height || 12, raw });
  }

  const blocks = [];
  const sortedKeys = [...rows.keys()].sort((a, b) => a - b);

  for (const key of sortedKeys) {
    const line = rows.get(key).sort((a, b) => a.x - b.x);
    let cur = null;

    for (const part of line) {
      const gap = cur ? part.x - (cur.x + cur.w) : 0;
      const sameStyle = cur && Math.abs(cur.fontSize - part.fontSize) < 3;
      const merge = cur && gap < Math.max(24, cur.fontSize * 2) && sameStyle;

      if (merge) {
        const needsSpace = gap > part.fontSize * 0.35;
        cur.text += (needsSpace ? ' ' : '') + part.text;
        cur.w = part.x + part.w - cur.x;
        cur.h = Math.max(cur.h, part.h);
        cur.fontSize = Math.max(cur.fontSize, part.fontSize);
      } else {
        if (cur) blocks.push(cur);
        cur = { ...part };
      }
    }
    if (cur) blocks.push(cur);
  }

  return blocks
    .map((b) => ({
      ...b,
      text: b.text.replace(/\s+/g, (m) => (m.includes('\n') ? m : ' ')).trim(),
    }))
    .filter((b) => b.text.length > 0);
}

function isFooterBlock(b, pageH) {
  const t = b.text.replace(/\s/g, '');
  return (
    b.y > pageH * 0.88 ||
    /^GOLDENHOUR/i.test(t) ||
    /^\d{2}\/\d{2}$/.test(t) ||
    /COVER|PROBLEM|SOLUTION|CLOSING|DASHBOARD|MINIAPP|STATISTICS/i.test(t)
  );
}

function blockColor(block, isDark) {
  const t = block.text.trim();
  if (/^[А-ЯA-Z0-9 ·/]+$/.test(t) && t.length < 40 && block.fontSize < 18) {
    return isDark ? C.accent : C.accent;
  }
  if (block.fontSize < 14) return isDark ? C.mutedOnDark : C.muted;
  return isDark ? C.light : C.ink;
}

function blockBold(block) {
  return block.fontSize >= 28 || /^[А-ЯA-Z0-9 ·/]+$/.test(block.text.trim());
}

function pptFontSize(block, pageH) {
  const pt = block.fontSize * (SLIDE_H / pageH) * 72 * 0.95;
  return Math.max(7, Math.min(44, Math.round(pt)));
}

function clusterCards(blocks, pageW, pageH) {
  const used = new Set();
  const cards = [];
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const seed = sorted[i];
    if (seed.fontSize > 40 || isFooterBlock(seed, pageH)) continue;

    const cluster = [seed];
    used.add(i);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const other = sorted[j];
      if (other.fontSize > 40 || isFooterBlock(other, pageH)) continue;
      const xOverlap = Math.abs(other.x - seed.x) < pageW * 0.22;
      const yClose = other.y - seed.y < pageH * 0.35 && other.y >= seed.y - 4;
      if (xOverlap && yClose) {
        cluster.push(other);
        used.add(j);
      }
    }

    if (cluster.length < 2) continue;

    const minX = Math.min(...cluster.map((c) => c.x));
    const minY = Math.min(...cluster.map((c) => c.y));
    const maxX = Math.max(...cluster.map((c) => c.x + c.w));
    const maxY = Math.max(...cluster.map((c) => c.y + c.h));
    const w = maxX - minX;
    const h = maxY - minY;

    if (w < pageW * 0.12 || w > pageW * 0.42) continue;
    if (h < pageH * 0.08 || h > pageH * 0.55) continue;

    cards.push({
      x: minX - 12,
      y: minY - 10,
      w: w + 24,
      h: h + 18,
    });
  }

  return cards;
}

async function extractPage(pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const blocks = groupTextBlocks(tc.items, vp.width, vp.height);
  return { pageW: vp.width, pageH: vp.height, blocks };
}

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'GoldenHour';
pres.author = 'GoldenHour';

for (let n = 1; n <= pdf.numPages; n++) {
  const { pageW, pageH, blocks } = await extractPage(n);
  const isDark = DARK_SLIDES.has(n);
  const slide = pres.addSlide();
  slide.name = `Слайд ${n}`;

  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: isDark ? C.darkBg : C.white },
    line: { color: isDark ? C.darkBg : C.white, width: 0 },
  });

  const content = blocks.filter((b) => !isFooterBlock(b, pageH));
  const footer = blocks.filter((b) => isFooterBlock(b, pageH));
  const cards = clusterCards(content, pageW, pageH);

  for (const card of cards) {
    slide.addShape('roundRect', {
      x: pdfToSlideX(card.x, pageW),
      y: pdfToSlideY(card.y, pageH),
      w: pdfToSlideW(card.w, pageW),
      h: pdfToSlideH(card.h, pageH),
      fill: { color: isDark ? '1A1A22' : 'F7F7FA' },
      line: { color: isDark ? '333340' : 'E5E5EA', width: 1 },
      rectRadius: 0.06,
    });
  }

  for (const b of content) {
    const x = pdfToSlideX(b.x, pageW);
    const y = pdfToSlideY(b.y, pageH);
    const w = Math.min(SLIDE_W - x, Math.max(pdfToSlideW(b.w, pageW), 0.5));
    const h = Math.max(pdfToSlideH(b.h, pageH), 0.2);
    const fontSize = pptFontSize(b, pageH);

    slide.addText(b.text, {
      x,
      y,
      w,
      h,
      fontSize,
      bold: blockBold(b),
      color: blockColor(b, isDark),
      fontFace: 'Arial',
      valign: 'top',
      margin: 0,
      wrap: true,
    });
  }

  for (const b of footer) {
    slide.addText(b.text, {
      x: pdfToSlideX(b.x, pageW),
      y: pdfToSlideY(b.y, pageH),
      w: pdfToSlideW(Math.max(b.w, 40), pageW),
      h: pdfToSlideH(b.h, pageH),
      fontSize: Math.max(6, pptFontSize(b, pageH) - 2),
      color: isDark ? C.mutedOnDark : C.muted,
      fontFace: 'Courier New',
      margin: 0,
    });
  }
}

await pres.writeFile({ fileName: outPath });
console.log(`OK: ${outPath} (${pdf.numPages} slides)`);
