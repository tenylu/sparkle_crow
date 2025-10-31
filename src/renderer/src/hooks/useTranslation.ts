import { useAppStore } from '../stores/useAppStore'
import { t } from '../utils/i18n'

export function useTranslation() {
  const language = useAppStore((state) => state.language)
  
  return (key: keyof typeof import('../utils/i18n').translations.zh) => t(language, key)
}

