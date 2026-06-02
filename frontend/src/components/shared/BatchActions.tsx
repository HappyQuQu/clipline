import { useState } from 'react'
import type { DisplaySegment } from '../../utils'

export function BatchActions({
  segments,
  onBatchTranscribe,
}: {
  segments: DisplaySegment[]
  onBatchTranscribe: (segmentIds: string[]) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  function selectAll() {
    setSelectedIds(new Set(segments.map((s) => s.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  if (segments.length === 0) return null

  return (
    <div className="batchActions">
      <div className="batchActionsLeft">
        <button className="batchSelectAll" onClick={selectAll}>
          全选
        </button>
        <button className="batchClear" onClick={clearSelection}>
          清除
        </button>
        <span className="batchCount">
          已选择 {selectedIds.size} / {segments.length} 个片段
        </span>
      </div>
      {selectedIds.size > 0 && (
        <div className="batchActionsRight">
          <button
            className="batchTranscribe"
            onClick={() => {
              onBatchTranscribe(Array.from(selectedIds))
              clearSelection()
            }}
          >
            🔍 批量识别语音
          </button>
        </div>
      )}
    </div>
  )
}
