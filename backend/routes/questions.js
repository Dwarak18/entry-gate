import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Fisher-Yates (Knuth) shuffle — unbiased
function fisherYatesShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Section order and expected counts
const SECTIONS = [
  { name: 'C', count: 12 },
  { name: 'Python', count: 12 },
  { name: 'Java', count: 13 },
  { name: 'SQL', count: 13 },
];

// Assign questions to team grouped by section, shuffled within each
async function assignQuestionsToTeam(teamId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Advisory lock to prevent race conditions (hash teamId to integer)
    const lockKey = Math.abs(teamId.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // Check if questions already assigned (safe under advisory lock)
    const existingCheck = await client.query(
      'SELECT COUNT(*) FROM team_questions WHERE team_id = $1',
      [teamId]
    );

    if (parseInt(existingCheck.rows[0].count) > 0) {
      await client.query('COMMIT');
      return; // Questions already assigned
    }

    // Fetch ALL questions grouped by category
    const questionsResult = await client.query('SELECT id, category FROM questions');
    const byCategory = {};
    for (const row of questionsResult.rows) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row.id);
    }

    // Build ordered list: C(1-12), Python(13-24), Java(25-37), SQL(38-50)
    // Shuffle within each category using Fisher-Yates
    const orderedQuestions = [];
    for (const section of SECTIONS) {
      const categoryQuestions = byCategory[section.name];
      if (!categoryQuestions || categoryQuestions.length < section.count) {
        throw new Error(`Not enough ${section.name} questions: have ${categoryQuestions?.length || 0}, need ${section.count}`);
      }
      const shuffled = fisherYatesShuffle(categoryQuestions).slice(0, section.count);
      for (const qId of shuffled) {
        orderedQuestions.push({ question_id: qId, section: section.name });
      }
    }

    // Parameterized batch INSERT for all 50 questions (with section)
    const params = [];
    const valuePlaceholders = orderedQuestions.map((q, i) => {
      const offset = i * 4;
      params.push(teamId, q.question_id, i + 1, q.section);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    }).join(', ');

    await client.query(
      `INSERT INTO team_questions (team_id, question_id, question_order, section)
       VALUES ${valuePlaceholders}`,
      params
    );

    // Initialize section tracking rows
    const sectionParams = [];
    const sectionPlaceholders = SECTIONS.map((s, i) => {
      const offset = i * 2;
      sectionParams.push(teamId, s.name);
      return `($${offset + 1}, $${offset + 2}, FALSE)`;
    }).join(', ');

    await client.query(
      `INSERT INTO team_sections (team_id, section_name, completed)
       VALUES ${sectionPlaceholders}
       ON CONFLICT (team_id, section_name) DO NOTHING`,
      sectionParams
    );

    // NOTE: quiz_started_at is set when user explicitly clicks "Start Quiz"
    // via POST /submissions/start — not here during question assignment

    await client.query('COMMIT');
    console.log(`✅ Assigned ${orderedQuestions.length} questions to team ${teamId} (sectioned)`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error assigning questions:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Get questions for logged-in team
router.get('/', authenticateToken, async (req, res) => {
  try {
    const teamId = req.user.id;

    // Ensure questions are assigned
    await assignQuestionsToTeam(teamId);

    // Get server-side timer info
    const teamInfo = await pool.query(
      'SELECT quiz_started_at FROM teams WHERE id = $1',
      [teamId]
    );
    const quizStartedAt = teamInfo.rows[0]?.quiz_started_at;
    const QUIZ_DURATION = 60 * 60; // 60 minutes in seconds
    let serverTimeRemaining = QUIZ_DURATION;

    if (quizStartedAt) {
      const elapsed = Math.floor((Date.now() - new Date(quizStartedAt).getTime()) / 1000);
      serverTimeRemaining = Math.max(0, QUIZ_DURATION - elapsed);
    }

    // Fetch assigned questions with their order and section
    const result = await pool.query(
      `SELECT 
        q.id,
        q.category,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        tq.question_order,
        tq.section,
        ta.selected_answer
       FROM team_questions tq
       JOIN questions q ON tq.question_id = q.id
       LEFT JOIN team_attempts ta ON ta.team_id = tq.team_id AND ta.question_id = q.id
       WHERE tq.team_id = $1
       ORDER BY tq.question_order`,
      [teamId]
    );

    // Fetch section completion status
    const sectionsResult = await pool.query(
      `SELECT section_name, completed, completed_at
       FROM team_sections
       WHERE team_id = $1
       ORDER BY CASE section_name
         WHEN 'C' THEN 1 WHEN 'Python' THEN 2
         WHEN 'Java' THEN 3 WHEN 'SQL' THEN 4
       END`,
      [teamId]
    );

    // Don't send correct answers to frontend
    const questions = result.rows.map(q => ({
      id: q.id,
      category: q.category,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      question_order: q.question_order,
      section: q.section,
      selected_answer: q.selected_answer || null
    }));

    const sections = sectionsResult.rows.map(s => ({
      name: s.section_name,
      completed: s.completed,
      completed_at: s.completed_at
    }));

    res.json({
      questions,
      sections,
      total: questions.length,
      serverTimeRemaining,
      quizStartedAt
    });

  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// Get specific question by order number
router.get('/:order', authenticateToken, async (req, res) => {
  try {
    const teamId = req.user.id;
    const order = parseInt(req.params.order);

    if (isNaN(order) || order < 1 || order > 50) {
      return res.status(400).json({ error: 'Invalid question number' });
    }

    const result = await pool.query(
      `SELECT 
        q.id,
        q.category,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        tq.question_order,
        ta.selected_answer
       FROM team_questions tq
       JOIN questions q ON tq.question_id = q.id
       LEFT JOIN team_attempts ta ON ta.team_id = tq.team_id AND ta.question_id = q.id
       WHERE tq.team_id = $1 AND tq.question_order = $2`,
      [teamId, order]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const q = result.rows[0];
    const question = {
      id: q.id,
      category: q.category,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      question_order: q.question_order,
      selected_answer: q.selected_answer || null
    };

    res.json(question);

  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ error: 'Failed to fetch question' });
  }
});

export default router;
