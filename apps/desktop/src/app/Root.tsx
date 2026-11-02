import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Providers } from './Providers';
import { useAuthStore } from './stores/auth';
import { AppPage } from '../pages/AppPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';

export function Root() {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'idle' || status === 'authenticating') {
    return <BootScreen />;
  }

  const authenticated = status === 'authenticated';

  return (
    <Providers>
      <HashRouter>
        <Routes>
          <Route path="/login" element={authenticated ? <Navigate to="/app" replace /> : <LoginPage />} />
          <Route path="/register" element={authenticated ? <Navigate to="/app" replace /> : <RegisterPage />} />
          <Route
            path="/app/:guildId?/:channelId?"
            element={authenticated ? <AppPage /> : <Navigate to="/login" replace />}
          />
          <Route path="*" element={<Navigate to={authenticated ? '/app' : '/login'} replace />} />
        </Routes>
      </HashRouter>
    </Providers>
  );
}

function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-app">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl font-black text-on-brand">
          D
        </div>
        <span className="text-sm text-muted">
          Carregando…
        </span>
      </div>
    </div>
  );
}
