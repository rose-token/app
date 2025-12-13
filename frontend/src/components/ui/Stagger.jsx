import React, { Children, cloneElement, isValidElement } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Stagger - Wrapper component for sequential child animations
 *
 * Applies staggered slide-up animations to each child element.
 * Respects prefers-reduced-motion for accessibility.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child elements to animate
 * @param {number} props.delay - Milliseconds between each child (default: 50)
 * @param {string} props.className - Classes for the wrapper
 * @param {'div'|'ul'|'ol'|'section'} props.as - Wrapper element type (default: 'div')
 *
 * @example
 * <Stagger delay={75} className="grid grid-cols-3 gap-4">
 *   <StatCard label="Price" value="$1.23" />
 *   <StatCard label="Supply" value="1,000,000" />
 *   <StatCard label="Volume" value="$50K" />
 * </Stagger>
 */
const Stagger = ({
  children,
  delay = 50,
  className = '',
  as: Component = 'div',
}) => {
  const prefersReducedMotion = useReducedMotion();

  const childArray = Children.toArray(children).filter(isValidElement);

  return (
    <Component className={className}>
      {childArray.map((child, index) => {
        // Skip animation if user prefers reduced motion
        if (prefersReducedMotion) {
          return child;
        }

        const animationDelay = index * delay;

        // Clone element with animation classes and custom delay
        // Inline animationDelay provides precise control; stagger-N classes kept in CSS for manual use
        return cloneElement(child, {
          key: child.key || index,
          className: `${child.props.className || ''} animate-initial animate-slide-up`.trim(),
          style: {
            ...child.props.style,
            animationDelay: `${animationDelay}ms`,
          },
        });
      })}
    </Component>
  );
};

export default Stagger;
