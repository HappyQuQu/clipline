import { useEffect, useRef, useId } from 'react';
import { X, CheckCircle, WarningCircle, FolderOpen, ArrowRight } from '@phosphor-icons/react';
import { extensionRegistry } from '../capabilities';
import PhaseTwoPlaceholder from './PhaseTwoPlaceholder';

export function IconButton({ icon: Icon, label, ...props }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon size={19} /></button>;
}
export function Badge({ tone = 'neutral', children, dot = false }) {
  return <span className={`badge ${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}
export function PageHeading({ eyebrow, title, description, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current, container = element.closest('.content');
    if (!container) return;
    const resize = new ResizeObserver(() => container.style.setProperty('--page-heading-height', `${element.getBoundingClientRect().height}px`));
    resize.observe(element);
    return () => { resize.disconnect(); container.style.removeProperty('--page-heading-height'); };
  }, []);
  return <div className="page-heading" ref={ref}><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>;
}
export function EmptyState({ title = '没有找到录像', description = '试试其他日期或录像源。', action, actionLabel }) {
  return <div className="empty-state"><FolderOpen size={38} weight="light" /><h3>{title}</h3><p>{description}</p>{action && <button className="button secondary" onClick={action}>{actionLabel}<ArrowRight size={16} /></button>}</div>;
}
export function Modal({ title, description, children, onClose, wide = false, className = '', footer, form, busy = false, scrollKey }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const focusable = dialog.querySelector('input:not([disabled]), select:not([disabled])') || dialog.querySelector('button:not([disabled])');
    focusable?.focus({ preventScroll: true });
    const cancel = e => { e.preventDefault(); if (!busyRef.current) closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [scrollKey]);
  const layout = <><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><IconButton icon={X} label="关闭弹窗" disabled={busy} onClick={onClose} /></div><div className="modal-body" ref={bodyRef}>{form ? <fieldset className="modal-fields" disabled={busy}>{children}</fieldset> : children}</div>{footer && <footer className="modal-actions">{footer}</footer>}</>;
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy} className={`modal ${wide ? 'wide' : ''} ${className}`} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}><div className="modal-content">{form ? <form {...form} className="modal-form">{layout}</form> : layout}</div></dialog>;
}
export function Toast({ message, onClose }) {
  useEffect(() => { if (!message) return; const timer = setTimeout(onClose, 4200); return () => clearTimeout(timer); }, [message, onClose]);
  return <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite">{message && <><CheckCircle size={20} weight="fill" /><span>{message}</span><IconButton icon={X} label="关闭提示" onClick={onClose} /></>}</div>;
}
export function Notice({ children, warning = false }) {
  return <div className={`notice ${warning ? 'warning' : ''}`}><WarningCircle size={18} /><span>{children}</span></div>;
}
export function ExtensionSlot({ name, context, showPlaceholder = true }) {
  const extensions = extensionRegistry.forSlot(name);
  if (!extensions.length) return showPlaceholder ? <PhaseTwoPlaceholder slot={name} /> : null;
  return extensions.map(extension => {
    const Component = extension.component;
    return Component ? <Component key={extension.id} context={context} /> : null;
  });
}
