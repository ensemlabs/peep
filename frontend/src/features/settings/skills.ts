import { ApiError } from '@/api/client'
import type { TFn } from '@/i18n'
import { errorMessage } from '@/i18n'

export interface SkillUploadError {
  message: string
  /** 409 skill_exists: the user may retry with ?replace=true. */
  canReplace: boolean
}

/** Map an upload failure to a translated message; never shows raw backend text. */
export function skillUploadError(e: unknown, t: TFn): SkillUploadError {
  const exists = e instanceof ApiError && (e.code === 'skill_exists' || e.status === 409)
  if (exists) return { message: t('error.skill_exists'), canReplace: true }
  if (e instanceof ApiError && (e.code === 'invalid_skill' || e.status === 422)) {
    return { message: t('error.invalid_skill'), canReplace: false }
  }
  return { message: errorMessage(e, t), canReplace: false }
}

/** Drop the YAML frontmatter so SKILL.md renders as plain markdown. */
export function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}
