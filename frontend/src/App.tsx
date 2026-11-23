import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { AuthGuard } from '@/layout/AuthGuard'
import { ChatRoute } from '@/features/chat/ChatPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AdminGuard } from '@/features/admin/AdminUsersPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AuthGuard />}>
        <Route path="/" element={<ChatRoute />} />
        <Route path="/c/:id" element={<ChatRoute />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin/users" element={<AdminGuard />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
