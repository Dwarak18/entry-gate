-- MCQ Competition Platform Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Teams table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id VARCHAR(50) UNIQUE NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    quiz_started_at TIMESTAMP,  -- Server-side timer: recorded when questions first assigned
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Questions table
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL CHECK (category IN ('C', 'Python', 'Java', 'SQL')),
    question_text TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_answer CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
    difficulty VARCHAR(20) DEFAULT 'basic',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Team assigned questions (tracks which questions each team gets)
CREATE TABLE team_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL,
    section VARCHAR(20),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, question_id)
);

-- Team attempts (tracks answers submitted by teams)
CREATE TABLE team_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_answer CHAR(1) CHECK (selected_answer IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, question_id)
);

-- Results table (final submission data)
CREATE TABLE results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    total_score INTEGER NOT NULL DEFAULT 0 CHECK (total_score >= 0),
    total_questions INTEGER NOT NULL DEFAULT 50 CHECK (total_questions > 0),
    time_taken INTEGER CHECK (time_taken >= 0), -- in seconds
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id)
);

-- Team sections (tracks section completion per team)
CREATE TABLE team_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    section_name VARCHAR(20) NOT NULL CHECK (section_name IN ('C', 'Python', 'Java', 'SQL')),
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    UNIQUE(team_id, section_name)
);

-- Create indexes for better performance
CREATE INDEX idx_teams_team_id ON teams(team_id);
CREATE INDEX idx_questions_category ON questions(category);
CREATE INDEX idx_team_questions_team_id ON team_questions(team_id);
CREATE INDEX idx_team_questions_question_id ON team_questions(question_id);
CREATE INDEX idx_team_attempts_team_id ON team_attempts(team_id);
CREATE INDEX idx_results_team_id ON results(team_id);
CREATE INDEX idx_results_total_score ON results(total_score DESC);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to teams table
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
