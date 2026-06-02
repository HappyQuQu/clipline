import * as ToggleGroup from '@radix-ui/react-toggle-group'

export function ExportMode({
  value,
  onChange,
}: {
  value: 'fast' | 'accurate'
  onChange: (value: 'fast' | 'accurate') => void
}) {
  return (
    <ToggleGroup.Root
      className="toggleGroup"
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === 'fast' || next === 'accurate') onChange(next)
      }}
    >
      <ToggleGroup.Item className="toggleItem" value="fast" title="快速：不重新编码，导出更快，边界可能贴近关键帧而不是逐帧精确">
        快速
      </ToggleGroup.Item>
      <ToggleGroup.Item className="toggleItem" value="accurate" title="精准：重新编码，起止时间更准，但导出更慢、文件可能重新压缩">
        精准
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  )
}
