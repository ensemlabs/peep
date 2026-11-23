import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'

export const ME_KEY = ['me'] as const
export const ME_POLL_MS = 30_000

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: api.me,
    retry: false,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? ME_POLL_MS : false),
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
