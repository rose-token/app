import React from 'react';

const ErrorMessage = ({ message, onDismiss }) => {
  if (!message) return null;
  
  return (
    <div className="flex justify-between items-center bg-red-100 text-red-700 p-4 rounded-md mb-4">
      <div>{message}</div>
      {onDismiss && (
        <button 
          onClick={onDismiss} 
          className="text-red-500 hover:text-red-700 ml-4"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;
