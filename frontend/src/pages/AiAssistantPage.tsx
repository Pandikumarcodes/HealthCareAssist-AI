import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/layout/Icon";
import { ChatTurn } from "../features/ai-assistant/ChatTurn";
import type { ChatTurnData } from "../features/ai-assistant/ChatTurn";
import { useAskAssistant } from "../features/ai-assistant/queries";
import {
  aiErrorMessage,
  MAX_QUESTION_CHARACTERS,
  questionError,
  questionLength,
} from "../services/ai";
import "../features/requests/requests.css";
import "../features/ai-assistant/ai-assistant.css";

export function AiAssistantPage() {
  const [question, setQuestion] = useState("");
  const [touched, setTouched] = useState(false);
  const [turns, setTurns] = useState<ChatTurnData[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const mutation = useAskAssistant();
  const validation = questionError(question);
  const showValidation = !!validation && (touched || !!question);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (followLatest.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns]);

  async function submit() {
    if (controller.current || mutation.isPending) return;
    setTouched(true);
    if (validation) return;
    const request = new AbortController();
    controller.current = request;
    const id = ++nextId.current;
    const submitted = question.trim();
    followLatest.current = true;
    setTurns((current) => [...current, { id, question: submitted }]);
    setAnnouncement("Preparing an answer from your documents.");
    // A deliberate submit keeps keyboard focus in the composer.
    input.current?.focus();
    try {
      const response = await mutation.mutateAsync({
        question: submitted,
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, response } : turn)),
      );
      setQuestion("");
      setTouched(false);
      setAnnouncement(
        response.grounded
          ? `Answer ready. ${response.sources.length} sources available.`
          : "No supported answer found. Review the response and Knowledge Base.",
      );
    } catch (error) {
      if (request.signal.aborted) return;
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, error: aiErrorMessage(error) } : turn,
        ),
      );
      setAnnouncement("");
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  return (
    <>
      <div className="dashboard-heading ai-heading">
        <div>
          <p className="dashboard-eyebrow">Answers with a source</p>
          <h1>AI Assistant</h1>
          <p>
            Ask about your uploaded documents and explore the sources behind
            each answer.
          </p>
        </div>
        <Link className="text-link" to="/knowledge-base">
          <Icon name="book" /> Knowledge Base
        </Link>
      </div>
      <section
        className="dashboard-panel ai-chat"
        aria-labelledby="ai-conversation-heading"
      >
        <div className="panel-heading">
          <h2 id="ai-conversation-heading">
            <Icon name="sparkles" /> Document assistant
          </h2>
          <button
            className="request-secondary"
            type="button"
            disabled={mutation.isPending || turns.length === 0}
            onClick={() => {
              if (controller.current) return;
              setTurns([]);
              setQuestion("");
              setTouched(false);
              mutation.reset();
              setAnnouncement("Chat cleared.");
              input.current?.focus();
            }}
          >
            Clear chat
          </button>
        </div>
        <div
          className="ai-transcript"
          ref={transcript}
          role="region"
          aria-label="Conversation"
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              48;
          }}
        >
          {turns.length === 0 ? (
            <div className="ai-welcome empty-state">
              <span className="overview-symbol">
                <Icon name="sparkles" />
              </span>
              <h3>What would you like to find?</h3>
              <p>
                Ask a question about fictional policies uploaded to your
                Knowledge Base. Answers use supporting passages from those
                documents.
              </p>
              <div className="ai-example">
                <span>Try a question like</span>
                <p>What documents does the fictional claims policy require?</p>
              </div>
              <p>
                Each question is independent. Include the details you need in
                every question.
              </p>
            </div>
          ) : (
            <ol className="ai-turns">
              {turns.map((turn) => (
                <ChatTurn key={turn.id} turn={turn} />
              ))}
            </ol>
          )}
        </div>
        <p className="request-announcement" role="status" aria-atomic="true">
          {announcement}
        </p>
        <form
          className="ai-composer"
          aria-label="Ask the AI Assistant"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="request-field">
            <label htmlFor="ai-question">Your question</label>
            <textarea
              id="ai-question"
              ref={input}
              rows={3}
              value={question}
              readOnly={mutation.isPending}
              placeholder="Ask about your uploaded fictional documents..."
              aria-invalid={showValidation}
              aria-describedby={`ai-question-help${showValidation ? " ai-question-error" : ""}`}
              onBlur={() => setTouched(true)}
              onChange={(event) => {
                setQuestion(event.target.value);
                setTouched(false);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <p id="ai-question-help">
              Enter to send. Shift+Enter for a new line. Up to{" "}
              {MAX_QUESTION_CHARACTERS} characters.
            </p>
            {showValidation && (
              <p id="ai-question-error" className="field-error">
                {validation}
              </p>
            )}
          </div>
          <div className="ai-composer-actions">
            <p>
              Fictional information only. Do not enter real patient details.
            </p>
            <div>
              <span className="ai-count">
                {questionLength(question)} / {MAX_QUESTION_CHARACTERS}
              </span>
              <button
                className="dashboard-button"
                type="submit"
                disabled={!!validation || mutation.isPending}
              >
                {mutation.isPending ? "Preparing answer..." : "Send question"}
                <Icon name="arrow" />
              </button>
            </div>
          </div>
        </form>
      </section>
      <p className="ai-footnote">
        Review the cited documents for full context. This assistant helps
        navigate documents and does not provide medical advice.
      </p>
    </>
  );
}
