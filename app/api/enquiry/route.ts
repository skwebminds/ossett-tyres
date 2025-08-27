// app/api/enquiry/route.ts
import { NextResponse } from "next/server";

function withCors(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "https://ossettyres.co.uk",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req: Request) {
  try {
    if (!process.env.WEB3FORMS_KEY) {
      return withCors(
        { success: false, message: "Email key not configured" },
        500
      );
    }

    // Expecting: { from_name, subject, reply_to, message, honey? }
    const body = await req.json().catch(() => ({}));
    const { from_name, subject, reply_to, message, honey } = body || {};

    // Simple validation + honeypot
    if (honey) {
      return withCors({ success: true, message: "ok" }); // silently drop bots
    }
    if (!from_name || !subject || !reply_to || !message) {
      return withCors(
        { success: false, message: "Missing fields" },
        400
      );
    }

    // Forward to Web3Forms with your secret key
    const resp = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        access_key: process.env.WEB3FORMS_KEY,
        from_name,
        subject,
        reply_to,
        message,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    return withCors(data, resp.status);
  } catch (e: any) {
    return withCors(
      { success: false, message: "Server error", detail: e?.message },
      500
    );
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://ossettyres.co.uk",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

