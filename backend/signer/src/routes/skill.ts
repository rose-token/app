import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

export const skillRouter = Router();

// Cache the SKILL.md content at startup
let skillContent: string;
try {
  // Development: SKILL.md at project root
  skillContent = readFileSync(join(__dirname, '../../../../SKILL.md'), 'utf-8');
} catch {
  // Docker: SKILL.md copied to /app/SKILL.md
  try {
    skillContent = readFileSync('/app/SKILL.md', 'utf-8');
  } catch {
    skillContent = '# Rose Token\n\nSKILL.md not found. See https://github.com/rose-token/app';
  }
}

// GET /skill — Serve SKILL.md as markdown
skillRouter.get('/', (_req: Request, res: Response) => {
  const accept = _req.headers.accept || '';

  if (accept.includes('application/json')) {
    res.json({
      name: 'Rose Token',
      version: '1.0.0',
      description: 'Decentralized task marketplace on Arbitrum — workers keep 95%',
      content: skillContent,
    });
  } else {
    res.type('text/markdown').send(skillContent);
  }
});
