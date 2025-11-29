/**
 * Skills constants for Rose Token marketplace profiles
 * Skills are predefined and users select from this list
 */

export const SKILLS = [
  { id: 'solidity', label: 'Solidity', category: 'blockchain' },
  { id: 'rust', label: 'Rust', category: 'blockchain' },
  { id: 'typescript', label: 'TypeScript', category: 'frontend' },
  { id: 'react', label: 'React', category: 'frontend' },
  { id: 'node', label: 'Node.js', category: 'backend' },
  { id: 'python', label: 'Python', category: 'backend' },
  { id: 'design', label: 'UI/UX Design', category: 'design' },
  { id: 'smart-contracts', label: 'Smart Contracts', category: 'blockchain' },
  { id: 'frontend', label: 'Frontend Development', category: 'frontend' },
  { id: 'backend', label: 'Backend Development', category: 'backend' },
  { id: 'devops', label: 'DevOps', category: 'infrastructure' },
  { id: 'security', label: 'Security Auditing', category: 'blockchain' },
  { id: 'testing', label: 'Testing/QA', category: 'quality' },
  { id: 'documentation', label: 'Documentation', category: 'quality' },
  { id: 'data', label: 'Data Engineering', category: 'backend' },
];

export const SKILL_CATEGORIES = {
  blockchain: { label: 'Blockchain', color: 'var(--rose-pink)' },
  frontend: { label: 'Frontend', color: 'var(--info)' },
  backend: { label: 'Backend', color: 'var(--success)' },
  design: { label: 'Design', color: 'var(--warning)' },
  infrastructure: { label: 'Infrastructure', color: 'var(--rose-gold)' },
  quality: { label: 'Quality', color: 'var(--text-secondary)' },
};

export const MAX_SKILLS = 10;

/**
 * Get a skill by its ID
 * @param {string} id - Skill ID
 * @returns {Object|undefined} Skill object or undefined
 */
export const getSkillById = (id) => SKILLS.find((s) => s.id === id);

/**
 * Get multiple skills by their IDs
 * @param {string[]} ids - Array of skill IDs
 * @returns {Object[]} Array of skill objects (filters out invalid IDs)
 */
export const getSkillsByIds = (ids) => ids.map(getSkillById).filter(Boolean);

/**
 * Get skills grouped by category
 * @returns {Object} Skills grouped by category key
 */
export const getSkillsByCategory = () => {
  return SKILLS.reduce((acc, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {});
};

/**
 * Validate skill IDs array
 * @param {string[]} ids - Array of skill IDs to validate
 * @returns {boolean} True if all IDs are valid and within max limit
 */
export const validateSkills = (ids) => {
  if (!Array.isArray(ids)) return false;
  if (ids.length > MAX_SKILLS) return false;
  return ids.every((id) => getSkillById(id) !== undefined);
};
