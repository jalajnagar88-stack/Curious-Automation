import { readFile } from "node:fs/promises";
import { cfg, log } from "./config.js";

const TEMPLATE = new URL("../template/slide.html", import.meta.url);
let cached = null;

async function template() {
  if (!cached) cached = await readFile(TEMPLATE, "utf8");
  return cached;
}

/** Inject one slide's data into the template. */
async function html(slide, meta, index) {
  const data = JSON.stringify({ ...slide, ...meta, index });
  const t = await template();
  if (!t.includes("/*__DATA__*/")) throw new Error("template lost its /*__DATA__*/ marker");
  return t.replace("/*__DATA__*/", data);
}

/* ---------- htmlcsstoimage.com ---------- */
async function viaHcti(doc) {
  if (!cfg.hctiUser || !cfg.hctiKey) throw new Error("HCTI credentials missing");
  const auth = Buffer.from(`${cfg.hctiUser}:${cfg.hctiKey}`).toString("base64");
  const res = await fetch("https://hcti.io/v1/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      html: doc,
      viewport_width: 1080,
      viewport_height: 1350,
      device_scale: 1,          // template is already at final pixel size
      ms_delay: 1200,           // webfonts + the auto-fit pass
    }),
  });
  if (!res.ok) throw new Error(`HCTI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { url } = await res.json();
  return url;
}

/* ---------- local puppeteer fallback ---------- */
async function viaPuppeteer(doc, name) {
  const { default: puppeteer } = await import("puppeteer");
  const { mkdir, writeFile } = await import("node:fs/promises");
  if (!cfg.publicImageBase)
    throw new Error("RENDERER=puppeteer needs PUBLIC_IMAGE_BASE (Meta fetches the image by URL)");

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(doc, { waitUntil: "networkidle0" });
    await page.waitForFunction('document.body.dataset.ready === "1"', { timeout: 15000 })
      .catch(() => log("render: auto-fit flag never set, capturing anyway"));
    const buf = await page.screenshot({ type: "png" });
    await mkdir("./public", { recursive: true });
    await writeFile(`./public/${name}.png`, buf);
    return `${cfg.publicImageBase.replace(/\/$/, "")}/${name}.png`;
  } finally {
    await browser.close();
  }
}

/** slides[] -> six public PNG URLs, in order. */
export async function renderSlides(slides, meta) {
  const stamp = Date.now();
  const urls = [];
  for (let i = 0; i < slides.length; i++) {
    const doc = await html(slides[i], meta, i);
    const url = cfg.renderer === "puppeteer"
      ? await viaPuppeteer(doc, `${stamp}-${i}`)
      : await viaHcti(doc);
    log(`render: slide ${i + 1}/${slides.length} -> ${url}`);
    urls.push(url);
  }
  return urls;
}
