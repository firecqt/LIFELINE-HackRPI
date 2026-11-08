import { useEffect, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { BASE_TICK_MS } from '../services/simulationService';

/**
 * Global simulation clock. Mounted once in the app shell so running missions keep advancing
 * while the ranger navigates between pages.
 */
export function useSimulationLoop() {
  const runningKey = useAppStore((st) =>
    Object.entries(st.sessions)
      .filter(([, s]) => s.sim.status === 'running')
      .map(([id, s]) => `${id}@${s.sim.speed}`)
      .join('|'),
  );
  const running = useMemo(() => (runningKey ? runningKey.split('|').map((k) => k.split('@')) : []), [runningKey]);

  useEffect(() => {
    const handles = running.map(([id, speedStr]) => {
      const interval = Math.max(50, BASE_TICK_MS / Number(speedStr));
      return window.setInterval(() => useAppStore.getState().advance(id, interval), interval);
    });
    return () => handles.forEach((h) => window.clearInterval(h));
  }, [running]);
}
