import { Link } from 'react-router-dom'

import Logo from '@/components/layout/Logo'

export default function NotFoundPage() {
  return (
    <div className="bg-plane grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <Logo size={40} />
        <p className="text-ink-3 mt-8 text-5xl font-bold">404</p>
        <h1 className="mt-3 text-lg font-semibold">Không tìm thấy trang</h1>
        <p className="text-ink-2 mt-1 text-sm">Đường dẫn bạn truy cập không tồn tại hoặc đã bị gỡ.</p>
        <Link to="/dashboard" className="btn-primary mt-6">
          Về bảng điều khiển
        </Link>
      </div>
    </div>
  )
}
