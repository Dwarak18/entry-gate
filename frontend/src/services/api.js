import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authAPI = {
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
};

// Admin APIs
export const adminAPI = {
  uploadTeams: (formData) => {
    return api.post('/admin/upload-teams', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  getTeams: () => api.get('/admin/teams'),
  getLeaderboard: () => api.get('/admin/leaderboard'),
  exportResults: () => {
    return api.get('/admin/export-results', {
      responseType: 'blob',
    });
  },
  deleteTeam: (teamId) => api.delete(`/admin/teams/${teamId}`),
};

export default api;
