// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { forwardRef, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

/* ------------------------------------------------------------------------ */
/* Icon                                                                     */
/* ------------------------------------------------------------------------ */

export type IconName =
  | 'table'
  | 'view'
  | 'index'
  | 'trigger'
  | 'database'
  | 'refresh'
  | 'close'
  | 'info'
  | 'search'
  | 'sort'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'edit'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'save'
  | 'rollback'
  | 'export'
  | 'import'
  | 'sql'
  | 'columns'
  | 'settings'
  | 'dataType'
  | 'sequence'
  | 'play'
  | 'play-selection'
  | 'clear'
  | 'key'
  | 'warning'
  | 'check'
  | 'file'
  | 'database-locked'
  | 'external'
  | 'duplicate'
  | 'rows'
  | 'columns-2';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  view: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12c3-6 7-9 10-9s7 3 10 9c-3 6-7 9-10 9S5 18 2 12z" />
    </>
  ),
  index: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="13" y2="15" />
    </>
  ),
  trigger: (
    <>
      <polygon points="13,2 3,14 11,14 9,22 21,10 13,10" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </>
  ),
  'database-locked': (
    <>
      <ellipse cx="12" cy="6" rx="9" ry="3" />
      <path d="M3 6v5c0 1.66 4.03 3 9 3s9-1.34 9-3V6" />
      <path d="M3 11v5c0 1.66 4.03 3 9 3s9-1.34 9-3v-5" />
      <rect x="10" y="14" width="4" height="4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </>
  ),
  sort: (
    <>
      <polyline points="8,8 12,4 16,8" />
      <polyline points="16,16 12,20 8,16" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  trash: (
    <>
      <polyline points="3,6 5,6 21,6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  'chevron-down': (
    <>
      <polyline points="6,9 12,15 18,9" />
    </>
  ),
  'chevron-left': (
    <>
      <polyline points="15,6 9,12 15,18" />
    </>
  ),
  'chevron-right': (
    <>
      <polyline points="9,6 15,12 9,18" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17,21 17,13 7,13 7,21" />
      <polyline points="7,3 7,8 15,8" />
    </>
  ),
  rollback: (
    <>
      <polyline points="1,4 1,10 7,10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>
  ),
  export: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,5 17,10" />
      <line x1="12" y1="5" x2="12" y2="19" />
    </>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,13 7,8" />
      <line x1="12" y1="13" x2="12" y2="3" />
    </>
  ),
  sql: (
    <>
      <polyline points="8,6 2,12 8,18" />
      <polyline points="16,6 22,12 16,18" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </>
  ),
  'columns-2': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  rows: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="14" x2="21" y2="14" />
    </>
  ),
  play: (
    <>
      <polygon points="6,4 20,12 6,20" />
    </>
  ),
  'play-selection': (
    <>
      <polygon points="8,5 19,12 8,19" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="2" y1="8" x2="5" y2="8" />
      <line x1="2" y1="16" x2="5" y2="16" />
    </>
  ),
  clear: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <line x1="11.5" y1="11.5" x2="21" y2="2" />
      <line x1="17" y1="6" x2="21" y2="10" />
      <line x1="14" y1="9" x2="18" y2="13" />
    </>
  ),
  warning: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </>
  ),
  check: (
    <>
      <polyline points="4,12 10,18 20,6" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </>
  ),
  settings: (
    <>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  dataType: (
    <>
      <path d="M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  sequence: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="14" x2="16" y2="14" />
      <line x1="8" y1="18" x2="12" y2="18" />
    </>
  ),
  external: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15,3 21,3 21,9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M4 16V4a2 2 0 0 1 2-2h10" />
    </>
  )
};

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export const Icon: React.FC<IconProps> = ({ name, size = 14, ...rest }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {ICON_PATHS[name]}
    </svg>
  );
};

/* ------------------------------------------------------------------------ */
/* Button                                                                   */
/* ------------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconOnly?: boolean;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon, iconOnly, size = 'md', loading, disabled, children, className = '', ...rest },
  ref
) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'danger' ? 'btn-danger' : '',
    iconOnly || (icon && !children) ? 'btn-icon' : '',
    size === 'sm' ? 'btn-sm' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} className={cls} disabled={disabled || loading} type="button" data-variant={variant} {...rest}>
      {loading ? (
        <span className="spinner spinner-sm" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 12 : 14} aria-hidden="true" />
      ) : null}
      {children && <span>{children}</span>}
    </button>
  );
});

/* ------------------------------------------------------------------------ */
/* Form elements                                                            */
/* ------------------------------------------------------------------------ */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, className = '', style, ...rest },
  ref
) {
  const cls = ['input', className].filter(Boolean).join(' ');
  if (icon) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
        <span
          style={{
            position: 'absolute',
            left: 6,
            color: 'var(--vscode-descriptionForeground)',
            display: 'inline-flex',
            pointerEvents: 'none'
          }}
        >
          <Icon name={icon} size={12} />
        </span>
        <input ref={ref} className={cls} style={{ paddingInlineStart: 22, width: '100%' }} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cls} style={style} {...rest} />;
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  return <select ref={ref} className={['select', props.className].filter(Boolean).join(' ')} {...props} />;
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(props, ref) {
  return <textarea ref={ref} className={['textarea', props.className].filter(Boolean).join(' ')} {...props} />;
});

