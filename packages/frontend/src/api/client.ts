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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }

  // 204 No Content
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
};
