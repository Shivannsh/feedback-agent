"use client";

import { useEffect, useRef, useState } from "react";
import { Attempt, clockText, presentationVisits } from "./api";

export default function PresentationEvidence({
  attempt,
  highlight,
}: {
  attempt: Attempt;
  highlight: string[];
}) {
  const presentation = attempt.presentation!;
  const visits = presentationVisits(presentation);
  const audio = useRef<HTMLAudioElement>(null);
  const [selected, setSelected] = useState(visits[0]?.slide || 1);
  const [time, setTime] = useState(0);
  const seek = (seconds: number, slide?: number) => {
    if (audio.current) audio.current.currentTime = seconds;
    setTime(seconds);
    if (slide) setSelected(slide);
  };
  useEffect(() => {
    const segment = attempt.segments?.find((item) =>
      highlight.includes(item.id),
    );
    const slideId =
      highlight.find((id) => id.startsWith("slide-")) || segment?.slide_id;
    const slide = slideId ? Number(slideId.replace("slide-", "")) : undefined;
    const start =
      segment?.start ?? visits.find((visit) => visit.slide === slide)?.start;
    if (start !== undefined) seek(start, slide);
    // Only a new citation selection should move playback, not background report polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);
  const shown = new Set(visits.map((visit) => visit.slide));
  return (
    <section className="presentation-evidence" id="presentation-evidence">
      <div className="evidence-heading">
        <h2>What your listener saw and heard</h2>
        <span>Slide {selected}</span>
      </div>
      <img
        className="evidence-slide"
        src={`/api/decks/${presentation.deck_id}/slides/${selected}`}
        alt={`Presented slide ${selected}`}
      />
      <audio
        ref={audio}
        controls
        preload="metadata"
        className="audio-player"
        src={`/api/attempts/${attempt.id}/audio`}
        onTimeUpdate={(event) => {
          const position = event.currentTarget.currentTime;
          setTime(position);
          const visit = visits.find(
            (item) => item.start <= position && position < item.end,
          );
          if (visit) setSelected(visit.slide);
        }}
      />
      <div className="visit-timeline" aria-label="Recorded slide visits">
        {visits.map((visit, index) => (
          <button
            key={index}
            className={
              time >= visit.start && time < visit.end ? "selected" : ""
            }
            onClick={() => seek(visit.start, visit.slide)}
          >
            Slide {visit.slide}
            <span>
              {clockText(visit.start)} – {clockText(visit.end)}
            </span>
          </button>
        ))}
      </div>
      <p className="small muted">
        {shown.size} slides shown ·{" "}
        {presentation.events.filter((event) => event.type === "pause").length}{" "}
        recording pauses. Playback omits paused time. Word timing is
        approximate.
      </p>
      <div className="timed-passages">
        {attempt.segments?.map((segment) => (
          <button
            id={`segment-${segment.id}`}
            key={segment.id}
            className={
              highlight.includes(segment.id) ? "highlighted-segment" : ""
            }
            onClick={() =>
              seek(
                segment.start || 0,
                Number(segment.slide_id?.replace("slide-", "")) || undefined,
              )
            }
          >
            <span>
              {clockText(segment.start || 0)} ·{" "}
              {segment.slide_id?.replace("slide-", "Slide ")}
            </span>
            {segment.text}
          </button>
        ))}
      </div>
    </section>
  );
}
