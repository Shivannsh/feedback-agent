"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  CircleHelp,
  History,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { api, Health } from "./api";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [panel, setPanel] = useState<"setup" | "about" | null>(null);
  useEffect(() => {
    async function refresh() {
      try {
        setHealth(await api<Health>("/health"));
        setOffline(false);
      } catch {
        setOffline(true);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel(null);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <AudioLines size={22} />
          </span>
          first listener<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-label">YOUR PRACTICE ROOM</div>
        <nav aria-label="Main navigation">
          <Link
            className={`nav-item ${pathname === "/" ? "active" : ""}`}
            href="/"
          >
            <Plus size={18} />
            New pitch
          </Link>
          <Link
            className={`nav-item ${pathname === "/history" ? "active" : ""}`}
            href="/history"
          >
            <History size={18} />
            Pitch history
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setPanel("about")}>
            <CircleHelp size={17} />
            How it works
            <ArrowUpRight size={14} className="push-right" />
          </button>
          <button className="nav-item" onClick={() => setPanel("setup")}>
            <Settings2 size={17} />
            Connection settings
          </button>
          <div className="workspace-footer">
            <span
              className={`status-dot ${health?.api_key_configured && !offline ? "green" : "amber"}`}
            />
            <span>
              {offline
                ? "Backend offline"
                : health?.api_key_configured
                  ? "AI connected"
                  : "API setup needed"}
            </span>
            <span className="local-label">LOCAL</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>Pitch practice</span>
          <button
            className="connection-button"
            onClick={() => setPanel("setup")}
          >
            <span
              className={`status-dot ${health?.api_key_configured && !offline ? "green" : "amber"}`}
            />
            {offline
              ? "Backend offline"
              : health?.api_key_configured
                ? "Ready to listen"
                : "Set up your connection"}
            <ArrowUpRight size={14} />
          </button>
        </header>
        <main>{children}</main>
      </div>
      {panel && (
        <div className="modal-backdrop" onClick={() => setPanel(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button modal-close"
              aria-label="Close dialog"
              onClick={() => setPanel(null)}
            >
              <X size={20} />
            </button>
            {panel === "setup" ? (
              <>
                <Settings2 className="modal-symbol" />
                <h2 id="modal-title">Your AI connection</h2>
                <p>
                  Add your OpenAI API key to <code>backend/.env</code> in the
                  project folder.
                </p>
                <pre>OPENAI_API_KEY=your-key</pre>
                <p className="muted">
                  The backend reads this file automatically. API requests are
                  billed to your provider account.
                </p>
                <div className="settings-line">
                  <span>Listener model</span>
                  <code>{health?.listener_model || "Waiting for backend"}</code>
                </div>
                <div className="settings-line">
                  <span>Transcription</span>
                  <code>
                    {health?.transcription_model || "Waiting for backend"}
                  </code>
                </div>
                <p className="small muted">
                  This version runs on your computer with local storage. Pitch
                  text and submitted recordings are sent to OpenAI for
                  processing.
                </p>
              </>
            ) : (
              <>
                <AudioLines className="modal-symbol" />
                <h2 id="modal-title">Meet a fresh listener.</h2>
                <p>
                  Give your pitch to an audience hearing about your company for
                  the first time. Feedback arrives after you finish.
                </p>
                <ol className="how-list">
                  <li>Choose who is listening and share your pitch.</li>
                  <li>
                    Read the picture they formed, including assumptions and open
                    questions.
                  </li>
                  <li>
                    Add your intended takeaways to see where the message landed.
                  </li>
                  <li>Try a revision with a fresh listener.</li>
                </ol>
                <p className="small muted">
                  This is an AI simulation. Use feedback from real first-time
                  listeners to check how well it reflects your audience.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
