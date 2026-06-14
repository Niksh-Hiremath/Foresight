import { Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import LandingPage from './pages/LandingPage'
import AgentsPage from './pages/AgentsPage'
import KnowledgebasePage from './pages/KnowledgebasePage'
import PluginsPage from './pages/PluginsPage'
import HistoryPage from './pages/HistoryPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/knowledge-base" element={<KnowledgebasePage />} />
      <Route path="/plugins" element={<PluginsPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
