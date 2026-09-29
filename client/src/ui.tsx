import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ImageCost } from "./api";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export function PageHeader({
  index,
  title,
  lede,
}: {
  index: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="page-head">
      <span className="page-index">{index}</span>
      <div>
        <h2>{title}</h2>
        <p>{lede}</p>
      </div>
    </header>
  );
}

export function Banner({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return (
    <p className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

type Camera = { scale: number; x: number; y: number };

export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cameraRef = useRef<Camera>({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; camX: number; camY: number; pointerId: number } | null>(null);
  const animationRef = useRef(0);
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  function paint(next: Camera = cameraRef.current) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image?.complete || image.naturalWidth === 0) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = image.naturalWidth * fit * next.scale;
    const drawnHeight = image.naturalHeight * fit * next.scale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (width - drawnWidth) / 2 + next.x,
      (height - drawnHeight) / 2 + next.y,
      drawnWidth,
      drawnHeight,
    );
  }

  function apply(next: Camera) {
    cameraRef.current = next;
    setCamera(next);
    paint(next);
  }

  function animateTo(end: Camera) {
    cancelAnimationFrame(animationRef.current);
    const start = cameraRef.current;
    const started = performance.now();
    function frameStep(now: number) {
      const t = Math.min(1, (now - started) / 180);
      const eased = 1 - (1 - t) ** 3;
      apply({
        scale: start.scale + (end.scale - start.scale) * eased,
        x: start.x + (end.x - start.x) * eased,
        y: start.y + (end.y - start.y) * eased,
      });
      if (t < 1) animationRef.current = requestAnimationFrame(frameStep);
    }
    animationRef.current = requestAnimationFrame(frameStep);
  }

  function zoomBy(factor: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const start = cameraRef.current;
    animateTo(zoomAt(start, factor, frame.clientWidth / 2, frame.clientHeight / 2, frame.clientWidth, frame.clientHeight));
  }

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      apply({ scale: 1, x: 0, y: 0 });
    };
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const node: HTMLDivElement = frame;
    const observer = new ResizeObserver(() => paint());
    observer.observe(node);
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0016);
      apply(zoomAt(cameraRef.current, factor, event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height));
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    cancelAnimationFrame(animationRef.current);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      camX: cameraRef.current.x,
      camY: cameraRef.current.y,
      pointerId: event.pointerId,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone. Moves over the canvas still pan.
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    apply({
      ...cameraRef.current,
      x: drag.camX + event.clientX - drag.x,
      y: drag.camY + event.clientY - drag.y,
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <figure className="zoom">
      <div className="zoom-bar" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={camera.scale <= MIN_ZOOM + 0.001}
          onClick={() => zoomBy(1 / 1.25)}
        >
          −
        </button>
        <span>{Math.round(camera.scale * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={camera.scale >= MAX_ZOOM - 0.001}
          onClick={() => zoomBy(1.25)}
        >
          +
        </button>
        <button
          type="button"
          disabled={camera.scale === 1 && camera.x === 0 && camera.y === 0}
          onClick={() => animateTo({ scale: 1, x: 0, y: 0 })}
        >
          100%
        </button>
      </div>
      <div
        className={dragging ? "zoom-view dragging" : "zoom-view"}
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} role="img" aria-label={alt} />
      </div>
    </figure>
  );
}

function zoomAt(camera: Camera, factor: number, cx: number, cy: number, width: number, height: number): Camera {
  const scale = clampZoom(camera.scale * factor);
  if (scale === camera.scale) return camera;
  const ratio = scale / camera.scale;
  return {
    scale,
    x: camera.x * ratio + (cx - width / 2) * (1 - ratio),
    y: camera.y * ratio + (cy - height / 2) * (1 - ratio),
  };
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function CostLine({ usage }: { usage?: ImageCost | null }) {
  if (!usage) return null;
  return (
    <p className="cost">
      <span>
        {usage.totalTokens.toLocaleString()} tokens · {usage.inputTokens.toLocaleString()} in (
        {usage.textTokens.toLocaleString()} text, {usage.imageTokens.toLocaleString()} image) ·{" "}
        {usage.outputTokens.toLocaleString()} out
      </span>
      <strong>{formatUsd(usage.costUsd)}</strong>
      <span className="fine">Estimated at gpt-image-2.5-sunburst standard rates.</span>
    </p>
  );
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount >= 1 ? 2 : 4,
    maximumFractionDigits: amount >= 1 ? 2 : 4,
  }).format(amount);
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
