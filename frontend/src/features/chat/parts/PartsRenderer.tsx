import type { Part } from '@/api/types'
import { Markdown } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCard } from './ToolCard'
import { SubagentCard } from './SubagentCard'
import { MediaGrid } from '../../media/MediaGrid'

export function PartsRenderer({ parts, live }: { parts: Part[]; live: boolean }) {
  return (
    <>
      {parts.map((part) => {
        switch (part.type) {
          case 'thinking':
            return <ThinkingBlock key={part.id} part={part} live={live} />
          case 'text':
            return part.text ? <Markdown key={part.id} text={part.text} streaming={live} /> : null
          case 'tool':
            return <ToolCard key={part.id} part={part} live={live} />
          case 'subagent':
            return <SubagentCard key={part.id} part={part} live={live} />
          case 'files':
            return <MediaGrid key={part.id} files={part.files} />
          default:
            return null
        }
      })}
    </>
  )
}
