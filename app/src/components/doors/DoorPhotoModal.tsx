'use client';

import React, { useState, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import type { Door } from '@/lib/types';
import { uploadDoorPhoto, updateDoorImageUrl, removeDoorPhoto } from '@/lib/firestore';

interface DoorPhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  door: Door | null;
  orgId: string;
  onSuccess?: (msg: string) => void;
  onError?: (err: string) => void;
}

export default function DoorPhotoModal({
  isOpen,
  onClose,
  door,
  orgId,
  onSuccess,
  onError,
}: DoorPhotoModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!door) return null;

  const currentDisplayImage = previewUrl || (activeTab === 'url' && customUrl ? customUrl : door.image_url || door.unifi_thumbnail_url);
  const hasCustomImage = Boolean(door.image_url);
  const hasUnifiImage = Boolean(door.unifi_thumbnail_url);

  const handleFileSelect = (selectedFile: File) => {
    setLocalError(null);
    if (!selectedFile.type.startsWith('image/')) {
      const msg = 'Please select a valid image file (JPEG, PNG, WebP).';
      setLocalError(msg);
      onError?.(msg);
      return;
    }
    // Limit to 10MB
    if (selectedFile.size > 10 * 1024 * 1024) {
      const msg = 'Image must be smaller than 10MB.';
      setLocalError(msg);
      onError?.(msg);
      return;
    }

    setFile(selectedFile);
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleSave = async () => {
    if (!door) return;
    setSaving(true);
    setLocalError(null);
    try {
      if (activeTab === 'upload' && file) {
        await uploadDoorPhoto(orgId, door.id, file);
        onSuccess?.(`Updated picture for ${door.label}`);
        handleClose();
      } else if (activeTab === 'url' && customUrl.trim()) {
        await updateDoorImageUrl(orgId, door.id, customUrl.trim());
        onSuccess?.(`Updated picture URL for ${door.label}`);
        handleClose();
      }
    } catch (err: any) {
      console.error('[DoorPhotoModal] Error saving door photo:', err);
      const errMsg = err?.message || 'Failed to save door picture.';
      setLocalError(errMsg);
      onError?.(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToUnifi = async () => {
    if (!door) return;
    setSaving(true);
    setLocalError(null);
    try {
      await removeDoorPhoto(orgId, door.id);
      onSuccess?.(`Reverted to UniFi picture for ${door.label}`);
      handleClose();
    } catch (err: any) {
      console.error('[DoorPhotoModal] Error reverting photo:', err);
      const errMsg = err?.message || 'Failed to reset picture.';
      setLocalError(errMsg);
      onError?.(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCustom = async () => {
    if (!door) return;
    setSaving(true);
    setLocalError(null);
    try {
      await removeDoorPhoto(orgId, door.id);
      onSuccess?.(`Removed custom picture for ${door.label}`);
      handleClose();
    } catch (err: any) {
      console.error('[DoorPhotoModal] Error removing photo:', err);
      const errMsg = err?.message || 'Failed to remove picture.';
      setLocalError(errMsg);
      onError?.(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(null);
    setCustomUrl('');
    setSaving(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Door Picture: ${door.label}`}
      maxWidth="32rem"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.75rem' }}>
          <div>
            {hasCustomImage && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-danger)', fontSize: '0.75rem' }}
                onClick={hasUnifiImage ? handleResetToUnifi : handleRemoveCustom}
                disabled={saving}
              >
                {hasUnifiImage ? '↺ Revert to UniFi Photo' : '✕ Remove Photo'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || (activeTab === 'upload' && !file) || (activeTab === 'url' && !customUrl.trim())}
            >
              {saving ? 'Saving…' : 'Save Picture'}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Error Banner */}
        {localError && (
          <div
            style={{
              padding: '0.625rem 0.875rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--color-danger)',
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{localError}</span>
          </div>
        )}

        {/* Preview Container */}
        <div>
          <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.375rem', display: 'block' }}>
            Current Preview
          </label>
          <div
            style={{
              width: '100%',
              height: '180px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-base)',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {currentDisplayImage ? (
              <img
                src={currentDisplayImage}
                alt={door.label}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '1rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>🚪</div>
                <div style={{ fontSize: '0.8125rem' }}>No picture configured for this door yet.</div>
              </div>
            )}

            {/* Badge indicating origin */}
            {currentDisplayImage && (
              <div
                style={{
                  position: 'absolute',
                  top: '0.5rem',
                  left: '0.5rem',
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: '0.6875rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {previewUrl
                  ? 'New Upload (Pending Save)'
                  : door.image_source === 'upload'
                  ? 'Custom Upload'
                  : door.image_source === 'custom_url'
                  ? 'Custom Web URL'
                  : hasUnifiImage
                  ? 'UniFi Access Photo'
                  : 'Picture'}
              </div>
            )}
          </div>
        </div>

        {/* Tab selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', gap: '1rem' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{
              padding: '0.5rem 0.25rem',
              borderBottom: activeTab === 'upload' ? '2px solid var(--color-accent)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: activeTab === 'upload' ? 600 : 400,
              color: activeTab === 'upload' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            }}
            onClick={() => setActiveTab('upload')}
          >
            📁 Upload Image
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{
              padding: '0.5rem 0.25rem',
              borderBottom: activeTab === 'url' ? '2px solid var(--color-accent)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: activeTab === 'url' ? 600 : 400,
              color: activeTab === 'url' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            }}
            onClick={() => setActiveTab('url')}
          >
            🔗 Image Web URL
          </button>
        </div>

        {/* Upload Drop Zone */}
        {activeTab === 'upload' ? (
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelect(e.target.files[0]);
                }
              }}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '2rem 1rem',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'rgba(36,101,245,0.05)' : 'var(--color-bg-base)',
                transition: 'border-color 0.2s ease, background 0.2s ease',
              }}
            >
              <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>📷</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {file ? file.name : 'Click or drag a photo here to upload'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                PNG, JPG, WebP up to 10MB. 16:9 landscape aspect ratio recommended.
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.375rem', display: 'block' }}>
              Direct Image URL (HTTPS)
            </label>
            <input
              type="url"
              className="input"
              placeholder="https://example.com/door-photo.jpg"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.375rem' }}>
              Ensure the image URL is publicly accessible with CORS enabled.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
