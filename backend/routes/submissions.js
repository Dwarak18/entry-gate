import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateAnswer } from '../middleware/validation.js';
import { activityLogLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const QUIZ_DURATION = 60 * 60; // 60 minutes in seconds
const GRACE_PERIOD = 30; // 30 seconds grace for network latency

// Fixed section order
const SECTION_ORDER = ['C', 'Python', 'Java', 'SQL'];

// Helper: check if quiz time has expired server-side
async function checkQuizTimeExpired(teamId) {
  const result = await pool.query(
    'SELECT quiz_started_at FROM teams WHERE id = $1',
    [teamId]
  );
  const startedAt = result.rows[0]?.quiz_started_at;
  if (!startedAt) return false; // quiz hasn't started
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return elapsed > (QUIZ_DURATION + GRACE_PERIOD);
}

// Helper: calculate server-side time taken
async function calculateTimeTaken(teamId) {
  const result = await pool.query(
    'SELECT quiz_started_at FROM teams WHERE id = $1',
    [teamId]
  );
  const startedAt = result.rows[0]?.quiz_started_at;
  if (!startedAt) return null;
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

// Save/Update answer for a question
router.post('/answer', authenticateToken, validateAnswer, async (req, res) => {
  try {
    const teamId = req.user.id;
    const { question_id, selected_answer } = req.body;

    // Server-side time check — reject if quiz expired
    const expired = await checkQuizTimeExpired(teamId);
    if (expired) {
      return res.status(403).json({ error: 'Quiz time has expired. You can no longer save answers.' });
    }

    // Verify this question is assigned to this team (and get its section)
    const assignedCheck = await pool.query(
      'SELECT id, section FROM team_questions WHERE team_id = $1 AND question_id = $2',
      [teamId, question_id]
    );

    if (assignedCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Question not assigned to your team' });
    }

    // Enforce section ordering: can only answer questions in the current or completed sections
    const questionSection = assignedCheck.rows[0].section;
    if (questionSection) {
      const sectionStatus = await pool.query(
        `SELECT section_name, completed FROM team_sections WHERE team_id = $1`,
        [teamId]
      );
      const sectionMap = {};
      for (const row of sectionStatus.rows) {
        sectionMap[row.section_name] = row.completed;
      }
      
      // Find current active section (first non-completed)
      const currentSectionIdx = SECTION_ORDER.findIndex(s => !sectionMap[s]);
      const questionSectionIdx = SECTION_ORDER.indexOf(questionSection);
      
      // Allow answers only in current active section (or already completed sections for re-answers)
      if (questionSectionIdx > currentSectionIdx && currentSectionIdx !== -1) {
        return res.status(403).json({ error: 'This section is locked. Complete the current section first.' });
      }
      
      // Don't allow modifying answers in completed sections
      if (sectionMap[questionSection] === true) {
        return res.status(403).json({ error: 'This section is already completed. Answers are read-only.' });
      }
    }

    // Check if already submitted
    const submissionCheck = await pool.query(
      'SELECT id FROM results WHERE team_id = $1',
      [teamId]
    );

    if (submissionCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Quiz already submitted' });
    }

    // Get correct answer
    const questionResult = await pool.query(
      'SELECT correct_answer FROM questions WHERE id = $1',
      [question_id]
    );

    const correctAnswer = questionResult.rows[0].correct_answer;
    const isCorrect = selected_answer === correctAnswer;

    // Insert or update attempt
    await pool.query(
      `INSERT INTO team_attempts (team_id, question_id, selected_answer, is_correct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id, question_id)
       DO UPDATE SET 
         selected_answer = EXCLUDED.selected_answer,
         is_correct = EXCLUDED.is_correct,
         timestamp = CURRENT_TIMESTAMP`,
      [teamId, question_id, selected_answer, isCorrect]
    );

    res.json({
      message: 'Answer saved successfully',
      saved: true
    });

  } catch (error) {
    console.error('Error saving answer:', error);
    res.status(500).json({ error: 'Failed to save answer' });
  }
});

// Complete a section (lock it and advance)
router.post('/complete-section', authenticateToken, async (req, res) => {
  try {
    const teamId = req.user.id;
    const { section_name } = req.body;

    if (!section_name || !SECTION_ORDER.includes(section_name)) {
      return res.status(400).json({ error: 'Invalid section name' });
    }

    // Server-side time check
    const expired = await checkQuizTimeExpired(teamId);
    if (expired) {
      return res.status(403).json({ error: 'Quiz time has expired.' });
    }

    // Check already submitted
    const submissionCheck = await pool.query(
      'SELECT id FROM results WHERE team_id = $1',
      [teamId]
    );
    if (submissionCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Quiz already submitted' });
    }

    // Verify all previous sections are completed
    const sectionIdx = SECTION_ORDER.indexOf(section_name);
    if (sectionIdx > 0) {
      const prevSections = SECTION_ORDER.slice(0, sectionIdx);
      const prevCheck = await pool.query(
        `SELECT section_name, completed FROM team_sections 
         WHERE team_id = $1 AND section_name = ANY($2)`,
        [teamId, prevSections]
      );
      const allPrevCompleted = prevCheck.rows.length === prevSections.length && 
                                prevCheck.rows.every(r => r.completed);
      if (!allPrevCompleted) {
        return res.status(403).json({ error: 'Previous sections must be completed first.' });
      }
    }

    // Verify all questions in this section are answered
    const unanswered = await pool.query(
      `SELECT tq.question_id FROM team_questions tq
       LEFT JOIN team_attempts ta ON ta.team_id = tq.team_id AND ta.question_id = tq.question_id
       WHERE tq.team_id = $1 AND tq.section = $2 AND ta.selected_answer IS NULL`,
      [teamId, section_name]
    );
    if (unanswered.rows.length > 0) {
      return res.status(400).json({ 
        error: `Answer all questions in ${section_name} section before completing it.`,
        unanswered_count: unanswered.rows.length
      });
    }

    // Mark section as completed
    await pool.query(
      `UPDATE team_sections SET completed = TRUE, completed_at = CURRENT_TIMESTAMP
       WHERE team_id = $1 AND section_name = $2`,
      [teamId, section_name]
    );

    // Find next section
    const nextIdx = sectionIdx + 1;
    const nextSection = nextIdx < SECTION_ORDER.length ? SECTION_ORDER[nextIdx] : null;

    res.json({
      message: `${section_name} section completed`,
      completed: section_name,
      next_section: nextSection,
      all_complete: nextSection === null
    });

  } catch (error) {
    console.error('Error completing section:', error);
    res.status(500).json({ error: 'Failed to complete section' });
  }
});

// Submit final quiz
router.post('/submit', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const teamId = req.user.id;

    // Server-side time calculation (ignore client-provided time_taken)
    const timeTaken = await calculateTimeTaken(teamId);

    // Verify all 4 sections are completed before final submit
    const sectionsCheck = await pool.query(
      `SELECT COUNT(*) as completed_count FROM team_sections
       WHERE team_id = $1 AND completed = TRUE`,
      [teamId]
    );
    if (parseInt(sectionsCheck.rows[0].completed_count) < 4) {
      return res.status(403).json({ error: 'All sections must be completed before submitting.' });
    }

    await client.query('BEGIN');

    // Calculate score
    const scoreResult = await client.query(
      `SELECT COUNT(*) as correct_count
       FROM team_attempts
       WHERE team_id = $1 AND is_correct = true`,
      [teamId]
    );

    const totalScore = parseInt(scoreResult.rows[0].correct_count);

    // Race-safe insert: ON CONFLICT returns nothing, so we know if it was a duplicate
    const insertResult = await client.query(
      `INSERT INTO results (team_id, total_score, total_questions, time_taken)
       VALUES ($1, $2, 50, $3)
       ON CONFLICT (team_id) DO NOTHING
       RETURNING id`,
      [teamId, totalScore, timeTaken]
    );

    if (insertResult.rows.length === 0) {
      // Row already existed — duplicate submission
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quiz already submitted' });
    }

    await client.query('COMMIT');

    res.json({
      message: 'Quiz submitted successfully',
      score: totalScore,
      total: 50
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting quiz:', error);
    res.status(500).json({ error: 'Failed to submit quiz' });
  } finally {
    client.release();
  }
});

// Get submission status and score (if submitted)
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const teamId = req.user.id;

    const result = await pool.query(
      `SELECT 
        r.total_score,
        r.total_questions,
        r.time_taken,
        r.submitted_at,
        (SELECT COUNT(*) FROM team_attempts WHERE team_id = $1) as answered_count
       FROM results r
       WHERE r.team_id = $1`,
      [teamId]
    );

    if (result.rows.length === 0) {
      // Not yet submitted
      const answeredResult = await pool.query(
        'SELECT COUNT(*) FROM team_attempts WHERE team_id = $1',
        [teamId]
      );

      return res.json({
        submitted: false,
        answered_count: parseInt(answeredResult.rows[0].count)
      });
    }

    const data = result.rows[0];
    res.json({
      submitted: true,
      score: data.total_score,
      total: data.total_questions,
      time_taken: data.time_taken,
      submitted_at: data.submitted_at,
      answered_count: parseInt(data.answered_count)
    });

  } catch (error) {
    console.error('Error fetching submission status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Start quiz — sets quiz_started_at server-side (only on first call)
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const teamId = req.user.id;

    // Check if already submitted
    const submissionCheck = await pool.query(
      'SELECT id FROM results WHERE team_id = $1',
      [teamId]
    );
    if (submissionCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Quiz already submitted' });
    }

    // Set quiz_started_at only if not already set
    await pool.query(
      'UPDATE teams SET quiz_started_at = CURRENT_TIMESTAMP WHERE id = $1 AND quiz_started_at IS NULL',
      [teamId]
    );

    // Get current quiz_started_at
    const team = await pool.query(
      'SELECT quiz_started_at FROM teams WHERE id = $1',
      [teamId]
    );
    const startedAt = team.rows[0]?.quiz_started_at;
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const serverTimeRemaining = Math.max(0, QUIZ_DURATION - elapsed);

    res.json({
      quiz_started_at: startedAt,
      serverTimeRemaining
    });

  } catch (error) {
    console.error('Error starting quiz:', error);
    res.status(500).json({ error: 'Failed to start quiz' });
  }
});

// Log anti-cheat activity events
const VALID_EVENT_TYPES = ['TAB_SWITCH', 'WINDOW_BLUR', 'DEVTOOLS_OPEN', 'FULLSCREEN_EXIT'];

router.post('/log-activity', authenticateToken, activityLogLimiter, async (req, res) => {
  try {
    const teamId = req.user.id;
    const { event_type, details } = req.body;

    if (!event_type || !VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    // Sanitize details — truncate to 500 chars
    const safeDetails = details ? String(details).slice(0, 500) : null;

    await pool.query(
      `INSERT INTO cheat_logs (team_id, event_type, details) VALUES ($1, $2, $3)`,
      [teamId, event_type, safeDetails]
    );

    res.json({ logged: true });

  } catch (error) {
    console.error('Error logging activity:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

export default router;
