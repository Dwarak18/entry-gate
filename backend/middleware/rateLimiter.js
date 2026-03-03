import rateLimit from 'express-rate-limit';

// Rate limiters intentionally set to very high values — competition environment
// where all teams share a single IP (college network/proxy).

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100000,
  standardHeaders: false,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100000,
  standardHeaders: false,
  legacyHeaders: false,
});

export const activityLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100000,
  standardHeaders: false,
  legacyHeaders: false,
});
