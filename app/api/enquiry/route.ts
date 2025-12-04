export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { allowedOrigins, withCors } from "./lib/cors";
import { sendWeb3Email } from "./lib/email";
import { appendToSheet } from "./lib/sheets";
import { RATE_EMAIL_MAX, RATE_IP_MAX, rateLimitEmail, rateLimitIp } from "./lib/rateLimit";

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

    if (rateLimitIp(ip)) {
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

    if (rateLimitEmail(reply_to.toLowerCase())) {
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
      const emailResult = await sendWeb3Email({
        key: web3formsKey!,
        fromName: from_name,
        fromEmail: web3formsFromEmail!,
        subject,
        replyTo: reply_to,
        message,
      });

      if (!emailResult.ok) {
        console.error("Web3Forms error:", {
          status: emailResult.status,
          data: emailResult.data,
          raw: emailResult.raw,
        });
        return withCors(
          {
            success: false,
            message:
              emailResult.message ||
              "Failed to send enquiry via email",
          },
          emailResult.status,
          origin
        );
      }

      emailResponseMessage =
        emailResult.message ||
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
