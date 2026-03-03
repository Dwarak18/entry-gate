import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { apiLimiter } from './middleware/rateLimiter.js';
import pool from './config/database.js';

// Import routes
import authRoutes from './routes/auth.js';
import questionRoutes from './routes/questions.js';
import submissionRoutes from './routes/submissions.js';
import adminRoutes from './routes/admin.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust first proxy (required for rate limiter to see real IPs behind Nginx/Railway/Render)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS — open to all origins so phones, tablets and any device can connect
app.use(cors({
  origin: true,   // reflect request origin (allows all)
  credentials: true,
}));

// Body parser middleware (increased limit for edge cases)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting (applied to all /api/ routes)
app.use('/api/', apiLimiter);

// Health check — keeps Render/Railway from sleeping; load balancers use this
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'MCQ Competition API is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.message === 'Only Excel files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
async function runMigrations() {
  const client = await pool.connect();
  try {
    // Ensure plain_password column exists (safe to run multiple times)
    await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS plain_password TEXT;`);
    console.log('✅ DB migrations applied');
  } catch (err) {
    // Non-fatal: table may not exist yet (first deploy runs init-db separately)
    console.warn('⚠️  Migration skipped (DB may not be initialized yet):', err.message);
  } finally {
    client.release();
  }
}

runMigrations().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   🚀 MCQ Competition Platform - Backend API       ║
║   Server running on port ${PORT}                      ║
║   Environment: ${process.env.NODE_ENV || 'development'}                      ║
║   Timestamp: ${new Date().toLocaleString()}           ║
╚════════════════════════════════════════════════════╝
    `);
  });

  // Keep-alive: prevents cloud load balancers from dropping idle connections
  server.keepAliveTimeout = 65000;   // slightly above most LB 60s timeout
  server.headersTimeout  = 70000;    // must be > keepAliveTimeout
  // Hard cap per request: 30s before forceful close (prevents pool exhaustion)
  server.requestTimeout  = 30000;
});

export default app;
