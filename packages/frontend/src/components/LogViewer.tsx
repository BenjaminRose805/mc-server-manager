import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogFile {
  name: string;
  size: number;
  modifiedAt: string;
}

interface LogViewerProps {
  serverId: string;
  className?: string;
}

const LINES_PER_PAGE = 500;

// ---------------------------------------------------------------------------
// LogViewer
// ---------------------------------------------------------------------------

export function LogViewer({ serverId, className }: LogViewerProps) {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch file list
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLogFiles(serverId);
      setFiles(data.files);
      // Auto-select latest.log if present
      if (data.files.length > 0 && !selectedFile) {
        const latest = data.files.find((f) => f.name === 'latest.log');
        setSelectedFile(latest?.name ?? data.files[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load log files');
    } finally {
      setLoading(false);
    }
  }, [serverId, selectedFile]);

  useEffect(() => {
    fetchFiles();
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center gap-2 text-sm text-zinc-400', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading log files...
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center text-sm text-red-400', className)}>
        {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2', className)}>
        <FolderOpen className="h-8 w-8 text-zinc-600" />
        <p className="text-sm text-zinc-500">No log files yet. Start the server to generate logs.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-4', className)}>
      {/* File list sidebar */}
      <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Log Files</span>
          <button
            onClick={fetchFiles}
            title="Refresh file list"
            className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="divide-y divide-zinc-800/50">
          {files.map((f) => (
            <button
              key={f.name}
              onClick={() => setSelectedFile(f.name)}
              className={cn(
                'flex w-full flex-col px-3 py-2 text-left transition-colors',
                selectedFile === f.name
                  ? 'bg-emerald-500/5 border-l-2 border-l-emerald-500'
                  : 'hover:bg-zinc-800/50 border-l-2 border-l-transparent',
              )}
            >
              <span className={cn(
                'text-sm truncate',
                selectedFile === f.name ? 'text-emerald-400 font-medium' : 'text-zinc-300',
              )}>
                <FileText className="mr-1.5 inline h-3.5 w-3.5" />
                {f.name}
              </span>
              <span className="mt-0.5 text-xs text-zinc-600">
                {formatBytes(f.size)} &middot; {new Date(f.modifiedAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 min-w-0">
        {selectedFile ? (
          <LogContent serverId={serverId} filename={selectedFile} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Select a log file to view.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LogContent — displays the actual log file content with pagination + search
// ---------------------------------------------------------------------------

function LogContent({
  serverId,
  filename,
}: {
  serverId: string;
  filename: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [filteredLines, setFilteredLines] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLogContent(serverId, filename, {
        offset,
        limit: LINES_PER_PAGE,
        search: search || undefined,
      });
      setLines(data.lines);
      setTotalLines(data.totalLines);
      setFilteredLines(data.filteredLines);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load log content');
    } finally {
      setLoading(false);
    }
  }, [serverId, filename, offset, search]);

  useEffect(() => {
    setOffset(0);
    setSearch('');
    setSearchInput('');
  }, [filename]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput);
  };

  const currentPage = Math.floor(offset / LINES_PER_PAGE) + 1;
  const totalPages = Math.ceil(filteredLines / LINES_PER_PAGE);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search logs (regex)..."
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500"
          />
        </form>
        <button
          onClick={fetchContent}
          title="Refresh"
          className="rounded-md border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 hover:bg-zinc-700"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Info bar */}
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {search
            ? `${filteredLines} matching lines (of ${totalLines} total)`
            : `${totalLines} lines`}
        </span>
        <span>
          Page {currentPage} of {totalPages || 1}
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs leading-5">
          {lines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-600">
              {search ? 'No matching lines.' : 'Empty log file.'}
            </div>
          ) : (
            <div className="p-3">
              {lines.map((line, i) => {
                const lineNum = offset + i + 1;
                const level = getLogLevel(line);
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-3 hover:bg-zinc-800/30',
                      level === 'error' && 'text-red-400',
                      level === 'warn' && 'text-amber-400',
                      level === 'info' && 'text-zinc-300',
                    )}
                  >
                    <span className="select-none text-zinc-700 w-10 text-right shrink-0">
                      {lineNum}
                    </span>
                    <span className="whitespace-pre-wrap break-all">{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - LINES_PER_PAGE))}
            disabled={offset === 0}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-zinc-500">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => hasMore && setOffset(offset + LINES_PER_PAGE)}
            disabled={!hasMore}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLogLevel(line: string): 'error' | 'warn' | 'info' {
  if (/\bERROR\b/i.test(line) || /\bFATAL\b/i.test(line)) return 'error';
  if (/\bWARN\b/i.test(line)) return 'warn';
  return 'info';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
