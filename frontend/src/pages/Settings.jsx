import { useState } from 'react';
import { Check, Globe, Clock, PlayCircle, FolderSimple, ArrowCounterClockwise, DownloadSimple, HardDrives, Stack, Sparkle, Info, ArrowRight } from '@phosphor-icons/react';
import { SETTINGS_FIELDS, mergeSettingsGroup } from '../domain';
import { Badge, ExtensionSlot, PageHeading } from '../components/UI';

const tabs = [
  { id: 'general', label: '基础设置', description: '工作空间与存储', icon: Globe },
  { id: 'scan', label: '扫描与索引', description: '新录像源默认策略', icon: FolderSimple },
  { id: 'playback', label: '录像回看', description: '连续播放与断档', icon: PlayCircle },
  { id: 'export', label: '录像导出', description: '模式与时间范围', icon: DownloadSimple },
  { id: 'tasks', label: '后台任务', description: '队列与处理资源', icon: Stack },
  { id: 'recognition', label: '识别与模型', description: '智能能力二期预留', icon: Sparkle },
  { id: 'about', label: '关于 Clipline', description: '版本与运行说明', icon: Info },
];
const intervalLabel = value => value === 'manual' ? '手动扫描' : `每 ${value} 分钟`;
export default function Settings({ settings, setSettings, draft, setDraft, defaults, notify }) {
  const [tab, setTab] = useState('general');
  const dirtyCount = group => (SETTINGS_FIELDS[group] || []).filter(field => draft[field] !== settings[field]).length;
  const pending = Object.keys(SETTINGS_FIELDS).reduce((count, group) => count + dirtyCount(group), 0);
  const changed = dirtyCount(tab);
  const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  function save() { setSettings(previous => mergeSettingsGroup(previous, draft, tab)); notify(`${tabs.find(item => item.id === tab).label}已保存`); }
  function reset() { setDraft(previous => mergeSettingsGroup(previous, defaults, tab)); notify('本页已恢复默认值，保存后生效'); }
  function discard() { setDraft(previous => mergeSettingsGroup(previous, settings, tab)); }
  return <div className="settings-page optimized-settings">
    <PageHeading eyebrow="MAKE IT WORK YOUR WAY" title="设置" description="分别配置扫描、回看、导出和后台任务，按需保存每一类设置。"><Badge tone={pending ? 'amber' : 'neutral'}>{pending ? `${pending} 项未保存` : '配置已保存'}</Badge></PageHeading>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">{tabs.map(({ id, label, description, icon: Icon }) => <button key={id} aria-label={label} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span>{id === 'recognition' ? <span className="settings-phase-badge">二期</span> : dirtyCount(id) > 0 && <i className="unsaved-dot" title="有未保存的修改" />}</button>)}</nav>
      <div className="settings-content">
        {tab === 'general' && <>
          <div className="settings-overview"><button onClick={() => setTab('scan')} aria-label="查看扫描设置"><FolderSimple size={20} /><span>扫描默认值<strong>{intervalLabel(settings.interval)}</strong></span><ArrowRight size={14} /></button><button onClick={() => setTab('export')} aria-label="查看导出设置"><DownloadSimple size={20} /><span>导出默认值<strong>{settings.defaultMode === 'fast' ? '快速导出' : '精准导出'}</strong></span><ArrowRight size={14} /></button><button onClick={() => setTab('tasks')} aria-label="查看后台任务设置"><Stack size={20} /><span>后台并行<strong>{settings.concurrency} 个任务</strong></span><ArrowRight size={14} /></button></div>
          <SettingsPanel title="工作空间与时间" icon={Globe} description="当前工作空间用于本地录像管理，录像按北京时间展示。"><div className="setting-row"><div><strong>工作空间</strong><p>当前原型的配置保存在此浏览器中。</p></div><Badge tone="blue">本地工作空间</Badge></div><div className="setting-row"><div><strong>录像时区</strong><p>当前固定使用北京时间，保证时间轴与导出范围一致。</p></div><span className="setting-readonly">Asia/Shanghai <small>UTC+8</small></span></div></SettingsPanel>
          <SettingsPanel title="存储位置" icon={HardDrives} description="录像目录保持只读，导出生成独立文件。"><div className="path-row"><span>录像根目录</span><code>/recordings</code><Badge>只读</Badge></div><details className="settings-path-details"><summary>查看索引与导出路径</summary><div className="path-row"><span>索引与缓存</span><code>/app/data</code><Badge>服务端</Badge></div><div className="path-row"><span>导出暂存</span><code>/app/data/exports</code><Badge>服务端</Badge></div></details><p className="setting-note">以上为正式部署的目录约定。当前视频下载位置由浏览器决定。</p></SettingsPanel>
        </>}
        {tab === 'scan' && <SettingsPanel title="扫描与索引" icon={FolderSimple} description="设置新录像源的默认频率，避免处理仍在写入的文件。"><div className="setting-row"><div><strong>默认扫描间隔</strong><p>添加录像源时带入此值；已添加录像源的频率不会改变。</p></div><select aria-label="默认扫描间隔" value={draft.interval} onChange={event => update('interval', event.target.value)}><option value="5">每 5 分钟</option><option value="10">每 10 分钟</option><option value="30">每 30 分钟</option><option value="manual">仅手动扫描</option></select></div><div className="setting-row"><div><strong>跳过最近写入的文件</strong><p>正式版扫描时跳过近期文件，待写入完成后再建立索引。</p></div><select aria-label="跳过文件写入时长" value={draft.skipRecent} onChange={event => update('skipRecent', event.target.value)}><option value="30">最近 30 秒</option><option value="60">最近 1 分钟</option><option value="120">最近 2 分钟</option></select></div><div className="setting-row"><div><strong>支持的视频格式</strong><p>扫描会读取录像信息，并准备预览缩略图。</p></div><span className="format-list">MP4 · MOV · MKV<br />AVI · TS · M4V</span></div><div className="settings-scope-note"><Info size={16} /><p>当前原型会应用新源的默认频率；定时扫描和文件写入检查由正式服务端执行。</p></div></SettingsPanel>}
        {tab === 'playback' && <SettingsPanel title="连续回看" icon={PlayCircle} description="让连续录像自然接续，也可以逐段手动播放。"><Toggle label="自动播放下一片段" hint="当前片段结束后，继续播放同一天的下一片段。" checked={draft.autoNext} onChange={value => update('autoNext', value)} /><Toggle label="自动跳过录像断档" hint={draft.autoNext ? '下一片段前有断档时，提示后继续播放。' : '开启自动播放下一片段后生效；保留当前偏好。'} disabled={!draft.autoNext} checked={draft.skipGaps} onChange={value => update('skipGaps', value)} /><div className="settings-scope-note"><PlayCircle size={16} /><p>保存后在回看页生效，不修改源录像内容。</p></div></SettingsPanel>}
        {tab === 'export' && <>
          <SettingsPanel title="默认导出模式" icon={DownloadSimple} description="每次导出会带入此默认值，提交前仍可单独调整。"><fieldset className="settings-export-modes"><legend className="review-screen-reader">默认导出模式</legend>{[['fast', '快速导出', '保留原画质、处理更快，起止时间贴近关键帧。'], ['precise', '精准导出', '重新编码，精确到选定时间，需要更多处理时间。']].map(([id, label, hint]) => <label key={id} className={draft.defaultMode === id ? 'selected' : ''}><input type="radio" name="default-export-mode" aria-label={`默认${label}`} checked={draft.defaultMode === id} onChange={() => update('defaultMode', id)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset></SettingsPanel>
          <SettingsPanel title="导出范围" icon={Clock}><div className="setting-row"><div><strong>单次最长导出范围</strong><p>按起止时间跨度限制；超过范围时会提示调整。</p></div><select aria-label="最长导出范围" value={draft.maxDuration} onChange={event => update('maxDuration', event.target.value)}><option value="10">10 分钟</option><option value="30">30 分钟</option><option value="60">60 分钟</option></select></div><div className="settings-scope-note"><Info size={16} /><p>当前原型会校验范围并演示导出任务，下载仍为 60 秒示例视频。</p></div></SettingsPanel>
        </>}
        {tab === 'tasks' && <SettingsPanel title="后台处理资源" icon={Stack} description="目录扫描、索引重建、播放准备和导出共享处理队列。"><div className="setting-row"><div><strong>并行任务数</strong><p>新排队任务按此限制开始；已运行的任务不会被中断。</p></div><select aria-label="并行任务数" value={draft.concurrency} onChange={event => update('concurrency', event.target.value)}><option value="1">1 个任务 · 低占用</option><option value="2">2 个任务 · 均衡</option><option value="3">3 个任务 · 更快处理</option></select></div><div className="setting-row"><div><strong>切换页面</strong><p>提交后可继续回看，结果与过程记录在任务及日志中心。</p></div><Badge tone="blue">继续处理</Badge></div><div className="setting-row"><div><strong>关闭浏览器页面</strong><p>当前演示队列会暂停；正式版由服务端持续执行。</p></div><Badge>正式版接入</Badge></div></SettingsPanel>}
        {tab === 'recognition' && <><ExtensionSlot name="settings-section" context={{ settings: draft, update }} /><div className="settings-scope-note recognition-setting-note"><Info size={16} /><p>各录像源的识别触发策略在添加或编辑源时配置。当前所有识别能力保持关闭。</p></div></>}
        {tab === 'about' && <SettingsPanel title="关于 Clipline" icon={Info}><div className="settings-about-identity"><img src="/assets/clipline-logo.svg" alt="Clipline 标志" /><div><h3>Clipline</h3><p>你的录像，有迹可循。</p><Badge tone="blue">一期交互原型 · v0.1.0</Badge></div></div><div className="setting-row"><div><strong>运行方式</strong><p>前端使用示例录像和演示任务，尚未连接正式服务端。</p></div><Badge>本地原型</Badge></div><div className="setting-row"><div><strong>数据与配置</strong><p>已保存的录像源、设置、任务和日志保存在当前浏览器。</p></div><Badge>本地保存</Badge></div><div className="settings-scope-note"><Info size={16} /><p>语音转写和视频内容识别将在二期接入。真实目录扫描、转码和区间拼接需接入正式后端。</p></div></SettingsPanel>}
        {SETTINGS_FIELDS[tab] && <div className={`settings-save-bar ${changed ? 'has-changes' : ''}`}><span aria-live="polite">{changed ? <><i className="unsaved-dot" />本页 {changed} 项未保存</> : '本页配置已保存'}<small>切换页面保留编辑，保存后才生效</small></span><div className="settings-save-actions"><button className="button quiet" onClick={reset}><ArrowCounterClockwise size={15} />恢复本页默认</button><button className="button secondary" disabled={!changed} onClick={discard}>撤销修改</button><button className="button primary" disabled={!changed} onClick={save}><Check size={16} />保存本页</button></div></div>}
      </div>
    </div>
  </div>;
}
function SettingsPanel({ title, description, icon: Icon, children }) {
  return <section className="panel settings-panel"><div className="section-heading"><h2>{title}</h2><Icon size={20} /></div>{description && <p className="section-description">{description}</p>}{children}</section>;
}
function Toggle({ label, hint, checked, disabled = false, onChange }) {
  return <div className={`setting-row ${disabled ? 'setting-disabled' : ''}`}><div><strong>{label}</strong><p>{hint}</p></div><label className="switch"><input type="checkbox" role="switch" aria-label={label} disabled={disabled} checked={checked} onChange={event => onChange(event.target.checked)} /><span /></label></div>;
}
