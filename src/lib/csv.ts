import Papa from "papaparse";

export type ParsedConnectionRow = {
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  profileUrl: string | null;
};

function pick(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const found = Object.entries(row).find(
      ([k]) => k.trim().toLowerCase() === key.toLowerCase(),
    );
    if (found?.[1]?.trim()) return found[1].trim();
  }
  return null;
}

/** Parses LinkedIn's Connections.csv export (or similar headers). */
export function parseConnectionsCsv(csvText: string): ParsedConnectionRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });

  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0]?.message ?? "Invalid CSV");
  }

  // LinkedIn exports often include notes rows before the header; Papa may miss them.
  // If firstName is missing widely, try to find the real header row.
  let rows = parsed.data;
  const hasNames = rows.some(
    (r) => pick(r, ["First Name", "firstName", "FirstName"]) != null,
  );

  if (!hasNames) {
    const lines = csvText.split(/\r?\n/);
    const headerIdx = lines.findIndex((line) =>
      /first\s*name/i.test(line),
    );
    if (headerIdx >= 0) {
      const sliced = lines.slice(headerIdx).join("\n");
      const retry = Papa.parse<Record<string, string>>(sliced, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      });
      rows = retry.data;
    }
  }

  return rows
    .map((row) => {
      const firstName = pick(row, ["First Name", "firstName", "FirstName"]);
      const lastName = pick(row, ["Last Name", "lastName", "LastName"]) ?? "";
      if (!firstName) return null;

      return {
        firstName,
        lastName,
        email: pick(row, ["Email Address", "Email", "email"]),
        company: pick(row, ["Company", "company"]),
        position: pick(row, ["Position", "Headline", "Title", "position"]),
        connectedOn: pick(row, ["Connected On", "connectedOn", "Connected"]),
        profileUrl: pick(row, [
          "URL",
          "Profile URL",
          "profileUrl",
          "Public Profile URL",
        ]),
      } satisfies ParsedConnectionRow;
    })
    .filter((r): r is ParsedConnectionRow => Boolean(r));
}
