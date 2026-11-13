'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface MobileDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Native modal dialog styled as a mobile bottom sheet (and centered modal on larger screens).
 * Uses HTMLDialogElement.showModal() for top-layer rendering, Esc/back-gesture dismissal, and focus return.
 */
export default function MobileDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
}: MobileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  const isPointerOutside = (e: React.PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) => {
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    pressedOutsideRef.current = isPointerOutside(e, dialog);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pressedOutsideRef.current && isPointerOutside(e, dialog)) {
      dialog.close();
    }
    pressedOutsideRef.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="mobile-sheet-dialog"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {/* Drag handle visual cue on mobile */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          paddingTop: '0.625rem',
          paddingBottom: '0.25rem',
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <div
          style={{
            width: '2.5rem',
            height: '0.25rem',
            borderRadius: '9999px',
            background: 'var(--color-border)',
          }}
        />
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
          padding: '0.625rem 1.25rem 0.875rem',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            id={titleId}
            style={{
              fontSize: '1.125rem',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              lineHeight: 1.3,
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text-secondary)',
                marginTop: '0.1875rem',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          style={{
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: '9999px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div
        style={{
          padding: '1.125rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px))',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {children}
      </div>
    </dialog>
  );
}
