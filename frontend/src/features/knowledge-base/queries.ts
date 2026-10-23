import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../services/api'
import { deleteDocument, getDocument, uploadDocument } from '../../services/documents'
import type { DocumentUpload } from '../../services/documents'

export const documentKeys = {
  lists: ['documents', 'list'] as const,
  list: (page: number) => ['documents', 'list', { page, page_size: 20 }] as const,
  searches: ['documents', 'search'] as const,
  search: (q: string, limit: number) => ['documents', 'search', { q, limit }] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
}
export function useDocument(id: string) {
  return useQuery({ queryKey: documentKeys.detail(id), queryFn: ({ signal }) => getDocument(id, signal), retry: false })
}
export function useDocumentMutations() {
  const client = useQueryClient()
  const refreshCollections = async () => {
    await Promise.all([client.cancelQueries({ queryKey: documentKeys.lists }), client.cancelQueries({ queryKey: documentKeys.searches })])
    // Reset also removes stale passages from inactive caches and after refetch
    // errors. A deleted excerpt must never remain on screen as successful data.
    await Promise.all([client.resetQueries({ queryKey: documentKeys.lists }), client.resetQueries({ queryKey: documentKeys.searches })])
  }
  const refreshDeleted = async (id: string) => {
    await client.cancelQueries({ queryKey: documentKeys.detail(id), exact: true })
    client.removeQueries({ queryKey: documentKeys.detail(id), exact: true })
    await refreshCollections()
  }
  const upload = useMutation({
    mutationFn: (input: DocumentUpload) => uploadDocument(input), retry: false,
    onSuccess: async (item) => {
      const key = documentKeys.detail(String(item.id))
      await client.cancelQueries({ queryKey: key, exact: true })
      client.setQueryData(key, item)
      await refreshCollections()
    },
    // A connection loss can occur after a successful commit: refresh the list,
    // but never retry POST automatically or present failure as definite rollback.
    onError: refreshCollections,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteDocument(id), retry: false,
    onSuccess: (_data, id) => refreshDeleted(id),
    onError: async (error, id) => { if (error instanceof ApiError && error.status === 404) await refreshDeleted(id) },
  })
  return { upload, remove }
}
