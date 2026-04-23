import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { LeadCommandCenter } from './screens/LeadCommandCenter'
import { LeadQueue } from './screens/LeadQueue'
import { SettingsScreen } from './screens/SettingsScreen'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<LeadQueue />} />
        <Route path="/leads/:id" element={<LeadCommandCenter />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Routes>
    </QueryClientProvider>
  )
}
