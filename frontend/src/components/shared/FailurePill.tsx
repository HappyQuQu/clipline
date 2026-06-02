import { AlertTriangle } from 'lucide-react'
import type { Segment } from '../../types'

export function FailurePill({ segments }: { segments: Segment[] }) {
  return (
    <div className="failurePill" title={segments[0]?.errorMessage ?? '扫描失败'}>
      <AlertTriangle size={15} />
      {segments.length} 个问题
    </div>
  )
}
