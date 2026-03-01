import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useQuizStore } from '../store/store';
import { questionsAPI, submissionsAPI } from '../services/api';

const SECTION_ORDER = ['C', 'Python', 'Java', 'SQL'];
const SECTION_LABELS = { C: 'Section 1: C', Python: 'Section 2: Python', Java: 'Section 3: Java', SQL: 'Section 4: SQL' };
const SECTION_TOTALS = { C: 12, Python: 12, Java: 13, SQL: 13 };

export default function QuizPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const {
    questions,
    currentQuestion,
    answers,
    timeRemaining,
    sections,
    currentSection,
    setQuestions,
    setCurrentQuestion,
    saveAnswer,
    decrementTime,
    setSections,
    completeSection: completeSectionInStore,
    submitQuiz: submitQuizToStore,
  } = useQuizStore();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completingSection, setCompletingSection] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [expired, setExpired] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [toast, setToast] = useState(null); // { msg, type: 'error'|'info' }
  const toastTimerRef = useRef(null);

  const showToast = (msg, type = 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  // Anti-cheat refs
  const lastLogTimeRef = useRef(0);
  const cheatCountRef = useRef({ TAB_SWITCH: 0, WINDOW_BLUR: 0, DEVTOOLS_OPEN: 0, FULLSCREEN_EXIT: 0 });

  // Group questions by section
  const sectionQuestions = useMemo(() => {
    const grouped = {};
    for (const s of SECTION_ORDER) grouped[s] = [];
    for (const q of questions) {
      if (grouped[q.section]) grouped[q.section].push(q);
    }
    return grouped;
  }, [questions]);

  // Questions for the current active section
  const currentSectionQs = useMemo(() => {
    return currentSection ? (sectionQuestions[currentSection] || []) : [];
  }, [sectionQuestions, currentSection]);

  // Index within the current section
  const sectionStartIndex = useMemo(() => {
    if (!currentSection) return 0;
    let start = 0;
    for (const s of SECTION_ORDER) {
      if (s === currentSection) break;
      start += (sectionQuestions[s] || []).length;
    }
    return start;
  }, [currentSection, sectionQuestions]);

  const localIndex = currentQuestion - sectionStartIndex;

  // Answered count for current section
  const sectionAnsweredCount = useMemo(() => {
    return currentSectionQs.filter(q => answers[q.id] || q.selected_answer).length;
  }, [currentSectionQs, answers, questions]);

  // All sections complete?
  const allSectionsComplete = useMemo(() => {
    return sections.length === 4 && sections.every(s => s.completed);
  }, [sections]);

  // Total answered across all questions
  const totalAnswered = useMemo(() => {
    return questions.filter(q => answers[q.id] || q.selected_answer).length;
  }, [questions, answers]);

  // Section-wise answered counts (for modal)
  const sectionAnsweredCounts = useMemo(() => {
    const counts = {};
    for (const s of SECTION_ORDER) {
      const qs = sectionQuestions[s] || [];
      counts[s] = qs.filter(q => answers[q.id] || q.selected_answer).length;
    }
    return counts;
  }, [sectionQuestions, answers, questions]);

  // Timer class helper
  const timerClass = useMemo(() => {
    if (timeRemaining <= 60) return 'timer-warning timer-danger';
    if (timeRemaining <= 300) return 'timer-warning timer-critical';
    if (timeRemaining <= 600) return 'timer-amber';
    return 'timer-normal';
  }, [timeRemaining]);

  // ===== ANTI-CHEAT: Throttled activity logger =====
  const logActivity = useCallback(async (eventType, details = null) => {
    const now = Date.now();
    if (now - lastLogTimeRef.current < 5000) return;
    lastLogTimeRef.current = now;
    cheatCountRef.current[eventType] = (cheatCountRef.current[eventType] || 0) + 1;
    try {
      await submissionsAPI.logActivity({ event_type: eventType, details });
    } catch (e) {
      // Silently fail
    }
  }, []);

  // ===== ANTI-CHEAT: Monitoring listeners =====
  useEffect(() => {
    if (!hasStarted) return;

    const handleWindowBlur = () => {
      logActivity('WINDOW_BLUR', 'Window lost focus');
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logActivity('TAB_SWITCH', 'Page became hidden');
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        logActivity('FULLSCREEN_EXIT', 'Exited fullscreen mode');
      }
    };

    let devtoolsOpen = false;
    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;
      if ((widthThreshold || heightThreshold) && !devtoolsOpen) {
        devtoolsOpen = true;
        logActivity('DEVTOOLS_OPEN', 'Width diff: ' + (window.outerWidth - window.innerWidth) + ', Height diff: ' + (window.outerHeight - window.innerHeight));
      } else if (!widthThreshold && !heightThreshold) {
        devtoolsOpen = false;
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    const devtoolsInterval = setInterval(checkDevTools, 2000);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      clearInterval(devtoolsInterval);
    };
  }, [hasStarted, logActivity]);

  const fetchQuestionsData = useCallback(async () => {
    const response = await questionsAPI.getAll();
    setQuestions(response.data.questions || []);

    if (response.data.sections) {
      setSections(response.data.sections);
    }

    if (response.data.serverTimeRemaining !== undefined) {
      const { setTimeRemaining } = useQuizStore.getState();
      setTimeRemaining(response.data.serverTimeRemaining);
    }

    if (response.data.sections) {
      const activeSection = SECTION_ORDER.find(name => {
        const s = response.data.sections.find(sec => sec.name === name);
        return !s || !s.completed;
      });
      if (activeSection) {
        let startIdx = 0;
        for (const s of SECTION_ORDER) {
          if (s === activeSection) break;
          startIdx += (response.data.questions || []).filter(q => q.section === s).length;
        }
        setCurrentQuestion(startIdx);
      }
    }

    return response.data;
  }, [setQuestions, setSections, setCurrentQuestion]);

  // Initialize quiz state on mount
  useEffect(() => {
    const initializeQuiz = async () => {
      try {
        const statusResponse = await submissionsAPI.getStatus();
        if (statusResponse.data.submitted) {
          navigate('/result');
          return;
        }

        const { setTimeRemaining } = useQuizStore.getState();
        if (statusResponse.data.serverTimeRemaining !== undefined) {
          setTimeRemaining(statusResponse.data.serverTimeRemaining);
        }

        // If quiz has NOT started, show Start screen first (no question fetch yet)
        if (!statusResponse.data.quizStartedAt) {
          setHasStarted(false);
          setLoading(false);
          return;
        }

        // Quiz already started: continue session
        if ((statusResponse.data.serverTimeRemaining ?? 0) <= 0) {
          setExpired(true);
          setLoading(false);
          return;
        }

        setHasStarted(true);
        await fetchQuestionsData();
        setLoading(false);
      } catch (error) {
        console.error('Error initializing quiz:', error);
        setLoading(false);
        if (error.response?.status === 401 || error.response?.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          navigate('/login');
        } else {
          showToast('Failed to load quiz. Please refresh.');
        }
      }
    };

    initializeQuiz();
  }, [navigate, fetchQuestionsData]);

  // Timer countdown
  useEffect(() => {
    if (!hasStarted || !questions.length) return;
    const timer = setInterval(() => { decrementTime(); }, 1000);
    return () => clearInterval(timer);
  }, [hasStarted, questions, decrementTime]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeRemaining === 0 && hasStarted) {
      handleSubmit(true);
    }
  }, [timeRemaining, hasStarted]);

  // Set selected answer from saved answers
  useEffect(() => {
    if (questions[currentQuestion]) {
      const questionId = questions[currentQuestion].id;
      setSelectedAnswer(answers[questionId] || questions[currentQuestion].selected_answer || null);
    }
  }, [currentQuestion, questions, answers]);

  // Prevent page refresh during quiz
  useEffect(() => {
    if (!hasStarted) return;
    const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasStarted]);

  const handleAnswerSelect = async (answer) => {
    setSelectedAnswer(answer);
    const questionId = questions[currentQuestion].id;
    saveAnswer(questionId, answer);
    try {
      await submissionsAPI.saveAnswer({ question_id: questionId, selected_answer: answer });
    } catch (error) {
      console.error('Error saving answer:', error);
      if (error.response?.data?.error) {
        showToast(error.response.data.error);
      }
    }
  };

  const handleNext = () => {
    const maxIdx = sectionStartIndex + currentSectionQs.length - 1;
    if (currentQuestion < maxIdx) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > sectionStartIndex) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleCompleteSection = async () => {
    if (completingSection) return;
    
    const section = currentSection;
    if (!section) return;

    const answered = currentSectionQs.filter(q => answers[q.id] || q.selected_answer).length;
    const total = currentSectionQs.length;
    
    if (answered < total) {
      showToast('Please answer all ' + total + ' questions in ' + section + ' before completing this section. (' + answered + '/' + total + ' answered)');
      return;
    }

    const userConfirmed = window.confirm(
      'Complete the ' + section + ' section? Your answers will be locked and you will move to the next section.'
    );
    if (!userConfirmed) return;

    setCompletingSection(true);
    try {
      const response = await submissionsAPI.completeSection({ section_name: section });
      completeSectionInStore(section);
      
      const nextSection = response.data.next_section;
      if (nextSection) {
        const allQs = useQuizStore.getState().questions;
        let nextStart = 0;
        for (const s of SECTION_ORDER) {
          if (s === nextSection) break;
          nextStart += allQs.filter(q => q.section === s).length;
        }
        setCurrentQuestion(nextStart);
      }
    } catch (error) {
      console.error('Error completing section:', error);
      const msg = error.response?.data?.error || 'Failed to complete section';
      showToast(msg);
    } finally {
      setCompletingSection(false);
    }
  };

  const handleSubmit = async (force = false) => {
    if (submitting) return;
    
    if (!force && !allSectionsComplete) {
      showToast('Complete all 4 sections before submitting.');
      return;
    }

    if (!force && !showSubmitModal) {
      setShowSubmitModal(true);
      return;
    }

    setShowSubmitModal(false);
    setSubmitting(true);
    try {
      const timeTaken = (60 * 60) - timeRemaining;
      const response = await submissionsAPI.submitQuiz({ time_taken: timeTaken });
      submitQuizToStore(response.data.score);
      navigate('/result');
    } catch (error) {
      console.error('Error submitting quiz:', error);
      showToast(error.response?.data?.error || 'Failed to submit quiz. Please try again.');
      setSubmitting(false);
    }
  };

  const confirmSubmit = () => {
    handleSubmit(true);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleStartQuiz = async () => {
    try {
      setLoading(true);
      const response = await submissionsAPI.startQuiz();
      const { setTimeRemaining } = useQuizStore.getState();
      setTimeRemaining(response.data.serverTimeRemaining);
      if (response.data.serverTimeRemaining <= 0) {
        setExpired(true);
        setLoading(false);
      } else {
        setHasStarted(true);
        await fetchQuestionsData();
        setLoading(false);
      }
    } catch (error) {
      console.error('Error starting quiz:', error);
      const msg = error.response?.data?.error || 'Failed to start quiz';
      showToast(msg);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-dim flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 spinner-m3 mx-auto mb-4"></div>
          <p className="text-on-surface-variant text-sm">Loading questions...</p>
        </div>
      </div>
    );
  }

  // ===== EXPIRED SCREEN =====
  if (expired) {
    return (
      <div className="min-h-screen bg-surface-dim flex items-center justify-center px-4">
        <div className="max-w-md w-full animate-slide-up">
          <div className="surface-1 rounded-3xl p-8 shadow-elevated-3 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-error-container border border-error/20">
              <svg className="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-error mb-2">Time Expired</h2>
            <p className="text-on-surface-variant text-sm mb-6">
              Your quiz time of 60 minutes has run out. You can no longer submit answers.
            </p>
            <div className="p-4 rounded-2xl bg-surface-container mb-6">
              <p className="text-xs text-on-surface-variant">Team: <span className="font-semibold text-on-surface">{user?.team_name}</span></p>
              <p className="text-xs text-on-surface-variant mt-1">Answered: <span className="font-semibold text-on-surface">{totalAnswered}/{questions.length}</span></p>
            </div>
            <button
              onClick={handleLogout}
              className="btn-primary w-full py-3 rounded-2xl font-semibold"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-surface-dim flex items-center justify-center px-4">
        <div className="max-w-2xl w-full animate-slide-up">
          <div className="surface-1 rounded-3xl p-8 shadow-elevated-3">
            <h2 className="text-2xl font-bold mb-6 text-center text-on-surface">
              Welcome, {user?.team_name}!
            </h2>
          
            <div className="mb-8 space-y-4">
              <div className="p-5 rounded-2xl bg-primary-container border border-primary/15">
                <h3 className="font-semibold mb-3 text-primary text-sm">Quiz Instructions</h3>
                <ul className="list-disc list-inside space-y-2 text-on-surface-variant text-sm">
                  <li>You have 1 hour to complete {questions.length || 50} questions</li>
                  <li>Questions are divided into <strong className="text-on-surface">4 sections</strong> in fixed order</li>
                  <li><strong className="text-on-surface">Section 1:</strong> C — 12 questions</li>
                  <li><strong className="text-on-surface">Section 2:</strong> Python — 12 questions</li>
                  <li><strong className="text-on-surface">Section 3:</strong> Java — 13 questions</li>
                  <li><strong className="text-on-surface">Section 4:</strong> SQL — 13 questions</li>
                  <li>You must complete each section before moving to the next</li>
                  <li>Once a section is completed, answers are locked</li>
                  <li>Your answers are auto-saved within the active section</li>
                  <li>Final submit is available after all 4 sections are done</li>
                  <li className="text-error font-medium">Do not refresh the page or switch tabs during the quiz!</li>
                  <li className="text-error font-medium">Tab switches and suspicious activity are monitored</li>
                </ul>
              </div>

              <div className="p-4 rounded-2xl bg-secondary-container border border-secondary/15">
                <p className="text-sm text-on-surface-variant">
                  Total Questions: <span className="font-semibold text-secondary">{questions.length || 50}</span>
                </p>
                <p className="text-sm text-on-surface-variant">
                  Time Limit: <span className="font-semibold text-secondary">1 hour</span>
                </p>
              </div>
            </div>

            <button
              onClick={handleStartQuiz}
              className="btn-primary w-full py-4 rounded-2xl font-semibold text-lg"
            >
              Start Quiz
            </button>
            <button
              onClick={handleLogout}
              className="w-full mt-3 py-3 rounded-2xl font-medium surface-2 text-on-surface-variant hover:text-error transition-all duration-200 text-sm"
            >
              ← Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  const question = questions[currentQuestion];
  const isCurrentSectionComplete = sections.find(s => s.name === currentSection)?.completed;

  return (
    <div className="min-h-screen bg-surface-dim px-4 py-6">
      {/* Toast notification */}
      {toast && (
        <div
          className={'fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-start gap-3 px-5 py-4 rounded-2xl shadow-elevated-3 max-w-sm w-full mx-4 animate-slide-up ' + (
            toast.type === 'error'
              ? 'bg-error-container border border-error/30 text-error'
              : 'bg-primary-container border border-primary/30 text-primary'
          )}
        >
          <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {toast.type === 'error'
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            }
          </svg>
          <p className="text-sm font-medium flex-1">{toast.msg}</p>
          <button onClick={() => setToast(null)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )} */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop" onClick={() => setShowSubmitModal(false)}>
          <div className="surface-1 rounded-3xl p-8 max-w-md w-full mx-4 shadow-elevated-3 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-on-surface mb-4 text-center">
              Confirm Submission
            </h3>
            <p className="text-on-surface-variant text-sm mb-6 text-center">
              Are you sure you want to submit? You cannot change your answers after submission.
            </p>
            
            {/* Section-wise breakdown */}
            <div className="space-y-2 mb-6">
              {SECTION_ORDER.map(s => {
                const answered = sectionAnsweredCounts[s];
                const total = SECTION_TOTALS[s];
                const isComplete = sections.find(sec => sec.name === s)?.completed;
                return (
                  <div key={s} className="flex justify-between items-center p-3 rounded-xl surface-2">
                    <span className="text-sm text-on-surface font-medium">{s}</span>
                    <div className="flex items-center gap-2">
                      <span className={'text-sm font-mono ' + (answered === total ? 'text-success' : 'text-warning')}>
                        {answered}/{total}
                      </span>
                      {isComplete && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">Locked</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 rounded-xl bg-primary-container border border-primary/15 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Total Answered</span>
                <span className="font-bold text-primary font-mono">{totalAnswered}/{questions.length}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-on-surface-variant">Time Remaining</span>
                <span className={'font-bold font-mono ' + timerClass}>{formatTime(timeRemaining)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 py-3 rounded-2xl font-medium surface-2 text-on-surface-variant hover:text-on-surface transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmSubmit}
                disabled={submitting}
                className="flex-1 btn-success py-3 rounded-2xl font-semibold disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Quiz'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className="surface-1 p-4 rounded-2xl shadow-elevated-1 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div>
              <p className="font-semibold text-on-surface">{user?.team_name}</p>
              <p className="text-xs text-on-surface-variant">
                Total: {totalAnswered}/{questions.length} answered
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-error-container text-error border border-error/20 hover:bg-error/20 transition-all duration-200"
              title="Logout"
            >
              Logout
            </button>
          </div>
          <div className="text-right">
            <p className="text-xs text-on-surface-variant">Time Remaining</p>
            <p className={'text-2xl font-bold font-mono ' + timerClass}>
              {formatTime(timeRemaining)}
            </p>
          </div>
        </div>
      </div>

      {/* Section Navigation Bar */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className="surface-1 p-2 rounded-2xl shadow-elevated-1 flex gap-2">
          {SECTION_ORDER.map((sName, idx) => {
            const sec = sections.find(s => s.name === sName);
            const isActive = sName === currentSection;
            const isCompleted = sec?.completed;
            const isLocked = !isCompleted && !isActive;
            const sectionQs = sectionQuestions[sName] || [];
            const answeredInSection = sectionQs.filter(q => answers[q.id] || q.selected_answer).length;

            return (
              <button
                key={sName}
                disabled={isLocked}
                onClick={() => {
                  if (!isLocked && !isCompleted) {
                    let start = 0;
                    for (const s of SECTION_ORDER) {
                      if (s === sName) break;
                      start += (sectionQuestions[s] || []).length;
                    }
                    setCurrentQuestion(start);
                  }
                }}
                className={'flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 text-center border ' + (
                  isCompleted
                    ? 'section-complete text-success'
                    : isActive
                    ? 'section-active text-primary'
                    : 'section-locked text-on-surface-variant/40 cursor-not-allowed'
                )}
              >
                <div>{sName}</div>
                <div className="text-[10px] opacity-70 mt-0.5">
                  {isCompleted ? '✓ Done' : answeredInSection + '/' + sectionQs.length}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section Header */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className="surface-2 p-3 rounded-2xl flex justify-between items-center">
          <h3 className="font-semibold text-primary text-sm">
            {currentSection ? SECTION_LABELS[currentSection] : 'All Sections Complete'}
          </h3>
          <span className="text-xs font-medium text-on-surface-variant font-mono">
            {currentSection ? sectionAnsweredCount + ' / ' + currentSectionQs.length + ' answered' : ''}
          </span>
        </div>
      </div>

      {/* All Complete — Show Submit */}
      {allSectionsComplete && (
        <div className="max-w-4xl mx-auto mb-6">
          <div className="surface-1 p-6 rounded-3xl text-center border border-success/20 shadow-glow-success">
            <p className="text-base font-semibold mb-4 text-success">
              All sections complete! You can now submit your quiz.
            </p>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="btn-success px-10 py-4 rounded-2xl font-semibold text-lg disabled:opacity-50 disabled:hover:transform-none"
            >
              {submitting ? 'Submitting...' : 'Submit Quiz'}
            </button>
          </div>
        </div>
      )}

      {/* Question Card */}
      {currentSection && question && (
        <div className="max-w-4xl mx-auto">
          <div className="surface-1 p-8 rounded-3xl shadow-elevated-2 animate-fade-in">
            {/* Question Header */}
            <div className="flex justify-between items-center mb-6">
              <span className="px-3 py-1.5 rounded-xl text-xs font-medium bg-primary-container border border-primary/15 text-primary">
                {question.category}
              </span>
              <span className="text-xs text-on-surface-variant font-mono">
                Question {localIndex + 1} of {currentSectionQs.length}
              </span>
            </div>

            {/* Question Text */}
            <h3 className="text-lg font-medium mb-6 text-on-surface leading-relaxed">
              {question.question_text}
            </h3>

            {/* Options */}
            <div className="space-y-3">
              {['A', 'B', 'C', 'D'].map((option) => (
                <button
                  key={option}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={isCurrentSectionComplete}
                  className={'w-full p-4 rounded-2xl text-left transition-all duration-200 border disabled:opacity-50 disabled:cursor-not-allowed ' + (
                    selectedAnswer === option
                      ? 'option-selected text-on-surface'
                      : 'bg-surface-container-high/50 border-outline-variant text-on-surface-variant hover:border-primary/30 hover:bg-primary-container'
                  )}
                >
                  <span className="font-medium mr-3 text-primary">{option}.</span>
                  {question['option_' + option.toLowerCase()]}
                </button>
              ))}
            </div>

            {/* Navigation */}
            <div className="mt-8 flex justify-between items-center">
              <button
                onClick={handlePrevious}
                disabled={localIndex === 0}
                className="px-6 py-3 rounded-2xl font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed surface-2 text-on-surface-variant hover:text-primary"
              >
                ← Previous
              </button>

              {localIndex === currentSectionQs.length - 1 ? (
                <button
                  onClick={handleCompleteSection}
                  disabled={completingSection}
                  className={'px-8 py-3 rounded-2xl font-semibold transition-all duration-200 disabled:opacity-50 border ' + (
                    sectionAnsweredCount < currentSectionQs.length
                      ? 'border-outline-variant text-on-surface-variant/40 cursor-not-allowed bg-surface-container'
                      : 'btn-success'
                  )}
                >
                  {completingSection ? 'Completing...' : sectionAnsweredCount < currentSectionQs.length ? 'Answer all (' + sectionAnsweredCount + '/' + currentSectionQs.length + ')' : 'Complete ' + currentSection + ' ✓'}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="btn-primary px-6 py-3 rounded-2xl font-medium"
                >
                  Next →
                </button>
              )}
            </div>
          </div>

          {/* Question Grid */}
          <div className="mt-4 p-5 rounded-2xl surface-1 shadow-elevated-1">
            <h4 className="text-xs font-medium mb-3 text-on-surface-variant">
              {currentSection} Questions
            </h4>
            <div className="grid grid-cols-10 gap-2">
              {currentSectionQs.map((q, idx) => {
                const globalIdx = sectionStartIndex + idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentQuestion(globalIdx)}
                    className={'aspect-square rounded-xl text-xs font-medium transition-all duration-200 border ' + (
                      globalIdx === currentQuestion
                        ? 'bg-primary/20 text-primary border-primary/40'
                        : answers[q.id] || q.selected_answer
                        ? 'bg-success/10 text-success border-success/30'
                        : 'bg-surface-container border-outline-variant text-on-surface-variant/50 hover:border-primary/20'
                    )}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Completed sections grids (locked) */}
          {sections.filter(s => s.completed && s.name !== currentSection).map(sec => {
            const secQs = sectionQuestions[sec.name] || [];
            return (
              <div key={sec.name} className="mt-3 p-4 rounded-2xl surface-1 shadow-elevated-1 opacity-60">
                <h4 className="text-xs font-medium mb-2 text-on-surface-variant flex items-center gap-2">
                  {sec.name} <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">✓ Locked</span>
                </h4>
                <div className="grid grid-cols-13 gap-1.5">
                  {secQs.map((q, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-lg text-[10px] font-medium flex items-center justify-center grid-locked"
                    >
                      {idx + 1}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
