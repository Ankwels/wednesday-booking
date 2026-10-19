import { getStore } from "@netlify/blobs";

const SLOTS = ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
const NAMES = ["Francisco", "Daniel", "Klaus", "Bochra", "Konstantinos", "Rosland"];
const MODES = ["in-person", "teams"];
// The admin word is set in Netlify as the ADMIN_KEY environment variable.
const ADMIN_KEY = process.env.ADMIN_KEY;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const parse = (v) => {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
};

async function readState(store) {
  const bySlot = {};
  const byName = {};
  await Promise.all([
    ...SLOTS.map(async (s) => { bySlot[s] = parse(await store.get(`slot:${s}`)); }),
    ...NAMES.map(async (n) => { byName[n] = parse(await store.get(`name:${n}`)); }),
  ]);
  return { bySlot, byName };
}

export default async (req) => {
  const store = getStore({ name: "bookings-v2", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const { bySlot, byName } = await readState(store);
    if (url.searchParams.get("admin") !== null) {
      if (!ADMIN_KEY || url.searchParams.get("admin") !== ADMIN_KEY) return json({ error: "Wrong key" }, 403);
      return json({ slots: SLOTS, bySlot, byName });
    }
    const taken = {};
    SLOTS.forEach((s) => { taken[s] = !!bySlot[s]; });
    const name = url.searchParams.get("name");
    const mine = name && NAMES.includes(name) ? byName[name] : null;
    return json({ names: NAMES, slots: SLOTS, taken, mine });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const { action, name, slot, mode } = body;
    if (!NAMES.includes(name)) return json({ error: "Name not on the list" }, 400);
    const current = parse(await store.get(`name:${name}`));

    if (action === "cancel") {
      if (current) {
        await store.delete(`slot:${current.slot}`);
        await store.delete(`name:${name}`);
      }
      return json({ ok: true });
    }

    if (action === "mode") {
      if (!current || !MODES.includes(mode)) return json({ error: "Not allowed" }, 400);
      await store.set(`slot:${current.slot}`, JSON.stringify({ name, mode }));
      await store.set(`name:${name}`, JSON.stringify({ slot: current.slot, mode }));
      return json({ ok: true });
    }

    if (action === "book") {
      if (!SLOTS.includes(slot)) return json({ error: "Time not available" }, 400);
      if (!MODES.includes(mode)) return json({ error: "Choose in person or Teams" }, 400);
      if (current && current.slot === slot) {
        await store.set(`slot:${slot}`, JSON.stringify({ name, mode }));
        await store.set(`name:${name}`, JSON.stringify({ slot, mode }));
        return json({ ok: true });
      }
      const result = await store.set(`slot:${slot}`, JSON.stringify({ name, mode }), { onlyIfNew: true });
      if (!result.modified) return json({ error: "taken" }, 409);
      if (current) await store.delete(`slot:${current.slot}`);
      await store.set(`name:${name}`, JSON.stringify({ slot, mode }));
      return json({ ok: true });
    }
  }

  return json({ error: "Not allowed" }, 405);
};

export const config = { path: "/api/slots" };
