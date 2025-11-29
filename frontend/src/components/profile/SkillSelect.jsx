/**
 * SkillSelect component
 * Multi-select dropdown for choosing skills from predefined list
 */

import React, { useState, useRef, useEffect } from 'react';
import { SKILLS, SKILL_CATEGORIES, MAX_SKILLS, getSkillsByCategory } from '../../constants/skills';
import SkillBadge from './SkillBadge';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * SkillSelect - Multi-select dropdown for skills
 * @param {Object} props
 * @param {string[]} props.selected - Currently selected skill IDs
 * @param {Function} props.onChange - Callback when selection changes
 * @param {number} props.max - Maximum skills allowed (default: 10)
 * @param {boolean} props.disabled - Disable the selector
 */
const SkillSelect = ({ selected = [], onChange, max = MAX_SKILLS, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const skillsByCategory = getSkillsByCategory();

  // Filter skills based on search term
  const filteredSkills = searchTerm
    ? SKILLS.filter((skill) =>
        skill.label.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : null;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleToggle = (skillId) => {
    if (selected.includes(skillId)) {
      onChange(selected.filter((id) => id !== skillId));
    } else if (selected.length < max) {
      onChange([...selected, skillId]);
    }
  };

  const handleRemove = (skillId) => {
    onChange(selected.filter((id) => id !== skillId));
  };

  const isAtMax = selected.length >= max;

  return (
    <div ref={containerRef} className="relative">
      {/* Selected skills display */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((skillId) => (
            <SkillBadge
              key={skillId}
              skillId={skillId}
              size="md"
              onRemove={disabled ? undefined : handleRemove}
            />
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-left transition-all duration-200 ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-[var(--rose-pink)]'
        }`}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
        }}
      >
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isAtMax
            ? `Maximum ${max} skills selected`
            : `Select skills (${selected.length}/${max})`}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-secondary)' }}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute z-50 w-full mt-2 rounded-xl shadow-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            maxHeight: '300px',
          }}
        >
          {/* Search input */}
          <div
            className="sticky top-0 p-2"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--text-secondary)' }}
              />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search skills..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[var(--bg-tertiary)]"
                >
                  <X className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                </button>
              )}
            </div>
          </div>

          {/* Skills list */}
          <div className="overflow-y-auto" style={{ maxHeight: '220px' }}>
            {filteredSkills ? (
              // Search results
              <div className="p-2">
                {filteredSkills.length === 0 ? (
                  <p
                    className="text-sm text-center py-4"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    No skills found
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredSkills.map((skill) => (
                      <SkillOption
                        key={skill.id}
                        skill={skill}
                        isSelected={selected.includes(skill.id)}
                        isDisabled={isAtMax && !selected.includes(skill.id)}
                        onToggle={handleToggle}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Grouped by category
              <div className="p-2 space-y-3">
                {Object.entries(skillsByCategory).map(([categoryKey, skills]) => {
                  const category = SKILL_CATEGORIES[categoryKey];
                  return (
                    <div key={categoryKey}>
                      <h4
                        className="text-xs font-semibold uppercase tracking-wide mb-1.5 px-2"
                        style={{ color: category.color }}
                      >
                        {category.label}
                      </h4>
                      <div className="space-y-0.5">
                        {skills.map((skill) => (
                          <SkillOption
                            key={skill.id}
                            skill={skill}
                            isSelected={selected.includes(skill.id)}
                            isDisabled={isAtMax && !selected.includes(skill.id)}
                            onToggle={handleToggle}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Individual skill option in the dropdown
 */
const SkillOption = ({ skill, isSelected, isDisabled, onToggle }) => {
  const category = SKILL_CATEGORIES[skill.category];

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onToggle(skill.id)}
      disabled={isDisabled}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
        isDisabled && !isSelected
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-[var(--bg-secondary)]'
      }`}
      style={{
        backgroundColor: isSelected ? 'var(--bg-secondary)' : 'transparent',
        color: 'var(--text-primary)',
      }}
    >
      {/* Checkbox indicator */}
      <div
        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
        style={{
          border: isSelected
            ? `2px solid ${category.color}`
            : '2px solid var(--border-color)',
          backgroundColor: isSelected ? category.color : 'transparent',
        }}
      >
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span>{skill.label}</span>
    </button>
  );
};

export default SkillSelect;
