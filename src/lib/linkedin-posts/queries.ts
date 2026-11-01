/** Split OR alternatives without splitting quoted phrases. No regular expressions are executed. */
export function queryAlternatives(value: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\") { i++; continue; }
    if (value[i] === '"') quoted = !quoted;
    if (!quoted && value.slice(i, i + 2) === "OR" && /\s/.test(value[i - 1] ?? "") && /\s/.test(value[i + 2] ?? "")) {
      parts.push(value.slice(start, i).trim()); start = i + 2; i++;
    }
  }
  if (quoted) throw new Error("Close the quotation marks in each keyword.");
  parts.push(value.slice(start).trim());
  if (parts.some((part) => !part || part === "OR" || /^OR\s|\sOR$/.test(part))) throw new Error("Add a search phrase on both sides of OR.");
  return parts;
}
export const queryKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const uniqueLines = (value: string) => [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
export function buildQueries(keywords: string[], countries: readonly string[] = []): string[] {
  const queries = keywords.filter((k) => k.trim()).flatMap((keyword) => {
    const alternatives = queryAlternatives(keyword.trim());
    return countries.length ? countries.map((country) => alternatives.map((part) => `${part} ${country.trim()}`).join(" OR ")) : [keyword.trim()];
  });
  return [...new Map(queries.map((query) => [queryKey(query), query])).values()];
}
