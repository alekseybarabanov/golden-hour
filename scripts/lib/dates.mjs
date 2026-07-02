// Date utilities. Timezone is configurable:
//   GH_TZ        — IANA name (default "Europe/Moscow"), used for calendar-day math.
//   GH_TZ_OFFSET — fixed UTC offset like "+03:00"; if unset, derived from GH_TZ.
// For correct slot times set the host system TZ to match GH_TZ (see deploy/pi/).

const TZ = process.env.GH_TZ?.trim() || "Europe/Moscow";

function deriveOffset(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value || "";
    if (name === "GMT" || name === "UTC") return "+00:00";
    const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (m) return `${m[1]}${m[2]}:${m[3] || "00"}`;
  } catch {
    /* fall through to default */
  }
  return "+03:00";
}

const TZ_OFFSET = process.env.GH_TZ_OFFSET?.trim() || deriveOffset(TZ);

export function parseDateOnly(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = m[3] ? +m[3] : 1;
  return new Date(Date.UTC(y, mo, d));
}

/** Calendar date in the configured timezone (GH_TZ, default Europe/Moscow). */
export function todayISO(ref = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
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
