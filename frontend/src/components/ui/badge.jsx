import React from 'react';

const Badge = ({ children, variant = "default", className = "", ...props }) => {
  const baseClasses = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";

  const variantClasses = {
    default: "bg-muted text-muted-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    outline: "border border-muted text-muted-foreground bg-background",
    destructive: "bg-destructive/10 text-destructive"
  };

  const classes = `${baseClasses} ${variantClasses[variant] || variantClasses.default} ${className}`;

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

export { Badge };
