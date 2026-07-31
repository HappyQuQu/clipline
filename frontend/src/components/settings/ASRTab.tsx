import * as Switch from '@radix-ui/react-switch'
import { Archive, CheckCircle, CircleNotch, DownloadSimple, Eye, Info, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { ASRModelInfo } from '../../types'
import { formatBytes } from '../../utils'
import { useSettings } from './useSettings'

function isActiveModel(model: ASRModelInfo, engine?: string, size?: string) {
  if (model.engine !== engine) return false
  if (engine === 'funasr' && model.size_label === 'medium') {
    return size === 'tiny' || size === 'base' || size === 'medium'
  }
  return model.size_label === size
}

function ModelRow({ model, active }: { model: ASRModelInfo; active: boolean }) {
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
  const descriptions: Record<string, string> = {
    'funasr:medium': '中文场景推荐 · 含 VAD 与标点模型',
    'funasr:large': '更高准确率 · 需要更多内存',
    'sensevoice:small': '多语言、情感与音频事件识别',
    'whisper:tiny': '速度最快 · 适合低功耗设备',
    'whisper:base': '通用多语言基础模型',
    'whisper:medium': '更高多语言准确率',
    'whisper:large': '准确率最高 · 资源占用较大',
  }
  const engineName = model.engine === 'funasr' ? 'FunASR' : model.engine === 'sensevoice' ? 'SenseVoice' : 'Whisper'

  return (
    <div className="redesignModelRow">
      <div className="redesignModelIdentity"><span>{engineName.slice(0, 1)}</span><div><strong>{engineName} · {model.name}</strong><small>{descriptions[model.id] ?? model.size_label}</small></div></div>
      <span className={`redesignModelStatus ${active ? 'active' : model.downloaded ? 'downloaded' : isDownloading ? 'downloading' : ''}`}>{active ? '使用中' : model.downloaded ? '已下载' : isDownloading ? '下载中' : '未下载'}</span>
      <span className="redesignModelSize">{model.downloaded ? formatBytes(model.size_bytes) : `${model.size_label} 规格`}</span>
      <div>
        {model.downloaded ? (
          <button
            className="settingsActionBtn danger"
            disabled={deleteMutation.isPending || active}
            onClick={() => deleteMutation.mutate()}
            title={active ? '当前使用中的模型不可删除' : '删除模型缓存'}
          >
            <Trash size={14} />
            {active ? '使用中' : '删除'}
          </button>
        ) : (
          <button
            className="settingsActionBtn"
            disabled={isDownloading}
            onClick={() => downloadMutation.mutate()}
            title="下载模型"
          >
            {isDownloading ? <CircleNotch size={14} className="spin" /> : <DownloadSimple size={14} />}
            {isDownloading ? '下载中' : '下载'}
          </button>
        )}
      </div>
      {rowError && (
        <div className="settingsError redesignModelError">{rowError}</div>
      )}
    </div>
  )
}

export function ASRTab({ mode = 'settings' }: { mode?: 'settings' | 'models' }) {
  const { settings, update } = useSettings()
  const asr = settings?.asr
  const vision = settings?.vision
  const [modelFilter, setModelFilter] = useState<'all' | 'downloaded' | 'missing'>('all')

  const modelsQuery = useQuery({
    queryKey: ['asrModels'],
    queryFn: () => api.getASRModels(),
    refetchInterval: 10000,
  })

  const allModels = modelsQuery.data?.models ?? []
  const displayModels = allModels.filter((model) => modelFilter === 'all' || (modelFilter === 'downloaded' ? model.downloaded : !model.downloaded))
  const downloadedModels = allModels.filter((model) => model.downloaded)
  const downloadedBytes = downloadedModels.reduce((total, model) => total + model.size_bytes, 0)

  function handleSelectChange(key: string, value: string) {
    update({ [key]: value })
  }

  function handleNumberChange(key: string, value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num > 0) {
      update({ [key]: num })
    }
  }

  function handleSwitchChange(key: string, checked: boolean) {
    update({ [key]: checked })
  }

  if (mode === 'models') {
    const visionAvailable = vision?.modelStatus.available ?? false
    const visionName = vision?.modelStatus.model ?? vision?.model ?? 'YOLOv8n'
    const visionDevice = vision?.modelStatus.device ?? vision?.device ?? '-'
    return (
      <div className="redesignModelManagement">
        <section className="redesignModelSummary">
          <div><span className="blue"><Archive size={20} /></span><p><small>模型缓存</small><strong>{downloadedBytes ? `${formatBytes(downloadedBytes)} 已使用` : '暂无缓存'}</strong><em>{settings?.paths?.models ?? 'data/models'}</em></p></div>
          <div><span className="green"><CheckCircle size={20} /></span><p><small>已下载</small><strong>{downloadedModels.length} 个语音模型</strong><em>{allModels.filter((model) => isActiveModel(model, asr?.model, asr?.modelSize) && model.downloaded).length} 个正在使用</em></p></div>
          <div><span className="purple"><Eye size={20} /></span><p><small>视觉模型</small><strong>{visionName} {visionAvailable ? '可用' : '不可用'}</strong><em>{visionDevice.toUpperCase()} · {visionAvailable ? '已加载' : '未加载'}</em></p></div>
        </section>

        <section className="redesignModelPanel">
          <header><div><h2>语音识别模型</h2><p>模型下载到 Clipline 的本地缓存，删除不会影响已有字幕结果。</p></div><div className="redesignModelFilters"><button type="button" className={modelFilter === 'all' ? 'active' : ''} onClick={() => setModelFilter('all')}>全部</button><button type="button" className={modelFilter === 'downloaded' ? 'active' : ''} onClick={() => setModelFilter('downloaded')}>已下载</button><button type="button" className={modelFilter === 'missing' ? 'active' : ''} onClick={() => setModelFilter('missing')}>未下载</button></div></header>
          <div className="redesignModelTableHead"><span>引擎与模型</span><span>状态</span><span>缓存大小</span><span /></div>
          {modelsQuery.isLoading ? <div className="settingsLoading">加载中...</div> : <div>{displayModels.map((model) => <ModelRow key={model.id} model={model} active={isActiveModel(model, asr?.model, asr?.modelSize)} />)}</div>}
        </section>

        <section className="redesignVisionModelCard">
          <span className="redesignVisionIcon"><Eye size={22} /></span>
          <div><small>视觉识别模型</small><h2>{visionName}</h2><p>{vision?.modelStatus.path ?? settings?.paths?.vision ?? 'data/models/vision'}</p></div>
          <dl><div><dt>状态</dt><dd>{visionAvailable ? '可用' : '不可用'}</dd></div><div><dt>设备</dt><dd>{visionDevice.toUpperCase()}</dd></div><div><dt>输入尺寸</dt><dd>{vision?.imageSize ?? 416} px</dd></div></dl>
          <span className={`redesignVisionState ${visionAvailable ? 'available' : ''}`}>{visionAvailable ? '当前已加载' : '需要部署模型'}</span>
        </section>
        <p className="redesignModelBoundary"><Info size={15} />当前后端支持语音模型下载与删除；视觉模型由本地文件或部署配置提供，因此这里只显示真实加载状态。</p>
      </div>
    )
  }

  return (
    <div className={`settingsSections asrMode-${mode}`}>
      <div className="settingsSection">
        <div className="settingsSectionTitle">识别默认值</div>
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
            value={asr?.modelSize ?? 'base'}
            onChange={(e) => handleSelectChange('asr_model_size', e.target.value)}
          >
            <option value="tiny">Tiny (最快)</option>
            <option value="base">Base (NAS 推荐)</option>
            <option value="medium">Medium</option>
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
          <span>最大并发</span>
          <input
            className="settingsInput"
            type="number"
            min={1}
            max={8}
            value={asr?.maxConcurrent ?? 1}
            onChange={(e) => handleNumberChange('asr_max_concurrent', e.target.value)}
          />
        </div>
        <div className="settingsHint">
          NAS 建议最大并发保持 1，模型优先使用 Tiny 或 Base；是否自动识别建议在具体录像源里单独开启。
        </div>
        <div className="settingsKV">
          <span>任务超时</span>
          <input
            className="settingsInput"
            type="number"
            min={60}
            value={asr?.timeoutSeconds ?? 600}
            onChange={(e) => handleNumberChange('asr_timeout_seconds', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>音频采样率</span>
          <input
            className="settingsInput"
            type="number"
            min={8000}
            step={1000}
            value={asr?.audioSampleRate ?? 16000}
            onChange={(e) => handleNumberChange('asr_audio_sample_rate', e.target.value)}
          />
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
        <div className="settingsSubsectionTitle">视觉识别</div>
        <div className="settingsKV">
          <span>视觉模型</span>
          <select className="settingsSelect" value={vision?.model ?? 'yolov8n'} onChange={(e) => handleSelectChange('vision_model', e.target.value)}><option value="yolov8n">YOLOv8 Nano</option><option value="yolov8s">YOLOv8 Small</option></select>
        </div>
        <div className="settingsKV">
          <span>运行设备</span>
          <select className="settingsSelect" value={vision?.device ?? 'cpu'} onChange={(e) => handleSelectChange('vision_device', e.target.value)}><option value="cpu">CPU</option><option value="cuda">CUDA</option><option value="mps">MPS</option></select>
        </div>
        <div className="settingsKV">
          <span>最大并发</span>
          <input className="settingsInput" type="number" min={1} max={4} value={vision?.maxConcurrent ?? 1} onChange={(e) => handleNumberChange('vision_max_concurrent', e.target.value)} />
        </div>
        <div className="settingsKV">
          <span>抽帧间隔（秒）</span>
          <input className="settingsInput" type="number" min={1} value={vision?.sampleIntervalSeconds ?? 5} onChange={(e) => handleNumberChange('vision_sample_interval_seconds', e.target.value)} />
        </div>
        <div className="settingsHint">修改模型、运行设备或并发后可能需要重启后台服务；当前运行中的任务不会被中断。</div>
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle">模型管理</div>
        <div className="modelOverviewStrip">
          <span><small>模型缓存</small><strong>{settings?.paths?.models ?? '-'}</strong></span>
          <span><small>已下载</small><strong>{allModels.filter((model) => model.downloaded).length} / {allModels.length}</strong></span>
          <span><small>视觉模型</small><strong>{vision?.modelStatus.available ? '已加载' : '不可用'} · {vision?.modelStatus.device ?? '-'}</strong></span>
        </div>
        <div className="modelFilterTabs"><button type="button" className={modelFilter === 'all' ? 'active' : ''} onClick={() => setModelFilter('all')}>全部</button><button type="button" className={modelFilter === 'downloaded' ? 'active' : ''} onClick={() => setModelFilter('downloaded')}>已下载</button><button type="button" className={modelFilter === 'missing' ? 'active' : ''} onClick={() => setModelFilter('missing')}>未下载</button></div>
        {modelsQuery.isLoading ? (
          <div className="settingsLoading">加载中...</div>
        ) : (
          <div className="modelList">
            {displayModels.map((model) => (
              <ModelRow key={model.id} model={model} active={model.engine === asr?.model && model.size_label === asr?.modelSize} />
            ))}
          </div>
        )}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle">配置边界</div>
        <div className="settingsKV">
          <span>全局适合</span>
          <strong>默认模型、语言、热词、并发、超时、采样率。</strong>
        </div>
        <div className="settingsKV">
          <span>源内适合</span>
          <strong>某个录像源是否自动语音/视觉识别、识别对象、触发方式和优先级。</strong>
        </div>
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
