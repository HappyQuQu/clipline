import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api'
import type { SettingsResponse } from '../../types'

export function useSettings() {
  const queryClient = useQueryClient()
  const [saveError, setSaveError] = useState<string | null>(null)

  const query = useQuery<SettingsResponse>({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.updateSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
      setSaveError(null)
    },
    onError: (err: Error) => {
      setSaveError(err.message || '保存失败')
      // 3 秒后自动清除错误
      setTimeout(() => setSaveError(null), 3000)
    },
  })

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    update: mutation.mutate,
    isPending: mutation.isPending,
    saveError,
  }
}
