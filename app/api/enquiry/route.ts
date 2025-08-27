// app/api/enquiry/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    if (!process.env.WEB3FORMS_KEY) {
      return NextResponse.json(
        { success: false, message: "Email key not configured" },
        { status: 500 }
      );
    }

    // Expecting: { from_name, subject, reply_to, message, honey? }
    const body = await req.json().catch(() => ({}));
    const { from_name, subject, reply_to, message, honey } = body || {};

    // Simple validation + honeypot
    if (honey) {
      return NextResponse.json({ success: true, message: "ok" }); // silently drop bots
    }
    if (!from_name || !subject || !reply_to || !message) {
      return NextResponse.json(
        { success: false, message: "Missing fields" },
        { status: 400 }
      );
    }

    // Forward to Web3Forms with your secret key
    const resp = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: process.env.WEB3FORMS_KEY,
        from_name,
        subject,
        reply_to,
        message,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: "Server error", detail: e?.message },
      { status: 500 }
    );
  }
}
