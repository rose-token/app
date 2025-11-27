import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
