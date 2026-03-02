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

    // Seed default admin if none exists
    const adminCheck = await client.query('SELECT COUNT(*) FROM admins');
    if (parseInt(adminCheck.rows[0].count) === 0) {
      const passwordHash = await bcrypt.hash('heisenberg', 10);
      await client.query(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
        ['admin', passwordHash]
      );
      console.log('✅ Default admin created: username=admin, password=heisenberg');
    } else {
      console.log('ℹ️  Admin already exists, skipping seed.');
    }
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();
