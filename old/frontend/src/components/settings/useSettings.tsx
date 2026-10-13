import { CheckCircle } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api'
import type { SettingsResponse } from '../../types'

type SettingsDraftContextValue = {
  settings: SettingsResponse | null
  isLoading: boolean
  update: (payload: Record<string, unknown>) => void
  save: () => void
  reset: () => void
  isDirty: boolean
  isPending: boolean
  saveError: string | null
  saveSuccess: boolean
}

const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null)

const settingPath: Record<string, [keyof SettingsResponse, string]> = {
  scan_interval_seconds: ['recordings', 'scan_interval_seconds'],
  skip_recent_seconds: ['recordings', 'skip_recent_seconds'],
  timezone: ['recordings', 'timezone'],
  scan_workers_per_source: ['recordings', 'scan_workers_per_source'],
  global_ffprobe_concurrency: ['recordings', 'global_ffprobe_concurrency'],
  auto_cleanup_days: ['recordings', 'auto_cleanup_days'],
  idle_scan_enabled: ['recordings', 'idle_scan_enabled'],
  idle_scan_start_hour: ['recordings', 'idle_scan_start_hour'],
  idle_scan_end_hour: ['recordings', 'idle_scan_end_hour'],
  export_ttl_hours: ['export', 'export_ttl_hours'],
  max_export_minutes: ['export', 'max_export_minutes'],
  max_concurrent_exports: ['export', 'max_concurrent_exports'],
  thumbnail_mode: ['export', 'thumbnail_mode'],
  asr_model: ['asr', 'model'],
  asr_model_size: ['asr', 'modelSize'],
  asr_device: ['asr', 'device'],
  asr_language: ['asr', 'language'],
  asr_auto_transcribe: ['asr', 'autoTranscribe'],
  asr_hotwords: ['asr', 'hotwords'],
  asr_audio_sample_rate: ['asr', 'audioSampleRate'],
  asr_max_concurrent: ['asr', 'maxConcurrent'],
  asr_timeout_seconds: ['asr', 'timeoutSeconds'],
  vision_model: ['vision', 'model'],
  vision_device: ['vision', 'device'],
  vision_max_concurrent: ['vision', 'maxConcurrent'],
  vision_sample_interval_seconds: ['vision', 'sampleIntervalSeconds'],
  vision_image_size: ['vision', 'imageSize'],
  vision_confidence: ['vision', 'confidence'],
  vision_max_auto_jobs_per_scan: ['vision', 'maxAutoJobsPerScan'],
  log_level: ['logs', 'log_level'],
  log_format: ['logs', 'log_format'],
}

function applyPayload(settings: SettingsResponse, payload: Record<string, unknown>) {
  const next = structuredClone(settings) as SettingsResponse
  Object.entries(payload).forEach(([key, value]) => {
    const path = settingPath[key]
    if (!path) return
    const [section, field] = path
    const target = next[section]
    if (target && typeof target === 'object') (target as Record<string, unknown>)[field] = value
  })
  return next
}

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<SettingsResponse | null>(null)
  const [patch, setPatch] = useState<Record<string, unknown>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const query = useQuery<SettingsResponse>({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const isDirty = Object.keys(patch).length > 0

  useEffect(() => {
    if (!query.data) return
    setDraft((current) => {
      if (!isDirty) return query.data ?? null
      if (current) return current
      return applyPayload(query.data, patch)
    })
  }, [isDirty, patch, query.data])

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.updateSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
      setDraft(data)
      setPatch({})
      setSaveError(null)
      setSaveSuccess(true)
      window.setTimeout(() => setSaveSuccess(false), 2200)
    },
    onError: (error: Error) => {
      setSaveSuccess(false)
      setSaveError(error.message || '保存失败，请检查后端连接后重试。')
    },
  })

  const value = useMemo<SettingsDraftContextValue>(() => ({
    settings: draft ?? query.data ?? null,
    isLoading: query.isLoading,
    update: (payload) => {
      setSaveError(null)
      setSaveSuccess(false)
      setPatch((current) => ({ ...current, ...payload }))
      setDraft((current) => {
        const base = current ?? query.data
        return base ? applyPayload(base, payload) : current
      })
    },
    save: () => { if (Object.keys(patch).length) mutation.mutate(patch) },
    reset: () => {
      setDraft(query.data ?? null)
      setPatch({})
      setSaveError(null)
      setSaveSuccess(false)
    },
    isDirty,
    isPending: mutation.isPending,
    saveError,
    saveSuccess,
  }), [draft, isDirty, mutation, patch, query.data, query.isLoading, saveError, saveSuccess])

  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsDraftContext)
  if (!context) throw new Error('useSettings must be used inside SettingsDraftProvider')
  return context
}

export function SettingsSaveBar({ editable }: { editable: boolean }) {
  const { isDirty, isPending, saveError, saveSuccess, save, reset } = useSettings()
  if (!editable && !isDirty && !saveSuccess && !saveError) return null
  return (
    <div className="redesignSettingsSaveBar">
      <span aria-live="polite">{saveError ? <em role="alert">{saveError}</em> : saveSuccess ? <><CheckCircle size={16} weight="fill" />设置已保存</> : isDirty ? '有未保存的更改' : '当前设置已同步'}</span>
      <button type="button" className="manageSecondary" disabled={!isDirty || isPending} onClick={reset}>恢复本页默认值</button>
      <button type="button" className="managePrimary" disabled={!isDirty || isPending} onClick={save}>{isPending ? '保存中…' : '保存更改'}</button>
    </div>
  )
}
