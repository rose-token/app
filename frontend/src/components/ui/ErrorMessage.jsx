import React from 'react';

const ErrorMessage = ({ message, onDismiss }) => {
  if (!message) return null;
  
  return (
    <div className="flex justify-between items-center bg-destructive/10 text-destructive p-4 rounded-md mb-4">
      <div>{message}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-destructive/70 hover:text-destructive ml-4"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;
