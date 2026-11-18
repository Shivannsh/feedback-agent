"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  Presentation as PresentationIcon,
  Square,
  Upload,
} from "lucide-react";
import Shell from "@/components/Shell";
import {
  api,
  Attempt,
  Audience,
  audienceNames,
  clockText,
  Deck,
  errorText,
  jsonRequest,
  Presentation,
  SlideEvent,
} from "@/components/api";
import { makeWav } from "@/components/presentation-audio";

type Phase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "finishing"
  | "recorded"
  | "saving";
type SavedRecording = { audio: Blob; presentation: Presentation };

function Presenter() {
  const router = useRouter();
  const search = useSearchParams();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<Audience>("general");
  const [slide, setSlide] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loading, setLoading] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState<SavedRecording | null>(null);
  const [preview, setPreview] = useState("");
  const context = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const events = useRef<SlideEvent[]>([]);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const recordingId = useRef("");
  const active = ["starting", "recording", "paused", "finishing"].includes(
    phase,
  );
  const locked = phase !== "idle";
  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  function release() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    processor.current?.disconnect();
    processor.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    api<Deck[]>("/decks")
      .then(setDecks)
      .catch((e) => setError(errorText(e)));
    const id = search.get("deck");
    if (id)
      api<Deck>(`/decks/${id}`)
        .then(setDeck)
        .catch((e) => setError(errorText(e)));
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a[href]");
      if (
        dirty.current &&
        anchor &&
        !anchor.hasAttribute("download") &&
        !window.confirm(
          "Leave this pitch? Your unsaved recording will be lost.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      mounted.current = false;
      release();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [search]);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    setPrepared(false);
    setSlide(1);
    Promise.all(
      deck.pages.map(
        (_, index) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () =>
              reject(
                new Error(
                  "A slide could not load. Reload the page before recording.",
                ),
              );
            image.src = `/api/decks/${deck.id}/slides/${index + 1}`;
          }),
      ),
    )
      .then(() => {
        if (!cancelled) setPrepared(true);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [deck]);

  useEffect(() => {
    if (!recording) return;
    const url = URL.createObjectURL(recording.audio);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 20 * 1024 * 1024) {
      setError("Choose a PDF smaller than 20 MB.");
      return;
    }
    setLoading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const next = await api<Deck>("/decks", { method: "POST", body });
      setDeck(next);
      setDecks((old) => [next, ...old.filter((item) => item.id !== next.id)]);
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ""));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function save(value: SavedRecording) {
    changePhase("saving");
    setError("");
    try {
      const body = new FormData();
      body.append("file", value.audio, "presentation.wav");
      body.append("title", title.trim());
      body.append("audience", audience);
      body.append("presentation", JSON.stringify(value.presentation));
      const attempt = await api<Attempt>("/attempts/presentation", {
        method: "POST",
        body,
      });
      dirty.current = false;
      try {
        await api(`/attempts/${attempt.id}/analyze`, jsonRequest("POST"));
      } catch {
        /* The saved report page offers a retry if the provider is unavailable. */
      }
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      setError(errorText(e));
      changePhase("recorded");
    }
  }

  async function start() {
    if (!deck || !prepared || !title.trim() || phaseRef.current !== "idle")
      return;
    changePhase("starting");
    setError("");
    dirty.current = true;
    chunks.current = [];
    events.current = [];
    recordingId.current = crypto.randomUUID();
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone recording needs HTTPS or localhost in a supported browser.",
        );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!mounted.current) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = mic;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      context.current = audioContext;
      await audioContext.audioWorklet.addModule("/presentation-recorder.js");
      if (!mounted.current) {
        release();
        return;
      }
      const node = new AudioWorkletNode(audioContext, "presentation-recorder");
      processor.current = node;
      node.port.onmessage = ({ data }) => {
        if (!mounted.current) return;
        if (data.type === "chunk") {
          chunks.current.push(data.chunk);
          let peak = 0;
          for (const sample of data.chunk as Float32Array)
            peak = Math.max(peak, Math.abs(sample));
          setLevel(peak);
        } else if (data.type === "clock") setElapsed(data.time);
        else if (data.type === "event") {
          const event = data.event as SlideEvent;
          events.current.push(event);
          if (events.current.length === 499 && event.type !== "finish") {
            node.port.postMessage({ type: "finish" });
          }
          if (event.type === "slide") setSlide(event.slide);
          if (["start", "resume"].includes(event.type))
            changePhase("recording");
          if (event.type === "pause") {
            changePhase("paused");
            setLevel(0);
          }
          if (event.type === "finish") {
            const rate = audioContext.sampleRate;
            release();
            setElapsed(event.time);
            setLevel(0);
            if (event.time < 1) {
              dirty.current = false;
              changePhase("idle");
              setError("Record at least a second of speech before finishing.");
              return;
            }
            const value = {
              audio: makeWav(chunks.current, rate),
              presentation: {
                deck_id: deck.id,
                recording_id: recordingId.current,
                duration: event.time,
                events: [...events.current],
              },
            };
            chunks.current = [];
            setRecording(value);
            changePhase("recorded");
            void save(value);
          }
        }
      };
      node.onprocessorerror = () => {
        release();
        dirty.current = false;
        changePhase("idle");
        setError(
          "The microphone recorder stopped unexpectedly. Please start a new recording.",
        );
      };
      mic.getAudioTracks()[0].onended = () => {
        if (processor.current) {
          setError(
            "The microphone disconnected. Saving the recorded part of your pitch.",
          );
          finish();
        }
      };
      audioContext.createMediaStreamSource(mic).connect(node);
      node.connect(audioContext.destination);
      await audioContext.resume();
      node.port.postMessage({ type: "start", slide });
    } catch (e) {
      release();
      dirty.current = false;
      changePhase("idle");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser, then try again."
          : errorText(e),
      );
    }
  }

  function go(number: number) {
    if (
      !deck ||
      number < 1 ||
      number > deck.pages.length ||
      number === slide ||
      ["starting", "finishing", "saving", "recorded"].includes(phaseRef.current)
    )
      return;
    if (processor.current)
      processor.current.port.postMessage({ type: "slide", slide: number });
    else setSlide(number);
  }
  function pause() {
    processor.current?.port.postMessage({
      type: phaseRef.current === "paused" ? "resume" : "pause",
    });
  }
  function finish() {
    if (!["recording", "paused"].includes(phaseRef.current)) return;
    changePhase("finishing");
    processor.current?.port.postMessage({ type: "finish" });
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input, select, textarea, button, a",
        )
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(slide + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(slide - 1);
      }
      if (event.code === "Space" && ["recording", "paused"].includes(phase)) {
        event.preventDefault();
        pause();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <Shell>
      <div className="page-container presenter-page">
        <div className="page-heading">
          <div className="eyebrow">SLIDES + YOUR VOICE</div>
          <h1>Make your pitch.</h1>
          <p>
            A fresh listener sees your slides as you explain them.
            <br />
            Your feedback arrives after you finish.
          </p>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {!active && !recording && (
          <section className="present-setup">
            <div>
              <label htmlFor="pitch-title">Pitch title</label>
              <input
                id="pitch-title"
                maxLength={120}
                value={title}
                disabled={locked}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Your next customer conversation"
              />
            </div>
            <div>
              <label htmlFor="pitch-audience">Who is listening?</label>
              <select
                id="pitch-audience"
                value={audience}
                disabled={locked}
                onChange={(e) => setAudience(e.target.value as Audience)}
              >
                {Object.entries(audienceNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="deck-picker">
              <label className="button secondary file-button">
                <Upload size={16} />
                {loading ? "Preparing slides…" : "Upload PDF deck"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={loading || locked}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                  aria-label="Upload PDF deck"
                />
              </label>
              {decks.length > 0 && (
                <select
                  aria-label="Reuse a deck"
                  value={deck?.id || ""}
                  disabled={loading || locked}
                  onChange={(e) =>
                    setDeck(
                      decks.find((item) => item.id === e.target.value) || null,
                    )
                  }
                >
                  <option value="" disabled>
                    Reuse a prepared deck
                  </option>
                  {decks.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.pages.length} slides
                    </option>
                  ))}
                </select>
              )}
              <p className="small muted">
                PDF · up to 20 slides / 20 MB. Export PowerPoint or Google
                Slides as PDF. Prepared slides are reused across rehearsals.
              </p>
            </div>
          </section>
        )}
        {deck ? (
          <section
            className="presentation-stage"
            aria-label="Presentation stage"
          >
            <div className="stage-heading">
              <span>{deck.name}</span>
              <span className="stage-status" aria-live="polite">
                {phase === "recording" ? (
                  <>
                    <span className="record-dot" /> Recording
                  </>
                ) : phase === "paused" ? (
                  "Paused · microphone not captured"
                ) : phase === "saving" ? (
                  "Saving your pitch…"
                ) : !prepared ? (
                  "Loading slides…"
                ) : (
                  "Ready when you are"
                )}
              </span>
            </div>
            <div className="slide-canvas">
              {/* All slides stay decoded in the page so navigation does not wait for a network fetch. */}
              {deck.pages.map((_, index) => (
                <img
                  key={`${deck.id}-${index}`}
                  src={`/api/decks/${deck.id}/slides/${index + 1}`}
                  alt={`Slide ${index + 1} of ${deck.pages.length}`}
                  hidden={slide !== index + 1}
                />
              ))}
              {phase === "paused" && (
                <span className="paused-overlay">Paused</span>
              )}
            </div>
            <div className="stage-controls">
              <div className="slide-navigation">
                <button
                  className="icon-button"
                  aria-label="Previous slide"
                  disabled={
                    slide === 1 ||
                    ["starting", "finishing", "saving", "recorded"].includes(
                      phase,
                    )
                  }
                  onClick={() => go(slide - 1)}
                >
                  <ArrowLeft size={19} />
                </button>
                <span>
                  {slide} / {deck.pages.length}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next slide"
                  disabled={
                    slide === deck.pages.length ||
                    ["starting", "finishing", "saving", "recorded"].includes(
                      phase,
                    )
                  }
                  onClick={() => go(slide + 1)}
                >
                  <ArrowRight size={19} />
                </button>
              </div>
              <div className="recording-clock">
                <Mic size={16} />
                <meter
                  min="0"
                  max="1"
                  value={Math.min(1, level * 4)}
                  aria-label="Microphone level"
                />
                <span>
                  {clockText(elapsed)} <small>/ 15:00</small>
                </span>
              </div>
              <div className="button-row">
                {phase === "idle" && (
                  <button
                    className="button primary"
                    disabled={!prepared || !title.trim() || loading}
                    onClick={start}
                  >
                    <Mic size={16} />
                    Start pitch
                  </button>
                )}
                {["recording", "paused"].includes(phase) && (
                  <>
                    <button className="button secondary" onClick={pause}>
                      {phase === "paused" ? (
                        <Play size={16} />
                      ) : (
                        <Pause size={16} />
                      )}
                      {phase === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button className="button primary" onClick={finish}>
                      <Square size={14} />
                      Finish pitch
                    </button>
                  </>
                )}
                {["starting", "finishing", "saving"].includes(phase) && (
                  <span className="saving-state">
                    <LoaderCircle className="spin" size={17} />
                    {phase === "starting"
                      ? "Opening microphone…"
                      : phase === "finishing"
                        ? "Finishing…"
                        : "Saving…"}
                  </span>
                )}
              </div>
            </div>
            <div className="slide-strip" aria-label="Jump to a slide">
              {deck.pages.map((_, index) => (
                <button
                  key={index}
                  aria-label={`Show slide ${index + 1}`}
                  aria-current={slide === index + 1 ? "true" : undefined}
                  disabled={[
                    "starting",
                    "finishing",
                    "saving",
                    "recorded",
                  ].includes(phase)}
                  onClick={() => go(index + 1)}
                >
                  <img
                    src={`/api/decks/${deck.id}/slides/${index + 1}`}
                    alt=""
                  />
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="presentation-empty">
            <PresentationIcon size={36} />
            <h2>Your slides set the scene.</h2>
            <p>Upload a deck to enter your practice room.</p>
          </div>
        )}
        {recording && phase === "recorded" && (
          <section className="recording-recovery">
            <h2>Your recording is still here.</h2>
            <p>Keep this page open while retrying the upload.</p>
            <audio controls src={preview} />
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => save(recording)}
              >
                Retry saving
              </button>
              <a
                className="button secondary"
                href={preview}
                download="pitch-recording.wav"
              >
                Download recording
              </a>
              <button
                className="text-button"
                onClick={() => {
                  if (
                    window.confirm("Discard this recording and start again?")
                  ) {
                    dirty.current = false;
                    setRecording(null);
                    setElapsed(0);
                    changePhase("idle");
                  }
                }}
              >
                Discard
              </button>
            </div>
          </section>
        )}
        <div className="presentation-notes">
          <p>
            <Check size={14} />
            Slide changes, revisits and pauses are captured automatically.
          </p>
          <p>
            Use arrow keys to change slides; space pauses or resumes. Keep this
            tab visible while presenting. Audio and shown slides are sent to
            OpenAI when you finish.
          </p>
        </div>
      </div>
    </Shell>
  );
}

export default function PresentPage() {
  return (
    <Suspense
      fallback={<div className="loading-page">Opening your practice room…</div>}
    >
      <Presenter />
    </Suspense>
  );
}
