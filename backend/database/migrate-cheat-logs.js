import pool from '../config/database.js';

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cheat_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cheat_logs_team_id ON cheat_logs(team_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cheat_logs_created_at ON cheat_logs(created_at DESC)');
    console.log('✅ cheat_logs table created successfully');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

migrate();
