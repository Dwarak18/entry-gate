import rateLimit from 'express-rate-limit';

// Rate limiter for login endpoints
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for general API endpoints
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for anti-cheat activity logging
export const activityLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 12, // 12 log events per minute max
  message: 'Too many activity log requests.',
  standardHeaders: true,
  legacyHeaders: false,
});
