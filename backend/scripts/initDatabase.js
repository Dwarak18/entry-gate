import pool from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Initializing database schema...');
    
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schema);

    // Apply migrations for existing databases
    await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS plain_password TEXT;`);
    
    console.log('✅ Database schema created/verified successfully!');

    // Always upsert admin — uses ADMIN_PASSWORD env var, fallback to 'Admin@h2o2026'
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@h2o2026';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await client.query(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminUsername, passwordHash]
    );
    console.log(`✅ Admin upserted: username=${adminUsername}, password=${adminPassword}`);
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();
