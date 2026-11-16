// Notion API helpers shared by the trades and account-status routes.
export const NOTION_VERSION = "2022-06-28";

// Queries a database and follows `next_cursor` so results aren't capped at 100.
export async function queryDatabase(env, databaseId, body = {}, { maxPages = 10 } = {}) {
  const results = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data?.message || `Notion ${res.status}`);
      err.status = res.status;
      err.detail = data;
      throw err;
    }
    results.push(...(data.results || []));
    if (!data.has_more || body.page_size) break;
    cursor = data.next_cursor;
  }
  return results;
}

// Property readers. Each returns a safe default when the property is missing.
export const text = (p) =>
  !p ? ""
  : p.type === "title" ? p.title.map((t) => t.plain_text).join("")
  : p.type === "rich_text" ? p.rich_text.map((t) => t.plain_text).join("")
  : "";
export const select = (p) => p?.select?.name || "";
export const multiSelect = (p) => (p?.multi_select || []).map((o) => o.name);
export const checkbox = (p) => p?.checkbox === true;
export const date = (p) => p?.date?.start || null;
export function number(p) {
  if (!p) return null;
  if (typeof p.number === "number") return p.number;
  if (p.formula?.type === "number") return p.formula.number ?? null;
  return null;
}
