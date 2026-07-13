import * as Switch from '@radix-ui/react-switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, Download, Lightbulb, Loader2, PackageOpen, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { ASRModelInfo } from '../../types'
import { formatBytes } from '../../utils'
import { useSettings } from './useSettings'

function ModelRow({ model }: { model: ASRModelInfo }) {
  const queryClient = useQueryClient()
  const [polling, setPolling] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const downloadMutation = useMutation({
    mutationFn: () => api.downloadASRModel(model.id),
    onSuccess: () => setPolling(true),
    onError: (err: Error) => setRowError(err.message || '下载失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteASRModel(model.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asrModels'] }),
    onError: (err: Error) => setRowError(err.message || '删除失败'),
  })

  // 轮询下载状态
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(async () => {
      try {
        const status = await api.getASRModelStatus(model.id)
        if (status.status === 'completed' || status.status === 'failed') {
          setPolling(false)
          void queryClient.invalidateQueries({ queryKey: ['asrModels'] })
        }
      } catch {
        // 忽略轮询错误
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [polling, model.id, queryClient])

  const isDownloading = downloadMutation.isPending || polling

  return (
    <div className="modelRow">
      <div>
        <strong>{model.engine.toUpperCase()}</strong>
        <span style={{ marginLeft: 8, color: '#7b8794', fontSize: 12 }}>{model.name}</span>
      </div>
      <div>
        <span
          className={`modelBadge ${model.downloaded ? 'downloaded' : isDownloading ? 'downloading' : 'not-downloaded'}`}
        >
          {model.downloaded ? '已下载' : isDownloading ? '下载中' : '未下载'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#7b8794' }}>
        {model.downloaded ? formatBytes(model.size_bytes) : '-'}
      </div>
      <div>
        {model.downloaded ? (
          <button
            className="settingsActionBtn danger"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            title="删除模型缓存"
          >
            <Trash2 size={14} />
            删除
          </button>
        ) : (
          <button
            className="settingsActionBtn"
            disabled={isDownloading}
            onClick={() => downloadMutation.mutate()}
            title="下载模型"
          >
            {isDownloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {isDownloading ? '下载中' : '下载'}
          </button>
        )}
      </div>
      {rowError && (
        <div style={{ gridColumn: '1 / -1' }} className="settingsError">{rowError}</div>
      )}
    </div>
  )
}

export function ASRTab() {
  const { settings, update, isPending, saveError } = useSettings()
  const asr = settings?.asr

  const modelsQuery = useQuery({
    queryKey: ['asrModels'],
    queryFn: () => api.getASRModels(),
    refetchInterval: 10000,
  })

  const displayModels = modelsQuery.data?.models ?? []

  function handleSelectChange(key: string, value: string) {
    update({ [key]: value })
  }

  function handleSwitchChange(key: string, checked: boolean) {
    update({ [key]: checked })
  }

  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle"><AudioLines size={16} />识别配置</div>
        <div className="settingsKV">
          <span>识别引擎</span>
          <select
            className="settingsSelect"
            value={asr?.model ?? 'funasr'}
            onChange={(e) => handleSelectChange('asr_model', e.target.value)}
          >
            <option value="funasr">FunASR</option>
            <option value="sensevoice">SenseVoice</option>
            <option value="whisper">Whisper</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>模型大小</span>
          <select
            className="settingsSelect"
            value={asr?.modelSize ?? 'medium'}
            onChange={(e) => handleSelectChange('asr_model_size', e.target.value)}
          >
            <option value="tiny">Tiny (最快)</option>
            <option value="base">Base</option>
            <option value="medium">Medium (推荐)</option>
            <option value="large">Large (最准)</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>运行设备</span>
          <select
            className="settingsSelect"
            value={asr?.device ?? 'auto'}
            onChange={(e) => handleSelectChange('asr_device', e.target.value)}
          >
            <option value="auto">自动</option>
            <option value="cpu">CPU</option>
            <option value="cuda">CUDA (GPU)</option>
            <option value="mps">MPS (Apple)</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>识别语言</span>
          <select
            className="settingsSelect"
            value={asr?.language ?? 'zh'}
            onChange={(e) => handleSelectChange('asr_language', e.target.value)}
          >
            <option value="zh">中文</option>
            <option value="en">英文</option>
            <option value="ja">日文</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>自动识别</span>
          <Switch.Root
            className="switchRoot"
            checked={asr?.autoTranscribe ?? false}
            onCheckedChange={(checked) => handleSwitchChange('asr_auto_transcribe', checked)}
          >
            <Switch.Thumb className="switchThumb" />
          </Switch.Root>
        </div>
        <div className="settingsKV">
          <span>热词</span>
          <input
            className="settingsInput"
            type="text"
            placeholder="用逗号分隔，如：会议,项目,进度"
            defaultValue={asr?.hotwords ?? ''}
            onBlur={(e) => update({ asr_hotwords: e.target.value })}
          />
        </div>
        {isPending && <div className="settingsSaving">保存中...</div>}
        {saveError && <div className="settingsError">{saveError}</div>}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle"><PackageOpen size={16} />模型管理</div>
        {modelsQuery.isLoading ? (
          <div style={{ color: '#7b8794', fontSize: 13, padding: '20px 20px' }}>加载中...</div>
        ) : (
          <div className="modelList">
            {displayModels.map((model) => (
              <ModelRow key={model.id} model={model} />
            ))}
          </div>
        )}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle"><Lightbulb size={16} />引擎说明</div>
        <div className="settingsKV">
          <span>FunASR</span>
          <strong>阿里达摩院开源的高性能语音识别引擎，推荐用于中文场景。</strong>
        </div>
        <div className="settingsKV">
          <span>SenseVoice</span>
          <strong>FunASR 的新一代模型，支持更多语言和情感识别。</strong>
        </div>
        <div className="settingsKV">
          <span>Whisper</span>
          <strong>OpenAI 开源的通用语音识别模型，多语言表现优秀。</strong>
        </div>
        <div className="settingsKV">
          <span>热词</span>
          <strong>添加特定词汇可提高识别准确率，用英文逗号分隔。</strong>
        </div>
      </div>
    </div>
  )
}
