/**
 * Modal Component
 * Accessible modal dialog with focus management
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import { Button } from '../components/Button';
import './Modal.css';

export const MODAL_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
  FULL: 'full',
};

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = MODAL_SIZES.MD,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  footer,
  className,
  ...props
}) => {
  const modalRef = useRef(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  const modalClasses = classNames(
    'tw-modal',
    `tw-modal--${size}`,
    className
  );

  return createPortal(
    <div
      className="tw-modal-backdrop"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <FocusTrap>
        <div ref={modalRef} className={modalClasses} {...props}>
          {(title || showCloseButton) && (
            <div className="tw-modal__header">
              {title && (
                <h2 id="modal-title" className="tw-modal__title">
                  {title}
                </h2>
              )}
              {showCloseButton && (
                <button
                  className="tw-modal__close"
                  onClick={onClose}
                  aria-label="Close modal"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M18 6L6 18M6 6L18 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
          
          <div className="tw-modal__body">
            {children}
          </div>
          
          {footer && (
            <div className="tw-modal__footer">
              {footer}
            </div>
          )}
        </div>
      </FocusTrap>
    </div>,
    document.body
  );
};

// Confirmation Dialog Component
export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
}) => {
  const handleConfirm = async () => {
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('Confirmation error:', error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size={MODAL_SIZES.SM}
      closeOnBackdrop={!loading}
      closeOnEscape={!loading}
      showCloseButton={!loading}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="tw-confirm-dialog__message">{message}</p>
    </Modal>
  );
};

// Hook for confirmation dialogs
export const useConfirm = () => {
  const [state, setState] = React.useState({
    isOpen: false,
    options: {},
  });

  const confirm = React.useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options: {
          ...options,
          onConfirm: () => {
            resolve(true);
            setState({ isOpen: false, options: {} });
          },
          onClose: () => {
            resolve(false);
            setState({ isOpen: false, options: {} });
          },
        },
      });
    });
  }, []);

  const dialog = state.isOpen ? (
    <ConfirmDialog {...state.options} isOpen={state.isOpen} />
  ) : null;

  return { confirm, dialog };
};