// Date utilities (Europe/Moscow +03:00 by default).

const TZ_OFFSET = "+03:00";

export function parseDateOnly(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = m[3] ? +m[3] : 1;
  return new Date(Date.UTC(y, mo, d));
}

export function todayISO(ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ref.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBetween(from, to) {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function weeksBetween(from, to) {
  const d = daysBetween(from, to);
  if (d == null) return null;
  return Math.max(1, Math.ceil(d / 7));
}

export function addDays(iso, n) {
  const d = parseDateOnly(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return todayISO(d);
}

export function formatDateTime(isoDate, hour, minute = 0) {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  return `${isoDate}T${h}:${m}:00${TZ_OFFSET}`;
}

export function addMinutes(isoDateTime, minutes) {
  const m = isoDateTime.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/
  );
  if (!m) return isoDateTime;
  const base = new Date(`${m[1]}T${m[2]}:${m[3]}:00${TZ_OFFSET}`);
  base.setMinutes(base.getMinutes() + minutes);
  const y = base.getFullYear();
  const mo = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  const h = String(base.getHours()).padStart(2, "0");
  const mi = String(base.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00${TZ_OFFSET}`;
}

export function resolveToday(opts) {
  return opts.date || todayISO();
}
