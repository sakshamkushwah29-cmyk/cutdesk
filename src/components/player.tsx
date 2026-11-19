"use client";

import Link from "next/link";
import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Comment, Mark, STATUS_LABEL, Version, formatBytes, formatTimecode } from "@/lib/types";

const COLORS = ["#d6ff4a", "#ff6a45", "#8ecbff", "#ffffff"];
const FRAME = 1 / 24;
const HOLD = 250;
const CONTROL_BAR = 48;

function onClock(start: number | null, end: number | null, time: number, timed: boolean) {
  if (!timed || start == null) return true;
  if (end != null && end >= start) return time >= start - HOLD && time <= end + HOLD;
  return Math.abs(time - start) <= HOLD;
}

type Props = {
  title: string;
  backHref?: string;
  versions: Version[];
  comments: Comment[];
  initialVersionId?: string | null;
  mediaUrl: (versionId: string) => string;
  allowComment: boolean;
  allowDownload: boolean;
  watermark?: string | null;
  canInternal?: boolean;
  guestName?: string;
  onGuestName?: (name: string) => void;
  status?: string;
  members?: { id: string; name: string }[];
  assigneeId?: string | null;
  onStatus?: (status: string) => void;
  onAssignee?: (assigneeId: string | null) => void;
  onComment: (input: {
    versionId: string;
    parentId?: string;
    body: string;
    visibility: "CLIENT" | "INTERNAL";
    startMs: number | null;
    endMs: number | null;
    markup: Mark[];
    guestName?: string;
  }) => Promise<void>;
  onResolve?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onNewVersion?: (file: File) => Promise<void>;
  onSend?: () => Promise<void>;
  sentLink?: string | null;
};

function asMarks(value: unknown): Mark[] {
  return Array.isArray(value) ? (value as Mark[]) : [];
}

