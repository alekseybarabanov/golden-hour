/**
 * Export HTML deck → editable PPTX (text boxes, shapes — not slide screenshots).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import PptxGenJS from 'pptxgenjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const outPath = path.join(__dirname, 'zolotoy-chas-prezentaciya.pptx');

const W = 10;
const H = 5.625;
const px = (v) => (v * W) / 1920;
const py = (v) => (v * H) / 1080;

const C = {
  white: 'FFFFFF',
  darkBg: '0A0A12',
  ink: '0A0A12',
  light: 'F5F5F7',
  accent: 'FF5A36',
  accent2: 'FF8C5A',
  accent3: 'FFB36B',
  text2: '4A4A58',
  dimOnDark: 'C4C4CC',
  cardDark: '1A1A22',
  cardDarkBorder: '3A3A48',
  border: 'E5E5EA',
  innerDark: '1A1A28',
};

const html = fs.readFileSync(htmlPath, 'utf8');
const $ = cheerio.load(html);
const slideEls = $('.deck > section.slide').toArray();

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Золотой час';
pres.title = 'Золотой час — презентация';

function textColor(isDark, dim = false) {
  if (isDark) return dim ? C.dimOnDark : C.light;
  return dim ? C.text2 : C.ink;
}

function addBg(slide, isDark) {
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: isDark ? C.darkBg : C.white },
    line: { color: isDark ? C.darkBg : C.white, width: 0 },
  });
}

function innerText(el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

function htmlToLines(el) {
  const $el = $(el).clone();
  $el.find('br').replaceWith('\n');
  $el.find('span').each((_, span) => {
    const t = $(span).text();
    $(span).replaceWith(t);
  });
  return $el.text().replace(/\r/g, '').trim();
}

function addTextBox(slide, text, opts) {
  const {
    x, y, w, h,
    fontSize = 18,
    bold = false,
    color = C.ink,
    align = 'left',
    valign = 'top',
    fontFace = 'Arial',
    italic = false,
    charSpacing = 0,
    lineSpacing = undefined,
    fill,
    margin = 0,
  } = opts;

  const textOpts = {
    x, y, w, h,
    fontSize,
    bold,
    color,
    align,
    valign,
    fontFace,
    italic,
    charSpacing,
    margin,
    wrap: true,
  };
  if (lineSpacing != null) textOpts.lineSpacing = lineSpacing;
  if (fill) textOpts.fill = fill;

  slide.addText(text, textOpts);
}

function addKicker(slide, text, isDark, y = py(80)) {
  addTextBox(slide, text, {
    x: px(112),
    y,
    w: px(800),
    h: py(30),
    fontSize: 9,
    bold: true,
    color: isDark ? C.accent2 : C.accent,
    charSpacing: 2,
  });
}

function addHeading(slide, el, isDark, kind, y) {
  const text = htmlToLines(el);
  const isH1 = kind === 'h1';
  addTextBox(slide, text, {
    x: px(112),
    y,
    w: px(1200),
    h: isH1 ? py(200) : py(150),
    fontSize: isH1 ? 48 : 32,
    bold: true,
    color: textColor(isDark),
    lineSpacing: isH1 ? 44 : 34,
    charSpacing: -1,
  });
  return y + (isH1 ? py(180) : py(130));
}

function addLede(slide, el, isDark, y, centered = false) {
  const text = innerText(el);
  addTextBox(slide, text, {
    x: centered ? px(360) : px(112),
    y,
    w: centered ? px(1200) : px(900),
    h: py(80),
    fontSize: 14,
    color: textColor(isDark, true),
    align: centered ? 'center' : 'left',
    lineSpacing: 22,
  });
  return y + py(70);
}

function addFeatureCard(slide, card, box, isDark) {
  const { x, y, w, h } = box;
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    fill: { color: isDark ? C.cardDark : C.white },
    line: { color: isDark ? C.cardDarkBorder : C.border, width: 1 },
    rectRadius: 0.08,
  });

  const icon = $(card).find('.icon').first();
  const title = $(card).find('h4').first();
  const desc = $(card).find('p').first();

  if (icon.length) {
    slide.addShape('roundRect', {
      x: x + px(28),
      y: y + py(28),
      w: px(48),
      h: py(48),
      fill: {
        type: 'gradient',
        color: [C.accent, C.accent3],
        angle: 120,
      },
      line: { width: 0 },
      rectRadius: 0.15,
    });
    addTextBox(slide, innerText(icon), {
      x: x + px(28),
      y: y + py(32),
      w: px(48),
      h: py(40),
      fontSize: 16,
      bold: true,
      color: C.white,
      align: 'center',
      valign: 'middle',
    });
  }

  if (title.length) {
    addTextBox(slide, innerText(title), {
      x: x + px(28),
      y: y + (icon.length ? py(90) : py(28)),
      w: w - px(56),
      h: py(36),
      fontSize: 13,
      bold: true,
      color: textColor(isDark),
    });
  }

  if (desc.length) {
    addTextBox(slide, innerText(desc), {
      x: x + px(28),
      y: y + (icon.length ? py(125) : py(65)),
      w: w - px(56),
      h: py(50),
      fontSize: 11,
      color: textColor(isDark, true),
    });
  }
}

function addCard(slide, card, box, isDark) {
  const { x, y, w, h } = box;
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    fill: { color: isDark ? C.cardDark : C.white },
    line: { color: isDark ? C.cardDarkBorder : C.border, width: 1 },
    rectRadius: 0.06,
  });

  const title = $(card).find('h4').first();
  const desc = $(card).find('p').first();

  if (title.length) {
    addTextBox(slide, innerText(title), {
      x: x + px(24),
      y: y + py(24),
      w: w - px(48),
      h: py(36),
      fontSize: 13,
      bold: true,
      color: textColor(isDark),
    });
  }

  if (desc.length) {
    addTextBox(slide, innerText(desc), {
      x: x + px(24),
      y: y + py(62),
      w: w - px(48),
      h: py(60),
      fontSize: 11,
      color: textColor(isDark, true),
      lineSpacing: 16,
    });
  }
}

function addGrid(slide, grid, startY, isDark) {
  const cols = grid.hasClass('g4') ? 4 : grid.hasClass('g2') ? 2 : 3;
  const gap = px(24);
  const left = px(112);
  const totalW = W - left * 2;
  const cardW = (totalW - gap * (cols - 1)) / cols;
  const cardH = py(200);

  const items = grid.children().toArray();
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = left + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    const box = { x, y, w: cardW, h: cardH };

    if ($(item).hasClass('feature-card')) addFeatureCard(slide, item, box, isDark);
    else if ($(item).hasClass('card')) addCard(slide, item, box, isDark);
  });

  const rows = Math.ceil(items.length / cols);
  return startY + rows * (cardH + gap) + py(20);
}

function addSteps(slide, stack, startY, isDark) {
  const left = px(112);
  const w = px(900);
  let y = startY;

  stack.children('.step').each((_, step) => {
    slide.addShape('ellipse', {
      x: left,
      y: y,
      w: px(44),
      h: py(44),
      fill: {
        type: 'gradient',
        color: [C.accent, C.accent3],
        angle: 120,
      },
      line: { width: 0 },
    });

    const num = $(step).find('.n').first();
    addTextBox(slide, innerText(num), {
      x: left,
      y: y + py(4),
      w: px(44),
      h: py(36),
      fontSize: 14,
      bold: true,
      color: C.white,
      align: 'center',
    });

    const title = $(step).find('h4').first();
    const desc = $(step).find('p').first();

    addTextBox(slide, innerText(title), {
      x: left + px(68),
      y: y + py(2),
      w: w - px(68),
      h: py(30),
      fontSize: 13,
      bold: true,
      color: textColor(isDark),
    });

    if (desc.length) {
      addTextBox(slide, innerText(desc), {
        x: left + px(68),
        y: y + py(30),
        w: w - px(68),
        h: py(30),
        fontSize: 11,
        color: textColor(isDark, true),
      });
    }

    y += py(72);
  });
}

function addHeroShot(slide) {
  const cx = px(1920 - 60 - 320);
  const cy = py(540 - 320);
  const size = px(640);

  slide.addShape('ellipse', {
    x: cx,
    y: cy,
    w: size,
    h: size,
    fill: {
      type: 'gradient',
      color: [C.accent, C.accent2, C.accent3],
      angle: 120,
    },
    line: { width: 0 },
    transparency: 15,
  });

  const inner = px(80);
  slide.addShape('roundRect', {
    x: cx + inner,
    y: cy + inner,
    w: size - inner * 2,
    h: size - inner * 2,
    fill: { color: C.innerDark },
    line: { color: '444455', width: 1 },
    rectRadius: 0.12,
  });

  addTextBox(slide, '🌅', {
    x: cx + inner,
    y: cy + inner + py(60),
    w: size - inner * 2,
    h: py(120),
    fontSize: 52,
    align: 'center',
    valign: 'middle',
    color: C.white,
  });
}

function addPill(slide, el, isDark, y) {
  const text = innerText(el);
  const pillW = px(Math.min(700, text.length * 22 + 80));
  const x = (W - pillW) / 2;

  slide.addShape('roundRect', {
    x,
    y,
    w: pillW,
    h: py(56),
    fill: { color: isDark ? '2A1A14' : 'FFF0EB' },
    line: { color: isDark ? C.accent2 : C.accent, width: 1 },
    rectRadius: 0.5,
  });

  addTextBox(slide, text, {
    x,
    y: y + py(12),
    w: pillW,
    h: py(32),
    fontSize: 16,
    bold: true,
    color: isDark ? C.accent2 : C.accent,
    align: 'center',
  });
}

function addCtaButton(slide, el, x, y) {
  const text = innerText(el).replace(/\s*→\s*$/, '') + ' →';
  const btnW = px(220);
  const btnH = py(52);

  slide.addShape('roundRect', {
    x,
    y,
    w: btnW,
    h: btnH,
    fill: {
      type: 'gradient',
      color: [C.accent, C.accent3],
      angle: 120,
    },
    line: { width: 0 },
    rectRadius: 0.5,
  });

  addTextBox(slide, text, {
    x,
    y: y + py(12),
    w: btnW,
    h: py(28),
    fontSize: 12,
    bold: true,
    color: C.white,
    align: 'center',
  });
}

function addMonoStack(slide, stack, startY, isDark) {
  let y = startY;
  stack.children('div').each((_, line) => {
    addTextBox(slide, innerText(line), {
      x: px(112),
      y,
      w: W - px(224),
      h: py(36),
      fontSize: 11,
      color: textColor(isDark, true),
      fontFace: 'Courier New',
    });
    y += py(40);
  });
}

function processSlide(slideEl) {
  const $s = $(slideEl);
  const isDark = $s.hasClass('dark');
  const isCenter = $s.hasClass('center');
  const title = $s.attr('data-title') || 'Слайд';
  const notes = $s.find('aside.notes').text().trim();

  const slide = pres.addSlide();
  slide.name = title;
  if (notes) slide.addNotes(notes);

  addBg(slide, isDark);

  if ($s.find('.hero-shot').length) addHeroShot(slide);

  const brand = $s.find('.brand').first();
  if (brand.length) {
    addTextBox(slide, innerText(brand), {
      x: px(112),
      y: py(56),
      w: px(400),
      h: py(30),
      fontSize: 11,
      bold: true,
      color: C.light,
    });
  }

  const kicker = $s.children('p.kicker').first();
  let y = isCenter ? py(160) : py(80);

  if (kicker.length && !isCenter) addKicker(slide, innerText(kicker), isDark, y);

  const h1 = $s.find('h1.h1').first();
  const h2 = $s.find('h2.h2').first();

  if (isCenter) {
    const wrap = $s.children('div').first();
    const ck = wrap.find('p.kicker').first();
    const ch1 = wrap.find('h1.h1').first();
    const clede = wrap.find('p.lede').first();

    if (ck.length) {
      addTextBox(slide, innerText(ck), {
        x: px(200),
        y: py(120),
        w: px(1520),
        h: py(30),
        fontSize: 9,
        bold: true,
        color: isDark ? C.accent2 : C.accent,
        align: 'center',
        charSpacing: 2,
      });
    }

    if (ch1.length) {
      const fs = parseInt(ch1.attr('style')?.match(/font-size:\s*(\d+)px/)?.[1] || '72', 10);
      addTextBox(slide, htmlToLines(ch1), {
        x: px(200),
        y: py(170),
        w: px(1520),
        h: py(280),
        fontSize: fs > 80 ? 42 : 32,
        bold: true,
        color: textColor(isDark),
        align: 'center',
        lineSpacing: fs > 80 ? 46 : 38,
        charSpacing: -1,
      });
    }

    if (clede.length) {
      addTextBox(slide, innerText(clede), {
        x: px(300),
        y: py(420),
        w: px(1320),
        h: py(60),
        fontSize: 14,
        color: textColor(isDark, true),
        align: 'center',
      });
    }
    return;
  }

  if (h1.length) {
    if (kicker.length) addKicker(slide, innerText(kicker), isDark, py(80));

    const gradSpan = $(h1).find('span').first();
    if (gradSpan.length) {
      const gradText = gradSpan.text();
      const full = htmlToLines(h1[0]);
      const lines = full.split('\n');
      const line1 = lines[0] || '';
      const line2 = gradText;

      addTextBox(slide, line1, {
        x: px(112),
        y: py(115),
        w: px(1100),
        h: py(70),
        fontSize: 48,
        bold: true,
        color: textColor(isDark),
        lineSpacing: 44,
      });
      addTextBox(slide, line2, {
        x: px(112),
        y: py(175),
        w: px(600),
        h: py(60),
        fontSize: 48,
        bold: true,
        color: C.accent,
        lineSpacing: 44,
      });
      y = py(260);
    } else {
      y = addHeading(slide, h1[0], isDark, 'h1', py(115));
    }

    const lede = $s.children('p.lede').first();
    if (lede.length) addLede(slide, lede[0], isDark, y);
    return;
  }

  if (h2.length) {
    if (kicker.length) addKicker(slide, innerText(kicker), isDark, py(80));
    y = addHeading(slide, h2[0], isDark, 'h2', py(115));
  }

  const grid = $s.children('.grid').first();
  if (grid.length) {
    addGrid(slide, grid, py(300), isDark);
  }

  const stack = $s.children('.stack').first();
  if (stack.length) addSteps(slide, stack, py(300), isDark);

  const centerBlock = $s.children('.center').first();
  if (centerBlock.length) {
    const pill = centerBlock.find('.pill').first();
    if (pill.length) {
      addPill(slide, pill[0], isDark, py(320));
      const sub = centerBlock.find('p.lede').first();
      if (sub.length) {
        addTextBox(slide, innerText(sub), {
          x: px(300),
          y: py(400),
          w: px(1320),
          h: py(50),
          fontSize: 14,
          color: textColor(isDark, true),
          align: 'center',
        });
      }
    }
  }

  const row = $s.children('.row').first();
  if (row.length) {
    if (kicker.length) addKicker(slide, innerText(kicker), isDark, py(80));

    const testimonial = row.find('.testimonial').first();
    const cta = row.find('.cta-btn').first();
    const emoji = row.find('div').filter((_, el) => /🌅/.test($(el).text())).first();
    const dimTexts = row.find('p.dim');

    if (testimonial.length) {
      addTextBox(slide, innerText(testimonial), {
        x: px(112),
        y: py(200),
        w: px(700),
        h: py(220),
        fontSize: 22,
        color: C.light,
        fontFace: 'Georgia',
        lineSpacing: 30,
      });
    }

    const rightX = px(1100);
    if (dimTexts.length) {
      addTextBox(slide, innerText(dimTexts.first()), {
        x: rightX,
        y: py(180),
        w: px(500),
        h: py(30),
        fontSize: 10,
        color: C.dimOnDark,
        align: 'center',
      });
    }

    if (emoji.length) {
      addTextBox(slide, '🌅', {
        x: rightX,
        y: py(220),
        w: px(500),
        h: py(90),
        fontSize: 48,
        align: 'center',
        color: C.white,
      });
    }

    if (cta.length) addCtaButton(slide, cta[0], rightX + px(140), py(330));

    if (dimTexts.length > 1) {
      addTextBox(slide, innerText(dimTexts.last()), {
        x: rightX,
        y: py(400),
        w: px(500),
        h: py(30),
        fontSize: 8,
        color: C.dimOnDark,
        align: 'center',
      });
    }
    return;
  }

  const ledeOnly = $s.children('p.lede').first();
  if (ledeOnly.length && !grid.length && !stack.length) {
    addLede(slide, ledeOnly[0], isDark, py(320));
  }

  const monoStack = $s.find('.stack.mono').first();
  if (monoStack.length) addMonoStack(slide, monoStack, py(300), isDark);
}

slideEls.forEach(processSlide);

await pres.writeFile({ fileName: outPath });
console.log(`OK: ${outPath} (${slideEls.length} slides)`);
