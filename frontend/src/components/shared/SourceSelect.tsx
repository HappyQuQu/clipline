import * as Select from '@radix-ui/react-select'
import { Camera, ChevronDown } from 'lucide-react'
import type { Source } from '../../types'

export function SourceSelect({
  sources,
  value,
  onChange,
}: {
  sources: Source[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={!sources.length}>
      <Select.Trigger className="selectTrigger" aria-label="选择源">
        <Camera size={16} />
        <Select.Value placeholder="选择源" />
        <Select.Icon className="selectIcon">
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="selectContent" position="popper" sideOffset={6}>
          <Select.Viewport>
            {sources.map((source) => (
              <Select.Item className="selectItem" key={source.id} value={source.id}>
                <Select.ItemText>{source.name}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
