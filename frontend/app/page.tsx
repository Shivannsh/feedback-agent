"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  FileText,
  Lightbulb,
  LoaderCircle,
  Mic,
  Upload,
  Users,
  X,
} from "lucide-react";
import Shell from "@/components/Shell";
import AudioRecorder from "@/components/AudioRecorder";
import AttemptList from "@/components/AttemptList";
import {
  api,
  Attempt,
  AttemptSummary,
  Audience,
  audienceDescriptions,
  audienceNames,
  errorText,
  Health,
  jsonRequest,
} from "@/components/api";

const examplePitch =
  "We help training teams turn their own written material into video lessons. A training manager uploads a chapter or manual, chooses the intended learners, and generates a draft video. Their subject expert reviews and approves it before it is shared with learners. The aim is to make existing material easier to explain and update. We’d like to start with one chapter in a small pilot.";

function NewPitch() {
  const router = useRouter();
  const search = useSearchParams();
  const revision = search.get("revise");
  const [mode, setMode] = useState<"text" | "record" | "upload">("text");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<Audience>("general");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  useEffect(() => {
    api<AttemptSummary[]>("/attempts")
      .then(setAttempts)
      .catch((error) => setError(errorText(error)));
    const refresh = () =>
      api<Health>("/health")
        .then(setHealth)
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!revision) {
      setParentId(null);
      return;
    }
    api<Attempt>(`/attempts/${revision}`)
      .then((attempt) => {
        setTitle(`${attempt.title.slice(0, 108)} · revised`);
        setAudience(attempt.audience);
        setText(attempt.transcript);
        setParentId(attempt.id);
        setMode("text");
      })
      .catch((error) => setError(errorText(error)));
  }, [revision]);

  function chooseFile(selected: File | null) {
    setError("");
    if (selected && selected.size > 24 * 1024 * 1024) {
      setError("Choose a recording smaller than 24 MB.");
      return;
    }
    setFile(selected);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      let attempt: Attempt;
      if (mode === "text") {
        attempt = await api<Attempt>(
          "/attempts",
          jsonRequest("POST", {
            title: title.trim(),
            audience,
            transcript: text.trim(),
            parent_id: parentId,
          }),
        );
      } else {
        if (!file) throw new Error("Record or choose an audio file first.");
        const body = new FormData();
        body.append("title", title.trim());
        body.append("audience", audience);
        body.append("file", file);
        attempt = await api<Attempt>("/attempts/audio", {
          method: "POST",
          body,
        });
      }
      if (health?.api_key_configured) {
        try {
          await api(`/attempts/${attempt.id}/analyze`, jsonRequest("POST"));
        } catch {
          /* The saved attempt page provides a recoverable start action. */
        }
      }
      router.push(`/attempts/${attempt.id}`);
    } catch (error) {
      setError(errorText(error));
      setSaving(false);
    }
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <Shell>
      <div className="page-container">
        <div className="page-heading">
          <div className="eyebrow">
            <span className="small-line" />A FRESH PERSPECTIVE
          </div>
          <h1>
            Hear how your
            <br className="hero-break" /> pitch lands.
          </h1>
          <p>
            You know your business inside out.
            <br />
            Meet a listener who’s hearing it for the first time.
          </p>
        </div>
        {!parentId && (
          <Link href="/present" className="presentation-invite">
            <span>
              <strong>Present with slides</strong>
              <small>
                Show your deck and speak naturally. Your listener sees and hears
                your pitch together.
              </small>
            </span>
            <ArrowRight size={22} />
          </Link>
        )}
        <div className="compose-layout">
          <form className="pitch-card" onSubmit={submit}>
            <div className="card-heading">
              <div>
                <h2>{parentId ? "Refine your pitch" : "Give it your pitch"}</h2>
                <p>
                  {parentId
                    ? "This revision gets a fresh listener."
                    : "Share the words you’d use in the room."}
                </p>
              </div>
              <span className="outline-icon">
                <AudioLines size={21} />
              </span>
            </div>
            <div
              className="input-tabs"
              role="tablist"
              aria-label="Pitch input method"
            >
              {(
                [
                  { id: "text", label: "Write or paste", Icon: FileText },
                  { id: "record", label: "Record", Icon: Mic },
                  { id: "upload", label: "Upload audio", Icon: Upload },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  role="tab"
                  aria-selected={mode === id}
                  type="button"
                  key={id}
                  className={mode === id ? "selected" : ""}
                  onClick={() => {
                    setMode(id);
                    setFile(null);
                  }}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
            <div className="pitch-fields">
              <label className="field-label" htmlFor="pitch-title">
                Pitch name
              </label>
              <input
                id="pitch-title"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. School pilot introduction"
                autoComplete="off"
              />
              {mode === "text" ? (
                <>
                  <div className="textarea-label">
                    <label className="field-label" htmlFor="pitch-text">
                      Your pitch
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setText(examplePitch);
                        if (!title) setTitle("Example · Training video pitch");
                      }}
                    >
                      Try an example
                      <ArrowUpRightIcon />
                    </button>
                  </div>
                  <textarea
                    id="pitch-text"
                    required
                    minLength={30}
                    maxLength={40000}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Imagine your audience just sat down. What would you say?"
                  />
                  <div className="text-meta">
                    <span>Use the words you’d actually say.</span>
                    <span>
                      {words} words · ~{Math.max(1, Math.ceil(words / 140))} min
                    </span>
                  </div>
                </>
              ) : mode === "record" ? (
                <AudioRecorder onReady={chooseFile} />
              ) : (
                <div
                  className="upload-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    chooseFile(event.dataTransfer.files[0] || null);
                  }}
                >
                  <Upload size={26} />
                  <h3>{file ? file.name : "Bring a pitch you’ve recorded."}</h3>
                  <p>
                    {file
                      ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Ready to submit`
                      : "Drop your audio here or choose a file."}
                  </p>
                  <label className="button secondary file-button">
                    {file ? "Choose another file" : "Choose audio"}
                    <input
                      aria-label="Choose audio recording"
                      type="file"
                      accept="audio/*,.mp4,.webm"
                      onChange={(event) =>
                        chooseFile(event.target.files?.[0] || null)
                      }
                    />
                  </label>
                  <span className="small muted">
                    MP3, M4A, WAV, WebM and more · Up to 24 MB
                  </span>
                  {file && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setFile(null)}
                    >
                      <X size={14} />
                      Remove file
                    </button>
                  )}
                </div>
              )}
              <div className="audience-field">
                <label className="field-label" htmlFor="audience">
                  Who’s listening?
                </label>
                <div className="select-wrap">
                  <Users size={17} />
                  <select
                    id="audience"
                    value={audience}
                    onChange={(event) =>
                      setAudience(event.target.value as Audience)
                    }
                  >
                    {Object.entries(audienceNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
                <p>{audienceDescriptions[audience]}</p>
              </div>
              {error && (
                <div role="alert" className="error-message">
                  {error}
                </div>
              )}
              <div className="submit-row">
                <span>
                  <Check size={15} />A fresh start, every pitch
                </span>
                <button
                  className="button primary"
                  disabled={saving || (mode !== "text" && !file)}
                >
                  {saving ? <LoaderCircle className="spin" size={17} /> : null}
                  {saving
                    ? "Saving your pitch…"
                    : health?.api_key_configured
                      ? "Hear the first impression"
                      : "Save pitch"}
                  {!saving && <ArrowRight size={17} />}
                </button>
              </div>
              {!health?.api_key_configured && (
                <p className="setup-note">
                  You can save a pitch now. Add your API key in connection
                  settings to generate feedback.
                </p>
              )}
            </div>
          </form>
          <aside className="compose-aside">
            <div className="expectation-card">
              <span className="expectation-icon">
                <Lightbulb size={23} />
              </span>
              <h2>
                What picture will
                <br />
                your words create?
              </h2>
              <p>
                Your listener will explain the business it imagined, in its own
                words.
              </p>
              <div className="report-preview">
                <div>
                  <span className="preview-dot" />
                  <strong>The picture I formed</strong>
                </div>
                <div>
                  <span className="preview-dot" />
                  <span>What I took away</span>
                </div>
                <div>
                  <span className="preview-dot" />
                  <span>What I assumed</span>
                </div>
                <div>
                  <span className="preview-dot" />
                  <span>What I’d ask next</span>
                </div>
              </div>
              <div className="aside-footer">
                <AudioLines size={17} />
                <span>Feedback after the full pitch</span>
              </div>
            </div>
            <p className="aside-note">
              Then add what you wanted to convey and see where your message
              landed.
            </p>
          </aside>
        </div>
        <section className="recent-section">
          <div className="section-heading">
            <h2>Recent pitches</h2>
            {attempts.length > 0 && (
              <Link className="text-button" href="/history">
                View all
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
          {attempts.length ? (
            <AttemptList attempts={attempts.slice(0, 3)} />
          ) : (
            <div className="empty-history">
              <HistoryIcon />
              <span>
                Your practice starts here. Saved pitches will appear in this
                space.
              </span>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
function HistoryIcon() {
  return <FileText size={20} />;
}

export default function Page() {
  return (
    <Suspense
      fallback={<div className="loading-page">Opening your practice room…</div>}
    >
      <NewPitch />
    </Suspense>
  );
}
