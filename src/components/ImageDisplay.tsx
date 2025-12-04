import { useEffect, useRef } from 'react';
import type { ImageLayerData } from './layers/ImageLayer';

interface ImageDisplayProps {
  imageData: ImageLayerData;
  name: string;
  position: { x: number; y: number; scale: number };
  onPositionChange: (position: { x: number; y: number; scale: number }) => void;
}

export function ImageDisplay({ imageData, name, position, onPositionChange }: ImageDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{ x: number; y: number; scale: number; initialDistance?: number } | null>(null);

  const handleMouseMove = useRef((e: MouseEvent) => {
    if (isDraggingRef.current && dragStartRef.current) {
      onPositionChange({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
        scale: position.scale,
      });
    } else if (isResizingRef.current && resizeStartRef.current) {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        const currentDistance = Math.sqrt(
          Math.pow(containerRect.right - e.clientX, 2) + 
          Math.pow(containerRect.bottom - e.clientY, 2)
        );
        const initialDistance = resizeStartRef.current.initialDistance || 100;
        const scaleRatio = currentDistance / initialDistance;
        const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale * scaleRatio));
        onPositionChange({
          x: position.x,
          y: position.y,
          scale: newScale,
        });
        resizeStartRef.current.initialDistance = currentDistance / (newScale / resizeStartRef.current.scale);
      } else {
        const deltaX = e.clientX - resizeStartRef.current.x;
        const deltaY = e.clientY - resizeStartRef.current.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const direction = deltaX + deltaY > 0 ? 1 : -1;
        const scaleDelta = (distance * direction) / 200;
        const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale + scaleDelta));
        onPositionChange({
          x: position.x,
          y: position.y,
          scale: newScale,
        });
      }
    }
  });

  const handleMouseUp = useRef(() => {
    isDraggingRef.current = false;
    isResizingRef.current = false;
    dragStartRef.current = null;
    resizeStartRef.current = null;
  });

  useEffect(() => {
    handleMouseMove.current = (e: MouseEvent) => {
      if (isDraggingRef.current && dragStartRef.current) {
        onPositionChange({
          x: e.clientX - dragStartRef.current.x,
          y: e.clientY - dragStartRef.current.y,
          scale: position.scale,
        });
      } else if (isResizingRef.current && resizeStartRef.current) {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          const currentDistance = Math.sqrt(
            Math.pow(containerRect.right - e.clientX, 2) + 
            Math.pow(containerRect.bottom - e.clientY, 2)
          );
          const initialDistance = resizeStartRef.current.initialDistance || 100;
          const scaleRatio = currentDistance / initialDistance;
          const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale * scaleRatio));
          onPositionChange({
            x: position.x,
            y: position.y,
            scale: newScale,
          });
          resizeStartRef.current.initialDistance = currentDistance / (newScale / resizeStartRef.current.scale);
        } else {
          const deltaX = e.clientX - resizeStartRef.current.x;
          const deltaY = e.clientY - resizeStartRef.current.y;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const direction = deltaX + deltaY > 0 ? 1 : -1;
          const scaleDelta = (distance * direction) / 200;
          const newScale = Math.max(0.1, Math.min(5, resizeStartRef.current.scale + scaleDelta));
          onPositionChange({
            x: position.x,
            y: position.y,
            scale: newScale,
          });
        }
      }
    };
    handleMouseUp.current = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };
  }, [position, onPositionChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target === containerRef.current || target.classList.contains('ImageDisplay') || target.closest('.ImageDisplay') === containerRef.current) {
      if (target.closest('.ImageResizeHandle')) {
        return;
      }
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      
      const handleMouseMoveGlobal = (e: MouseEvent) => {
        handleMouseMove.current(e);
      };
      const handleMouseUpGlobal = () => {
        handleMouseUp.current();
        window.removeEventListener('mousemove', handleMouseMoveGlobal);
        window.removeEventListener('mouseup', handleMouseUpGlobal);
      };
      
      window.addEventListener('mousemove', handleMouseMoveGlobal);
      window.addEventListener('mouseup', handleMouseUpGlobal);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(5, position.scale + delta));
    onPositionChange({
      x: position.x,
      y: position.y,
      scale: newScale,
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isResizingRef.current = true;
    const containerRect = containerRef.current?.getBoundingClientRect();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scale: position.scale,
      initialDistance: containerRect ? Math.sqrt(
        Math.pow(containerRect.right - e.clientX, 2) + 
        Math.pow(containerRect.bottom - e.clientY, 2)
      ) : 0,
    };
    
    const handleMouseMoveGlobal = (e: MouseEvent) => {
      handleMouseMove.current(e);
    };
    const handleMouseUpGlobal = () => {
      handleMouseUp.current();
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
    
    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);
  };

  return (
    <div
      ref={containerRef}
      className="ImageDisplay"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `scale(${position.scale})`,
        transformOrigin: 'top left',
        zIndex: 15,
        pointerEvents: 'auto',
        border: '2px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '4px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: '4px',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px',
          padding: '2px 4px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderRadius: '2px',
        }}
      >
        <span style={{ color: 'white', fontSize: '12px', userSelect: 'none' }}>{name}</span>
      </div>
      <div
        style={{
          position: 'relative',
          backgroundColor: 'white',
          display: 'inline-block',
        }}
      >
        <img
          src={imageData.imageUrl}
          alt={name}
          style={{
            maxWidth: '400px',
            maxHeight: '300px',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
            opacity: 1,
            backgroundColor: 'white',
          }}
          draggable={false}
        />
        <div
          className="ImageResizeHandle"
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '20px',
            height: '20px',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            cursor: 'nwse-resize',
            borderTopLeftRadius: '4px',
            borderBottomRightRadius: '4px',
            border: '2px solid rgba(0, 0, 0, 0.3)',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}

