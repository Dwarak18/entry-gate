// One-time script: Reset ALL teams' quiz data (for testing)
// Run with: node database/reset-all-quizzes.js

import pool from '../config/database.js';

async function resetAllQuizzes() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete in dependency order
    const r1 = await client.query('DELETE FROM results');
    const r2 = await client.query('DELETE FROM cheat_logs');
    const r3 = await client.query('DELETE FROM team_attempts');
    const r4 = await client.query('DELETE FROM team_sections');
    const r5 = await client.query('DELETE FROM team_questions');
    const r6 = await client.query('UPDATE teams SET quiz_started_at = NULL');

    await client.query('COMMIT');

    console.log('✅ All quiz data reset:');
    console.log(`   Results deleted: ${r1.rowCount}`);
    console.log(`   Cheat logs deleted: ${r2.rowCount}`);
    console.log(`   Attempts deleted: ${r3.rowCount}`);
    console.log(`   Sections deleted: ${r4.rowCount}`);
    console.log(`   Team questions deleted: ${r5.rowCount}`);
    console.log(`   Teams timer reset: ${r6.rowCount}`);
    console.log('');
    console.log('All teams can now retake the quiz from scratch.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error resetting quizzes:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

resetAllQuizzes();
