import { FileAudio, Loader2, RotateCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { dismissJob, extractLinks, importFiles, importLink, retryJob, useJobs } from "../importer";
import { SourceMark } from "./bits";

export function AddBar() {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const jobs = useJobs((s) => s.jobs);

  const submit = (text: string) => {
    const links = extractLinks(text);
    if (!links.length) {
      setErr(text.trim() ? "That isn't an Instagram or X post link." : "");
      return;
    }
    setErr("");
    setVal("");
    links.forEach(importLink);
  };

  return (
    <div className="addbar-wrap">
      <form
        className={`addbar ${err ? "has-err" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit(val);
        }}
      >
        <input
          id="link-input"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            if (err) setErr("");
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (extractLinks(text).length) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder="Paste an Instagram or X link"
          aria-label="Instagram or X link"
          aria-invalid={!!err}
          aria-describedby={err ? "link-err" : undefined}
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
        <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} title="Add audio from your device" aria-label="Add audio from your device">
          <FileAudio size={18} strokeWidth={1.75} />
        </button>
        <button type="submit" className="btn primary" disabled={!val.trim()}>
          Add
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </form>
      {err && (
        <p className="add-err" id="link-err" role="alert">
          {err}
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="jobs" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.id} className={`job ${j.state}`}>
              <SourceMark source={j.source} size={13} />
              <div className="job-text">
                <span className="job-link">{j.label}</span>
                <span className="job-status">{j.state === "working" ? "Pulling audio…" : j.error}</span>
              </div>
              {j.state === "working" ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <>
                  <button className="icon-btn sm" onClick={() => retryJob(j)} aria-label="Try again" title="Try again">
                    <RotateCw size={15} strokeWidth={1.9} />
                  </button>
                  <button className="icon-btn sm" onClick={() => dismissJob(j.id)} aria-label="Dismiss" title="Dismiss">
                    <X size={15} strokeWidth={1.9} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
