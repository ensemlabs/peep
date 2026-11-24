import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import { isOverQuota } from '@/lib/quota'

export const ME_KEY = ['me'] as const
export const ME_POLL_MS = 30_000
export const QUOTA_POLL_MS = 60_000

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: api.me,
    retry: false,
    staleTime: 15_000,
    // Blocked by the quota: re-check so a reset, a raised or a removed limit unblocks without a reload.
    refetchInterval: (q) =>
      q.state.data?.status === 'pending' ? ME_POLL_MS : isOverQuota(q.state.data?.quota) ? QUOTA_POLL_MS : false,
    refetchOnWindowFocus: true,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear()
      navigate('/login', { replace: true })
    },
  })
}
