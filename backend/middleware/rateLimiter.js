import rateLimit from 'express-rate-limit';

// Rate limiter for login endpoints
// Competition context: many teams login from the same IP (college network/proxy),
// so we allow 200 attempts per 15 min window per IP.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many login attempts from this network. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for general API endpoints
// 50 teams × ~120 requests each = ~6,000 per session from one IP.
// Keeping 10,000 per 15 min gives comfortable headroom.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000,
  message: { error: 'Too many requests from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for anti-cheat activity logging
// 50 teams on same IP: need at least 50 events/min headroom.
export const activityLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  message: { error: 'Too many activity log requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});
