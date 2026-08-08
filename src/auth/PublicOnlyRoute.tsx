import { Navigate, Outlet } from 'react-router-dom'

import RouteFallback from '@/components/ui/RouteFallback'
import { useAuth } from './AuthContext'

/** Keeps an already-authenticated session out of /login. */
export default function PublicOnlyRoute() {
  const { user, initializing } = useAuth()

  if (initializing) return <RouteFallback />
  if (user) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
