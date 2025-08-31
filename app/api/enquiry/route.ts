// app/api/enquiry/route.ts
export const runtime = "nodejs";

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

    const body = await req.json().catch(() => ({}));
    const {
      customerName, reply_to, phone,
      reg, make, colour, year,
      chosenFrontTyre, frontQty,
      chosenRearTyre, rearQty,
      tierPref, brandPref,
      submittedAt
    } = body || {};

    // Build row for Sheets (match your headers)
    const row = [
      customerName || "",       // A: Customer Name
      reply_to || "",           // B: Customer Email
      phone || "",              // C: Phone
      reg || "",                // D: Reg
      make || "",               // E: Make
      colour || "",             // F: Colour
      year || "",               // G: Year
      chosenFrontTyre || "",    // H: Front Tyre
      String(frontQty ?? ""),   // I: Front Qty
      chosenRearTyre || "",     // J: Rear Tyre
      String(rearQty ?? ""),    // K: Rear Qty
      tierPref || "",           // L: Budget Range
      brandPref || "",          // M: Preferred Brand
      submittedAt || new Date().toISOString() // N: Timestamp
    ];

    // Append asynchronously to Google Sheets
    appendToSheet(row).catch(err => console.error("Sheets append error:", err));

    return withCors({ success: true, message: "Order logged to Google Sheets" }, 200, origin);
  } catch (e: any) {
    return withCors(
      { success: false, message: "Server error", detail: e?.message },
      500,
      req.headers.get("origin")
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
