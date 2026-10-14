import type { ScanJob } from '../../types'
import { scanStatusLabel } from '../../utils'

export function ScanProgress({ job }: { job?: ScanJob }) {
  if (!job) {
    return (
      <div className="scanProgress idle">
        <span>未扫描</span>
        <div className="progressTrack">
          <i style={{ width: '0%' }} />
        </div>
      </div>
    )
  }
  const total = job.totalFiles || job.scannedFiles || 0
  const progress = total > 0 ? Math.min(100, Math.round((job.scannedFiles / total) * 100)) : job.status === 'completed' ? 100 : 0
  return (
    <div className={`scanProgress ${job.status}`}>
      <span>
        {scanStatusLabel(job.status)} · {job.scannedFiles}/{total || '-'}
      </span>
      <div className="progressTrack">
        <i style={{ width: `${progress}%` }} />
      </div>
      <small>{job.indexedFiles} 入库 · {job.failedFiles} 错误</small>
    </div>
  )
}
