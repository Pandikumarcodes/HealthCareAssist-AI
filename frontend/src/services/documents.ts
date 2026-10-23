import { apiGet, apiRequest } from './api'

export const processingOutcomes = {
  UNPROCESSED: { label: 'Not processed', description: 'This document has not been indexed for content search.' },
  INDEXED: { label: 'Searchable', description: 'Selectable text is indexed and ready for content search.' },
  NO_TEXT: { label: 'No selectable text', description: 'No selectable text was found. Scanned PDFs require OCR, which is not supported.' },
  FAILED: { label: 'Processing failed', description: 'Text processing failed or exceeded a processing limit. The document is still available to manage.' },
} as const
export type ProcessingStatus = keyof typeof processingOutcomes
export interface DocumentMetadata {
  id: number
  title: string
  original_filename: string
  file_size: number
  content_type: 'application/pdf'
  created_at: string
  processing_status: ProcessingStatus
}
export interface DocumentParameters { page: number; page_size: number }
export interface DocumentListResponse extends DocumentParameters {
  data: DocumentMetadata[]; total: number; total_pages: number
}
export interface DocumentUpload { file: File; title?: string }
export interface SearchPassage {
  document_id: number; document_title: string; chunk_id: number; page_number: number; text: string; score: number
}
export interface DocumentSearchResponse { query: string; results: SearchPassage[] }
export const MAX_PDF_BYTES = 5 * 1024 * 1024
export const hasControlCharacters = (value: string) => Array.from(value).some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127)
export function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positive = (value: unknown): value is number => count(value) && value > 0
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const invalid = (): never => { throw new Error('Unexpected document API response') }

function documentMetadata(value: unknown): DocumentMetadata {
  if (!object(value) || !positive(value.id) || !text(value.title) || !text(value.original_filename) ||
    (value.original_filename.includes('/') || value.original_filename.includes('\\') || value.original_filename.includes(':')) || hasControlCharacters(value.original_filename) ||
    !positive(value.file_size) || value.file_size > MAX_PDF_BYTES || value.content_type !== 'application/pdf' ||
    typeof value.created_at !== 'string' || !value.created_at.endsWith('Z') || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.processing_status !== 'string' || !Object.hasOwn(processingOutcomes, value.processing_status)) return invalid()
  // Project safe fields rather than retaining unexpected server/storage fields.
  return { id: value.id, title: value.title, original_filename: value.original_filename,
    file_size: value.file_size, content_type: value.content_type, created_at: value.created_at,
    processing_status: value.processing_status as ProcessingStatus }
}
function unwrapDocument(body: unknown): DocumentMetadata {
  return object(body) ? documentMetadata(body.data) : invalid()
}
export async function getDocuments(parameters: DocumentParameters, signal?: AbortSignal): Promise<DocumentListResponse> {
  const query = new URLSearchParams({ page: String(parameters.page), page_size: String(parameters.page_size) })
  const body = await apiGet(`/api/documents?${query}`, signal)
  if (!object(body) || !Array.isArray(body.data) || body.page !== parameters.page || body.page_size !== parameters.page_size ||
    !positive(body.page) || !positive(body.page_size) || body.page_size > 100 || !count(body.total) || !count(body.total_pages) ||
    body.total_pages !== Math.ceil(body.total / body.page_size) ||
    body.data.length !== Math.min(body.page_size, Math.max(0, body.total - (body.page - 1) * body.page_size))) return invalid()
  return { data: body.data.map(documentMetadata), page: body.page, page_size: body.page_size, total: body.total, total_pages: body.total_pages }
}
export async function getDocument(id: string, signal?: AbortSignal): Promise<DocumentMetadata> {
  return unwrapDocument(await apiGet(`/api/documents/${encodeURIComponent(id)}`, signal))
}
export async function uploadDocument({ file, title }: DocumentUpload): Promise<DocumentMetadata> {
  const body = new FormData()
  body.append('file', file)
  if (title?.trim()) body.append('title', title.trim())
  // Flask performs bounded synchronous validation/extraction before responding.
  return unwrapDocument(await apiRequest('/api/documents', { method: 'POST', body, timeoutMs: 30000 }))
}
export async function deleteDocument(id: string): Promise<void> {
  await apiRequest(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function searchDocuments(query: string, limit: number, signal?: AbortSignal): Promise<DocumentSearchResponse> {
  const q = query.trim()
  const body = await apiGet(`/api/documents/search?${new URLSearchParams({ q, limit: String(limit) })}`, signal)
  if (!object(body) || body.query !== q || !Array.isArray(body.results) || body.results.length > limit) return invalid()
  const results: SearchPassage[] = body.results.map((value: unknown) => {
    if (!object(value) || !positive(value.document_id) || !text(value.document_title) || !positive(value.chunk_id) ||
      !positive(value.page_number) || !text(value.text) || Array.from(value.text).length > 1200 ||
      typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) return invalid()
    return { document_id: value.document_id, document_title: value.document_title, chunk_id: value.chunk_id,
      page_number: value.page_number, text: value.text, score: value.score }
  })
  if (new Set(results.map((result) => result.chunk_id)).size !== results.length) return invalid()
  return { query: q, results }
}
