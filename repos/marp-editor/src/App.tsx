import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './components/Home'
import { Editor } from './components/Editor'
import { SharedView } from './components/SharedView'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/analytics" element={<AnalyticsDashboard />} />
        <Route path="/share/:token" element={<SharedView />} />
      </Routes>
    </BrowserRouter>
  )
}
