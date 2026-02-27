import { create } from 'zustand';

// Restore auth state from localStorage on init
const storedToken = localStorage.getItem('token');
const storedUser = (() => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
})();

export const useAuthStore = create((set) => ({
  user: storedUser || null,
  token: storedToken || null,
  isAuthenticated: !!(storedToken && storedUser),
  role: storedUser?.role || null,
  
  login: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ 
      user, 
      token, 
      isAuthenticated: true,
      role: user.role || 'team'
    });
  },
  
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ 
      user: null, 
      token: null, 
      isAuthenticated: false,
      role: null
    });
  },
}));

export const useThemeStore = create((set) => ({
  theme: 'elegant', // 'elegant' or 'cyberpunk'
  toggleTheme: () => set((state) => ({ 
    theme: state.theme === 'elegant' ? 'cyberpunk' : 'elegant' 
  })),
  setTheme: (theme) => set({ theme }),
}));

export const useQuizStore = create((set) => ({
  questions: [],
  currentQuestion: 0,
  answers: {},
  timeRemaining: 60 * 60, // 60 minutes in seconds
  quizStarted: false,
  quizSubmitted: false,
  score: null,
  sections: [],           // [{name, completed, completed_at}]
  currentSection: 'C',    // Active section name
  
  setQuestions: (questions) => set({ questions }),
  
  setCurrentQuestion: (index) => set({ currentQuestion: index }),
  
  saveAnswer: (questionId, answer) => set((state) => ({
    answers: { ...state.answers, [questionId]: answer }
  })),
  
  decrementTime: () => set((state) => {
    const newTime = Math.max(0, state.timeRemaining - 1);
    return { timeRemaining: newTime };
  }),
  
  setTimeRemaining: (seconds) => set({ timeRemaining: Math.max(0, seconds) }),
  
  startQuiz: () => set({ quizStarted: true }),
  
  setSections: (sections) => {
    // Determine current active section (first non-completed)
    const sectionOrder = ['C', 'Python', 'Java', 'SQL'];
    const currentSection = sectionOrder.find(name => {
      const s = sections.find(sec => sec.name === name);
      return !s || !s.completed;
    }) || null; // null = all complete
    set({ sections, currentSection });
  },
  
  completeSection: (sectionName) => set((state) => {
    const sectionOrder = ['C', 'Python', 'Java', 'SQL'];
    const updatedSections = state.sections.map(s =>
      s.name === sectionName ? { ...s, completed: true, completed_at: new Date().toISOString() } : s
    );
    const nextSection = sectionOrder.find(name => {
      const s = updatedSections.find(sec => sec.name === name);
      return !s || !s.completed;
    }) || null;
    return { sections: updatedSections, currentSection: nextSection };
  }),
  
  submitQuiz: (score) => set({ 
    quizSubmitted: true, 
    score 
  }),
  
  resetQuiz: () => set({
    questions: [],
    currentQuestion: 0,
    answers: {},
    timeRemaining: 60 * 60,
    quizStarted: false,
    quizSubmitted: false,
    score: null,
    sections: [],
    currentSection: 'C',
  }),
}));
