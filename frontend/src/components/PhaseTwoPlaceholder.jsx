import { Eye, MagnifyingGlass, Microphone, SlidersHorizontal, Sparkle, Stack, Tag, HardDrives } from '@phosphor-icons/react';

const placeholders = {
  'source-settings': {
    title: '自动识别', icon: Sparkle,
    description: '二期可选择手动或扫描后自动识别，结果在片段详情查看。',
    items: [{ label: '新录像自动语音转写', icon: Microphone }, { label: '新录像自动画面识别', icon: Eye }],
  },
  'library-filters': {
    title: '内容查询', icon: SlidersHorizontal,
    description: '二期开放，当前仅按文件信息查询。',
    items: [{ label: '字幕搜索', icon: Microphone }, { label: '画面标签', icon: Tag }, { label: '识别状态', icon: Stack }],
  },
  'clip-detail': {
    title: '智能分析', icon: Sparkle,
    description: '二期在这里查看字幕、画面识别结果和事件时间点。',
    items: [{ label: '语音转写', icon: Microphone }, { label: '视频内容识别', icon: Eye }],
  },
  'search-provider': {
    title: '内容搜索', icon: MagnifyingGlass,
    description: '二期支持按字幕和画面标签查找录像。',
  },
  'task-type': {
    title: '识别任务', icon: Stack,
    description: '二期在这里查看识别进度、结果与重试。',
    items: [{ label: '语音转写任务', icon: Microphone }, { label: '画面识别任务', icon: Eye }],
  },
  'settings-section': {
    title: '识别与模型', icon: SlidersHorizontal,
    description: '模型选择、识别策略和资源配置将在二期开放。',
    items: [{ label: '语音模型与转写策略', icon: Microphone }, { label: '视觉模型与识别策略', icon: Eye }, { label: '运行设备与模型缓存', icon: HardDrives }],
  },
};

export default function PhaseTwoPlaceholder({ slot }) {
  const config = placeholders[slot];
  if (!config) return null;
  const Icon = config.icon;
  return <section className={`phase-two-placeholder slot-${slot}`} aria-label={`${config.title}，二期预留`}>
    <div className="phase-two-heading"><h3><Icon size={16} />{config.title}</h3><span className="phase-two-badge">二期预留</span></div>
    <p>{config.description}</p>
    {config.items && <div className="phase-two-items">{config.items.map(({ label, icon: ItemIcon }) => <div key={label}><ItemIcon size={15} /><span>{label}</span><span className="phase-two-item-status">尚未开放</span></div>)}</div>}
  </section>;
}
