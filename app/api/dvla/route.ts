// app/api/dvla/route.ts
import { NextResponse } from "next/server";

// --- Upstream URLs ----------------------------------------------------------
const DVLA_URL =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const OETYRES_URL =
  "https://api.oneautoapi.com/driverightdata/oetyrefitmentdata/v2";

// --- Simple cooldown --------------------------------------------------------
// Map of last request timestamps by key (ip / ip+vrm). Tiny traffic => fine in-memory.
const lastRequest: Map<string, number> = new Map();

/** Cooldown: per-IP (2s) and per-IP+VRM (10s). */
function simpleCooldown(ip: string, vrm: string) {
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const ipVrmKey = `ipvrm:${ip}:${vrm}`;

  const tooSoon = (key: string, ms: number) => {
    const last = lastRequest.get(key) || 0;
    if (now - last < ms) return true;
    lastRequest.set(key, now);
    return false;
  };

  if (tooSoon(ipVrmKey, 10_000)) return { blocked: true, retryAfterSec: 10, which: "IP+VRM" };
  if (tooSoon(ipKey, 2_000)) return { blocked: true, retryAfterSec: 2, which: "IP" };
  return { blocked: false, retryAfterSec: 0, which: null as any };
}

function rateLimitResponse(retryAfterSec: number, which: string) {
  return NextResponse.json(
    { ok: false, error: 429, message: `Rate limit hit (${which}). Try again in ~${retryAfterSec}s.` },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Policy": "IP:2s; IP+VRM:10s",
      },
    }
  );
}

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// --- VRM validation ---------------------------------------------------------
function normaliseAndValidateVRM(input: string | null) {
  const vrm = (input || "").trim().toUpperCase();
  if (!vrm) return { ok: false as const, error: "Use ?reg=YOURREG or provide registrationNumber" };
  if (!/^[A-Z0-9]{1,8}$/.test(vrm)) return { ok: false as const, error: "Invalid VRM format" };
  return { ok: true as const, vrm };
}

// --- Upstream: DVLA ---------------------------------------------------------
async function fetchDvla(reg: string) {
  if (!process.env.DVLA_API_KEY) {
    return { ok: false, status: 500, data: { error: "DVLA API key not configured" } };
  }
  const resp = await fetch(DVLA_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.DVLA_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ registrationNumber: reg }),
  });
  let data: any = null;
  try { data = await resp.json(); } catch { data = null; }
  return { ok: resp.ok, status: resp.status, data };
}

// --- Upstream: OneAuto (raw) -----------------------------------------------
async function fetchOETyresRaw(vrm: string) {
  if (!process.env.ONEAUTO_API_KEY) {
    return { ok: false, status: 501, data: { error: "Tyre API key not configured (ONEAUTO_API_KEY)" } };
  }
  const url = `${OETYRES_URL}?vehicle_registration_mark=${encodeURIComponent(vrm)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.ONEAUTO_API_KEY!}` },
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// --- Extract ONLY "tyre_size_front"/"tyre_size_rear" ------------------------
function pickFrontRearTyreSizes(raw: any) {
  const model = raw?.oe_data?.modelIDs?.[0];
  return {
    tyre_size_front: model?.tyre_size_front ?? null,
    tyre_size_rear: model?.tyre_size_rear ?? null,
  };
}

// --- Response builder -------------------------------------------------------
function buildResponse({
  dvla,
  tyresRaw,
}: {
  dvla: { ok: boolean; status: number; data: any };
  tyresRaw?: { ok: boolean; status: number; data: any } | null;
}) {
  const status = dvla.ok ? 200 : dvla.status;
  const tyres =
    tyresRaw?.ok && tyresRaw.data
      ? pickFrontRearTyreSizes(tyresRaw.data)
      : { tyre_size_front: null, tyre_size_rear: null };

  return NextResponse.json(
    {
      ok: dvla.ok,
      dvla: dvla.data, // keep DVLA full for make/model/colour/etc
      tyres,           // only the two fields you want
    },
    { status }
  );
}

// --- Handlers ---------------------------------------------------------------

// POST body: { registrationNumber: "AB12CDE" }
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => ({} as any));
    const norm = normaliseAndValidateVRM(body?.registrationNumber ?? null);
    if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

    const cd = simpleCooldown(ip, norm.vrm);
    if (cd.blocked) return rateLimitResponse(cd.retryAfterSec, cd.which!);

    const dvla = await fetchDvla(norm.vrm);
    if (!dvla.ok) return buildResponse({ dvla, tyresRaw: null });

    const tyresRaw = await fetchOETyresRaw(norm.vrm).catch(() => ({ ok: false, status: 500, data: null }));
    return buildResponse({ dvla, tyresRaw });
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: err?.message }, { status: 500 });
  }
}

// GET /api/dvla?reg=AB12CDE
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const { searchParams } = new URL(req.url);
    const norm = normaliseAndValidateVRM(searchParams.get("reg"));
    if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

    const cd = simpleCooldown(ip, norm.vrm);
    if (cd.blocked) return rateLimitResponse(cd.retryAfterSec, cd.which!);

    const dvla = await fetchDvla(norm.vrm);
    if (!dvla.ok) return buildResponse({ dvla, tyresRaw: null });

    const tyresRaw = await fetchOETyresRaw(norm.vrm).catch(() => ({ ok: false, status: 500, data: null }));
    return buildResponse({ dvla, tyresRaw });
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: err?.message }, { status: 500 });
  }
}
