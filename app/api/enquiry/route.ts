export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { google } from "googleapis";

// --- Allowed origins --------------------------------------------------------
const allowedOrigins = [
  "https://ossettyres.co.uk",
  "https://www.ossettyres.co.uk",
];

// --- Simple rate limiting --------------------------------------------------
type RateEntry = { count: number; windowStart: number };
const RATE_WINDOW_MS = 60_000; // 1 minute bucket
const RATE_IP_MAX = 5; // max submissions per IP per minute
const RATE_EMAIL_MAX = 3; // max submissions per email per minute

const ipRate: Map<string, RateEntry> = new Map();
const emailRate: Map<string, RateEntry> = new Map();

function hitRateLimiter(
  key: string | null | undefined,
  map: Map<string, RateEntry>,
  limit: number
) {
  if (!key) return false;
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.windowStart > RATE_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return false;
  }
  existing.count += 1;
  if (existing.count > limit) {
    return true;
  }
  return false;
}

// --- CORS helper ------------------------------------------------------------
function withCors(body: any, status = 200, origin?: string | null) {
  const useOrigin = allowedOrigins.includes(origin || "") ? origin : allowedOrigins[0];
  return NextResponse.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": useOrigin!,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// --- Google Sheets helper ---------------------------------------------------
async function appendToSheet(row: any[]) {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!email || !key || !spreadsheetId) {
    throw new Error("Sheets not configured: missing GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GOOGLE_SHEETS_ID");
  }

  const auth = new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `Orders!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

// --- POST handler -----------------------------------------------------------
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip")?.trim() || null;
  const userAgent = req.headers.get("user-agent") || "unknown";
  const web3formsKey = process.env.WEB3FORMS_KEY;
  const web3formsFromEmail = process.env.WEB3FORMS_FROM_EMAIL;

  try {
    const body = await req.json().catch(() => ({}));
    const {
      from_name,
      subject,
      reply_to,
      message,
      honey,
      reg,
      make,
      colour,
      year,
      chosenFrontTyre,
      chosenRearTyre,
      frontQty,
      rearQty,
      tierPref,
      brandPref,
      customerName,
      phone,
      skipWeb3Email,
    } = (body || {}) as any;

    const shouldSendEmail = !skipWeb3Email;

    if (shouldSendEmail && (!web3formsKey || !web3formsFromEmail)) {
      return withCors(
        {
          success: false,
          message: "Email key or sender not configured",
        },
        500,
        origin
      );
    }

    // Honeypot / validation
    if (honey) {
      return withCors({ success: true, message: "ok" }, 200, origin);
    }

    if (hitRateLimiter(ip, ipRate, RATE_IP_MAX)) {
      console.warn("Enquiry rate limited by IP", { ip: ip || "unknown" });
      return withCors(
        {
          success: false,
          message: "Too many enquiries from this IP. Please wait a minute.",
        },
        429,
        origin
      );
    }

    if (!from_name || !subject || !reply_to || !message) {
      return withCors(
        { success: false, message: "Missing fields" },
        400,
        origin
      );
    }

    if (hitRateLimiter(reply_to.toLowerCase(), emailRate, RATE_EMAIL_MAX)) {
      console.warn("Enquiry rate limited by email", { reply_to });
      return withCors(
        {
          success: false,
          message: "Too many enquiries for this email. Please wait a minute.",
        },
        429,
        origin
      );
    }

    // --- Send email via Web3Forms ---
    let emailResponseMessage = "Email handled externally";

    if (shouldSendEmail) {
      const resp = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          access_key: web3formsKey,
          from_name,
          from_email: web3formsFromEmail,
          subject,
          reply_to,
          message,
        }),
      });

      let rawWeb3Response = "";
      let data: any = {};
      try {
        rawWeb3Response = await resp.text();
        data = rawWeb3Response ? JSON.parse(rawWeb3Response) : {};
      } catch {
        data = rawWeb3Response ? { raw: rawWeb3Response } : {};
      }

      // Normalise Web3Forms success
      const emailSuccess =
        data?.success === true ||
        data?.success === "true" ||
        data?.status === "success";

      if (!resp.ok || !emailSuccess) {
        console.error("Web3Forms error:", {
          status: resp.status,
          data,
          raw: rawWeb3Response,
        });
        return withCors(
          {
            success: false,
            message: data?.message || data?.raw || "Failed to send enquiry via email",
          },
          resp.ok ? 500 : resp.status,
          origin
        );
      }

      emailResponseMessage =
        data?.message ||
        "Enquiry sent successfully. We will contact you shortly.";
    }

    // --- Build row for Sheets ---
    const submittedAtUK = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      hour12: false,
    });

    const row = [
      customerName || "",
      reply_to || "",
      phone || "",
      reg || "",
      make || "",
      colour || "",
      year || "",
      chosenFrontTyre || "",
      String(frontQty ?? ""),
      chosenRearTyre || "",
      String(rearQty ?? ""),
      tierPref || "",
      brandPref || "",
      "",
      submittedAtUK,
      ip || "unknown",
      userAgent,
    ];

    // Try to write to Sheets, but don't break email success if this fails
    try {
      await appendToSheet(row);
    } catch (sheetErr: any) {
      console.error("Sheet append failed:", sheetErr?.message || sheetErr);
      // still return success to the frontend, since email was sent
    }

    // Final normalised response for the widget
    return withCors(
      {
        success: true,
        message: emailResponseMessage,
      },
      200,
      origin
    );
  } catch (e: any) {
    console.error("Server error:", e);
    return withCors(
      {
        success: false,
        message: "Server error",
        detail: e?.message,
      },
      500,
      origin
    );
  }
}

// --- OPTIONS (CORS preflight) ----------------------------------------------
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const useOrigin = allowedOrigins.includes(origin || "") ? origin : allowedOrigins[0];

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": useOrigin!,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
