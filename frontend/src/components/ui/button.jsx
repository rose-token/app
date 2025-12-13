import React from 'react';

export function Button({ className, variant = "default", size = "default", style, ...props }) {
  const baseClasses = "inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 btn-press";

  const variantStyles = {
    default: {
      background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
      color: 'var(--bg-primary)',
      boxShadow: '0 4px 16px rgba(212, 165, 165, 0.3)'
    },
    destructive: {
      background: 'var(--error-bg)',
      border: '1px solid rgba(248, 113, 113, 0.3)',
      color: 'var(--error)'
    },
    outline: {
      background: 'transparent',
      border: '1px solid rgba(212, 165, 165, 0.3)',
      color: 'var(--rose-pink)'
    },
    secondary: {
      background: 'transparent',
      border: '1px solid rgba(212, 165, 165, 0.3)',
      color: 'var(--rose-pink)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)'
    },
    link: {
      background: 'transparent',
      color: 'var(--rose-pink)',
      textDecoration: 'underline'
    },
    success: {
      background: 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
      color: 'var(--bg-primary)',
      boxShadow: '0 4px 16px rgba(74, 222, 128, 0.3)'
    },
    warning: {
      background: 'linear-gradient(135deg, var(--warning) 0%, #f59e0b 100%)',
      color: 'var(--bg-primary)',
      boxShadow: '0 4px 16px rgba(251, 191, 36, 0.3)'
    },
    info: {
      background: 'var(--info-bg)',
      border: '1px solid rgba(96, 165, 250, 0.3)',
      color: 'var(--info)'
    }
  };

  const sizeClasses = {
    default: "h-11 px-6 py-2",
    sm: "h-9 px-4 text-xs",
    lg: "h-12 px-8",
    icon: "h-10 w-10"
  };

  const hoverEffects = {
    default: "hover:translate-y-[-2px] hover:shadow-[0_6px_24px_rgba(212,165,165,0.4)]",
    destructive: "hover:bg-[rgba(248,113,113,0.25)]",
    outline: "hover:bg-[rgba(212,165,165,0.15)]",
    secondary: "hover:bg-[rgba(212,165,165,0.15)]",
    ghost: "hover:bg-[rgba(255,255,255,0.05)]",
    link: "hover:opacity-80",
    success: "hover:translate-y-[-2px] hover:shadow-[0_6px_24px_rgba(74,222,128,0.4)]",
    warning: "hover:translate-y-[-2px] hover:shadow-[0_6px_24px_rgba(251,191,36,0.4)]",
    info: "hover:bg-[rgba(96,165,250,0.25)]"
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${hoverEffects[variant] || ''} ${className || ''}`}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    />
  );
}
