// Migration: Add plain_password column to teams table
// Run with: node backend/database/migrate-plain-password.js

import pool from '../config/database.js';

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migration: add plain_password column to teams...');

    await client.query(`
      ALTER TABLE teams
      ADD COLUMN IF NOT EXISTS plain_password TEXT;
    `);

    console.log('✅ Migration complete: plain_password column added to teams table.');
    console.log('ℹ️  Existing teams will show "—" for password in admin panel.');
    console.log('    New teams added via the admin panel will have their password stored.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
