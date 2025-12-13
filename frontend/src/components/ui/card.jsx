import React from 'react';

export function Card({ className, ...props }) {
  return (
    <div
      className={`rounded-[20px] backdrop-blur-[20px] transition-colors duration-300 hover:border-[rgba(212,175,140,0.35)] ${className || ''}`}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={`flex flex-col space-y-1.5 p-7 pb-0 ${className || ''}`}
      {...props}
    />
  );
}

export function CardTitle({ className, children, ...props }) {
  return (
    <h3
      className={`font-display text-xl font-medium tracking-tight ${className || ''}`}
      style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ className, ...props }) {
  return (
    <p
      className={`text-sm ${className || ''}`}
      style={{ color: 'var(--text-muted)' }}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }) {
  return (
    <div
      className={`p-7 pt-5 ${className || ''}`}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={`flex items-center p-7 pt-0 ${className || ''}`}
      {...props}
    />
  );
}
