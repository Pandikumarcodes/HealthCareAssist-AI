import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRequest, deleteRequest, getRequest, updateRequest } from '../../services/requests'
import type { RequestInput, RequestUpdate, SupportRequest } from '../../services/requests'

export const requestKeys = {
  lists: ['requests'] as const,
  detail: (id: string) => ['request', id] as const,
  summary: ['dashboard', 'summary'] as const,
}

export function useRequest(id: string, enabled = true) {
  return useQuery({ queryKey: requestKeys.detail(id), queryFn: ({ signal }) => getRequest(id, signal), enabled })
}

export function useRequestMutations(id?: string) {
  const client = useQueryClient()
  const refresh = async (item: SupportRequest) => {
    const key = requestKeys.detail(String(item.id))
    // Cancel an older GET before installing the committed mutation response.
    await client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData(key, item)
    // Refresh cached destinations before navigation, including inactive lists.
    await Promise.all([
      client.invalidateQueries({ queryKey: requestKeys.lists, refetchType: 'all' }),
      client.invalidateQueries({ queryKey: key, exact: true }),
      client.invalidateQueries({ queryKey: requestKeys.summary, exact: true, refetchType: 'all' }),
    ])
  }
  const create = useMutation({ mutationFn: (input: RequestInput) => createRequest(input), onSuccess: refresh })
  const update = useMutation({ mutationFn: (input: RequestUpdate) => updateRequest(id!, input), onSuccess: refresh })
  const remove = useMutation({
    mutationFn: () => deleteRequest(id!),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: requestKeys.detail(id!), exact: true })
      await Promise.all([
        client.invalidateQueries({ queryKey: requestKeys.lists, refetchType: 'all' }),
        client.invalidateQueries({ queryKey: requestKeys.summary, exact: true, refetchType: 'all' }),
      ])
      client.removeQueries({ queryKey: requestKeys.detail(id!), exact: true })
    },
  })
  return { create, update, remove }
}
