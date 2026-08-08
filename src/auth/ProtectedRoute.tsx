import { Navigate, Outlet, useLocation } from 'react-router-dom'

import RouteFallback from '@/components/ui/RouteFallback'
import { useAuth } from './AuthContext'

export default function ProtectedRoute() {
  const { user, initializing } = useAuth()
  const location = useLocation()

  if (initializing) return <RouteFallback label="Đang kiểm tra phiên đăng nhập…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />

  return <Outlet />
}
