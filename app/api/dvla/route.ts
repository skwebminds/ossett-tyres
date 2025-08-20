// app/api/dvla/route.ts
import { NextResponse } from "next/server";

export const revalidate = 0; // disable caching for this route

const DVLA_URL =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

// --- Helpers ---------------------------------------------------------------

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
    body: JSON.stringify({
      registrationNumber: reg.trim().toUpperCase(),
    }),
    cache: "no-store",
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  return { ok: resp.ok, status: resp.status, data };
}

async function fetchTyresByVRM(vrm: string) {
  // Tyre endpoint is GET-based
  if (!process.env.ONEAUTO_API_KEY) {
    return {
      ok: false,
      status: 501,
      data: { error: "Tyre API key not configured (ONEAUTO_API_KEY)" },
    };
  }

  const url = `https://api.oneautoapi.com/driverightdata/tyre-fitments?vrm=${encodeURIComponent(
    vrm.trim().toUpperCase()
  )}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.ONEAUTO_API_KEY!}`,
    },
    cache: "no-store",
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  return { ok: resp.ok, status: resp.status, data };
}

function buildResponse({
  dvla,
  tyres,
}: {
  dvla: { ok: boolean; status: number; data: any };
  tyres?: { ok: boolean; status: number; data: any } | null;
}) {
  // We treat DVLA as the primary call. If DVLA fails, reflect that status.
  const status = dvla.ok ? 200 : dvla.status;

  // Optional light normalisation (leave raw if you prefer)
  // Many tyre providers return multiple fitments; we pass through as-is + add a disclaimer.
  const payload = {
    dvla: dvla.data,
    tyres: tyres?.data ?? null,
    notice:
      "Tyre sizes are third‑party fitment data and may list multiple valid options depending on trim/wheels. Please confirm against the tyre sidewall or door‑jamb sticker.",
  };

  return NextResponse.json(
    { ok: dvla.ok, status, data: payload },
    { status }
  );
}

// --- Handlers --------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const registrationNumber = body?.registrationNumber as string | undefined;

    if (!registrationNumber || typeof registrationNumber !== "string") {
      return NextResponse.json(
        { error: "registrationNumber is required" },
        { status: 400 }
      );
    }

    const dvla = await fetchDvla(registrationNumber);

    // If DVLA fails, still return (no point calling tyres without a valid reg context)
    if (!dvla.ok) {
      return buildResponse({ dvla, tyres: null });
    }

    // Tyres are best-effort; if it fails we still return DVLA data
    const tyres =
      process.env.ONEAUTO_API_KEY && registrationNumber
        ? await fetchTyresByVRM(registrationNumber)
        : null;

    return buildResponse({ dvla, tyres });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: err?.message },
      { status: 500 }
    );
  }
}

// GET /api/dvla?reg=AB12CDE
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const reg = searchParams.get("reg");

    if (!reg) {
      return NextResponse.json(
        { error: "Use ?reg=YOURREG" },
        { status: 400 }
      );
    }

    const dvla = await fetchDvla(reg);

    if (!dvla.ok) {
      return buildResponse({ dvla, tyres: null });
    }

    const tyres =
      process.env.ONEAUTO_API_KEY && reg ? await fetchTyresByVRM(reg) : null;

    return buildResponse({ dvla, tyres });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: err?.message },
      { status: 500 }
    );
  }
}
