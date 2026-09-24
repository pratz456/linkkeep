const INTERNAL_ORIGIN = "https://morrow.invalid";
const ALLOWED_RETURN_PATHS = new Set(["/"]);
const ALLOWED_QUERY_VALUES: Record<string, ReadonlySet<string>> = {
  horizon: new Set(["today", "week", "month"]),
  area: new Set(["Work", "Personal", "Wellbeing"]),
};

export function safeReturnPath(value: string | null | undefined) {
  if (!value || /[\\\u0000-\u001F\u007F]/.test(value)) return "/";

  try {
    const candidate = new URL(value, INTERNAL_ORIGIN);
    if (
      candidate.origin !== INTERNAL_ORIGIN ||
      candidate.username ||
      candidate.password ||
      !ALLOWED_RETURN_PATHS.has(candidate.pathname)
    ) {
      return "/";
    }

    const safeQuery = new URLSearchParams();
    for (const [key, queryValue] of candidate.searchParams) {
      if (ALLOWED_QUERY_VALUES[key]?.has(queryValue)) {
        safeQuery.set(key, queryValue);
      }
    }

    const query = safeQuery.toString();
    return `${candidate.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "/";
  }
}

export function safeReturnUrl(returnTo: string, appOrigin: string) {
  const origin = new URL(appOrigin).origin;
  return new URL(safeReturnPath(returnTo), origin);
}
