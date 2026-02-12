import { useState, useRef, useEffect } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type {
  ModSortOption,
  ModEnvironment,
  ModCategory,
  ModSource,
} from "@mc-server-manager/shared";
import { cn } from "@/lib/utils";

const SORT_OPTIONS: { value: ModSortOption; label: string }[] = [
  { value: "downloads", label: "Most Downloaded" },
  { value: "relevance", label: "Relevance" },
  { value: "updated", label: "Recently Updated" },
  { value: "newest", label: "Newest" },
];

const ENVIRONMENT_OPTIONS: {
  value: ModEnvironment;
  label: string;
  description: string;
}[] = [
  { value: "server", label: "Server-side", description: "Runs on the server" },
  { value: "client", label: "Client-side", description: "Runs on the client" },
  {
    value: "both",
    label: "Universal",
    description: "Runs on both client & server",
  },
];

const MAX_VISIBLE_CATEGORIES = 16;

interface ModFilterBarProps {
  sort: ModSortOption;
  onSortChange: (sort: ModSortOption) => void;
  categories: ModCategory[];
  selectedCategories: string[];
  onCategoriesChange: (slugs: string[]) => void;
  environment: ModEnvironment | null;
  onEnvironmentChange: (env: ModEnvironment | null) => void;
  sources: ModSource[];
  onSourcesChange: (sources: ModSource[]) => void;
  curseforgeConfigured: boolean;
  showEnvironment?: boolean;
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

export function ModFilterBar({
  sort,
  onSortChange,
  categories,
  selectedCategories,
  onCategoriesChange,
  environment,
  onEnvironmentChange,
  sources,
  onSourcesChange,
  curseforgeConfigured,
  showEnvironment = true,
}: ModFilterBarProps) {
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggleCategory = (slug: string) => {
    if (selectedCategories.includes(slug)) {
      onCategoriesChange(selectedCategories.filter((s) => s !== slug));
    } else {
      onCategoriesChange([...selectedCategories, slug]);
    }
  };

  const toggleSource = (src: ModSource) => {
    if (sources.includes(src)) {
      if (sources.length <= 1) return;
      onSourcesChange(sources.filter((s) => s !== src));
    } else {
      onSourcesChange([...sources, src]);
    }
  };

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    (showEnvironment && environment !== null) ||
    (curseforgeConfigured && sources.length < 2);

  const clearAllFilters = () => {
    onCategoriesChange([]);
    onEnvironmentChange(null);
    if (curseforgeConfigured) {
      onSourcesChange(["modrinth", "curseforge"]);
    }
  };

  const visibleCategories = showAllCategories
    ? categories
    : categories.slice(0, MAX_VISIBLE_CATEGORIES);
  const hiddenCount = categories.length - MAX_VISIBLE_CATEGORIES;

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Sort";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-300">Filters</span>
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <FilterSection label="Sort by">
          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              {currentSortLabel}
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 text-zinc-500 transition-transform",
                  sortOpen && "rotate-180",
                )}
              />
            </button>
            {sortOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                <div className="p-1">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        onSortChange(opt.value);
                        setSortOpen(false);
                      }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                        sort === opt.value
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "text-zinc-300 hover:bg-zinc-800",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FilterSection>

        {showEnvironment && (
          <FilterSection label="Runs on">
            <div className="flex flex-wrap gap-1.5">
              {ENVIRONMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    onEnvironmentChange(
                      environment === opt.value ? null : opt.value,
                    )
                  }
                  title={opt.description}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    environment === opt.value
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FilterSection>
        )}

        {curseforgeConfigured && (
          <FilterSection label="Source">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => toggleSource("modrinth")}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  sources.includes("modrinth")
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:text-zinc-200",
                )}
              >
                Modrinth
              </button>
              <button
                onClick={() => toggleSource("curseforge")}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  sources.includes("curseforge")
                    ? "border-orange-500/30 bg-orange-500/10 text-orange-400"
                    : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:text-zinc-200",
                )}
              >
                CurseForge
              </button>
            </div>
          </FilterSection>
        )}

        {categories.length > 0 && (
          <FilterSection label="Categories">
            <div className="flex flex-wrap gap-1.5">
              {visibleCategories.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => toggleCategory(cat.slug)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    selectedCategories.includes(cat.slug)
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-700/50 bg-zinc-800/30 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                  )}
                >
                  {cat.name}
                </button>
              ))}

              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllCategories(!showAllCategories)}
                  className="rounded-full border border-zinc-700/50 bg-zinc-800/30 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
                >
                  {showAllCategories ? "Show less" : `+${hiddenCount} more`}
                </button>
              )}
            </div>
          </FilterSection>
        )}
      </div>
    </div>
  );
}
