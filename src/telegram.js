import { cfg, log } from "./config.js";

const api = (m) => `https://api.telegram.org/bot${cfg.tgToken}/${m}`;

async function call(method, body) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) log(`telegram ${method} failed:`, json.description);
  return json.result;
}

export async function say(text) {
  return call("sendMessage", {
    chat_id: cfg.tgChat, text, parse_mode: "HTML", disable_web_page_preview: true,
  });
}

/** Six images plus the approval card. */
export async function sendForApproval(row, imageUrls) {
  await call("sendMediaGroup", {
    chat_id: cfg.tgChat,
    media: imageUrls.map((u, i) => ({
      type: "photo", media: u, caption: i === 0 ? `Draft #${row.id}` : undefined,
    })),
  });

  const conf = row.confidence == null ? "?" : Number(row.confidence).toFixed(2);
  const tags = (row.hashtags || []).join(" ");
  const text =
    `<b>Draft #${row.id}</b> · ${row.day_format}\n` +
    `Confidence ${conf} · facts verified\n\n` +
    `${escapeHtml(row.caption || "").slice(0, 2500)}\n\n` +
    `${escapeHtml(tags)}\n\n` +
    `Source: ${row.source_url}`;

  return call("sendMessage", {
    chat_id: cfg.tgChat, text, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[
      { text: "Approve", callback_data: `ok:${row.id}` },
      { text: "Skip",    callback_data: `no:${row.id}` },
    ]]},
  });
}

export async function held(row, failures) {
  await say(
    `<b>Held — not published</b>\n` +
    `Draft #${row?.id ?? "?"} failed the fact check.\n\n` +
    failures.map((f) => `· ${escapeHtml(f)}`).join("\n") +
    (row?.source_url ? `\n\nSource: ${row.source_url}` : "")
  );
}

export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Long-poll for button presses. No public webhook needed, which means this runs
 * on a box with no inbound ports open.
 */
export function listen(onDecision) {
  let offset = 0;
  const tick = async () => {
    try {
      const res = await fetch(api("getUpdates") + `?timeout=50&offset=${offset}`);
      const json = await res.json();
      for (const u of json.result || []) {
        offset = u.update_id + 1;
        const cb = u.callback_query;
        if (!cb?.data) continue;
        const [verb, id] = cb.data.split(":");
        await call("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: verb === "ok" ? "Approved — publishes at 08:00" : "Skipped",
        });
        await onDecision(verb === "ok" ? "approved" : "skipped", Number(id));
      }
    } catch (e) {
      log("telegram poll error", e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
    setImmediate(tick);
  };
  tick();
  log("telegram: listening for approve/skip");
}
