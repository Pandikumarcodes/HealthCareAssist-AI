import { useLayoutEffect, useRef } from 'react'
import { ApiError } from '../../services/api'
import type { DocumentMetadata } from '../../services/documents'

export function DeleteDocumentDialog({ item, pending, error, onCancel, onDelete }: {
  item: DocumentMetadata; pending: boolean; error: unknown; onCancel: () => void; onDelete: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const missing = error instanceof ApiError && error.status === 404
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    return () => { element.close(); (previous?.isConnected ? previous : document.getElementById('dashboard-main'))?.focus() }
  }, [])
  return <dialog ref={dialog} tabIndex={-1} className="request-dialog" aria-labelledby="delete-document-title" aria-describedby="delete-document-description" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel() }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const first = controls[0], last = controls[controls.length - 1]
    if (!first) { event.preventDefault(); dialog.current?.focus() }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}>
    <h2 id="delete-document-title">Delete document #{item.id}?</h2><p className="delete-request-title">{item.title}</p>
    <p id="delete-document-description">This permanently removes the stored PDF and its indexed text. This action cannot be undone.</p>
    {!!error && <p role="alert" className="field-error">{missing ? 'This document was already deleted. Close this dialog to continue.' : 'Unable to delete document. Check your connection and try again.'}</p>}
    <div className="request-actions"><button type="button" className="request-secondary" autoFocus disabled={pending} onClick={onCancel}>{missing ? 'Close' : 'Cancel'}</button><button type="button" className="request-danger" disabled={pending || missing} onClick={onDelete}>{pending ? 'Deleting…' : 'Delete document'}</button></div>
    <p role="status" className="kb-help">{pending ? 'Deleting document and indexed text…' : ''}</p>
  </dialog>
}
