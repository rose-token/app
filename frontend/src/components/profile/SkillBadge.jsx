/**
 * SkillBadge component
 * Displays a skill as a styled pill/tag
 */

import React from 'react';
import { getSkillById, SKILL_CATEGORIES } from '../../constants/skills';

/**
 * SkillBadge - Displays a skill as a colored pill
 * @param {Object} props
 * @param {string} props.skillId - The skill ID to display
 * @param {string} props.size - Size variant: 'sm' | 'md' (default: 'sm')
 * @param {Function} props.onRemove - Optional callback to remove skill (shows X button)
 */
const SkillBadge = ({ skillId, size = 'sm', onRemove }) => {
  const skill = getSkillById(skillId);

  if (!skill) {
    return null;
  }

  const category = SKILL_CATEGORIES[skill.category] || SKILL_CATEGORIES.quality;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses[size]}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${category.color} 20%, transparent)`,
        color: category.color,
        border: `1px solid color-mix(in srgb, ${category.color} 30%, transparent)`,
      }}
    >
      <span>{skill.label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(skillId);
          }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
          aria-label={`Remove ${skill.label}`}
        >
          <svg
            className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </span>
  );
};

/**
 * SkillBadgeList - Displays multiple skills
 * @param {Object} props
 * @param {string[]} props.skills - Array of skill IDs
 * @param {string} props.size - Size variant
 * @param {number} props.max - Maximum skills to show (rest shown as +N)
 * @param {Function} props.onRemove - Optional callback to remove skills
 */
export const SkillBadgeList = ({ skills = [], size = 'sm', max, onRemove }) => {
  if (!skills || skills.length === 0) {
    return null;
  }

  const visibleSkills = max ? skills.slice(0, max) : skills;
  const hiddenCount = max ? Math.max(0, skills.length - max) : 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleSkills.map((skillId) => (
        <SkillBadge
          key={skillId}
          skillId={skillId}
          size={size}
          onRemove={onRemove}
        />
      ))}
      {hiddenCount > 0 && (
        <span
          className={`inline-flex items-center rounded-full font-medium ${
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
          }`}
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
          }}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
};

export default SkillBadge;
