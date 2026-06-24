// Per-user per-day delivery flags (morning brief, evening check-in).

import path from "node:path";

export function deliveryStatePath(plansDir, date) {
  return path.join(plansDir, `.delivery-state-${date}.json`);
}

export function wasDelivered(state, template) {
  return Boolean(state?.delivered?.[template]);
}

export function markDelivered(state, template, atIso) {
  const delivered = { ...(state?.delivered || {}) };
  delivered[template] = atIso || new Date().toISOString();
  return {
    date: state?.date,
    delivered,
  };
}
