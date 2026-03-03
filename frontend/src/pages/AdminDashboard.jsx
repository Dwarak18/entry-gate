import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/store';
import { adminAPI } from '../services/api';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState('teams');
  const [teams, setTeams] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [cheatLogs, setCheatLogs] = useState({ logs: [], summary: [] });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const refreshIntervalRef = useRef(null);

  // CRUD state
  const [showAddModal, setShowAddModal] = useState(false);
  const [crudForm, setCrudForm] = useState({ team_id: '', team_name: '', password: '' });
  const [crudSaving, setCrudSaving] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showPasswordFor, setShowPasswordFor] = useState(null); // team id whose password is visible
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [timerAction, setTimerAction] = useState(null); // 'starting' | 'resetting' | null
  const [timerResult, setTimerResult] = useState(null);

  useEffect(() => {
    if (activeTab === 'teams') {
      fetchTeams();
    } else if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    } else if (activeTab === 'activity') {
      fetchCheatLogs();
    }
  }, [activeTab]);

  // Auto-refresh leaderboard every 10 seconds
  useEffect(() => {
    if (activeTab === 'leaderboard') {
      refreshIntervalRef.current = setInterval(() => {
        fetchLeaderboard(true);
      }, 10000);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [activeTab]);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getTeams();
      setTeams(response.data.teams);
    } catch (error) {
      console.error('Error fetching teams:', error);
      alert('Failed to fetch teams');
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await adminAPI.getLeaderboard();
      setLeaderboard(response.data.leaderboard);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      if (!silent) alert('Failed to fetch leaderboard');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchCheatLogs = async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getCheatLogs();
      setCheatLogs(response.data);
    } catch (error) {
      console.error('Error fetching cheat logs:', error);
      alert('Failed to fetch activity logs');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0]);
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const ext = selectedFile.name.split('.').pop().toLowerCase();
      let response;
      if (ext === 'json') {
        response = await adminAPI.uploadTeamsJSON(formData);
      } else {
        // xlsx, xls, csv all go to upload-teams
        response = await adminAPI.uploadTeams(formData);
      }
      setUploadResult(response.data);
      setSelectedFile(null);
      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.value = '';
      fetchTeams();
    } catch (error) {
      console.error('Error uploading file:', error);
      alert(error.response?.data?.error || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  // CRUD handlers
  const handleAddTeam = async () => {
    const { team_id, team_name, password } = crudForm;
    if (!team_id.trim() || !team_name.trim() || !password.trim()) {
      alert('All fields are required');
      return;
    }
    setCrudSaving(true);
    try {
      await adminAPI.addTeam({ team_id: team_id.trim(), team_name: team_name.trim(), password });
      setCrudForm({ team_id: '', team_name: '', password: '' });
      setShowAddModal(false);
      fetchTeams();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to add team');
    } finally {
      setCrudSaving(false);
    }
  };

  const handleEditSave = async (teamId) => {
    if (!editName.trim()) return;
    const updateData = { team_name: editName.trim() };
    if (editPassword.trim()) updateData.password = editPassword.trim();
    try {
      await adminAPI.updateTeam(teamId, updateData);
      setEditingTeam(null);
      setEditPassword('');
      setShowEditPassword(false);
      fetchTeams();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to update team');
    }
  };

  const handleExportResults = async () => {
    try {
      const response = await adminAPI.exportResults();
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'results-' + Date.now() + '.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error exporting results:', error);
      alert('Failed to export results');
    }
  };

  const handleDeleteTeam = async (teamId, teamName) => {
    const confirm = window.confirm('Are you sure you want to delete team "' + teamName + '"?');
    if (!confirm) return;

    try {
      await adminAPI.deleteTeam(teamId);
      fetchTeams();
    } catch (error) {
      console.error('Error deleting team:', error);
      alert('Failed to delete team');
    }
  };

  const handleResetTeam = async (teamId, teamName) => {
    const confirm = window.confirm('Reset quiz for team "' + teamName + '"? This will clear all their answers, sections, and timer so they can retake the quiz.');
    if (!confirm) return;

    try {
      await adminAPI.resetTeam(teamId);
      alert('Quiz reset for "' + teamName + '" — they can now retake the quiz.');
      fetchTeams();
    } catch (error) {
      console.error('Error resetting team:', error);
      alert('Failed to reset team');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleStartAllTimers = async () => {
    if (!window.confirm('Start timer for ALL teams that have not started yet?')) return;
    setTimerAction('starting');
    setTimerResult(null);
    try {
      const res = await adminAPI.startAllTimers();
      setTimerResult({ type: 'success', message: res.data.message });
      fetchTeams();
    } catch (err) {
      setTimerResult({ type: 'error', message: err.response?.data?.error || 'Failed to start timers' });
    } finally {
      setTimerAction(null);
    }
  };

  const handleResetAllTimers = async () => {
    if (!window.confirm('Reset timer for ALL teams? Their quiz_started_at will be cleared and the clock will restart on their next login.')) return;
    setTimerAction('resetting');
    setTimerResult(null);
    try {
      const res = await adminAPI.resetAllTimers();
      setTimerResult({ type: 'warning', message: res.data.message });
      fetchTeams();
    } catch (err) {
      setTimerResult({ type: 'error', message: err.response?.data?.error || 'Failed to reset timers' });
    } finally {
      setTimerAction(null);
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      completed: 'bg-success-container text-success border border-success/20',
      'in-progress': 'bg-warning-container text-warning border border-warning/20',
      'not-started': 'bg-surface-bright text-on-surface-variant border border-outline-variant',
    };

    return (
      <span className={'px-3 py-1 rounded-xl text-xs font-medium ' + styles[status]}>
        {status.replace('-', ' ').toUpperCase()}
      </span>
    );
  };

  const getThreatLevel = (totalEvents) => {
    if (totalEvents >= 10) return { label: 'HIGH', class: 'cheat-badge-high' };
    if (totalEvents >= 5) return { label: 'MEDIUM', class: 'cheat-badge-medium' };
    return { label: 'LOW', class: 'cheat-badge-low' };
  };

  const formatTimestamp = (ts) => {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-surface-dim px-4 py-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="surface-1 rounded-3xl shadow-elevated-2 p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-on-surface mb-1">
                Admin Dashboard
              </h1>
              <p className="text-sm text-on-surface-variant">
                Manage teams and view competition results
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="px-5 py-2 rounded-2xl font-medium text-sm surface-2 text-on-surface-variant hover:text-error hover:border-error/30 transition-all duration-200"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Competition Timer Control */}
        <div className="surface-1 rounded-3xl shadow-elevated-2 p-5 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-on-surface">Competition Control</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Manage the quiz timer for all teams globally.
              </p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleStartAllTimers}
                disabled={!!timerAction}
                className="px-5 py-2.5 rounded-2xl font-semibold text-sm bg-success-container text-success border border-success/20 hover:bg-success/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {timerAction === 'starting' ? '⏳ Starting…' : '▶ Start Timer'}
              </button>
              <button
                onClick={handleResetAllTimers}
                disabled={!!timerAction}
                className="px-5 py-2.5 rounded-2xl font-semibold text-sm bg-warning-container text-warning border border-warning/20 hover:bg-warning/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {timerAction === 'resetting' ? '⏳ Resetting…' : '↺ Reset Timer (All)'}
              </button>
            </div>
          </div>
          {timerResult && (
            <div className={`mt-3 px-4 py-2.5 rounded-2xl text-sm font-medium ${
              timerResult.type === 'success' ? 'bg-success-container text-success border border-success/20' :
              timerResult.type === 'warning' ? 'bg-warning-container text-warning border border-warning/20' :
              'bg-error-container text-error border border-error/20'
            }`}>
              {timerResult.message}
              <button onClick={() => setTimerResult(null)} className="ml-3 opacity-60 hover:opacity-100 text-base leading-none">×</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="surface-1 rounded-2xl shadow-elevated-1 p-1.5 flex gap-1.5">
            <button
              onClick={() => setActiveTab('upload')}
              className={'flex-1 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ' + (
                activeTab === 'upload'
                  ? 'bg-secondary-container border border-secondary/20 text-secondary'
                  : 'text-on-surface-variant hover:bg-surface-bright'
              )}
            >
              Upload Teams
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={'flex-1 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ' + (
                activeTab === 'teams'
                  ? 'bg-primary-container border border-primary/20 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-bright'
              )}
            >
              Teams ({teams.length})
            </button>
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={'flex-1 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ' + (
                activeTab === 'leaderboard'
                  ? 'bg-success-container border border-success/20 text-success'
                  : 'text-on-surface-variant hover:bg-surface-bright'
              )}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={'flex-1 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ' + (
                activeTab === 'activity'
                  ? 'bg-error-container border border-error/20 text-error'
                  : 'text-on-surface-variant hover:bg-surface-bright'
              )}
            >
              Activity Monitor
            </button>
          </div>
        </div>

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="surface-1 rounded-3xl shadow-elevated-2 p-6 animate-fade-in">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-semibold text-on-surface">Upload Teams</h2>
              <button
                onClick={() => { setCrudForm({ team_id: '', team_name: '', password: '' }); setShowAddModal(true); }}
                className="btn-secondary px-5 py-2.5 rounded-2xl font-semibold text-sm"
              >
                + Add Team
              </button>
            </div>

            <div className="mb-4 p-4 rounded-2xl surface-2 text-sm text-on-surface-variant">
              Supports <span className="font-semibold text-on-surface">.xlsx</span>, <span className="font-semibold text-on-surface">.xls</span>, <span className="font-semibold text-on-surface">.csv</span>, <span className="font-semibold text-on-surface">.json</span> — format is auto-detected.
              Columns: <code className="font-mono text-xs bg-surface-dim px-1.5 py-0.5 rounded">team_id</code>, <code className="font-mono text-xs bg-surface-dim px-1.5 py-0.5 rounded">team_name</code>, <code className="font-mono text-xs bg-surface-dim px-1.5 py-0.5 rounded">password</code>
            </div>

            <div className="mb-4">
              <input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls,.csv,.json"
                onChange={handleFileSelect}
                className="w-full p-3 rounded-2xl input-m3 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border file:border-secondary/30 file:bg-secondary-container file:text-secondary file:font-medium file:text-sm file:cursor-pointer"
              />
              {selectedFile && (
                <p className="mt-2 text-xs text-on-surface-variant">
                  Selected: <span className="font-mono text-primary">{selectedFile.name}</span>
                  {' '}— format: <span className="font-semibold uppercase">{selectedFile.name.split('.').pop()}</span>
                </p>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="btn-secondary w-full py-3 rounded-2xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none"
            >
              {uploading ? 'Uploading...' : 'Upload Teams'}
            </button>

            {uploadResult && (
              <div className={'mt-4 p-4 rounded-2xl ' + (
                uploadResult.created > 0 ? 'surface-2 border border-success/20' : 'surface-2 border border-warning/20'
              )}>
                <h4 className="font-semibold mb-2 text-on-surface text-sm">Upload Results:</h4>
                <p className="text-on-surface-variant text-sm">Created: <span className="font-bold text-success">{uploadResult.created}</span> teams</p>
                <p className="text-on-surface-variant text-sm">Skipped: <span className="font-bold text-warning">{uploadResult.skipped}</span> teams</p>
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-error text-sm">View Errors ({uploadResult.errors.length})</summary>
                    <ul className="mt-2 ml-4 text-sm list-disc">
                      {uploadResult.errors.map((err, idx) => <li key={idx} className="text-error/80">{err}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add Team Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
            <div className="surface-1 rounded-3xl shadow-elevated-3 p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-on-surface mb-5">Add New Team</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Team ID</label>
                  <input
                    type="text"
                    placeholder="e.g. TEAM001"
                    value={crudForm.team_id}
                    onChange={e => setCrudForm(f => ({ ...f, team_id: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-2xl input-m3 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Team Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Alpha Team"
                    value={crudForm.team_name}
                    onChange={e => setCrudForm(f => ({ ...f, team_name: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-2xl input-m3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Password</label>
                  <div className="relative">
                    <input
                      type={showAddPassword ? 'text' : 'password'}
                      placeholder="Team login password"
                      value={crudForm.password}
                      onChange={e => setCrudForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full px-4 py-2.5 pr-10 rounded-2xl input-m3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                      tabIndex={-1}
                    >
                      {showAddPassword ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-2xl surface-2 text-on-surface-variant font-medium text-sm hover:bg-surface-bright transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTeam}
                  disabled={crudSaving}
                  className="flex-1 py-2.5 rounded-2xl btn-secondary font-semibold text-sm disabled:opacity-50"
                >
                  {crudSaving ? 'Adding...' : 'Add Team'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Teams Tab */}
        {activeTab === 'teams' && (
          <div className="surface-1 rounded-3xl shadow-elevated-2 p-6 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-on-surface">
                Registered Teams
                <span className="ml-2 text-sm font-normal text-on-surface-variant">({teams.length})</span>
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setCrudForm({ team_id: '', team_name: '', password: '' }); setShowAddModal(true); }}
                  className="btn-secondary px-4 py-2 rounded-xl text-sm font-medium"
                >
                  + Add Team
                </button>
                <button onClick={fetchTeams} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium">
                  Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 spinner-m3 mx-auto"></div>
              </div>
            ) : teams.length === 0 ? (
              <p className="text-center py-12 text-on-surface-variant">
                No teams registered yet
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-outline">
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium uppercase tracking-wide">Team Code</th>
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium uppercase tracking-wide">Team Name</th>
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium uppercase tracking-wide">Password</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium uppercase tracking-wide">Score</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium uppercase tracking-wide">Rank</th>
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium uppercase tracking-wide">Status</th>
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((team) => (
                      <tr
                        key={team.id}
                        className="border-b border-outline-variant hover:bg-surface-bright transition-colors duration-150"
                      >
                        {/* Team Code */}
                        <td className="p-3 font-mono text-sm font-semibold text-primary/90">
                          {team.team_id}
                        </td>

                        {/* Team Name */}
                        <td className="p-3 text-on-surface text-sm font-medium">
                          {team.team_name}
                        </td>

                        {/* Password with eye toggle */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-on-surface-variant">
                              {showPasswordFor === team.id
                                ? (team.plain_password || <span className="italic opacity-50">not stored</span>)
                                : (team.plain_password ? '••••••••' : <span className="italic opacity-50">—</span>)}
                            </span>
                            {team.plain_password && (
                              <button
                                onClick={() => setShowPasswordFor(showPasswordFor === team.id ? null : team.id)}
                                className="p-1 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-all duration-150"
                                title={showPasswordFor === team.id ? 'Hide password' : 'Show password'}
                              >
                                {showPasswordFor === team.id ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="p-3 text-center font-semibold text-on-surface font-mono text-sm">
                          {team.score !== null && team.score !== undefined
                            ? <span className="text-primary">{team.score}<span className="text-on-surface-variant font-normal">/50</span></span>
                            : <span className="text-on-surface-variant">—</span>}
                        </td>

                        {/* Rank */}
                        <td className="p-3 text-center">
                          {team.rank ? (
                            <span className={
                              'font-bold font-mono text-sm ' +
                              (team.rank === 1 ? 'rank-gold' :
                               team.rank === 2 ? 'rank-silver' :
                               team.rank === 3 ? 'rank-bronze' :
                               'text-on-surface-variant')
                            }>
                              #{team.rank}
                            </span>
                          ) : (
                            <span className="text-on-surface-variant text-sm">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="p-3">
                          {getStatusBadge(team.status)}
                        </td>

                        {/* Actions */}
                        <td className="p-3">
                          <div className="flex gap-1.5 flex-wrap">
                            <button
                              onClick={() => { setEditingTeam(team); setEditName(team.team_name); setEditPassword(''); setShowEditPassword(false); }}
                              className="px-3 py-1.5 rounded-xl bg-primary-container text-primary border border-primary/20 hover:bg-primary/20 text-xs font-medium transition-all duration-200"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleResetTeam(team.id, team.team_name)}
                              className="px-3 py-1.5 rounded-xl bg-warning-container text-warning border border-warning/20 hover:bg-warning/20 text-xs font-medium transition-all duration-200"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => handleDeleteTeam(team.id, team.team_name)}
                              className="px-3 py-1.5 rounded-xl bg-error-container text-error border border-error/20 hover:bg-error/20 text-xs font-medium transition-all duration-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Edit Team Modal */}
        {editingTeam && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setEditingTeam(null); setEditPassword(''); setShowEditPassword(false); }}>
            <div className="surface-1 rounded-3xl shadow-elevated-3 p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-on-surface mb-1">Edit Team</h3>
              <p className="text-xs text-on-surface-variant font-mono mb-5">{editingTeam.team_id}</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Team Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditSave(editingTeam.id)}
                    className="w-full px-4 py-2.5 rounded-2xl input-m3 text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">
                    Password
                    <span className="ml-1 font-normal opacity-60">(leave blank to keep current)</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showEditPassword ? 'text' : 'password'}
                      value={editPassword}
                      onChange={e => setEditPassword(e.target.value)}
                      placeholder={editingTeam.plain_password ? '••••••••' : 'Enter new password'}
                      className="w-full px-4 py-2.5 pr-10 rounded-2xl input-m3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                      tabIndex={-1}
                    >
                      {showEditPassword ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setEditingTeam(null); setEditPassword(''); setShowEditPassword(false); }}
                  className="flex-1 py-2.5 rounded-2xl surface-2 text-on-surface-variant font-medium text-sm hover:bg-surface-bright transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleEditSave(editingTeam.id)}
                  className="flex-1 py-2.5 rounded-2xl btn-primary font-semibold text-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <div className="surface-1 rounded-3xl shadow-elevated-2 p-6 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold text-on-surface">
                  Leaderboard
                </h2>
                <p className="text-xs text-on-surface-variant mt-1">Auto-refreshes every 10 seconds</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => fetchLeaderboard()} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium">
                  Refresh
                </button>
                <button onClick={handleExportResults} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium">
                  Export
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 spinner-m3 mx-auto"></div>
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="text-center py-12 text-on-surface-variant">
                No results available yet
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-outline">
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium">Rank</th>
                      <th className="p-3 text-left text-on-surface-variant text-xs font-medium">Team</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">C</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Python</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Java</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">SQL</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Total</th>
                      <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Accuracy</th>
                      <th className="p-3 text-right text-on-surface-variant text-xs font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry) => (
                      <tr
                        key={entry.rank}
                        className={'border-b border-outline-variant hover:bg-surface-bright transition-colors duration-150 ' + (
                          entry.rank === 1
                            ? 'bg-yellow-500/5'
                            : entry.rank === 2
                            ? 'bg-gray-400/5'
                            : entry.rank === 3
                            ? 'bg-orange-500/5'
                            : ''
                        )}
                      >
                        <td className="p-3">
                          <span className={'text-lg font-bold ' + (
                            entry.rank === 1 ? 'rank-gold' :
                            entry.rank === 2 ? 'rank-silver' :
                            entry.rank === 3 ? 'rank-bronze' :
                            'text-on-surface-variant'
                          )}>
                            #{entry.rank}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-on-surface text-sm">{entry.team_name}</div>
                          <div className="text-xs text-on-surface-variant font-mono">{entry.team_id}</div>
                        </td>
                        <td className="p-3 text-center font-mono text-sm text-on-surface-variant">
                          <span className="font-semibold text-on-surface">{entry.c_score}</span>/12
                        </td>
                        <td className="p-3 text-center font-mono text-sm text-on-surface-variant">
                          <span className="font-semibold text-on-surface">{entry.python_score}</span>/12
                        </td>
                        <td className="p-3 text-center font-mono text-sm text-on-surface-variant">
                          <span className="font-semibold text-on-surface">{entry.java_score}</span>/13
                        </td>
                        <td className="p-3 text-center font-mono text-sm text-on-surface-variant">
                          <span className="font-semibold text-on-surface">{entry.sql_score}</span>/13
                        </td>
                        <td className="p-3 text-center">
                          <span className="font-bold text-primary font-mono text-lg">{entry.score}</span>
                          <span className="text-on-surface-variant text-xs font-mono">/{entry.total}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className="text-sm font-semibold text-success font-mono">
                            {(Number.isFinite(entry.accuracy) ? entry.accuracy : 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="p-3 text-right text-xs text-on-surface-variant font-mono">
                          {entry.time_taken ? Math.floor(entry.time_taken / 60) + 'm ' + (entry.time_taken % 60) + 's' : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Activity Monitor Tab */}
        {activeTab === 'activity' && (
          <div className="animate-fade-in space-y-6">
            {/* Summary Cards */}
            <div className="surface-1 rounded-3xl shadow-elevated-2 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-on-surface">
                  Activity Summary
                </h2>
                <button onClick={fetchCheatLogs} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium">
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 spinner-m3 mx-auto"></div>
                </div>
              ) : cheatLogs.summary.length === 0 ? (
                <p className="text-center py-8 text-on-surface-variant">
                  No suspicious activity detected yet
                </p>
              ) : (
                <div className="overflow-x-auto rounded-2xl">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-outline">
                        <th className="p-3 text-left text-on-surface-variant text-xs font-medium">Team</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Risk</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Total</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Tab Switches</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Window Blur</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">DevTools</th>
                        <th className="p-3 text-center text-on-surface-variant text-xs font-medium">Fullscreen Exit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cheatLogs.summary.map((row) => {
                        const threat = getThreatLevel(row.total_events);
                        return (
                          <tr key={row.team_id} className="border-b border-outline-variant hover:bg-surface-bright transition-colors duration-150">
                            <td className="p-3">
                              <div className="font-semibold text-on-surface text-sm">{row.team_name}</div>
                              <div className="text-xs text-on-surface-variant font-mono">{row.team_id}</div>
                            </td>
                            <td className="p-3 text-center">
                              <span className={'px-3 py-1 rounded-xl text-xs font-bold ' + threat.class}>
                                {threat.label}
                              </span>
                            </td>
                            <td className="p-3 text-center font-bold text-on-surface font-mono">{row.total_events}</td>
                            <td className="p-3 text-center font-mono text-on-surface-variant">{row.tab_switches}</td>
                            <td className="p-3 text-center font-mono text-on-surface-variant">{row.window_blurs}</td>
                            <td className="p-3 text-center font-mono text-on-surface-variant">
                              <span className={row.devtools_opens > 0 ? 'text-error font-bold' : ''}>{row.devtools_opens}</span>
                            </td>
                            <td className="p-3 text-center font-mono text-on-surface-variant">{row.fullscreen_exits}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent Activity Log */}
            <div className="surface-1 rounded-3xl shadow-elevated-2 p-6">
              <h2 className="text-lg font-semibold text-on-surface mb-4">
                Recent Activity Log
              </h2>

              {cheatLogs.logs.length === 0 ? (
                <p className="text-center py-8 text-on-surface-variant">
                  No activity logs yet
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {cheatLogs.logs.slice(0, 100).map((log) => (
                    <div key={log.id} className="flex items-center gap-3 p-3 rounded-xl surface-2">
                      <span className={'px-2 py-1 rounded-lg text-[10px] font-bold min-w-[90px] text-center ' + (
                        log.event_type === 'DEVTOOLS_OPEN' ? 'cheat-badge-high' :
                        log.event_type === 'TAB_SWITCH' ? 'cheat-badge-medium' :
                        log.event_type === 'WINDOW_BLUR' ? 'cheat-badge-medium' :
                        'cheat-badge-low'
                      )}>
                        {log.event_type.replace('_', ' ')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-on-surface">{log.team_name}</span>
                        <span className="text-xs text-on-surface-variant font-mono ml-2">{log.team_id}</span>
                        {log.details && (
                          <p className="text-xs text-on-surface-variant/60 truncate">{log.details}</p>
                        )}
                      </div>
                      <span className="text-xs text-on-surface-variant font-mono whitespace-nowrap">
                        {formatTimestamp(log.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
