"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import Shell from "@/components/Shell";
import AttemptList from "@/components/AttemptList";
import { api, AttemptSummary, errorText } from "@/components/api";

export default function HistoryPage() {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<AttemptSummary[]>("/attempts")
      .then(setAttempts)
      .catch((error) => setError(errorText(error)))
      .finally(() => setLoading(false));
  }, []);
  const filtered = attempts.filter((attempt) =>
    attempt.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Shell>
      <div className="page-container">
        <div className="page-heading">
          <div className="eyebrow">YOUR PRACTICE, OVER TIME</div>
          <h1>
            Every pitch.
            <br />A new perspective.
          </h1>
          <p>
            Revisit a first impression or give a revised pitch a fresh start.
          </p>
        </div>
        <div className="history-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search pitches"
              placeholder="Find a pitch…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Link href="/" className="button primary">
            New pitch
            <ArrowRight size={16} />
          </Link>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="muted">Loading your pitches…</p>
        ) : filtered.length ? (
          <AttemptList attempts={filtered} />
        ) : (
          <div className="empty-history">
            {query
              ? "No pitches match your search."
              : "Your saved pitches will appear here."}
          </div>
        )}
      </div>
    </Shell>
  );
}
