import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { ToastStack } from '../alerts/NotificationCenter';
import { useSimulationLoop } from '../../hooks/useSimulation';
// Registers the engine start/reset handlers used by the store.
import '../../api/backendLink';
import { useAppStore } from '../../store/appStore';

export default function AppShell() {
  useSimulationLoop();
  const ensure = useAppStore((s) => s.ensureSession);
  const missions = useAppStore((s) => s.missions);

  // Hydrate live sessions for the pre-existing missions in the background so the dashboard
  // reflects the same simulation state the map page will show.
  useEffect(() => {
    const ids = missions.map((m) => m.id);
    let k = 0;
    const next = () => {
      if (k >= ids.length) return;
      ensure(ids[k++]);
      setTimeout(next, 30);
    };
    const t = setTimeout(next, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="relative min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <ToastStack />
    </div>
  );
}