/* ------------------------------------------------------------------------ */
/* Badge                                                                    */
/* ------------------------------------------------------------------------ */

export interface BadgeProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'default' | 'pk' | 'null' | 'warning' | 'error' | 'success';
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', className = '', children, ...rest }) => {
  const cls = [
    'badge',
    variant === 'pk' ? 'badge-pk' : '',
    variant === 'null' ? 'badge-null' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------------ */
/* Tooltip                                                                  */
/* ------------------------------------------------------------------------ */

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  return (
    <span className="tooltip">
      {children}
      <span className="tooltip-content">{content}</span>
    </span>
  );
};

/* ------------------------------------------------------------------------ */
/* Spinner                                                                  */
/* ------------------------------------------------------------------------ */

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: React.ReactNode;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', label }) => {
  const sizeMap: Record<string, number> = { sm: 14, md: 20, lg: 28 };
  const px = sizeMap[size] || 20;
  return (
    <span className="spinner" role="status" aria-live="polite" style={{ display: 'inline-flex', gap: 6 }}>
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
};

/* ------------------------------------------------------------------------ */
/* Modal                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * The one modal shell every dialog in the app uses.
 *
 * Before this existed, seven call sites each re-implemented the same overlay,
 * header (icon + title + close) and footer (cancel + confirm) markup, which is
 * why a styling or accessibility fix had to be repeated everywhere. The header
 * and the overlay dismissal behaviour — the parts that were always identical —
 * live here; `body` and `footer` stay free-form for the genuinely different
 * parts of each dialog.
 */
export interface ModalProps {
  /** Dialog title, shown next to the icon. */
  title: React.ReactNode;
  /** Icon shown left of the title. */
  icon?: IconName;
  /**
   * Close handler, also used for overlay clicks.
   *
   * Omit for dialogs that must be answered (no overlay dismissal, no close
   * button), such as a blocking confirmation.
   */
  onClose?: () => void;
  /** Icon size; the default suits the standard dialogs. */
  iconSize?: number;
  /**
   * Extra classes on the modal box, for the few dialogs that need their own
   * width. Layout styling belongs in the stylesheet, not inline `style`.
   */
  className?: string;
  /** Extra classes on the overlay. */
  overlayClassName?: string;
  /** Dialog body. */
  children: React.ReactNode;
  /** Footer buttons; omitted when a dialog has none. */
  footer?: React.ReactNode;
  /** Accessible label for the close button. */
  closeLabel?: string;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  icon = 'info',
  onClose,
  iconSize = 14,
  className = '',
  overlayClassName = '',
  children,
  footer,
  closeLabel
}) => {
  const { t } = useI18n();
  return (
    <div
      className={['modal-overlay', overlayClassName].filter(Boolean).join(' ')}
      onClick={onClose}
    >
      <div
        className={['modal', className].filter(Boolean).join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <Icon name={icon} size={iconSize} />
          <span className="modal-header-title">{title}</span>
          {onClose && (
            <Button variant="icon" icon="close" onClick={onClose} aria-label={closeLabel || t('cancel')} />
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

/**
 * The standard cancel/confirm footer, so no dialog re-invents the pair.
 *
 * `confirmDisabled` mirrors the validation each dialog already does; it is kept
 * separate from `confirmLoading` because a disabled button and a busy button
 * read differently to a screen reader.
 */
export interface ModalActionsProps {
  onCancel: () => void;
  onConfirm?: () => void;
  cancelLabel: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  cancelDisabled?: boolean;
}

export const ModalActions: React.FC<ModalActionsProps> = ({
  onCancel,
  onConfirm,
  cancelLabel,
  confirmLabel,
  confirmVariant = 'primary',
  confirmDisabled,
  confirmLoading,
  cancelDisabled
}) => (
  <>
    <Button variant="secondary" onClick={onCancel} disabled={cancelDisabled}>
      {cancelLabel}
    </Button>
    {onConfirm && (
      <Button
        variant={confirmVariant}
        onClick={onConfirm}
        disabled={confirmDisabled}
        loading={confirmLoading}
      >
        {confirmLabel}
      </Button>
    )}
  </>
);

/* ------------------------------------------------------------------------ */
/* ConfirmDialog                                                            */
/* ------------------------------------------------------------------------ */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  loading,
  onConfirm,
  onCancel
}) => {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <Modal
      title={title}
      icon={variant === 'danger' ? 'warning' : 'info'}
      iconSize={16}
      // A destructive action must be answered deliberately, so this dialog
      // deliberately has no close button and ignores overlay clicks.
      footer={
        <ModalActions
          onCancel={onCancel}
          onConfirm={onConfirm}
          cancelLabel={cancelLabel || t('cancel')}
          confirmLabel={confirmLabel || t('confirm')}
          confirmVariant={variant === 'danger' ? 'danger' : 'primary'}
          confirmLoading={loading}
          cancelDisabled={loading}
        />
      }
    >
      <p>{message}</p>
    </Modal>
  );
};

/* ------------------------------------------------------------------------ */
/* ContextMenu                                                              */
/* ------------------------------------------------------------------------ */

export type ContextMenuItem =
  | {
      /** A divider row: no label and no action. */
      separator: true;
      label?: string;
    }
  | {
      separator?: false;
      label: string;
      icon?: IconName;
      onClick: () => void;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
    };

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ open, x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }} role="menu">
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="context-menu-separator" role="separator" />;
        }
        const activate = item.onClick;
        const isDisabled = item.disabled === true;
        return (
          <div
            key={i}
            className={'context-menu-item' + (isDisabled ? ' muted' : '')}
            role="menuitem"
            aria-disabled={isDisabled || undefined}
            onClick={() => {
              if (!isDisabled) {
                activate();
                onClose();
              }
            }}
            style={item.danger ? { color: 'var(--vscode-errorForeground)' } : undefined}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span className="muted" style={{ fontSize: 10 }}>
                {item.shortcut}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* Field                                                                    */
/* ------------------------------------------------------------------------ */

export interface FieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  help?: React.ReactNode;
  /** Extra classes, for the few fields that need spacing or sizing. */
  className?: string;
}

