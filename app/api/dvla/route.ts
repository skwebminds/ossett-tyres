import { NextResponse } from "next/server";
import { google } from "googleapis";

// --- Upstream URLs ----------------------------------------------------------
const DVLA_URL =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const OETYRES_URL =
  "https://api.oneautoapi.com/driverightdata/oetyrefitmentdata/v2";

// --- Simple cooldown --------------------------------------------------------
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

  if (tooSoon(ipVrmKey, 10_000))
    return { blocked: true, retryAfterSec: 10, which: "IP+VRM" };
  if (tooSoon(ipKey, 2_000))
    return { blocked: true, retryAfterSec: 2, which: "IP" };
  return { blocked: false, retryAfterSec: 0, which: null as any };
}

function rateLimitResponse(retryAfterSec: number, which: string) {
  return withCors(
    {
      ok: false,
      error: 429,
      message: `Rate limit hit (${which}). Try again in ~${retryAfterSec}s.`,
    },
    429
  );
}

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// --- Google Sheets logging --------------------------------------------------
async function appendApiLog(row: any[]) {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!email || !key || !spreadsheetId) return;

  const auth = new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `api logging tracker!A:Z`, // 👈 logs into your tracker tab
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

// --- VRM validation ---------------------------------------------------------
function normaliseAndValidateVRM(input: string | null) {
  const vrm = (input || "").trim().toUpperCase();
  if (!vrm)
    return {
      ok: false as const,
      error: "Use ?reg=YOURREG or provide registrationNumber",
    };
  if (!/^[A-Z0-9]{1,8}$/.test(vrm))
    return { ok: false as const, error: "Invalid VRM format" };
  return { ok: true as const, vrm };
}

// --- Upstream: DVLA ---------------------------------------------------------
async function fetchDvla(reg: string) {
  if (!process.env.DVLA_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: { error: "DVLA API key not configured" },
    };
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
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

// --- Upstream: OneAuto ------------------------------------------------------
async function fetchOETyresRaw(vrm: string) {
  if (!process.env.ONEAUTO_API_KEY) {
    return {
      ok: false,
      status: 501,
      data: {
        error: "Tyre API key not configured (ONEAUTO_API_KEY)",
      },
    };
  }
  const url = `${OETYRES_URL}?vehicle_registration_mark=${encodeURIComponent(
    vrm
  )}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": process.env.ONEAUTO_API_KEY! },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

// --- CORS helper ------------------------------------------------------------
const allowedOrigins = [
  "https://ossettyres.co.uk",
  "https://www.ossettyres.co.uk",
];

function withCors(body: any, status = 200, origin?: string | null) {
  const useOrigin = allowedOrigins.includes(origin || "")
    ? origin
    : allowedOrigins[0];
  return NextResponse.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": useOrigin!,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// --- Response builder -------------------------------------------------------
function buildResponse({
  dvla,
  tyresRaw,
  origin,
}: {
  dvla: { ok: boolean; status: number; data: any };
  tyresRaw?: { ok: boolean; status: number; data: any } | null;
  origin?: string | null;
}) {
  const status = dvla.ok ? 200 : dvla.status;
  return withCors(
    {
      ok: dvla.ok,
      dvla: dvla.data,
      tyres: tyresRaw?.data,
    },
    status,
    origin
  );
}

// --- Handlers ---------------------------------------------------------------

// POST
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";
  const submittedAtUK = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
  });

  try {
    const body = await req.json().catch(() => ({} as any));
    const customerName = body?.customerName || "unknown";
    const customerPhone = body?.customerPhone || "unknown";
    const norm = normaliseAndValidateVRM(body?.registrationNumber ?? null);

    if (!norm.ok) {
      await appendApiLog([
        submittedAtUK,
        "/api/dvla",
        body?.registrationNumber || "",
        ip,
        userAgent,
        "POST",
        400,
        "Invalid VRM",
        customerName,
        customerPhone,
      ]);
      return withCors({ error: norm.error }, 400, origin);
    }

    const cd = simpleCooldown(ip, norm.vrm);
    if (cd.blocked) {
      await appendApiLog([
        submittedAtUK,
        "/api/dvla",
        norm.vrm,
        ip,
        userAgent,
        "POST",
        429,
        "Rate limited",
        customerName,
        customerPhone,
      ]);
      return rateLimitResponse(cd.retryAfterSec, cd.which!);
    }

    const dvla = await fetchDvla(norm.vrm);
    const tyresRaw = dvla.ok
      ? await fetchOETyresRaw(norm.vrm).catch(() => ({
          ok: false,
          status: 500,
          data: null,
        }))
      : null;

    // ✅ Log lookup (with name + phone)
    await appendApiLog([
      submittedAtUK,
      "/api/dvla",
      norm.vrm,
      ip,
      userAgent,
      "POST",
      dvla.status,
      dvla.ok ? "Success" : "Failed",
      customerName,
      customerPhone,
    ]);

    // ✅ Optional: simplified email alert via Web3Forms
    if (process.env.WEB3FORMS_KEY) {
      const message = `A customer has searched their registration but not yet placed an order.

Registration: ${norm.vrm}
Name: ${customerName}
Phone: ${customerPhone}
Time (UK): ${submittedAtUK}`;

      await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: process.env.WEB3FORMS_KEY,
          from_name: "DVLA Lookup Tracker",
          subject: `Pending Order Lookup – ${norm.vrm}`,
          message,
        }),
      }).catch(() => {});
    }

    return buildResponse({ dvla, tyresRaw, origin });
  } catch (err: any) {
    await appendApiLog([
      submittedAtUK,
      "/api/dvla",
      "",
      ip,
      userAgent,
      "POST",
      500,
      "Server error",
    ]);
    return withCors({ error: "Server error", detail: err?.message }, 500, origin);
  }
}

// GET
export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";
  const submittedAtUK = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
  });

  try {
    const { searchParams } = new URL(req.url);
    const norm = normaliseAndValidateVRM(searchParams.get("reg"));
    if (!norm.ok) {
      await appendApiLog([
        submittedAtUK,
        "/api/dvla",
        searchParams.get("reg") || "",
        ip,
        userAgent,
        "GET",
        400,
        "Invalid VRM",
      ]);
      return withCors({ error: norm.error }, 400, origin);
    }

    const cd = simpleCooldown(ip, norm.vrm);
    if (cd.blocked) {
      await appendApiLog([
        submittedAtUK,
        "/api/dvla",
        norm.vrm,
        ip,
        userAgent,
        "GET",
        429,
        "Rate limited",
      ]);
      return rateLimitResponse(cd.retryAfterSec, cd.which!);
    }

    const dvla = await fetchDvla(norm.vrm);
    const tyresRaw = dvla.ok
      ? await fetchOETyresRaw(norm.vrm).catch(() => ({
          ok: false,
          status: 500,
          data: null,
        }))
      : null;

    await appendApiLog([
      submittedAtUK,
      "/api/dvla",
      norm.vrm,
      ip,
      userAgent,
      "GET",
      dvla.status,
      dvla.ok ? "Success" : "Failed",
    ]);

    return buildResponse({ dvla, tyresRaw, origin });
  } catch (err: any) {
    await appendApiLog([
      submittedAtUK,
      "/api/dvla",
      "",
      ip,
      userAgent,
      "GET",
      500,
      "Server error",
    ]);
    return withCors({ error: "Server error", detail: err?.message }, 500, origin);
  }
}

// --- OPTIONS ---------------------------------------------------------------
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const useOrigin = allowedOrigins.includes(origin || "")
    ? origin
    : allowedOrigins[0];
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": useOrigin!,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
