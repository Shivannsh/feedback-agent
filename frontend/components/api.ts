export type Audience = "general" | "school" | "maritime";
export const audienceNames: Record<Audience, string> = {
  general: "General business listener",
  school: "School principal",
  maritime: "Maritime training manager",
};
export const audienceDescriptions: Record<Audience, string> = {
  general:
    "Understands everyday business. Meeting your company for the first time.",
  school: "Understands classrooms, teacher workloads, and school purchasing.",
  maritime: "Understands technical instruction and maritime training delivery.",
};
export type Health = {
  api_key_configured: boolean;
  listener_model: string;
  transcription_model: string;
  presentation_transcription_model?: string;
};
export type Belief = {
  topic: string;
  interpretation: string;
  basis: string;
  source_segment_ids: string[];
};
export type Report = {
  mental_picture: string;
  main_takeaway: string;
  first_question: string;
  beliefs: Belief[];
  assumptions: { assumption: string; trigger_segment_ids: string[] }[];
  uncertainties: { question: string; possible_interpretations: string[] }[];
};
export type AttemptSummary = {
  id: string;
  title: string;
  audience: Audience;
  input_type: string;
  status: string;
  created_at: string;
  parent_id: string | null;
};
export type Attempt = AttemptSummary & {
  presentation: Presentation | null;
  transcript: string;
  segments:
    | {
        id: string;
        text: string;
        start?: number;
        end?: number;
        slide_id?: string;
        visit_id?: string;
      }[]
    | null;
  error: string | null;
  listener: Report | null;
  evidence: {
    annotations: {
      belief_index: number;
      assessment: string;
      explanation: string;
      source_segment_ids: string[];
    }[];
    narrative_flags?: {
      passage: string;
      explanation: string;
      source_segment_ids: string[];
    }[];
  } | null;
  intent: string[];
  comparison_status: string;
  comparison_error: string | null;
  comparison: {
    items: {
      takeaway_index: number;
      listener_interpretation: string;
      alignment: string;
      gap: string;
      suggested_clarification: string;
      source_segment_ids: string[];
    }[];
    priority_changes: string[];
  } | null;
  runs: {
    stage: string;
    model: string;
    prompt_version: string;
    latency_ms: number;
  }[];
};

export type Deck = {
  id: string;
  name: string;
  pages: { number: number; width: number; height: number }[];
};
export type SlideEvent = {
  type: "start" | "slide" | "pause" | "resume" | "finish";
  slide: number;
  time: number;
  wall_time: number;
};
export type Presentation = {
  deck_id: string;
  recording_id: string;
  duration: number;
  events: SlideEvent[];
};
export function clockText(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export function presentationVisits(presentation: Presentation) {
  return presentation.events.flatMap((event, index, events) => {
    const next = events[index + 1];
    return next &&
      !["pause", "finish"].includes(event.type) &&
      next.time > event.time
      ? [{ slide: event.slide, start: event.time, end: next.time }]
      : [];
  });
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    cache: "no-store",
  });
  if (!response.ok) {
    let message =
      "The server could not complete this request. Check that the backend is running.";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail))
        message = data.detail
          .map((issue: { msg: string }) => issue.msg)
          .join(" ");
    } catch {
      /* Preserve the useful fallback for non-JSON proxy failures. */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function dateText(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export const busyStatuses = [
  "queued",
  "transcribing",
  "listening",
  "reviewing",
];
