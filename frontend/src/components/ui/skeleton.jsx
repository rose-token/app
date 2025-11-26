import React from 'react';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className || ''}`}
      style={{ background: 'rgba(255, 255, 255, 0.08)' }}
      {...props}
    />
  );
}
