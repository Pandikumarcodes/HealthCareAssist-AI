import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { WelcomePage } from './pages/WelcomePage'
import { RequestsPage } from './pages/RequestsPage'
import { NewRequestPage, EditRequestPage } from './pages/RequestFormPage'
import { RequestDetailsPage } from './pages/RequestDetailsPage'
import { KnowledgeBasePage } from './pages/KnowledgeBasePage'
import { DocumentDetailsPage } from './pages/DocumentDetailsPage'

export default function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 60_000 },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/requests/new" element={<NewRequestPage />} />
            <Route path="/requests/:id" element={<RequestDetailsPage />} />
            <Route path="/requests/:id/edit" element={<EditRequestPage />} />
            <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
            <Route path="/knowledge-base/:id" element={<DocumentDetailsPage />} />
          </Route>
          <Route path="*" element={
            <main className="not-found">
              <h1>Page not found</h1>
              <p>This page is not available.</p>
              <Link className="text-link" to="/">Return to welcome</Link>
            </main>
          } />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
