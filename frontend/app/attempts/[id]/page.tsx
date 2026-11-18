"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import Shell from "@/components/Shell";
import {
  api,
  Attempt,
  audienceNames,
  busyStatuses,
  dateText,
  errorText,
  jsonRequest,
} from "@/components/api";

const progressMessages: Record<string, string> = {
  queued: "Your pitch is in the listening queue.",
  transcribing: "Turning your recording into a transcript.",
  listening: "Your listener is forming its first impression.",
  reviewing: "Checking the passages behind that impression.",
};

export default function AttemptPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [previous, setPrevious] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [intended, setIntended] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [comparePrevious, setComparePrevious] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const initializedId = useRef("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await api<Attempt>(`/attempts/${params.id}`);
        if (!alive) return;
        setAttempt(data);
        if (initializedId.current !== data.id) {
          setIntended((data.intent || []).join("\n"));
          initializedId.current = data.id;
          if (data.parent_id)
            api<Attempt>(`/attempts/${data.parent_id}`)
              .then((parent) => {
                if (alive) setPrevious(parent);
              })
              .catch(() => {});
        }
      } catch (error) {
        if (alive) setError(errorText(error));
      }
      if (alive) timer = setTimeout(refresh, 2500);
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [params.id]);

  async function analyze() {
    setActionBusy(true);
    setError("");
    try {
      setAttempt(
        await api<Attempt>(
          `/attempts/${params.id}/analyze`,
          jsonRequest("POST"),
        ),
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function compare(event: React.FormEvent) {
    event.preventDefault();
    setActionBusy(true);
    setError("");
    try {
      const takeaways = intended
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!takeaways.length || takeaways.length > 5)
        throw new Error(
          "Add one to five takeaways, with each on its own line.",
        );
      await api(
        `/attempts/${params.id}/intended-takeaways`,
        jsonRequest("PUT", { takeaways }),
      );
      setAttempt(
        await api<Attempt>(
          `/attempts/${params.id}/compare`,
          jsonRequest("POST"),
        ),
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function remove() {
    setActionBusy(true);
    setError("");
    try {
      await api(`/attempts/${params.id}`, { method: "DELETE" });
      router.push("/history");
    } catch (error) {
      setError(errorText(error));
      setActionBusy(false);
    }
  }

  function showSources(ids: string[]) {
    setTranscriptOpen(true);
    setHighlight(ids);
    setTimeout(
      () =>
        document
          .getElementById(
            ids.length ? `segment-${ids[0]}` : "transcript-section",
          )
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
  }

  function sources(ids: string[]) {
    return ids.length ? (
      <button className="source-button" onClick={() => showSources(ids)}>
        <FileText size={12} />
        View passage{ids.length > 1 ? "s" : ""}
        <ChevronRight size={12} />
      </button>
    ) : null;
  }

  const report = attempt?.listener;
  const running = !!attempt && busyStatuses.includes(attempt.status);
  const comparing =
    !!attempt && ["queued", "running"].includes(attempt.comparison_status);

  return (
    <Shell>
      <div className="page-container report-container">
        <Link href="/history" className="back-link">
          <ArrowLeft size={15} />
          All pitches
        </Link>
        {!attempt ? (
          <div className="loading-page">{error || "Opening your pitch…"}</div>
        ) : (
          <>
            <div className="report-heading">
              <div>
                <div className="eyebrow">
                  {attempt.status === "ready"
                    ? "YOUR LISTENER’S FIRST IMPRESSION"
                    : "YOUR PITCH"}
                </div>
                <h1>{attempt.title}</h1>
                <div className="report-meta">
                  <span>
                    <Users size={14} />
                    {audienceNames[attempt.audience]}
                  </span>
                  <span>{dateText(attempt.created_at)}</span>
                  <span className={`status-label status-${attempt.status}`}>
                    {attempt.status === "ready"
                      ? "Feedback ready"
                      : attempt.status}
                  </span>
                </div>
              </div>
              <Link
                href={`/?revise=${attempt.id}`}
                className="button secondary"
              >
                <RefreshCw size={15} />
                Try a revision
              </Link>
            </div>
            {error && (
              <p role="alert" className="error-message">
                {error}
                <button className="text-button" onClick={() => setError("")}>
                  Dismiss
                </button>
              </p>
            )}
            {attempt.status === "draft" && (
              <section className="start-card">
                <span className="mic-orb">
                  <AudioLines size={28} />
                </span>
                <div>
                  <h2>Your pitch is saved.</h2>
                  <p>
                    Ready for a fresh perspective? Generate your listener’s
                    first impression.
                  </p>
                  <button
                    className="button primary"
                    disabled={actionBusy}
                    onClick={analyze}
                  >
                    {actionBusy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                    Get listener feedback
                  </button>
                </div>
              </section>
            )}
            {running && (
              <div className="processing-card" role="status">
                <LoaderCircle className="spin" size={21} />
                <div>
                  <strong>{progressMessages[attempt.status]}</strong>
                  <p>
                    You can return to this saved attempt while it processes.
                  </p>
                </div>
              </div>
            )}
            {attempt.status === "failed" && (
              <div className="error-message">
                <strong>
                  {report
                    ? "Your first impression is saved. The evidence check needs another try."
                    : "This attempt needs another try."}
                </strong>
                <p>{attempt.error}</p>
                <button
                  className="button secondary"
                  disabled={actionBusy}
                  onClick={analyze}
                >
                  <RefreshCw size={15} />
                  Retry processing
                </button>
              </div>
            )}
            {report && (
              <>
                <section className="mental-picture">
                  <div className="mental-picture-label">
                    <AudioLines size={19} />
                    <span>THE PICTURE I FORMED</span>
                  </div>
                  <p className="mental-picture-text">{report.mental_picture}</p>
                  <div className="takeaway">
                    <span>What I’d tell a colleague</span>
                    <p>{report.main_takeaway}</p>
                  </div>
                </section>
                {!!attempt.evidence?.narrative_flags?.length && (
                  <section className="report-card narrative-flags">
                    <h2>Evidence notes on this impression</h2>
                    {attempt.evidence.narrative_flags.map((flag, index) => (
                      <div key={index}>
                        <blockquote>{flag.passage}</blockquote>
                        <p>{flag.explanation}</p>
                        {sources(flag.source_segment_ids)}
                      </div>
                    ))}
                  </section>
                )}
                {previous?.listener && (
                  <div className="revision-comparison">
                    <button
                      className="text-button"
                      onClick={() => setComparePrevious(!comparePrevious)}
                    >
                      <RefreshCw size={15} />
                      {comparePrevious
                        ? "Hide earlier impression"
                        : "Compare with the earlier impression"}
                      <ChevronDown size={15} />
                    </button>
                    {comparePrevious && (
                      <div className="previous-impression">
                        <Link href={`/attempts/${previous.id}`}>
                          {previous.title}
                          <ArrowRight size={14} />
                        </Link>
                        <p>{previous.listener.mental_picture}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="report-columns">
                  <section className="report-card">
                    <div className="section-heading">
                      <h2>What I assumed</h2>
                      <span className="count-label">
                        {report.assumptions.length}
                      </span>
                    </div>
                    {report.assumptions.length ? (
                      report.assumptions.map((item, index) => (
                        <div className="insight" key={index}>
                          <span className="insight-dot" />
                          <div>
                            <p>{item.assumption}</p>
                            {sources(item.trigger_segment_ids)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted empty-insight">
                        The listener reported no material assumptions.
                      </p>
                    )}
                  </section>
                  <section className="report-card">
                    <div className="section-heading">
                      <h2>What remained unclear</h2>
                      <span className="count-label">
                        {report.uncertainties.length}
                      </span>
                    </div>
                    {report.uncertainties.length ? (
                      report.uncertainties.map((item, index) => (
                        <div className="uncertainty" key={index}>
                          <h3>{item.question}</h3>
                          {item.possible_interpretations.length > 0 && (
                            <ul>
                              {item.possible_interpretations.map(
                                (interpretation, i) => (
                                  <li key={i}>{interpretation}</li>
                                ),
                              )}
                            </ul>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="muted empty-insight">
                        The listener reported no material ambiguity.
                      </p>
                    )}
                  </section>
                </div>
                <section className="first-question">
                  <MessageCircle size={23} />
                  <div>
                    <span>THE FIRST QUESTION I’D ASK</span>
                    <p>{report.first_question}</p>
                  </div>
                </section>
                <section className="report-card beliefs-card">
                  <div className="section-heading">
                    <h2>How I understood it</h2>
                    <span className="small muted">Linked to your words</span>
                  </div>
                  {report.beliefs.map((belief, index) => {
                    const annotation = attempt.evidence?.annotations.find(
                      (item) => item.belief_index === index,
                    );
                    return (
                      <div className="belief" key={index}>
                        <div>
                          <span className="belief-topic">
                            {belief.topic.replaceAll("_", " ")}
                          </span>
                          <span className={`basis basis-${belief.basis}`}>
                            {belief.basis}
                          </span>
                        </div>
                        <p>{belief.interpretation}</p>
                        {sources(belief.source_segment_ids)}
                        {annotation && (
                          <details className="evidence-detail">
                            <summary>
                              Evidence review · {annotation.assessment}
                              <ChevronDown size={13} />
                            </summary>
                            <p>{annotation.explanation}</p>
                            {sources(annotation.source_segment_ids)}
                          </details>
                        )}
                      </div>
                    );
                  })}
                </section>
                <section className="intent-card">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">CHECK WHAT LANDED</div>
                      <h2>Is that what you meant?</h2>
                    </div>
                    <span className="outline-icon">
                      <Check size={21} />
                    </span>
                  </div>
                  <p>
                    Add the ideas you wanted your audience to take away. We’ll
                    compare them with the first impression already saved above.
                  </p>
                  <form onSubmit={compare}>
                    <label className="field-label" htmlFor="intended">
                      Your intended takeaways
                    </label>
                    <textarea
                      id="intended"
                      value={intended}
                      onChange={(event) => setIntended(event.target.value)}
                      disabled={comparing}
                      required
                      placeholder={
                        "One takeaway per line, up to five.\nFor example, who the product is for and how a customer uses it."
                      }
                      maxLength={3004}
                    />
                    <div className="intent-submit">
                      <span className="small muted">
                        The first impression stays saved.
                      </span>
                      <button
                        className="button primary"
                        disabled={actionBusy || comparing}
                      >
                        {comparing ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <ArrowRight size={16} />
                        )}
                        {comparing
                          ? "Comparing takeaways…"
                          : "Compare understanding"}
                      </button>
                    </div>
                  </form>
                  {attempt.comparison_error && (
                    <p role="alert" className="error-message">
                      {attempt.comparison_error}
                    </p>
                  )}
                  {attempt.comparison && (
                    <div className="comparison-results">
                      {attempt.comparison.items.map((item) => (
                        <article
                          key={item.takeaway_index}
                          className="comparison-item"
                        >
                          <div>
                            <h3>{attempt.intent[item.takeaway_index]}</h3>
                            <span
                              className={`alignment alignment-${item.alignment}`}
                            >
                              {item.alignment}
                            </span>
                          </div>
                          <p>
                            <strong>The listener understood</strong>{" "}
                            {item.listener_interpretation}
                          </p>
                          {item.gap && <p>{item.gap}</p>}
                          {item.suggested_clarification && (
                            <div className="clarification">
                              <strong>A clarification to try</strong>
                              <p>{item.suggested_clarification}</p>
                            </div>
                          )}
                          {sources(item.source_segment_ids)}
                        </article>
                      ))}
                      {attempt.comparison.priority_changes.length > 0 && (
                        <div className="priorities">
                          <h3>Start with these changes</h3>
                          <ol>
                            {attempt.comparison.priority_changes.map(
                              (change, index) => (
                                <li key={index}>{change}</li>
                              ),
                            )}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
            <section className="transcript-section" id="transcript-section">
              <button
                className="transcript-toggle"
                aria-expanded={transcriptOpen}
                onClick={() => setTranscriptOpen(!transcriptOpen)}
              >
                <FileText size={17} />
                <span>Your original pitch</span>
                <ChevronDown
                  size={17}
                  className={transcriptOpen ? "rotated" : ""}
                />
              </button>
              {transcriptOpen && (
                <div className="transcript-body">
                  {attempt.input_type === "audio" && (
                    <>
                      <audio
                        controls
                        src={`/api/attempts/${attempt.id}/audio`}
                        className="audio-player"
                      />
                      <p className="small muted">
                        Passages are linked to the transcript. Audio playback
                        covers the full recording.
                      </p>
                    </>
                  )}
                  {attempt.segments ? (
                    attempt.segments.map((segment) => (
                      <p
                        id={`segment-${segment.id}`}
                        className={
                          highlight.includes(segment.id)
                            ? "highlighted-segment"
                            : ""
                        }
                        key={segment.id}
                      >
                        <span>{segment.id}</span>
                        {segment.text}
                      </p>
                    ))
                  ) : (
                    <p>
                      {attempt.transcript ||
                        "The transcript will appear after your recording is processed."}
                    </p>
                  )}
                  <Link className="text-button" href={`/?revise=${attempt.id}`}>
                    Edit as a new attempt
                    <ArrowRight size={14} />
                  </Link>
                </div>
              )}
            </section>
            <div className="report-bottom">
              <span className="small muted">
                {attempt.runs.length
                  ? `Generated with ${attempt.runs.find((run) => run.stage === "listener")?.model || attempt.runs[0].model}`
                  : "Saved in your local workspace"}
              </span>
              {confirmDelete ? (
                <div className="button-row">
                  <span className="small">
                    Delete this pitch and its recording?
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep it
                  </button>
                  <button
                    className="text-button danger"
                    onClick={remove}
                    disabled={actionBusy}
                  >
                    Delete pitch
                  </button>
                </div>
              ) : (
                <button
                  className="text-button danger"
                  disabled={running || comparing}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={14} />
                  Delete pitch
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
