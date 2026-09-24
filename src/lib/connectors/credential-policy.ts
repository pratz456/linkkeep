function normalizeScopeSet(value: string | null) {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function canPreserveRefreshToken(input: {
  existingExternalAccountId: string | null;
  nextExternalAccountId: string | null;
  existingScope: string | null;
  nextScope: string | null;
}) {
  return (
    Boolean(input.existingExternalAccountId) &&
    input.existingExternalAccountId === input.nextExternalAccountId &&
    JSON.stringify(normalizeScopeSet(input.existingScope)) ===
      JSON.stringify(normalizeScopeSet(input.nextScope))
  );
}
