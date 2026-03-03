import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://entry-gate-production.up.railway.app/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only force-logout on 401 for protected routes, NOT for login/auth requests
    // (auth endpoints legitimately return 401 for wrong credentials)
    const isAuthRequest = error.config?.url?.includes('/auth/');
    if (error.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authAPI = {
  teamEnter: (data) => api.post('/auth/team/enter', data),   // no-password entry
  teamLogin: (credentials) => api.post('/auth/team/login', credentials),
  adminLogin: (credentials) => api.post('/auth/admin/login', credentials),
  verifyToken: () => api.get('/auth/verify'),
};

// Questions APIs
export const questionsAPI = {
  getAll: () => api.get('/questions'),
  getByOrder: (order) => api.get(`/questions/${order}`),
};

// Submissions APIs
export const submissionsAPI = {
  saveAnswer: (data) => api.post('/submissions/answer', data),
  completeSection: (data) => api.post('/submissions/complete-section', data),
  submitQuiz: (data) => api.post('/submissions/submit', data),
  getStatus: () => api.get('/submissions/status'),
  logActivity: (data) => api.post('/submissions/log-activity', data),
  startQuiz: () => api.post('/submissions/start'),
};

// Admin APIs
export const adminAPI = {
  uploadTeams: (formData) => {
    return api.post('/admin/upload-teams', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadTeamsJSON: (formData) => {
    return api.post('/admin/upload-teams-json', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  addTeam: (data) => api.post('/admin/add-team', data),
  updateTeam: (teamId, data) => api.put(`/admin/teams/${teamId}`, data),
  getTeams: () => api.get('/admin/teams'),
  getLeaderboard: () => api.get('/admin/leaderboard'),
  exportResults: () => {
    return api.get('/admin/export-results', {
      responseType: 'blob',
    });
  },
  deleteTeam: (teamId) => api.delete(`/admin/teams/${teamId}`),
  resetTeam: (teamId) => api.post(`/admin/reset-team/${teamId}`),
  getCheatLogs: () => api.get('/admin/cheat-logs'),
  startAllTimers: () => api.post('/admin/start-all-timers'),
  resetAllTimers: () => api.post('/admin/reset-all-timers'),
};

export default api;
