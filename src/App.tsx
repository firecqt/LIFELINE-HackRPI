import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Overview from './pages/Overview';
import MapPage from './pages/MapPage';
import Drones from './pages/Drones';
import MissingPersons from './pages/MissingPersons';
import GroundTeam from './pages/GroundTeam';
import Recovery from './pages/Recovery';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="map" element={<MapPage />} />
          <Route path="map/:missionId" element={<MapPage />} />
          <Route path="drones" element={<Drones />} />
          <Route path="people" element={<MissingPersons />} />
          <Route path="ground" element={<GroundTeam />} />
          <Route path="recovery/:missionId" element={<Recovery />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
