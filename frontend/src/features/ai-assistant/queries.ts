import { useMutation } from '@tanstack/react-query'
import { askAssistant } from '../../services/ai'
import type { AiQuestion } from '../../services/ai'

export function useAskAssistant() {
  return useMutation({
    mutationFn: ({ question, signal }: AiQuestion & { signal: AbortSignal }) => askAssistant({ question }, signal),
    retry: false,
    // Conversation belongs to the mounted page, not the global query cache.
    gcTime: 0,
  })
}
