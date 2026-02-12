import type { ModSortOption, ModSource } from "@mc-server-manager/shared";
import * as curseforge from "./mod-sources/curseforge.js";

interface SearchableResult {
  slug: string;
  downloads: number;
  lastUpdated: string;
}

interface SearchResponse<T extends SearchableResult> {
  results: T[];
  totalHits: number;
}

interface OrchestrateSearchOptions<T extends SearchableResult> {
  query: string;
  sort?: ModSortOption;
  sources?: ModSource[];
  modrinthSearch: () => Promise<SearchResponse<T>>;
  curseforgeSearch: () => Promise<SearchResponse<T>>;
}

export async function orchestrateSearch<T extends SearchableResult>(
  opts: OrchestrateSearchOptions<T>,
): Promise<SearchResponse<T>> {
  const useModrinth = !opts.sources || opts.sources.includes("modrinth");
  const useCurseforge = !opts.sources || opts.sources.includes("curseforge");

  const emptyResponse: SearchResponse<T> = { results: [], totalHits: 0 };

  const [modrinthResults, curseforgeResults] = await Promise.all([
    useModrinth ? opts.modrinthSearch() : Promise.resolve(emptyResponse),
    useCurseforge && curseforge.isConfigured()
      ? opts.curseforgeSearch()
      : Promise.resolve(emptyResponse),
  ]);

  if (!useModrinth) return curseforgeResults;
  if (!useCurseforge || !curseforge.isConfigured()) return modrinthResults;

  const seenSlugs = new Set<string>();
  const combined = [...modrinthResults.results];
  for (const result of combined) {
    seenSlugs.add(result.slug);
  }

  for (const result of curseforgeResults.results) {
    if (!seenSlugs.has(result.slug)) {
      combined.push(result);
      seenSlugs.add(result.slug);
    }
  }

  const resolvedSort = opts.sort ?? (opts.query ? "relevance" : "downloads");
  if (resolvedSort === "downloads") {
    combined.sort((a, b) => b.downloads - a.downloads);
  } else if (resolvedSort === "updated" || resolvedSort === "newest") {
    combined.sort(
      (a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
    );
  }

  return {
    results: combined,
    totalHits: modrinthResults.totalHits + curseforgeResults.totalHits,
  };
}
