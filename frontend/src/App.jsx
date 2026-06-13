import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Connectors from './pages/Connectors'
import Upload from './pages/Upload'
import Dashboard from './pages/Dashboard'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="connectors" element={<Connectors />} />
        <Route path="upload" element={<Upload />} />
        <Route path="dashboard" element={<Dashboard />} />
      </Route>
    </Routes>
  )
}
