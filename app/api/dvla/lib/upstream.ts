const DVLA_URL =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const OETYRES_URL =
  "https://api.oneautoapi.com/driverightdata/oetyrefitmentdata/v2";

export async function fetchDvla(reg: string) {
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

export async function fetchOETyresRaw(vrm: string) {
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
