"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";

export default function AudioRecorder({
  onReady,
}: {
  onReady: (file: File | null) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [status, setStatus] = useState<
    "idle" | "requesting" | "recording" | "paused" | "done"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  async function start() {
    setError("");
    setStatus("requesting");
    onReady(null);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "This browser cannot record audio. Use Upload audio instead.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(
        media,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = next;
      const chunks: Blob[] = [];
      let size = 0;
      next.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          size += event.data.size;
        }
        if (size > 23 * 1024 * 1024 && next.state !== "inactive") next.stop();
      };
      next.onerror = () => {
        if (mounted.current)
          setError(
            "Recording was interrupted. Check the playback before submitting.",
          );
      };
      next.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        const type = next.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        const file = new File(
          [blob],
          type.includes("mp4") ? "pitch.m4a" : "pitch.webm",
          { type },
        );
        setUrl(URL.createObjectURL(blob));
        onReady(file);
        setStatus("done");
      };
      next.start(1000);
      setSeconds(0);
      setUrl("");
      setStatus("recording");
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) {
        setError(
          error instanceof Error
            ? error.message
            : "Microphone access was unavailable.",
        );
        setStatus("idle");
      }
    }
  }

  function togglePause() {
    if (status === "recording") {
      recorder.current?.pause();
      setStatus("paused");
    } else {
      recorder.current?.resume();
      setStatus("recording");
    }
  }

  return (
    <div className="recorder">
      <div className={`mic-orb ${status === "recording" ? "recording" : ""}`}>
        <Mic size={30} />
      </div>
      <h3>
        {status === "recording"
          ? "You have the floor."
          : status === "paused"
            ? "Take your time."
            : status === "done"
              ? "Your pitch is recorded."
              : "Pitch it in your own words."}
      </h3>
      <p className="muted">
        {status === "done"
          ? "Listen back, then submit when you’re ready."
          : "Your listener will share its feedback after you finish."}
      </p>
      <div className="recording-time">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}
        <span>:</span>
        {String(seconds % 60).padStart(2, "0")}
      </div>
      {status === "recording" || status === "paused" ? (
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            onClick={togglePause}
          >
            {status === "paused" ? <Play size={16} /> : <Pause size={16} />}
            {status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => recorder.current?.stop()}
          >
            <Square size={14} />
            Finish recording
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button secondary"
          disabled={status === "requesting"}
          onClick={start}
        >
          <Mic size={16} />
          {status === "requesting"
            ? "Connecting microphone…"
            : status === "done"
              ? "Record again"
              : "Start recording"}
        </button>
      )}
      {url && <audio controls src={url} className="audio-player" />}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