export function Player(props: Props) {
  const ready = props.versions.filter((version) => version.state === "READY");
  const [versionId, setVersionId] = useState(props.initialVersionId || ready[0]?.id || "");
  const version = props.versions.find((item) => item.id === versionId) ?? ready[0];
  const kind = version?.mediaKind;
  const timedMedia = kind === "VIDEO" || kind === "AUDIO";
  const src = version && version.state === "READY" ? props.mediaUrl(version.id) : "";
  const [tool, setTool] = useState<"play" | "pen" | "rect" | "point">("play");
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<Mark[]>([]);
  const [future, setFuture] = useState<Mark[]>([]);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [catchBox, setCatchBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | undefined>();
  const [now, setNow] = useState(0);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<Mark | null>(null);

  useEffect(() => {
    if (!versionId && ready[0]) setVersionId(ready[0].id);
  }, [ready, versionId]);

  const visibleComments = props.comments.filter((comment) => comment.versionId === version?.id);
  const roots = visibleComments.filter((comment) => !comment.parentId);
  const openNotes = roots.filter((comment) => !comment.resolvedAt).length;
  const marks = useMemo(() => {
    const saved = props.comments
      .filter((comment) => comment.versionId === version?.id)
      .flatMap((comment) => (onClock(comment.startMs, comment.endMs, now, timedMedia) ? asMarks(comment.markup) : []));
    const showDraft = !timedMedia || drawing.current != null || onClock(draftAt, null, now, timedMedia);
    return showDraft ? [...saved, ...draft] : saved;
  }, [props.comments, version?.id, now, draft, draftAt, timedMedia]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const trace = (pts: { x: number; y: number }[]) => {
        ctx.beginPath();
        pts.forEach((pt, index) => {
          const x = pt.x * width;
          const y = pt.y * height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      };
      for (const mark of marks) {
        if (mark.type === "pen") {
          trace(mark.points);
          ctx.lineWidth = 5;
          ctx.strokeStyle = "rgba(8, 6, 5, 0.55)";
          ctx.stroke();
          trace(mark.points);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = mark.color;
          ctx.stroke();
        } else if (mark.type === "rect") {
          const x = mark.x * width;
          const y = mark.y * height;
          const w = mark.w * width;
          const h = mark.h * height;
          ctx.lineWidth = 5;
          ctx.strokeStyle = "rgba(8, 6, 5, 0.55)";
          ctx.strokeRect(x, y, w, h);
          ctx.lineWidth = 2.25;
          ctx.strokeStyle = mark.color;
          ctx.strokeRect(x, y, w, h);
        } else {
          const x = mark.x * width;
          const y = mark.y * height;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = mark.color;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = mark.color;
          ctx.fill();
        }
      }
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [marks]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button")) return;
      const media = mediaRef.current;
      if (!media) return;
      event.preventDefault();
      if (media.paused) void media.play();
      else media.pause();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setDraft([]);
    setFuture([]);
    setDraftAt(null);
    setTool("play");
    setActiveId(null);
  }, [versionId]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !timedMedia) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (media.paused || media.ended) return;
      if (t - last >= 80) {
        last = t;
        const ms = Math.round(media.currentTime * 1000);
        setNow((prev) => (Math.abs(prev - ms) >= 40 ? ms : prev));
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      setNow(Math.round(media.currentTime * 1000));
    };
    const onSeeked = () => {
      setNow(Math.round(media.currentTime * 1000));
      if (!media.paused && !media.ended) start();
    };
    media.addEventListener("play", start);
    media.addEventListener("pause", stop);
    media.addEventListener("seeked", onSeeked);
    if (!media.paused) start();
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("play", start);
      media.removeEventListener("pause", stop);
      media.removeEventListener("seeked", onSeeked);
    };
  }, [timedMedia, src, versionId]);

  useEffect(() => {
    if (tool === "play") return;
    const stage = canvasRef.current?.parentElement;
    if (!stage) return;
    const measure = () => {
      const surface = stage.querySelector("video, img");
      if (!(surface instanceof HTMLElement)) {
        setCatchBox(null);
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const box = surface.getBoundingClientRect();
      const bar = surface.tagName === "VIDEO" ? CONTROL_BAR : 0;
      setCatchBox({
        left: box.left - stageRect.left,
        top: box.top - stageRect.top,
        width: box.width,
        height: Math.max(0, box.height - bar),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const surface = stage.querySelector("video, img");
    surface?.addEventListener("load", measure);
    surface?.addEventListener("loadedmetadata", measure);
    return () => {
      observer.disconnect();
      surface?.removeEventListener("load", measure);
      surface?.removeEventListener("loadedmetadata", measure);
    };
  }, [tool, src, kind]);

  function point(event: PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function lockFrame() {
    const media = mediaRef.current;
    if (!media || !timedMedia) return true;
    media.pause();
    if (draft.length > 0 && draftAt != null && Math.abs(media.currentTime * 1000 - draftAt) > HOLD) {
      media.currentTime = draftAt / 1000;
      setNow(draftAt);
      return false;
    }
    if (!draft.length) {
      const ms = Math.round(media.currentTime * 1000);
      setDraftAt(ms);
      setNow(ms);
    }
    return true;
  }

  function pushMark(mark: Mark) {
    setDraft((current) => {
      if (current.length >= 20) return current;
      setFuture([]);
      return [...current, mark];
    });
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (tool === "play" || draft.length >= 20) return;
    if (!lockFrame()) return;
    const origin = point(event);
    if (tool === "point") {
      pushMark({ type: "point", color, x: origin.x, y: origin.y });
      return;
    }
    const mark: Mark =
      tool === "pen"
        ? { type: "pen", color, points: [origin] }
        : { type: "rect", color, x: origin.x, y: origin.y, w: 0, h: 0 };
    drawing.current = mark;
    event.currentTarget.setPointerCapture(event.pointerId);
    pushMark(mark);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const mark = drawing.current;
    if (!mark || mark.type === "point") return;
    const next = point(event);
    if (mark.type === "pen") mark.points.push(next);
    else {
      mark.w = next.x - mark.x;
      mark.h = next.y - mark.y;
    }
    setDraft((current) => [...current]);
  }

  function onPointerUp() {
    if (!drawing.current) return;
    const mark = drawing.current;
    drawing.current = null;
    if (mark.type === "rect") {
      mark.x = Math.min(mark.x, mark.x + mark.w);
      mark.y = Math.min(mark.y, mark.y + mark.h);
      mark.w = Math.abs(mark.w);
      mark.h = Math.abs(mark.h);
    }
    if (mark.type === "pen" && mark.points.length < 2) {
      setDraft((current) => current.filter((item) => item !== mark));
      return;
    }
    if (mark.type === "rect" && mark.w < 0.004 && mark.h < 0.004) {
      setDraft((current) => current.filter((item) => item !== mark));
      return;
    }
    setDraft((current) => [...current]);
  }

  function undo() {
    drawing.current = null;
    setDraft((current) => {
      if (!current.length) return current;
      const last = current[current.length - 1];
      setFuture((stack) => [...stack, last]);
      return current.slice(0, -1);
    });
  }

  function redo() {
    setFuture((stack) => {
      if (!stack.length) return stack;
      const last = stack[stack.length - 1];
      setDraft((current) => [...current, last]);
      return stack.slice(0, -1);
    });
  }

  function chooseTool(next: "pen" | "rect" | "point") {
    const media = mediaRef.current;
    if (media) {
      media.pause();
      setNow(Math.round(media.currentTime * 1000));
    }
    setTool(next);
  }

  function readTime(media: HTMLMediaElement) {
    setNow(Math.round(media.currentTime * 1000));
  }

  function holdPlayhead() {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    readTime(media);
  }

  function step(direction: number) {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.currentTime = Math.max(0, media.currentTime + direction * FRAME);
    readTime(media);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!version) return;
    setPending(true);
    setError(null);
    try {
      const timed = kind === "VIDEO" || kind === "AUDIO";
      await props.onComment({
        versionId: version.id,
        parentId,
        body,
        visibility,
        startMs: timed ? (draft.length && draftAt != null ? draftAt : Math.round(now)) : null,
        endMs: null,
        markup: draft,
        guestName: props.guestName,
      });
      setBody("");
      setDraft([]);
      setFuture([]);
      setDraftAt(null);
      setParentId(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the comment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="review">
      <section className="stage-wrap">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            {props.backHref ? (
              <Link href={props.backHref} className="fine">
                Back
              </Link>
            ) : null}
            <h1 style={{ margin: "4px 0" }}>{props.title}</h1>
          </div>
          <div className="row">
            {props.onStatus ? (
              <select value={props.status} onChange={(event) => props.onStatus?.(event.target.value)} aria-label="Status">
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}
            {props.onSend ? (
              <button
                className="btn"
                type="button"
                disabled={sending}
                onClick={() => {
                  setSending(true);
                  void props.onSend?.().catch((err) => setError(err instanceof Error ? err.message : "Could not send the link.")).finally(() => setSending(false));
                }}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            ) : null}
            {props.allowDownload && src ? (
              <a className="btn" href={`${src}${src.includes("?") ? "&" : "?"}download=1`}>
                Download
              </a>
            ) : null}
          </div>
        </div>
        {props.sentLink ? (
          <p className="banner">
            Review link ready. <a href={props.sentLink}>{props.sentLink}</a>
          </p>
        ) : null}
        <div className="stage">
          {kind === "VIDEO" && src ? (
            <video
              ref={(node) => {
                mediaRef.current = node;
              }}
              src={src}
              controls
              controlsList={props.allowDownload ? undefined : "nodownload"}
              onPlay={(event) => {
                setTool("play");
                readTime(event.currentTarget);
              }}
              onTimeUpdate={(event) => readTime(event.currentTarget)}
              onPause={(event) => readTime(event.currentTarget)}
              onSeeked={(event) => readTime(event.currentTarget)}
            />
          ) : null}
          {kind === "AUDIO" && src ? (
            <audio
              ref={(node) => {
                mediaRef.current = node;
              }}
              src={src}
              controls
              controlsList={props.allowDownload ? undefined : "nodownload"}
              onPlay={(event) => {
                setTool("play");
                readTime(event.currentTarget);
              }}
              onTimeUpdate={(event) => readTime(event.currentTarget)}
              onPause={(event) => readTime(event.currentTarget)}
              onSeeked={(event) => readTime(event.currentTarget)}
            />
          ) : null}
          {kind === "IMAGE" && src ? <img src={src} alt="" /> : null}
          {kind === "DOCUMENT" && src ? <iframe title={props.title} src={src} style={{ minHeight: 480, border: 0 }} /> : null}
          {kind === "OTHER" && src ? (
            <a className="btn" href={props.allowDownload ? `${src}?download=1` : src}>
              Open file
            </a>
          ) : null}
          {!src ? <p className="muted">This version is not ready to play.</p> : null}
          {props.watermark ? <div className="watermark">{props.watermark}</div> : null}
          <canvas ref={canvasRef} className="ink off" />
          {tool !== "play" && catchBox ? (
            <div
              className="ink-catch"
              style={{ left: catchBox.left, top: catchBox.top, width: catchBox.width, height: catchBox.height }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ) : null}
        </div>
        <div className="transport">
          <div className="row">
            <button className="btn-ghost" type="button" onClick={() => step(-1)}>
              −1 frame
            </button>
            <button className="btn-ghost" type="button" onClick={() => step(1)}>
              +1 frame
            </button>
            <button className="timecode" type="button" onClick={holdPlayhead} title="Pause here and use this time for the note">
              {formatTimecode(now)}
            </button>
          </div>
          <div className="tools">
            <button className={tool === "pen" ? "btn" : "btn-ghost"} type="button" onClick={() => chooseTool("pen")}>
              Pen
            </button>
            <button className={tool === "rect" ? "btn" : "btn-ghost"} type="button" onClick={() => chooseTool("rect")}>
              Box
            </button>
            <button className={tool === "point" ? "btn" : "btn-ghost"} type="button" onClick={() => chooseTool("point")}>
              Point
            </button>
            {COLORS.map((swatch) => (
              <button
                key={swatch}
                className={color === swatch ? "swatch on" : "swatch"}
                style={{ background: swatch }}
                type="button"
                aria-label={swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
            <button className="btn-ghost" type="button" onClick={undo} disabled={!draft.length}>
              Undo
            </button>
            <button className="btn-ghost" type="button" onClick={redo} disabled={!future.length}>
              Redo
            </button>
          </div>
        </div>
        {roots.some((comment) => comment.startMs != null) ? (
          <div className="row pin-row">
            {roots
              .filter((comment) => comment.startMs != null)
              .map((comment) => (
                <button
                  key={comment.id}
                  className="btn-ghost"
                  type="button"
                  onClick={() => {
                    setActiveId(comment.id);
                    if (mediaRef.current && comment.startMs != null) {
                      mediaRef.current.pause();
                      mediaRef.current.currentTime = comment.startMs / 1000;
                      setNow(comment.startMs);
                    }
                  }}
                >
                  {formatTimecode(comment.startMs ?? 0)}
                </button>
              ))}
          </div>
        ) : null}
        <div className="version-pills row">
          {props.versions.map((item) => (
            <button
              key={item.id}
              className={item.id === version?.id ? "on" : ""}
              type="button"
              onClick={() => setVersionId(item.id)}
              style={{ width: "auto" }}
            >
              v{item.versionNumber} · {formatBytes(item.byteSize)}
            </button>
          ))}
          {props.onNewVersion ? (
            <label className="btn-ghost" style={{ width: "auto", cursor: "pointer" }}>
              New version
              <input
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void props.onNewVersion?.(file).catch((err) => setError(err.message));
                  event.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
      </section>
      <aside className="comments">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Comments</strong>
          {roots.length ? <span className="fine">{openNotes === 0 ? "All notes are done" : `${openNotes} open`}</span> : null}
        </div>
        {roots.length > 0 && openNotes === 0 ? <p className="banner">All notes are done. This file is approved.</p> : null}
        {roots.map((comment) => (
          <div key={comment.id}>
            <CommentCard
              comment={comment}
              active={comment.id === activeId}
              onOpen={() => {
                setActiveId(comment.id);
                if (comment.startMs != null && mediaRef.current) {
                  mediaRef.current.pause();
                  mediaRef.current.currentTime = comment.startMs / 1000;
                  setNow(comment.startMs);
                }
              }}
              onReply={() => setParentId(comment.id)}
              onResolve={props.onResolve}
              onDelete={props.onDelete}
            />
            {visibleComments
              .filter((reply) => reply.parentId === comment.id)
              .map((reply) => (
                <div key={reply.id} className="reply">
                  <CommentCard comment={reply} active={reply.id === activeId} onOpen={() => setActiveId(reply.id)} />
                </div>
              ))}
          </div>
        ))}
        {props.allowComment ? (
          <form className="stack" onSubmit={onSubmit}>
            {props.onGuestName ? (
              <label>
                Your name
                <input value={props.guestName ?? ""} onChange={(event) => props.onGuestName?.(event.target.value)} required />
              </label>
            ) : null}
            {kind === "VIDEO" || kind === "AUDIO" ? <p className="timecode">Note at {formatTimecode(now)}</p> : null}
            {props.canInternal ? (
              <label>
                Visibility
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as "CLIENT" | "INTERNAL")}>
                  <option value="CLIENT">Client</option>
                  <option value="INTERNAL">Internal</option>
                </select>
              </label>
            ) : null}
            {parentId ? (
              <p className="fine">
                Replying to {visibleComments.find((comment) => comment.id === parentId)?.authorName ?? "this note"}.{" "}
                <button type="button" className="btn-ghost" onClick={() => setParentId(undefined)}>
                  Cancel
                </button>
              </p>
            ) : null}
            <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Leave a note on this frame" required />
            {error ? <p className="error">{error}</p> : null}
            <button className="btn" disabled={pending} type="submit">
              {pending ? "Posting…" : "Post comment"}
            </button>
          </form>
        ) : (
          <p className="muted">Comments are off for this link.</p>
        )}
      </aside>
    </div>
  );
}

function CommentCard({
  comment,
  active,
  onOpen,
  onReply,
  onResolve,
  onDelete,
}: {
  comment: Comment;
  active: boolean;
  onOpen: () => void;
  onReply?: () => void;
  onResolve?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  return (
    <article className={`comment${active ? " on" : ""}${comment.resolvedAt ? " resolved" : ""}`}>
      <div className="comment-top">
        <button type="button" onClick={onOpen} style={{ background: "transparent", border: 0, padding: 0, textAlign: "left" }}>
          <strong>{comment.authorName}</strong>
          <div className="row">
            {comment.startMs != null ? <span className="timecode">{formatTimecode(comment.startMs)}</span> : null}
            {comment.endMs != null ? <span className="fine">to {formatTimecode(comment.endMs)}</span> : null}
            {comment.markup?.some((mark) => mark.type === "point") ? <span className="pill">Point</span> : null}
            {comment.markup?.some((mark) => mark.type === "pen" || mark.type === "rect") ? <span className="pill">Drawing</span> : null}
            {comment.visibility === "INTERNAL" ? <span className="pill internal">Internal</span> : null}
          </div>
          <p style={{ margin: "6px 0" }}>{comment.body}</p>
        </button>
        <div className="comment-actions">
          {onReply ? (
            <button className="btn-ghost" type="button" onClick={onReply}>
              Reply
            </button>
          ) : null}
          {onResolve ? (
            <button
              className={comment.resolvedAt ? "tick on" : "tick"}
              type="button"
              aria-label={comment.resolvedAt ? "Done. Click to reopen." : "Mark this note done"}
              onClick={() => void onResolve(comment.id)}
            >
              {comment.resolvedAt ? "✓ Done" : "✓"}
            </button>
          ) : null}
        </div>
      </div>
      {onDelete ? (
        <button className="btn-hot" type="button" onClick={() => void onDelete(comment.id)}>
          Delete
        </button>
      ) : null}
    </article>
  );
}
