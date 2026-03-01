import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/database.js';
import { authenticateAdmin } from '../middleware/auth.js';
import xlsx from 'xlsx';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Parse CSV text into array of objects
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

const router = express.Router();

// Sanitize cell value — strip formula injection chars and trim
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  let str = String(value).trim();
  // Strip leading formula injection characters (=, +, -, @, |, \t, \r, \n)
  str = str.replace(/^[=+\-@|\t\r\n]+/, '');
  // Remove HTML/script tags
  str = str.replace(/<[^>]*>/g, '');
  return str;
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `teams-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      return cb(new Error('Only Excel (.xlsx/.xls) or CSV files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const uploadJSON = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.json') return cb(new Error('Only JSON files are allowed'));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Shared helper to insert teams from an array of row objects
async function insertTeams(client, data) {
  let created = 0, skipped = 0;
  const errors = [];

  for (const row of data) {
    try {
      const teamId = sanitizeCell(row['Team ID'] || row['team_id']);
      const teamName = sanitizeCell(row['Team Name'] || row['team_name']);
      const password = row['Password'] || row['password'];

      if (!teamId || !teamName || !password) {
        errors.push(`Row ${created + skipped + 1}: Missing required fields (team_id, team_name, password)`);
        skipped++; continue;
      }
      if (teamId.length > 50) { errors.push(`Row ${created + skipped + 1}: Team ID exceeds 50 characters`); skipped++; continue; }
      if (teamName.length > 255) { errors.push(`Row ${created + skipped + 1}: Team Name exceeds 255 characters`); skipped++; continue; }

      const existingTeam = await client.query('SELECT id FROM teams WHERE team_id = $1', [teamId]);
      if (existingTeam.rows.length > 0) {
        errors.push(`Team ID "${teamId}" already exists`);
        skipped++; continue;
      }

      const hashedPassword = await bcrypt.hash(String(password), 10);
      await client.query(
        'INSERT INTO teams (team_id, team_name, password_hash) VALUES ($1, $2, $3)',
        [teamId, teamName, hashedPassword]
      );
      created++;
    } catch (error) {
      errors.push(`Row ${created + skipped + 1}: ${error.message}`);
      skipped++;
    }
  }
  return { created, skipped, errors };
}

// Upload teams from Excel or CSV
router.post('/upload-teams', authenticateAdmin, upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let data;

    if (ext === '.csv') {
      const text = fs.readFileSync(req.file.path, 'utf8');
      data = parseCSV(text);
    } else {
      // Excel
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      data = xlsx.utils.sheet_to_json(sheet);
    }

    if (data.length === 0) {
      return res.status(400).json({ error: 'File is empty' });
    }

    if (data.length > 500) {
      return res.status(400).json({ error: 'File exceeds maximum of 500 teams per upload' });
    }

    await client.query('BEGIN');
    const { created, skipped, errors } = await insertTeams(client, data);
    await client.query('COMMIT');

    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      message: 'Teams upload completed',
      created, skipped, total: data.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    await client.query('ROLLBACK');
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Error uploading teams:', error);
    res.status(500).json({ error: 'Failed to upload teams' });
  } finally {
    client.release();
  }
});

// Upload teams from JSON file
router.post('/upload-teams-json', authenticateAdmin, uploadJSON.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = fs.readFileSync(req.file.path, 'utf8');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON format' });
    }

    if (!Array.isArray(data)) return res.status(400).json({ error: 'JSON must be an array of team objects' });
    if (data.length === 0) return res.status(400).json({ error: 'JSON file is empty' });
    if (data.length > 500) return res.status(400).json({ error: 'Exceeds maximum of 500 teams per upload' });

    await client.query('BEGIN');
    const { created, skipped, errors } = await insertTeams(client, data);
    await client.query('COMMIT');

    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      message: 'Teams upload completed',
      created, skipped, total: data.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    await client.query('ROLLBACK');
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Error uploading teams JSON:', error);
    res.status(500).json({ error: 'Failed to upload teams' });
  } finally {
    client.release();
  }
});

// Get all teams
router.get('/teams', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        t.id,
        t.team_id,
        t.team_name,
        t.created_at,
        r.total_score,
        r.submitted_at,
        COALESCE(ac.answered_count, 0) as answered_count
       FROM teams t
       LEFT JOIN results r ON r.team_id = t.id
       LEFT JOIN (
         SELECT team_id, COUNT(*) as answered_count 
         FROM team_attempts 
         GROUP BY team_id
       ) ac ON ac.team_id = t.id
       ORDER BY t.created_at DESC`
    );

    const teams = result.rows.map(row => ({
      id: row.id,
      team_id: row.team_id,
      team_name: row.team_name,
      created_at: row.created_at,
      score: row.total_score,
      submitted_at: row.submitted_at,
      answered_count: parseInt(row.answered_count || 0),
      status: row.submitted_at ? 'completed' : (parseInt(row.answered_count) > 0 ? 'in-progress' : 'not-started')
    }));

    res.json({ teams, total: teams.length });

  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Get leaderboard (with section-wise scores)
