import { NextResponse } from "next/server";

export const allowedOrigins = [
  "https://ossettyres.co.uk",
  "https://www.ossettyres.co.uk",
];

export function withCors(body: any, status = 200, origin?: string | null) {
  const useOrigin = allowedOrigins.includes(origin || "")
    ? origin
    : allowedOrigins[0];

  return NextResponse.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": useOrigin!,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
