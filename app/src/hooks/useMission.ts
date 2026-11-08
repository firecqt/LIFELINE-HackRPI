import { useEffect } from 'react';
import { useAppStore, type Session } from '../store/appStore';
import type { Mission } from '../types/mission';

/** Resolve a mission + its live session (creating the session lazily). */
export function useMission(missionId: string | null | undefined): { mission: Mission | null; session: Session | null } {
  const mission = useAppStore((st) => (missionId ? st.missions.find((m) => m.id === missionId) ?? null : null));
  const session = useAppStore((st) => (missionId ? st.sessions[missionId] ?? null : null));
  const ensure = useAppStore((st) => st.ensureSession);
  useEffect(() => {
    if (missionId && mission && !session) ensure(missionId);
  }, [missionId, mission, session, ensure]);
  return { mission, session };
}
