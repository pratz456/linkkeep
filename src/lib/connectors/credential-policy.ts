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

export function normalizeScopeValue(value: string | null) {
  const scopes = normalizeScopeSet(value);
  return scopes.length ? scopes.join(" ") : null;
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
    normalizeScopeValue(input.existingScope) ===
      normalizeScopeValue(input.nextScope)
  );
}
