import React from 'react';

const Badge = ({ children, variant = "default", className = "", ...props }) => {
  const baseClasses = "inline-flex items-center px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold uppercase tracking-wide";

  const variantStyles = {
    default: {
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-secondary)'
    },
    secondary: {
      background: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-secondary)'
    },
    outline: {
      background: 'transparent',
      border: '1px solid var(--border-accent)',
      color: 'var(--text-secondary)'
    },
    destructive: {
      background: 'var(--error-bg)',
      border: '1px solid rgba(248, 113, 113, 0.3)',
      color: 'var(--error)'
    },
    warning: {
      background: 'var(--warning-bg)',
      border: '1px solid rgba(251, 191, 36, 0.3)',
      color: 'var(--warning)'
    },
    success: {
      background: 'var(--success-bg)',
      border: '1px solid rgba(74, 222, 128, 0.3)',
      color: 'var(--success)'
    },
    info: {
      background: 'var(--info-bg)',
      border: '1px solid rgba(96, 165, 250, 0.3)',
      color: 'var(--info)'
    },
    stakeholder: {
      background: 'var(--warning-bg)',
      border: '1px solid rgba(251, 191, 36, 0.3)',
      color: 'var(--warning)'
    },
    worker: {
      background: 'var(--info-bg)',
      border: '1px solid rgba(96, 165, 250, 0.3)',
      color: 'var(--info)'
    },
    complete: {
      background: 'var(--success-bg)',
      border: '1px solid rgba(74, 222, 128, 0.3)',
      color: 'var(--success)'
    },
    inProgress: {
      background: 'var(--rose-pink-muted)',
      border: '1px solid rgba(212, 165, 165, 0.3)',
      color: 'var(--rose-pink-light)'
    }
  };

  return (
    <span
      className={`${baseClasses} ${className}`}
      style={variantStyles[variant] || variantStyles.default}
      {...props}
    >
      {children}
    </span>
  );
};

export { Badge };
