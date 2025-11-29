// Skills must match frontend/src/constants/skills.js
export const ALLOWED_SKILLS = [
  'solidity',
  'rust',
  'typescript',
  'react',
  'node',
  'python',
  'design',
  'smart-contracts',
  'frontend',
  'backend',
  'devops',
  'security',
  'testing',
  'documentation',
  'data',
] as const;

export type SkillId = (typeof ALLOWED_SKILLS)[number];

export const MAX_SKILLS = 10;

export function validateSkills(skills: string[]): { valid: boolean; invalid: string[] } {
  if (!Array.isArray(skills)) {
    return { valid: false, invalid: [] };
  }

  if (skills.length > MAX_SKILLS) {
    return { valid: false, invalid: [] };
  }

  const allowedSet = new Set<string>(ALLOWED_SKILLS);
  const invalid = skills.filter((s) => !allowedSet.has(s));

  return {
    valid: invalid.length === 0,
    invalid,
  };
}

export function isValidSkill(skill: string): skill is SkillId {
  return ALLOWED_SKILLS.includes(skill as SkillId);
}
