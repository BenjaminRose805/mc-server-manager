import type {
  ServerWithStatus,
  Server,
  ServerType,
  CreateServerRequest,
  UpdateServerRequest,
  McVersion,
  VersionInfo,
  JavaInfo,
  SystemInfo,
  DownloadJob,
  DownloadRequest,
  ServerPropertiesResponse,
  UpdateServerPropertiesRequest,
  AppSettings,
  InstalledMod,
  InstallModRequest,
  ModLoader,
  ModSource,
  ModSearchResponse,
  ModVersion,
  ModSortOption,
  ModEnvironment,
  ModCategoryResponse,
  ModpackSearchResponse,
  ModpackVersion,
  ParsedModpack,
  InstalledModpack,
  InstallModpackRequest,
  ModpackUpdateInfo,
  ModpackExportData,
  LauncherInstance,
  CreateInstanceRequest,
  UpdateInstanceRequest,
  LauncherAccount,
  MinecraftVersion,
  PrepareResponse,
  PrepareJob,
} from "@mc-server-manager/shared";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

import { getBackendBaseUrlSync } from "@/utils/desktop";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = localStorage.getItem("accessToken");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${getBackendBaseUrlSync()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

let isRefreshing = false;

export async function authFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem("accessToken");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const base = getBackendBaseUrlSync();
  let res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && !isRefreshing && path !== "/api/auth/refresh") {
    isRefreshing = true;
    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        throw new Error("No refresh token");
      }

      const refreshRes = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!refreshRes.ok) {
        throw new Error("Refresh failed");
      }

      const refreshData = await refreshRes.json();
      localStorage.setItem("accessToken", refreshData.accessToken);
      if (refreshData.refreshToken) {
        localStorage.setItem("refreshToken", refreshData.refreshToken);
      }

      headers["Authorization"] = `Bearer ${refreshData.accessToken}`;
      res = await fetch(`${base}${path}`, {
        ...options,
        headers,
      });
    } catch {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      window.location.href = "/login";
      throw new ApiError(401, "Session expired", "UNAUTHORIZED");
    } finally {
      isRefreshing = false;
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export const api = {
  // Server CRUD
  getServers(): Promise<ServerWithStatus[]> {
    return request<ServerWithStatus[]>("/api/servers");
  },

  getServer(id: string): Promise<ServerWithStatus> {
    return request<ServerWithStatus>(`/api/servers/${id}`);
  },

  createServer(data: CreateServerRequest): Promise<Server> {
    return request<Server>("/api/servers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteServer(id: string, deleteFiles = false): Promise<void> {
    const qs = deleteFiles ? "?deleteFiles=true" : "";
    return request<void>(`/api/servers/${id}${qs}`, {
      method: "DELETE",
    });
  },

  // Server lifecycle
  startServer(id: string): Promise<{ status: string }> {
    return request("/api/servers/" + id + "/start", { method: "POST" });
  },

  stopServer(id: string): Promise<{ status: string }> {
    return request("/api/servers/" + id + "/stop", { method: "POST" });
  },

  restartServer(id: string): Promise<{ status: string }> {
    return request("/api/servers/" + id + "/restart", { method: "POST" });
  },

  killServer(id: string): Promise<{ status: string }> {
    return request("/api/servers/" + id + "/kill", { method: "POST" });
  },

  // Versions
  getVersions(
    serverType: ServerType,
    includeSnapshots = false,
  ): Promise<McVersion[]> {
    const qs = includeSnapshots ? "?snapshots=true" : "";
    return request<McVersion[]>(`/api/versions/${serverType}${qs}`);
  },

  getVersionInfo(
    serverType: ServerType,
    mcVersion: string,
  ): Promise<VersionInfo> {
    return request<VersionInfo>(`/api/versions/${serverType}/${mcVersion}`);
  },

  // Downloads
  startDownload(data: DownloadRequest): Promise<DownloadJob> {
    return request<DownloadJob>("/api/downloads", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getDownloadStatus(jobId: string): Promise<DownloadJob> {
    return request<DownloadJob>(`/api/downloads/${jobId}`);
  },

  cancelDownload(jobId: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/downloads/${jobId}`, {
      method: "DELETE",
    });
  },

  // Logs
  getLogFiles(serverId: string): Promise<{
    files: Array<{ name: string; size: number; modifiedAt: string }>;
  }> {
    return request(`/api/servers/${serverId}/logs`);
  },

  getLogContent(
    serverId: string,
    filename: string,
    options?: { offset?: number; limit?: number; search?: string },
  ): Promise<{
    content: string;
    lines: string[];
    totalLines: number;
    filteredLines: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    if (options?.offset !== undefined)
      params.set("offset", String(options.offset));
    if (options?.limit !== undefined)
      params.set("limit", String(options.limit));
    if (options?.search) params.set("search", options.search);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request(
      `/api/servers/${serverId}/logs/${encodeURIComponent(filename)}${qs}`,
    );
  },

  // Server Properties
  getServerProperties(id: string): Promise<ServerPropertiesResponse> {
    return request<ServerPropertiesResponse>(`/api/servers/${id}/properties`);
  },

  updateServerProperties(
    id: string,
    data: UpdateServerPropertiesRequest,
  ): Promise<ServerPropertiesResponse> {
    return request<ServerPropertiesResponse>(`/api/servers/${id}/properties`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  // Server config (PATCH /api/servers/:id)
  updateServer(id: string, data: UpdateServerRequest): Promise<Server> {
    return request<Server>(`/api/servers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  // System
  getJavaInfo(customPath?: string): Promise<JavaInfo> {
    const qs = customPath ? `?path=${encodeURIComponent(customPath)}` : "";
    return request<JavaInfo>(`/api/system/java${qs}`);
  },

  getSystemInfo(): Promise<SystemInfo> {
    return request<SystemInfo>("/api/system/info");
  },

  // Settings
  getSettings(): Promise<AppSettings> {
    return request<AppSettings>("/api/system/settings");
  },

  updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    return request<AppSettings>("/api/system/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  // Mods
  getInstalledMods(serverId: string): Promise<{ mods: InstalledMod[] }> {
    return request<{ mods: InstalledMod[] }>(`/api/servers/${serverId}/mods`);
  },

  installMod(serverId: string, data: InstallModRequest): Promise<InstalledMod> {
    return request<InstalledMod>(`/api/servers/${serverId}/mods`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  uninstallMod(serverId: string, modId: string): Promise<void> {
    return request<void>(`/api/servers/${serverId}/mods/${modId}`, {
      method: "DELETE",
    });
  },

  toggleMod(serverId: string, modId: string): Promise<InstalledMod> {
    return request<InstalledMod>(
      `/api/servers/${serverId}/mods/${modId}/toggle`,
      { method: "POST" },
    );
  },

  searchMods(params: {
    q?: string;
    loader: ModLoader;
    mcVersion: string;
    sort?: ModSortOption;
    categories?: string[];
    environment?: ModEnvironment;
    sources?: ModSource[];
    offset?: number;
    limit?: number;
  }): Promise<ModSearchResponse> {
    const searchParams = new URLSearchParams({
      loader: params.loader,
      mcVersion: params.mcVersion,
    });
    if (params.q) searchParams.set("q", params.q);
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.categories?.length)
      searchParams.set("categories", params.categories.join(","));
    if (params.environment) searchParams.set("environment", params.environment);
    if (params.sources?.length)
      searchParams.set("sources", params.sources.join(","));
    if (params.offset !== undefined)
      searchParams.set("offset", String(params.offset));
    if (params.limit !== undefined)
      searchParams.set("limit", String(params.limit));
    return request<ModSearchResponse>(
      `/api/mods/search?${searchParams.toString()}`,
    );
  },

  getModCategories(): Promise<ModCategoryResponse> {
    return request<ModCategoryResponse>("/api/mods/categories");
  },

  getModVersions(
    source: ModSource,
    sourceId: string,
    loader: ModLoader,
    mcVersion: string,
  ): Promise<{ versions: ModVersion[] }> {
    const params = new URLSearchParams({ loader, mcVersion });
    return request<{ versions: ModVersion[] }>(
      `/api/mods/${source}/${encodeURIComponent(sourceId)}/versions?${params.toString()}`,
    );
  },

  // Modpacks
  searchModpacks(
    query: string,
    offset?: number,
    limit?: number,
    sort?: ModSortOption,
    categories?: string[],
    environment?: ModEnvironment,
    sources?: ModSource[],
    mcVersion?: string,
  ): Promise<ModpackSearchResponse> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (mcVersion) params.set("mcVersion", mcVersion);
    if (offset !== undefined) params.set("offset", String(offset));
    if (limit !== undefined) params.set("limit", String(limit));
    if (sort) params.set("sort", sort);
    if (categories && categories.length > 0)
      params.set("categories", categories.join(","));
    if (environment) params.set("environment", environment);
    if (sources && sources.length > 0) params.set("sources", sources.join(","));
    return request<ModpackSearchResponse>(
      `/api/modpacks/search?${params.toString()}`,
    );
  },

  getModpackCategories(): Promise<ModCategoryResponse> {
    return request<ModCategoryResponse>("/api/modpacks/categories");
  },

  getModpackVersions(
    source: ModSource,
    sourceId: string,
  ): Promise<{ versions: ModpackVersion[] }> {
    return request<{ versions: ModpackVersion[] }>(
      `/api/modpacks/${source}/${encodeURIComponent(sourceId)}/versions`,
    );
  },

  parseModpack(
    source: ModSource,
    sourceId: string,
    versionId: string,
  ): Promise<ParsedModpack> {
    return request<ParsedModpack>(
      `/api/modpacks/${source}/${encodeURIComponent(sourceId)}/parse`,
      {
        method: "POST",
        body: JSON.stringify({ versionId }),
      },
    );
  },

  getInstalledModpacks(
    serverId: string,
  ): Promise<{ modpacks: InstalledModpack[] }> {
    return request<{ modpacks: InstalledModpack[] }>(
      `/api/servers/${serverId}/modpacks`,
    );
  },

  installModpack(
    serverId: string,
    data: InstallModpackRequest,
  ): Promise<InstalledModpack> {
    return request<InstalledModpack>(`/api/servers/${serverId}/modpacks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  removeModpack(serverId: string, modpackId: string): Promise<void> {
    return request<void>(`/api/servers/${serverId}/modpacks/${modpackId}`, {
      method: "DELETE",
    });
  },

  checkModpackUpdate(
    serverId: string,
    modpackId: string,
  ): Promise<ModpackUpdateInfo> {
    return request<ModpackUpdateInfo>(
      `/api/servers/${serverId}/modpacks/${modpackId}/check-update`,
    );
  },

  updateModpack(
    serverId: string,
    modpackId: string,
  ): Promise<InstalledModpack> {
    return request<InstalledModpack>(
      `/api/servers/${serverId}/modpacks/${modpackId}/update`,
      { method: "POST" },
    );
  },

  exportModpack(
    serverId: string,
    modpackId: string,
  ): Promise<ModpackExportData> {
    return request<ModpackExportData>(
      `/api/servers/${serverId}/modpacks/${modpackId}/export`,
    );
  },

  // Launcher - Instances
  getLauncherInstances(): Promise<LauncherInstance[]> {
    return request<LauncherInstance[]>("/api/launcher/instances");
  },

  getLauncherInstance(id: string): Promise<LauncherInstance> {
    return request<LauncherInstance>(`/api/launcher/instances/${id}`);
  },

  createLauncherInstance(
    data: CreateInstanceRequest,
  ): Promise<LauncherInstance> {
    return request<LauncherInstance>("/api/launcher/instances", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  updateLauncherInstance(
    id: string,
    data: UpdateInstanceRequest,
  ): Promise<LauncherInstance> {
    return request<LauncherInstance>(`/api/launcher/instances/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  deleteLauncherInstance(id: string): Promise<void> {
    return request<void>(`/api/launcher/instances/${id}`, {
      method: "DELETE",
    });
  },

  getLauncherVersions(type?: string): Promise<MinecraftVersion[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return request<MinecraftVersion[]>(`/api/launcher/versions${qs}`);
  },

  prepareLaunch(instanceId: string): Promise<PrepareJob> {
    return request<PrepareJob>(`/api/launcher/prepare/${instanceId}`, {
      method: "POST",
    });
  },

  getPrepareStatus(jobId: string): Promise<PrepareJob> {
    return request<PrepareJob>(`/api/launcher/prepare/jobs/${jobId}`);
  },

  cancelPrepare(jobId: string): Promise<{ message: string }> {
    return request<{ message: string }>(`/api/launcher/prepare/jobs/${jobId}`, {
      method: "DELETE",
    });
  },

  // Instance Mods
  getInstanceMods(instanceId: string): Promise<{ mods: InstalledMod[] }> {
    return request<{ mods: InstalledMod[] }>(
      `/api/launcher/instances/${instanceId}/mods`,
    );
  },

  installInstanceMod(
    instanceId: string,
    data: InstallModRequest,
  ): Promise<InstalledMod> {
    return request<InstalledMod>(`/api/launcher/instances/${instanceId}/mods`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  uninstallInstanceMod(instanceId: string, modId: string): Promise<void> {
    return request<void>(
      `/api/launcher/instances/${instanceId}/mods/${modId}`,
      { method: "DELETE" },
    );
  },

  toggleInstanceMod(instanceId: string, modId: string): Promise<InstalledMod> {
    return request<InstalledMod>(
      `/api/launcher/instances/${instanceId}/mods/${modId}`,
      { method: "PATCH" },
    );
  },

  // Instance Loader
  getInstanceLoader(
    instanceId: string,
  ): Promise<{ loader: string | null; version: string | null }> {
    return request<{ loader: string | null; version: string | null }>(
      `/api/launcher/instances/${instanceId}/loader`,
    );
  },

  installInstanceLoader(
    instanceId: string,
    data: { loader: string; loaderVersion?: string },
  ): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(
      `/api/launcher/instances/${instanceId}/loader`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },

  removeInstanceLoader(instanceId: string): Promise<void> {
    return request<void>(`/api/launcher/instances/${instanceId}/loader`, {
      method: "DELETE",
    });
  },

  getInstanceLoaderVersions(
    instanceId: string,
    loader: string,
    mcVersion: string,
  ): Promise<{ versions: Array<{ version: string; stable: boolean }> }> {
    const params = new URLSearchParams({ loader, mcVersion });
    return request<{
      versions: Array<{ version: string; stable: boolean }>;
    }>(
      `/api/launcher/instances/${instanceId}/loader/versions?${params.toString()}`,
    );
  },

  // Launcher - Accounts
  getLauncherAccounts(): Promise<LauncherAccount[]> {
    return request<LauncherAccount[]>("/api/launcher/accounts");
  },

  createLauncherAccount(data: {
    username: string;
    uuid: string;
    accountType: "msa" | "legacy";
  }): Promise<LauncherAccount> {
    return request<LauncherAccount>("/api/launcher/accounts", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteLauncherAccount(id: string): Promise<void> {
    return request<void>(`/api/launcher/accounts/${id}`, {
      method: "DELETE",
    });
  },
};
