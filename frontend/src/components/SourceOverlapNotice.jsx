import { WarningCircle } from '@phosphor-icons/react';

export default function SourceOverlapNotice({ overlaps = [], requireAcknowledgment = false, acknowledged = false, onAcknowledge }) {
  if (!overlaps.length) return null;
  return <section className="source-overlap-notice" aria-label="录像目录重叠提示" role="status">
    <h3><WarningCircle size={17} />目录与已有录像源重叠</h3>
    <p>扫描会递归读取子目录，同一批录像可能在片段库重复显示。建议使用已有源，或改选不重叠的目录。</p>
    <ul>{overlaps.map(source => <li key={source.id}><strong>{source.relation === 'inside' ? '位于已有源内' : '包含已有源'}：{source.name}</strong><code>{source.path}</code></li>)}</ul>
    {requireAcknowledgment ? <label><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} /><span>我了解录像可能重复显示，仍然使用此目录</span></label> : <p>当前目录已存在重叠；仅修改名称或扫描策略不会新增索引。</p>}
  </section>;
}
