import { Link } from 'react-router-dom'
import { Icon } from '../../components/layout/Icon'
import type { AiAnswer } from '../../services/ai'

export interface ChatTurnData { id: number; question: string; response?: AiAnswer; error?: string }

export function ChatTurn({ turn }: { turn: ChatTurnData }) {
  return <li className="ai-turn">
    <article className="ai-message ai-user" aria-label="Your question">
      <h3>You</h3><p className="ai-message-text">{turn.question}</p>
    </article>
    <article className="ai-message ai-assistant" aria-label={turn.error ? 'Request failed' : 'Assistant response'}>
      <h3><Icon name="sparkles" /> AI Assistant</h3>
      {turn.error ? <div className="ai-error" role="alert"><strong>Unable to answer</strong><p>{turn.error}</p><p>You can edit or resend your question using the composer.</p></div> : turn.response ? <>
        <p className={`ai-result-label${turn.response.grounded ? '' : ' ai-no-context'}`}>{turn.response.grounded ? 'Based on uploaded documents' : 'No supported answer'}</p>
        <p className="ai-message-text">{turn.response.answer}</p>
        {!turn.response.grounded && <p className="ai-context-help">Review or upload relevant fictional documents in the <Link className="text-link" to="/knowledge-base">Knowledge Base</Link>, then ask again.</p>}
        {turn.response.sources.length > 0 && <section className="ai-sources" aria-label="Answer sources">
          <h4><Icon name="book" /> Sources</h4>
          <ol>{turn.response.sources.map((source) => <li key={source.chunk_id}>
            <Link to={`/knowledge-base/${source.document_id}`}>{source.document_title}</Link>
            <span>Page {source.page_number}</span>
          </li>)}</ol>
          <p>Links open document details.</p>
        </section>}
      </> : <p className="ai-pending"><span className="loading-spinner" aria-hidden="true" />Preparing an answer from your documents...</p>}
    </article>
  </li>
}
