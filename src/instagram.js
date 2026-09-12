import { cfg, log } from "./config.js";

/*
 * Carousel publishing is four steps, and the step most implementations skip is
 * the polling. A container is not usable the moment the API returns its id —
 * Meta still has to fetch and process the image. Publishing a parent whose
 * children are not FINISHED fails intermittently, which is the worst kind of
 * bug to have on an 08:00 cron.
 */

async function graph(path, params, method = "POST") {
  const url = new URL(`${cfg.graph}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: cfg.igToken });
  const res = method === "GET"
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (json.error) {
    const e = json.error;
    throw new Error(`Graph ${e.code}/${e.error_subcode || 0}: ${e.message}`);
  }
  return json;
}

async function waitFinished(containerId, tries = 30, gapMs = 4000) {
  for (let i = 0; i < tries; i++) {
    const { status_code, status } = await graph(
      containerId, { fields: "status_code,status" }, "GET");
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED")
      throw new Error(`container ${containerId} ${status_code}: ${status || ""}`);
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error(`container ${containerId} never finished`);
}

/** @returns {{id:string, permalink:string|null}} */
export async function publishCarousel(imageUrls, caption, hashtags = []) {
  if (imageUrls.length < 2 || imageUrls.length > 10)
    throw new Error(`carousel needs 2-10 images, got ${imageUrls.length}`);

  // 1 — one child container per slide
  const children = [];
  for (const [i, image_url] of imageUrls.entries()) {
    const { id } = await graph(`${cfg.igUserId}/media`,
      { image_url, is_carousel_item: "true" });
    log(`ig: child ${i + 1}/${imageUrls.length} -> ${id}`);
    children.push(id);
  }

  // 2 — every child must be FINISHED before the parent is created
  for (const id of children) await waitFinished(id);

  // 3 — the parent carries the caption
  const full = [caption, "", hashtags.join(" ")].join("\n").trim();
  const { id: parent } = await graph(`${cfg.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: full,
  });
  await waitFinished(parent);

  // 4 — publish
  const { id: mediaId } = await graph(`${cfg.igUserId}/media_publish`,
    { creation_id: parent });
  log(`ig: published ${mediaId}`);

  let permalink = null;
  try {
    ({ permalink } = await graph(mediaId, { fields: "permalink" }, "GET"));
  } catch { /* permalink is cosmetic */ }

  return { id: mediaId, permalink };
}

export async function insights(mediaId) {
  try {
    const { data } = await graph(`${mediaId}/insights`,
      { metric: "reach,saved,shares,total_interactions" }, "GET");
    return Object.fromEntries(
      (data || []).map((m) => [m.name, m.values?.[0]?.value ?? 0]));
  } catch (e) {
    log("ig insights failed", e.message);
    return null;
  }
}
