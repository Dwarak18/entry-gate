/**
 * Import teams from an Excel (.xlsx/.xls) or CSV file directly into PostgreSQL.
 *
 * Usage:
 *   node scripts/importTeamsFromExcel.js <path-to-file>
 *
 * Expected columns (case-insensitive, flexible naming):
 *   Team ID  | team_id  | Team Code | team_code  → stored as team_id
 *   Team Name | team_name | Name      → stored as team_name
 *   Password | password  | Pass       → stored as plain_password (also hashed)
 *
 * Examples:
 *   node scripts/importTeamsFromExcel.js ./teams.xlsx
 *   node scripts/importTeamsFromExcel.js ./teams.csv
 */

import xlsx from 'xlsx';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── helpers ──────────────────────────────────────────────────────────────────

function sanitize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/^[=+\-@|\t\r\n]+/, '') // strip formula injection chars
    .replace(/<[^>]*>/g, '');         // strip HTML tags
}

/**
 * Resolve flexible column names to a canonical value.
 * Tries every alias for a column and returns the first match found in the row.
 */
function pick(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== '') {
      return row[alias];
    }
    // case-insensitive fallback
    const lower = alias.toLowerCase();
    const key = Object.keys(row).find(k => k.toLowerCase() === lower);
    if (key && row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  return undefined;
}

/** Parse CSV into array of plain objects (same shape as xlsx.utils.sheet_to_json) */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function importTeams(filePath) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.error(`❌  File not found: ${absPath}`);
    process.exit(1);
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    console.error('❌  Unsupported file type. Use .xlsx, .xls, or .csv');
    process.exit(1);
  }

  // ── parse file ─────────────────────────────────────────────────────────────

  let rows;
  if (ext === '.csv') {
    rows = parseCSV(fs.readFileSync(absPath, 'utf8'));
  } else {
    const workbook = xlsx.readFile(absPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  }

  if (rows.length === 0) {
    console.error('❌  The file is empty or has no data rows.');
    process.exit(1);
  }

  console.log(`\n📂  File     : ${absPath}`);
  console.log(`📋  Rows     : ${rows.length}`);
  console.log('─'.repeat(55));

  // ── preview first three rows to help user verify column mapping ────────────
  console.log('\n🔍  Column preview (first row):');
  const sampleRow = rows[0];
  const teamIdAliases   = ['Team ID', 'team_id', 'TeamID', 'Team Code', 'team_code', 'TeamCode', 'Code', 'code'];
  const teamNameAliases = ['Team Name', 'team_name', 'TeamName', 'Name', 'name'];
  const passwordAliases = ['Password', 'password', 'Pass', 'pass', 'Pwd', 'pwd'];

  const detectedId   = pick(sampleRow, teamIdAliases)   ?? '(not found)';
  const detectedName = pick(sampleRow, teamNameAliases) ?? '(not found)';
  const detectedPass = pick(sampleRow, passwordAliases) ?? '(not found)';

  console.log(`   Team Code  → "${detectedId}"`);
  console.log(`   Team Name  → "${detectedName}"`);
  console.log(`   Password   → "${String(detectedPass).replace(/./g, '*')}"`);

  if (detectedId === '(not found)' || detectedName === '(not found)' || detectedPass === '(not found)') {
    console.warn('\n⚠️   One or more required columns were not detected.');
    console.warn('     Expected column headers (any of these work):');
    console.warn(`       Team Code : ${teamIdAliases.join(', ')}`);
    console.warn(`       Team Name : ${teamNameAliases.join(', ')}`);
    console.warn(`       Password  : ${passwordAliases.join(', ')}`);
    console.warn('     Actual headers found:', Object.keys(sampleRow).join(', '));
  }

  console.log('\n─'.repeat(55));
  console.log('🚀  Importing teams…\n');

  // ── DB insert ──────────────────────────────────────────────────────────────

  const client = await pool.connect();
  let created = 0, skipped = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-based + header row

      const teamId   = sanitize(pick(row, teamIdAliases));
      const teamName = sanitize(pick(row, teamNameAliases));
      const password = pick(row, passwordAliases);

      // Validation
      if (!teamId || !teamName || !password) {
        const missing = [!teamId && 'Team Code', !teamName && 'Team Name', !password && 'Password'].filter(Boolean);
        errors.push(`Row ${rowNum}: Missing → ${missing.join(', ')}`);
        skipped++;
        continue;
      }
      if (teamId.length > 50) {
        errors.push(`Row ${rowNum}: Team Code "${teamId}" exceeds 50 characters`);
        skipped++;
        continue;
      }
      if (teamName.length > 255) {
        errors.push(`Row ${rowNum}: Team Name "${teamName}" exceeds 255 characters`);
        skipped++;
        continue;
      }

      // Duplicate check
      const existing = await client.query('SELECT id FROM teams WHERE team_id = $1', [teamId]);
      if (existing.rows.length > 0) {
        errors.push(`Row ${rowNum}: Team Code "${teamId}" already exists — skipped`);
        skipped++;
        continue;
      }

      // Hash password and insert
      const passwordHash = await bcrypt.hash(String(password), 10);
      await client.query(
        'INSERT INTO teams (team_id, team_name, password_hash, plain_password) VALUES ($1, $2, $3, $4)',
        [teamId, teamName, passwordHash, String(password)]
      );

      created++;
      process.stdout.write(`\r   ✔ Inserted ${created} team(s)…   `);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n\n❌  Fatal DB error — transaction rolled back.');
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  // ── summary ────────────────────────────────────────────────────────────────

  console.log('\n\n' + '─'.repeat(55));
  console.log('📊  Import summary');
  console.log('─'.repeat(55));
  console.log(`   ✅  Created  : ${created}`);
  console.log(`   ⏭  Skipped  : ${skipped}`);
  console.log(`   📁  Total    : ${rows.length}`);

  if (errors.length > 0) {
    console.log(`\n⚠️   Issues (${errors.length}):`);
    errors.forEach(e => console.log(`   • ${e}`));
  }

  console.log('\n✔  Done.\n');
}

// ── entry point ───────────────────────────────────────────────────────────────

const [,, filePath] = process.argv;

if (!filePath) {
  console.error('\n❌  No file path provided.\n');
  console.error('Usage:  node scripts/importTeamsFromExcel.js <path-to-file>\n');
  console.error('Example:');
  console.error('  node scripts/importTeamsFromExcel.js ./teams.xlsx');
  console.error('  node scripts/importTeamsFromExcel.js ./teams.csv\n');
  process.exit(1);
}

importTeams(filePath);
