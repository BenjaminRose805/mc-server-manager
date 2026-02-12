import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import {
  Gamepad2,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Server,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore, initWebSocket } from "@/stores/serverStore";
import { StatusBadge } from "./StatusBadge";

export function Layout() {
  const location = useLocation();
  const { servers, fetchServers } = useServerStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetchServers();
    initWebSocket();
  }, [fetchServers]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const navItems = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/launcher", label: "Launcher", icon: Gamepad2 },
    { to: "/mods", label: "Mods", icon: Package },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Mobile header bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center border-b border-zinc-800 bg-zinc-900 px-4 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="ml-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-bold tracking-tight">
            MC Server Manager
          </span>
        </div>
      </div>

      {/* Backdrop overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800 bg-zinc-900 transition-transform duration-200 ease-in-out",
          "lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center">
            <Server className="mr-2 h-5 w-5 text-emerald-400" />
            <h1 className="text-base font-bold tracking-tight">
              MC Server Manager
            </h1>
          </div>
          {/* Close button (mobile only) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.to;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Servers section */}
          <div className="mt-6">
            <div className="flex items-center justify-between px-3 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Servers
              </span>
              <Link
                to="/servers/new"
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title="Create Server"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
            </div>

            {servers.length === 0 ? (
              <p className="px-3 text-xs text-zinc-600">No servers yet</p>
            ) : (
              <ul className="space-y-0.5">
                {servers.map((server) => {
                  const active = location.pathname === `/servers/${server.id}`;
                  return (
                    <li key={server.id}>
                      <Link
                        to={`/servers/${server.id}`}
                        className={cn(
                          "flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-zinc-800 text-zinc-100"
                            : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                        )}
                      >
                        <span className="truncate">{server.name}</span>
                        <StatusBadge
                          status={server.status}
                          className="ml-2 scale-90"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-xs text-zinc-600">Minecraft Server Manager</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-h-screen p-4 pt-4 sm:p-6 lg:ml-64 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
