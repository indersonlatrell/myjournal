// A breached account has no buffer left, or says so in its Status text.
export function isBreached(status) {
  if (!status) return false;
  if (/^\s*breach(ed)?\b/i.test(status.status || "")) return true;
  const raw = status.distanceToBreach;
  if (raw === null || raw === undefined) return false;
  const dist = Number(raw);
  return !Number.isNaN(dist) && dist <= 0;
}
