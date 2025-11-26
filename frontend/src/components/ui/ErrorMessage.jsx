import React from 'react';

const ErrorMessage = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div
      className="flex justify-between items-center p-4 rounded-xl mb-4"
      style={{
        background: 'var(--error-bg)',
        border: '1px solid rgba(248, 113, 113, 0.3)',
        color: 'var(--error)'
      }}
    >
      <div>{message}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-4 transition-opacity hover:opacity-70"
          style={{ color: 'var(--error)' }}
        >
          ×
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;
