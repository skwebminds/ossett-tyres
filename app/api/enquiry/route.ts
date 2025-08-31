// app/api/enquiry/route.ts

export const runtime = "nodejs"; //forcing route to run in full Node.js runtime, where googleapis works

import { NextResponse } from "next/server";
import { google } from "googleapis";

// --- Allowed origins --------------------------------------------------------
const allowedOrigins = [
  "https://ossettyres.co.uk",
  "https://www.ossettyres.co.uk",
];

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
    console.warn("Sheets not configured: missing GOOGLE_SA_EMAIL/GOOGLE_SA_PRIVATE_KEY/GOOGLE_SHEETS_ID");
    return;
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
  try {
    const origin = req.headers.get("origin");

    if (!process.env.WEB3FORMS_KEY) {
      return withCors({ success: false, message: "Email key not configured" }, 500, origin);
    }

    const body = await req.json().catch(() => ({}));
    const {
      from_name, subject, reply_to, message, honey,
      reg, make, colour, year,
      chosenFrontTyre, chosenRearTyre, frontQty, rearQty,
      tierPref, brandPref, customerName, phone, submittedAt
    } = body || {};

    if (honey) return withCors({ success: true, message: "ok" }, 200, origin);
    if (!from_name || !subject || !reply_to || !message) {
      return withCors({ success: false, message: "Missing fields" }, 400, origin);
    }

    // Forward email via Web3Forms
    const resp = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: process.env.WEB3FORMS_KEY,
        from_name,
        subject,
        reply_to,
        message,
        reg, make, colour, year,
        chosenFrontTyre, chosenRearTyre, frontQty, rearQty,
        tierPref, brandPref, customerName, phone, submittedAt
      }),
    });

    const data = await resp.json().catch(() => ({}));

    // Build row for Sheets (match header order above)
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
      submittedAt || new Date().toISOString()
    ];

    appendToSheet(row).catch(err => console.error("Sheets append error:", err));

    return withCors(data, resp.status, origin);
  } catch (e: any) {
    return withCors({ success: false, message: "Server error", detail: e?.message }, 500, req.headers.get("origin"));
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

