import { NextResponse } from "next/server";
import { sendWeb3Email } from "../enquiry/lib/email";
import { allowedOrigins, withCors } from "../enquiry/lib/cors";
import { simpleCooldown, rateLimitResponse } from "./lib/cooldown";
import { getClientIp } from "./lib/ip";
import { appendApiLog } from "./lib/logging";
import { normaliseAndValidateVRM } from "./lib/validate";
import { fetchDvla, fetchOETyresRaw } from "./lib/upstream";

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

// --- POST -------------------------------------------------------------------
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
      return rateLimitResponse(withCors, cd.retryAfterSec, cd.which!);
    }

    const dvla = await fetchDvla(norm.vrm);
    const tyresRaw = dvla.ok
      ? await fetchOETyresRaw(norm.vrm).catch(() => ({
          ok: false,
          status: 500,
          data: null,
        }))
      : null;

    // Log lookup (with name + phone)
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

    // Optional: simplified email alert via Web3Forms
    const web3formsKey = process.env.WEB3FORMS_KEY;
    const web3formsFromEmail = process.env.WEB3FORMS_FROM_EMAIL;

    if (web3formsKey && web3formsFromEmail) {
      const message = `A customer has searched their registration but not yet placed an order.

Registration: ${norm.vrm}
Name: ${customerName}
Phone: ${customerPhone}
Time (UK): ${submittedAtUK}`;

      await sendWeb3Email({
        key: web3formsKey,
        fromName: "DVLA Lookup Tracker",
        fromEmail: web3formsFromEmail,
        replyTo: web3formsFromEmail,
        subject: `Pending Order Lookup – ${norm.vrm}`,
        message,
      }).catch(() => {});
    } else if (web3formsKey && !web3formsFromEmail) {
      console.warn(
        "Web3Forms enabled but WEB3FORMS_FROM_EMAIL is missing; DVLA lookup alert skipped."
      );
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

// --- GET --------------------------------------------------------------------
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
      return rateLimitResponse(withCors, cd.retryAfterSec, cd.which!);
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