router.get('/leaderboard', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        t.team_id,
        t.team_name,
        r.total_score,
        r.total_questions,
        r.time_taken,
        r.submitted_at,
        ROUND((r.total_score::decimal / r.total_questions) * 100, 2) AS accuracy,
        COALESCE(ss.c_score, 0) AS c_score,
        COALESCE(ss.python_score, 0) AS python_score,
        COALESCE(ss.java_score, 0) AS java_score,
        COALESCE(ss.sql_score, 0) AS sql_score
       FROM results r
       JOIN teams t ON r.team_id = t.id
       LEFT JOIN (
         SELECT 
           ta.team_id,
           SUM(CASE WHEN q.category = 'C' AND ta.is_correct THEN 1 ELSE 0 END) AS c_score,
           SUM(CASE WHEN q.category = 'Python' AND ta.is_correct THEN 1 ELSE 0 END) AS python_score,
           SUM(CASE WHEN q.category = 'Java' AND ta.is_correct THEN 1 ELSE 0 END) AS java_score,
           SUM(CASE WHEN q.category = 'SQL' AND ta.is_correct THEN 1 ELSE 0 END) AS sql_score
         FROM team_attempts ta
         JOIN questions q ON ta.question_id = q.id
         GROUP BY ta.team_id
       ) ss ON ss.team_id = t.id
       ORDER BY r.total_score DESC, r.time_taken ASC, r.submitted_at ASC`
    );

    const leaderboard = result.rows.map((row, index) => ({
      rank: index + 1,
      team_id: row.team_id,
      team_name: row.team_name,
      score: row.total_score,
      total: row.total_questions,
      time_taken: row.time_taken,
      submitted_at: row.submitted_at,
      accuracy: parseFloat(row.accuracy),
      c_score: parseInt(row.c_score),
      python_score: parseInt(row.python_score),
      java_score: parseInt(row.java_score),
      sql_score: parseInt(row.sql_score),
    }));

    res.json({ leaderboard, total: leaderboard.length });

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Get anti-cheat activity logs
router.get('/cheat-logs', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        cl.id,
        cl.event_type,
        cl.details,
        cl.created_at,
        t.team_id,
        t.team_name
       FROM cheat_logs cl
       JOIN teams t ON cl.team_id = t.id
       ORDER BY cl.created_at DESC
       LIMIT 500`
    );

    // Also get summary counts per team
    const summary = await pool.query(
      `SELECT 
        t.team_id,
        t.team_name,
        COUNT(*) AS total_events,
        SUM(CASE WHEN cl.event_type = 'TAB_SWITCH' THEN 1 ELSE 0 END) AS tab_switches,
        SUM(CASE WHEN cl.event_type = 'WINDOW_BLUR' THEN 1 ELSE 0 END) AS window_blurs,
        SUM(CASE WHEN cl.event_type = 'DEVTOOLS_OPEN' THEN 1 ELSE 0 END) AS devtools_opens,
        SUM(CASE WHEN cl.event_type = 'FULLSCREEN_EXIT' THEN 1 ELSE 0 END) AS fullscreen_exits
       FROM cheat_logs cl
       JOIN teams t ON cl.team_id = t.id
       GROUP BY t.team_id, t.team_name
       ORDER BY COUNT(*) DESC`
    );

    res.json({
      logs: result.rows,
      summary: summary.rows.map(r => ({
        team_id: r.team_id,
        team_name: r.team_name,
        total_events: parseInt(r.total_events),
        tab_switches: parseInt(r.tab_switches),
        window_blurs: parseInt(r.window_blurs),
        devtools_opens: parseInt(r.devtools_opens),
        fullscreen_exits: parseInt(r.fullscreen_exits),
      })),
      total: result.rows.length,
    });

  } catch (error) {
    console.error('Error fetching cheat logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// Reset a team's quiz (clear all quiz data so they can restart)
router.post('/reset-team/:teamId', authenticateAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { teamId } = req.params;

    // Verify team exists
    const teamCheck = await client.query(
      'SELECT team_id, team_name FROM teams WHERE id = $1',
      [teamId]
    );
    if (teamCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    await client.query('BEGIN');

    // Delete in order: results, cheat_logs, team_attempts, team_sections, team_questions
    await client.query('DELETE FROM results WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM cheat_logs WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM team_attempts WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM team_sections WHERE team_id = $1', [teamId]);
    await client.query('DELETE FROM team_questions WHERE team_id = $1', [teamId]);
    // Reset quiz_started_at
    await client.query('UPDATE teams SET quiz_started_at = NULL WHERE id = $1', [teamId]);

    await client.query('COMMIT');

    const team = teamCheck.rows[0];
    console.log(`🔄 Reset quiz data for team ${team.team_id} (${team.team_name})`);

    res.json({
      message: `Quiz reset for team "${team.team_name}"`,
      team: team
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error resetting team:', error);
    res.status(500).json({ error: 'Failed to reset team quiz' });
  } finally {
    client.release();
  }
});

// Export results as CSV
router.get('/export-results', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        t.team_id as "Team ID",
        t.team_name as "Team Name",
        r.total_score as "Score",
        r.total_questions as "Total Questions",
        r.time_taken as "Time Taken (seconds)",
        r.submitted_at as "Submitted At"
       FROM results r
       JOIN teams t ON r.team_id = t.id
       ORDER BY r.total_score DESC, r.time_taken ASC`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No results to export' });
    }

    // Create worksheet
    const worksheet = xlsx.utils.json_to_sheet(result.rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=results-${Date.now()}.xlsx`);
    res.send(buffer);

  } catch (error) {
    console.error('Error exporting results:', error);
    res.status(500).json({ error: 'Failed to export results' });
  }
});

// Delete a team (admin only)
router.delete('/teams/:teamId', authenticateAdmin, async (req, res) => {
  try {
    const { teamId } = req.params;

    const result = await pool.query(
      'DELETE FROM teams WHERE id = $1 RETURNING team_id, team_name',
      [teamId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    res.json({
      message: 'Team deleted successfully',
      team: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

export default router;
