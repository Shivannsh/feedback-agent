import Link from "next/link";
import { ArrowUpRight, FileText, Mic, Presentation } from "lucide-react";
import { AttemptSummary, audienceNames, dateText } from "./api";

export default function AttemptList({
  attempts,
}: {
  attempts: AttemptSummary[];
}) {
  return (
    <div className="attempt-list">
      {attempts.map((attempt) => (
        <Link
          className="attempt-row"
          href={`/attempts/${attempt.id}`}
          key={attempt.id}
        >
          <span className="attempt-icon">
            {attempt.input_type === "presentation" ? (
              <Presentation size={18} />
            ) : attempt.input_type === "audio" ? (
              <Mic size={18} />
            ) : (
              <FileText size={18} />
            )}
          </span>
          <div className="attempt-description">
            <strong>{attempt.title}</strong>
            <span>{audienceNames[attempt.audience]}</span>
          </div>
          <span className={`status-label status-${attempt.status}`}>
            {attempt.status === "ready"
              ? "Feedback ready"
              : attempt.status.replaceAll("_", " ")}
          </span>
          <span className="attempt-date">{dateText(attempt.created_at)}</span>
          <ArrowUpRight size={17} />
        </Link>
      ))}
    </div>
  );
}
