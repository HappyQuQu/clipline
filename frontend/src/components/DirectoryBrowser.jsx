import { useEffect, useState } from 'react';
import { FolderSimple, ArrowRight } from '@phosphor-icons/react';
import { EmptyState, Notice } from './UI';
import { queryString, request } from '../api/client';
export default function DirectoryBrowser({ sources, onSelect }) {
  const [relative, setRelative] = useState(''), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    request(`/recording-directories?${queryString({ relativePath: relative })}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, [relative]);
  async function more() { try { const next = await request(`/recording-directories?${queryString({ relativePath: relative, cursor: data.nextCursor })}`); setData(current => current?.relativePath === next.relativePath ? { ...current, items: [...current.items, ...next.items], nextCursor: next.nextCursor } : current); } catch (failure) { setError(failure.message); } }
  return <section className="source-directory-browser" aria-label="选择真实录像目录"><header><strong><FolderSimple size={15} />{data?.path || '/recordings'}</strong>{relative && <button type="button" className="text-button" onClick={() => setRelative(relative.split('/').slice(0, -1).join('/'))}>上一级</button>}</header>{error && <Notice warning>{error}</Notice>}<div className="source-directory-list">{!data && !error && <p role="status">正在读取目录…</p>}{data?.items.map(directory => { const added = sources.some(source => source.path === directory.path); return <div className="directory-row" key={directory.path}><button type="button" onClick={() => setRelative(directory.relativePath)} aria-label={`打开目录 ${directory.name}`}><FolderSimple size={20} /><span><strong>{directory.name}</strong><code>{directory.path}</code></span><ArrowRight size={15} /></button><button type="button" className="text-button" disabled={added} onClick={() => onSelect(directory)}>{added ? '已添加' : '选用目录'}</button></div>; })}{data && !data.items.length && <EmptyState title="没有子目录" description="可选择当前目录作为录像源。" />}</div>{data?.nextCursor && <button type="button" className="text-button" onClick={more}>加载更多目录</button>}{data && relative && <button type="button" className="button secondary full" disabled={sources.some(source => source.path === data.path)} onClick={() => onSelect({ path: data.path, name: relative.split('/').at(-1) })}>选用当前目录</button>}<p className="source-directory-note">选择 media 下的录像文件夹；目录和读取权限由服务端校验。</p></section>;
}