export const Field: React.FC<FieldProps> = ({ label, children, help, className = '' }) => {
  return (
    <label className={['field', className].filter(Boolean).join(' ')}>
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="field-help muted">{help}</span>}
    </label>
  );
};

/* ------------------------------------------------------------------------ */
/* Dialog building blocks                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A labelled checkbox.
 *
 * The plain `<label className="checkbox"><input type="checkbox" …/></label>`
 * pattern appeared five times, each repeating the same checked/onChange wiring
 * and each rendering the same nested `<span>`.
 */
export interface CheckboxLineProps {
  checked: boolean;
  /** Receives the new checked state, not the raw event. */
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  /** Extra content after the label, e.g. a type badge. */
  children?: React.ReactNode;
}

export const CheckboxLine: React.FC<CheckboxLineProps> = ({
  checked,
  onChange,
  label,
  disabled,
  children
}) => (
  <label className="checkbox">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>{label}</span>
    {children}
  </label>
);

/**
 * The inline error message shown inside dialogs.
 *
 * Every dialog rendered `{error && <div className="error-text">…</div>}` with a
 * slightly different inline margin; the margin is now a class so no call site
 * carries inline styling.
 */
export interface DialogErrorProps {
  error: string | null | undefined;
}

export const DialogError: React.FC<DialogErrorProps> = ({ error }) =>
  error ? <div className="error-text">{error}</div> : null;

/**
 * The centred "nothing to show here" panel.
 *
 * Every tab ended with its own copy of `tab-empty` + optional icon + optional
 * spinner + message, so the padding/centring rules were repeated in five places
 * and drifted. One component keeps them identical and makes the states read the
 * same: a loading panel and an empty panel differ only by `loading`.
 */
export interface EmptyStateProps {
  /** Message shown under the icon. */
  message: React.ReactNode;
  /** Optional large icon; omitted for the loading variant. */
  icon?: IconName;
  /** Icon size, chosen per tab because the panels differ in height. */
  iconSize?: number;
  /** Show a spinner above the message. */
  loading?: boolean;
  /** Extra classes for the rare panel that needs its own padding. */
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  icon,
  iconSize = 48,
  loading,
  className = ''
}) => (
  <div className={['tab-empty', className].filter(Boolean).join(' ')}>
    {loading ? <Spinner /> : icon ? <Icon name={icon} size={iconSize} /> : null}
    <span>{message}</span>
  </div>
);

/**
 * An icon-only toolbar button.
 *
 * Every toolbar action was written as `<Tooltip content={label}><Button
 * variant="icon" icon={...} onClick={...} aria-label={label}/></Tooltip>`,
 * repeating the same label three times. Here the label is passed once and used
 * for the tooltip, the accessible name and the default icon choice.
 */
export interface ToolbarIconButtonProps {
  /** Icon to show. */
  icon: IconName;
  /** Tooltip text and accessible label. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Button flavour; `icon` styling is the default for toolbars. */
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  /**
   * Extra classes on the button, for stateful styling such as a toolbar button
   * whose panel is currently open.
   */
  className?: string;
}

export const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = ({
  icon,
  label,
  onClick,
  disabled,
  variant = 'icon',
  size = 'md',
  loading,
  className
}) => (
  <Tooltip content={label}>
    <Button
      variant={variant}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      size={size}
      loading={loading}
      className={className}
      aria-label={label}
    />
  </Tooltip>
);

/**
 * The copy-to-clipboard toolbar button, which every table and editor shows.
 *
 * Kept as a named alias over {@link ToolbarIconButton} so call sites read as
 * "copy" rather than repeating `icon="copy"`.
 */
export const ToolbarCopyButton: React.FC<Omit<ToolbarIconButtonProps, 'icon'>> = (props) => (
  <ToolbarIconButton {...props} icon="copy" />
);
