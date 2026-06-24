import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const outPdf = path.join(__dirname, 'zolotoy-chas-prezentaciya.pdf');
const slidesDir = path.join(__dirname, 'pdf-slides');
const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.goto(fileUrl, { waitUntil: 'networkidle0' });
await page.emulateMediaType('print');

await page.pdf({
  path: outPdf,
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

fs.mkdirSync(slidesDir, { recursive: true });
const total = 31;

for (let i = 1; i <= total; i++) {
  const slidePage = await browser.newPage();
  await slidePage.goto(`${fileUrl}?preview=${i}`, { waitUntil: 'networkidle0' });
  const num = String(i).padStart(2, '0');
  await slidePage.pdf({
    path: path.join(slidesDir, `slide-${num}.pdf`),
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await slidePage.close();
}

await browser.close();
console.log(`OK: ${outPdf}`);
console.log(`OK: ${total} files in ${slidesDir}`);
