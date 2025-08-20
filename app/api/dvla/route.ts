import { NextResponse } from "next/server";

const DVLA_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

// POST: body { registrationNumber: "AB12CDE" }
export async function POST(req: Request) {
  try {
    const { registrationNumber } = await req.json();

    if (!registrationNumber || typeof registrationNumber !== "string") {
      return NextResponse.json({ error: "registrationNumber is required" }, { status: 400 });
    }
    if (!process.env.DVLA_API_KEY) {
      return NextResponse.json({ error: "DVLA API key not configured" }, { status: 500 });
    }

    const dvlaRes = await fetch(DVLA_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.DVLA_API_KEY!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ registrationNumber: registrationNumber.trim().toUpperCase() }),
      cache: "no-store"
    });

    const data = await dvlaRes.json();
    return NextResponse.json(
      { ok: dvlaRes.ok, status: dvlaRes.status, data },
      { status: dvlaRes.ok ? 200 : dvlaRes.status }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: err?.message }, { status: 500 });
  }
}

// GET: query param ?reg=AB12CDE
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const reg = searchParams.get("reg");

    if (!reg) {
      return NextResponse.json({ error: "Use ?reg=YOURREG" }, { status: 400 });
    }
    if (!process.env.DVLA_API_KEY) {
      return NextResponse.json({ error: "DVLA API key not configured" }, { status: 500 });
    }

    const dvlaRes = await fetch(DVLA_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.DVLA_API_KEY!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ registrationNumber: reg.trim().toUpperCase() }),
      cache: "no-store"
    });

    const data = await dvlaRes.json();
    return NextResponse.json(
      { ok: dvlaRes.ok, status: dvlaRes.status, data },
      { status: dvlaRes.ok ? 200 : dvlaRes.status }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: err?.message }, { status: 500 });
  }
}
