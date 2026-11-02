import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useUiStore, type LightboxItem, type ModalKind } from '../../app/stores/ui';
import { cn } from '../../lib/cn';
import { clampZoom, isZoomed, MAX_ZOOM, MIN_ZOOM, stepIndex, ZOOM_STEP } from '../../lib/media-gallery';

interface Offset {
  x: number;
  y: number;
}

interface LightboxState {
  open: boolean;
  items: LightboxItem[];
  index: number;
}

const ORIGIN: Offset = { x: 0, y: 0 };

function readLightbox(modal: ModalKind): LightboxState {
  if (!modal || modal.kind !== 'lightbox') return { open: false, items: [], index: 0 };
  return { open: modal.items.length > 0, items: modal.items, index: modal.index };
}

/** The image scales around the pointer, so the point under the cursor stays put while zooming. */
function zoomAroundPointer(zoom: number, pointer: Offset, center: Offset, offset: Offset): Offset {
  return {
    x: pointer.x - center.x - zoom * (pointer.x - center.x - offset.x),
    y: pointer.y - center.y - zoom * (pointer.y - center.y - offset.y),
  };
}

export function Lightbox() {
  const modal = useUiStore((state) => state.modal);
  const closeModal = useUiStore((state) => state.closeModal);
  const { open, items, index: modalIndex } = readLightbox(modal);
  const count = items.length;
  const [index, setIndex] = useState(modalIndex);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>(ORIGIN);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef({ zoom: MIN_ZOOM, offset: ORIGIN });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Offset } | null>(null);

  cameraRef.current = { zoom, offset };

  // the store's index wins whenever it changes, including clicking another image of the same message
  const openedAt = modal?.kind === 'lightbox' ? modal.openedAt : 0;
  useEffect(() => {
    if (open) setIndex(modalIndex);
  }, [open, modalIndex, openedAt]);

  useEffect(() => {
    if (!open) return;
    setZoom(MIN_ZOOM);
    setOffset(ORIGIN);
    setDragging(false);
    dragRef.current = null;
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const neighbour of [items[stepIndex(index, 1, count)], items[stepIndex(index, -1, count)]]) {
      if (!neighbour) continue;
      const preload = new Image();
      preload.src = neighbour.url;
    }
  }, [open, items, index, count]);

  const reset = useCallback(() => {
    setZoom(MIN_ZOOM);
    setOffset(ORIGIN);
  }, []);

  const zoomTo = useCallback((next: number, pointer?: Offset) => {
    const current = cameraRef.current;
    const value = clampZoom(next);
    if (value !== current.zoom && pointer && viewportRef.current) {
      const bounds = viewportRef.current.getBoundingClientRect();
      setOffset(zoomAroundPointer(value, pointer, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, current.offset));
    }
    if (value === MIN_ZOOM) setOffset(ORIGIN);
    setZoom(value);
  }, []);

  const step = useCallback((next: number) => setZoom(clampZoom(next)), []);
  const stepIndexBy = useCallback(
    (delta: number) => setIndex((current) => stepIndex(current, delta, count)),
    [count],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
      else if (event.key === 'ArrowLeft') stepIndexBy(-1);
      else if (event.key === 'ArrowRight') stepIndexBy(1);
      else if (event.key === '+' || event.key === '=') step(cameraRef.current.zoom + ZOOM_STEP);
      else if (event.key === '-' || event.key === '_') step(cameraRef.current.zoom - ZOOM_STEP);
      else if (event.key === '0') reset();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeModal, stepIndexBy, step, reset]);

  const activeIndex = Math.min(Math.max(index, 0), count - 1);
  const item = items[activeIndex];
  if (!open || !item) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!isZoomed(zoom) || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: offset };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY });
  };

  const endDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey || isZoomed(cameraRef.current.zoom))) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    zoomTo(cameraRef.current.zoom + direction * ZOOM_STEP, { x: event.clientX, y: event.clientY });
  };

  const toggleZoom = (event: ReactMouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (isZoomed(cameraRef.current.zoom)) reset();
    else zoomTo(2, { x: event.clientX, y: event.clientY });
  };

  const toolButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-on-image transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40';
  const navButton = 'absolute top-1/2 flex size-11 shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-on-image transition-colors hover:bg-white/20';

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de mídia"
      tabIndex={-1}
      className="fixed inset-0 z-[90] flex flex-col bg-black/92 backdrop-blur-sm outline-none"
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-2 text-on-image">
        <span className="tabular-nums text-sm text-white/70" aria-live="polite">
          {activeIndex + 1} / {count}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.filename}>
          {item.filename}
        </span>
        <button
          type="button"
          className={toolButton}
          aria-label="Reduzir zoom"
          title="Reduzir zoom"
          disabled={!isZoomed(zoom)}
          onClick={() => step(cameraRef.current.zoom - ZOOM_STEP)}
        >
          <ZoomOut size={18} aria-hidden />
        </button>
        <span className="w-12 shrink-0 text-center text-xs tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={toolButton}
          aria-label="Aumentar zoom"
          title="Aumentar zoom"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => step(cameraRef.current.zoom + ZOOM_STEP)}
        >
          <ZoomIn size={18} aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/15" aria-hidden />
        <button type="button" className={toolButton} aria-label="Fechar" title="Fechar" onClick={closeModal}>
          <X size={18} aria-hidden />
        </button>
      </header>

      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-16 pb-4"
        onWheel={onWheel}
        onDoubleClick={reset}
      >
        <img
          key={item.id}
          src={item.url}
          alt={item.filename}
          draggable={false}
          className={`max-h-full max-w-full select-none object-contain transition-transform duration-150 ease-out ${
            isZoomed(zoom) ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={toggleZoom}
        />

        {count > 1 ? (
          <>
            <button
              type="button"
              className={`${navButton} left-3`}
              aria-label="Imagem anterior"
              title="Imagem anterior"
              onClick={() => stepIndexBy(-1)}
            >
              <ChevronLeft size={24} aria-hidden />
            </button>
            <button
              type="button"
              className={`${navButton} right-3`}
              aria-label="Próxima imagem"
              title="Próxima imagem"
              onClick={() => stepIndexBy(1)}
            >
              <ChevronRight size={24} aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? <Filmstrip items={items} index={activeIndex} onSelect={setIndex} /> : null}
    </div>,
    document.body,
  );
}

/** Thumbnail strip under the viewer; the active card is scrolled into view as the viewer moves. */
function Filmstrip({ items, index, onSelect }: { items: LightboxItem[]; index: number; onSelect: (index: number) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const card = strip?.children[index] as HTMLElement | undefined;
    // scroll the strip only, so the page behind the viewer never moves
    if (!strip || !card) return;
    const left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [index]);

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Imagens da mensagem"
      // `mx-auto w-fit` centres the cards while the strip still scrolls once they overflow
      className="mx-auto flex w-fit max-w-full shrink-0 snap-x snap-proximity items-center gap-2 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:thin]"
    >
      {items.map((thumb, thumbIndex) => {
        const active = thumbIndex === index;
        return (
          <button
            key={thumb.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={thumb.filename}
            title={thumb.filename}
            onClick={() => onSelect(thumbIndex)}
            className={cn(
              'relative h-16 w-24 shrink-0 snap-center overflow-hidden rounded-md border-2 transition-[border-color,opacity,transform] duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-image',
              active
                ? 'border-brand opacity-100'
                : 'border-transparent opacity-55 hover:scale-[1.03] hover:opacity-90',
            )}
          >
            <img src={thumb.url} alt="" draggable={false} className="size-full object-cover" />
          </button>
        );
      })}
    </div>
  );
}
