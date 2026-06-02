import * as Select from '@radix-ui/react-select'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import type { DirectoryNode } from '../../types'

function DirectoryPickerModal({
  currentValue,
  initialPath,
  root,
  fallbackNodes,
  onClose,
  onPick,
}: {
  currentValue: string
  initialPath: string
  root: string
  fallbackNodes: DirectoryNode[]
  onClose: () => void
  onPick: (path: string) => void
}) {
  const [currentPath, setCurrentPath] = useState(initialPath || root)
  const directoryQuery = useQuery({
    queryKey: ['directories', currentPath],
    queryFn: () => api.directories(currentPath, 1),
    enabled: Boolean(currentPath),
  })
  const items = directoryQuery.data?.items ?? (currentPath === root ? fallbackNodes : [])
  const canGoUp = currentPath !== '/'
  const parentPath = canGoUp ? currentPath.slice(0, currentPath.lastIndexOf('/')) || '/' : '/'

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="directoryModal">
        <div className="directoryModalHead">
          <div>
            <strong>选择视频目录</strong>
            <span>容器路径：{currentPath}</span>
          </div>
          <button className="iconAction" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="directoryHint">
          这里浏览 Docker 容器文件系统。Windows 目录需要先在 compose 里挂载成容器路径，例如 `/video1`。
        </div>
        {currentValue && (
          <button className="currentPathButton" onClick={() => onPick(currentValue)}>
            当前已选：{currentValue}
          </button>
        )}
        <div className="directoryCrumbs">
          <button onClick={() => setCurrentPath('/')}>容器根 /</button>
          {canGoUp && <button onClick={() => setCurrentPath(parentPath)}>上一级</button>}
        </div>
        <div className="directoryBrowser">
          {directoryQuery.isFetching ? (
            <div className="directoryEmpty">正在读取目录...</div>
          ) : items.length ? (
            items.map((node) => (
              <button key={node.path} onClick={() => setCurrentPath(node.path)} disabled={!node.readable} title={node.path}>
                <FolderOpen size={16} />
                <span>{node.name}</span>
                <em>{node.path}</em>
                <small>{node.hasChildren ? '可展开' : '空目录'}</small>
              </button>
            ))
          ) : (
            <div className="directoryEmpty">当前目录没有子目录，可以直接使用当前目录。</div>
          )}
        </div>
        <div className="directoryModalActions">
          <button className="ghostAction" onClick={onClose}>取消</button>
          <button className="blueAction" onClick={() => onPick(currentPath)} disabled={!currentPath}>
            使用此容器路径
          </button>
        </div>
      </div>
    </div>
  )
}

export function PathPicker({
  value,
  root,
  nodes,
  onChange,
}: {
  value: string
  root: string
  nodes: DirectoryNode[]
  onChange: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pathPicker">
      <input className="field" value={value} placeholder="选择 Docker 视频目录，例如 /video1" readOnly />
      <button className="pathBrowseButton" type="button" onClick={() => setOpen(true)}>
        <FolderOpen size={15} />
        选择目录
      </button>
      {open && (
        <DirectoryPickerModal
          currentValue={value}
          initialPath={root || '/'}
          root={root || '/'}
          fallbackNodes={nodes}
          onClose={() => setOpen(false)}
          onPick={(path) => {
            onChange(path)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
