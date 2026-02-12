import { BrowserRouter, Routes, Route } from "react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { CreateServer } from "./pages/CreateServer";
import { ServerDetail } from "./pages/ServerDetail";
import { AppSettings } from "./pages/AppSettings";
import { Mods } from "./pages/Mods";
import Launcher from "./pages/Launcher";
import InstanceDetail from "./pages/InstanceDetail";
import Setup from "./pages/Setup";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Admin from "./pages/Admin";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#18181b",
              border: "1px solid #27272a",
              color: "#e4e4e7",
            },
          }}
          theme="dark"
        />
        <Routes>
          <Route path="setup" element={<Setup />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="servers/new" element={<CreateServer />} />
            <Route path="servers/:id" element={<ServerDetail />} />
            <Route path="mods" element={<Mods />} />
            <Route path="launcher" element={<Launcher />} />
            <Route path="launcher/:id" element={<InstanceDetail />} />
            <Route path="settings" element={<AppSettings />} />
            <Route
              path="admin"
              element={
                <ProtectedRoute requiredRole={["owner", "admin"]}>
                  <Admin />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
