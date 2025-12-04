export function normaliseAndValidateVRM(input: string | null) {
  const vrm = (input || "").trim().toUpperCase();
  if (!vrm)
    return {
      ok: false as const,
      error: "Use ?reg=YOURREG or provide registrationNumber",
    };
  if (!/^[A-Z0-9]{1,8}$/.test(vrm))
    return { ok: false as const, error: "Invalid VRM format" };
  return { ok: true as const, vrm };
}
