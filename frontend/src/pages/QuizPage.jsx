import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useQuizStore, useThemeStore } from '../store/store';
import { questionsAPI, submissionsAPI } from '../services/api';

const SECTION_ORDER = ['C', 'Python', 'Java', 'SQL'];
const SECTION_LABELS = { C: 'Section 1: C', Python: 'Section 2: Python', Java: 'Section 3: Java', SQL: 'Section 4: SQL' };

export default function QuizPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
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

  // Fetch questions on mount
  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const statusResponse = await submissionsAPI.getStatus();
        if (statusResponse.data.submitted) {
          navigate('/result');
          return;
        }

        const response = await questionsAPI.getAll();
        setQuestions(response.data.questions);
        
        if (response.data.sections) {
          setSections(response.data.sections);
        }

        if (response.data.serverTimeRemaining !== undefined) {
          const { setTimeRemaining } = useQuizStore.getState();
          setTimeRemaining(response.data.serverTimeRemaining);
        }

        // Set currentQuestion to first question of the active section
        if (response.data.sections) {
          const activeSection = SECTION_ORDER.find(name => {
            const s = response.data.sections.find(sec => sec.name === name);
            return !s || !s.completed;
          });
          if (activeSection) {
            let startIdx = 0;
            for (const s of SECTION_ORDER) {
              if (s === activeSection) break;
              startIdx += response.data.questions.filter(q => q.section === s).length;
            }
            setCurrentQuestion(startIdx);
          }
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching questions:', error);
        alert('Failed to load questions');
      }
    };

    fetchQuestions();
  }, [setQuestions, setSections, navigate]);

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
        alert(error.response.data.error);
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

    // Count answered using both local answers and server-saved answers
    const answered = currentSectionQs.filter(q => answers[q.id] || q.selected_answer).length;
    const total = currentSectionQs.length;
    
    if (answered < total) {
      alert(`Please answer all ${total} questions in ${section} before completing this section. (${answered}/${total} answered)`);
      return;
    }

    const userConfirmed = window.confirm(
      `Complete the ${section} section? Your answers will be locked and you'll move to the next section.`
    );
    if (!userConfirmed) return;

    setCompletingSection(true);
    try {
      const response = await submissionsAPI.completeSection({ section_name: section });
      completeSectionInStore(section);
      
      // Calculate next section start from fresh store state
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
      alert(msg);
    } finally {
      setCompletingSection(false);
    }
  };

  const handleSubmit = async (force = false) => {
    if (submitting) return;
    
    if (!force && !allSectionsComplete) {
      alert('Complete all 4 sections before submitting.');
      return;
    }

    if (!force) {
      const confirmSubmit = window.confirm(
        'Are you sure you want to submit? You cannot change your answers after submission.'
      );
      if (!confirmSubmit) return;
    }

    setSubmitting(true);
    try {
      const timeTaken = (60 * 60) - timeRemaining;
      const response = await submissionsAPI.submitQuiz({ time_taken: timeTaken });
      submitQuizToStore(response.data.score);
      navigate('/result');
    } catch (error) {
      console.error('Error submitting quiz:', error);
      alert(error.response?.data?.error || 'Failed to submit quiz. Please try again.');
      setSubmitting(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isElegant = theme === 'elegant';

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isElegant ? 'bg-gradient-to-br from-blue-50 to-purple-50' : 'bg-gray-900'}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
          <p className={isElegant ? 'text-gray-600' : 'text-gray-300'}>Loading questions...</p>
        </div>
      </div>
    );
  }

  if (!hasStarted) {
    return (
      <div className={`min-h-screen flex items-center justify-center px-4 ${isElegant ? 'bg-gradient-to-br from-blue-50 to-purple-50' : 'bg-gray-900 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900'}`}>
        <div className={`max-w-2xl w-full p-8 rounded-2xl ${isElegant ? 'bg-white shadow-2xl' : 'glass border-2 border-neon-blue shadow-[0_0_30px_rgba(0,240,255,0.3)]'}`}>
          <h2 className={`text-3xl font-bold mb-6 text-center ${isElegant ? 'text-gray-800' : 'text-neon-blue'}`}>
            Welcome, {user?.team_name}!
          </h2>
          
          <div className="mb-8 space-y-4">
            <div className={`p-4 rounded-lg ${isElegant ? 'bg-blue-50' : 'bg-gray-800 bg-opacity-50 border border-neon-blue'}`}>
              <h3 className={`font-semibold mb-2 ${isElegant ? 'text-gray-800' : 'text-white'}`}>Quiz Instructions:</h3>
              <ul className={`list-disc list-inside space-y-2 ${isElegant ? 'text-gray-700' : 'text-gray-300'}`}>
                <li>You have 1 hour to complete {questions.length} questions</li>
                <li>Questions are divided into <strong>4 sections</strong> in fixed order</li>
                <li><strong>Section 1:</strong> C — 12 questions</li>
                <li><strong>Section 2:</strong> Python — 12 questions</li>
                <li><strong>Section 3:</strong> Java — 13 questions</li>
                <li><strong>Section 4:</strong> SQL — 13 questions</li>
                <li>You must complete each section before moving to the next</li>
                <li>Once a section is completed, answers are locked</li>
                <li>Your answers are auto-saved within the active section</li>
                <li>Final submit is available after all 4 sections are done</li>
                <li className="text-red-500 font-semibold">Do not refresh the page during the quiz!</li>
              </ul>
            </div>

            <div className={`p-4 rounded-lg ${isElegant ? 'bg-purple-50' : 'bg-gray-800 bg-opacity-50 border border-neon-purple'}`}>
              <p className={`font-semibold ${isElegant ? 'text-gray-800' : 'text-white'}`}>
                Total Questions: <span className={isElegant ? 'text-purple-600' : 'text-neon-purple'}>{questions.length}</span>
              </p>
              <p className={`font-semibold ${isElegant ? 'text-gray-800' : 'text-white'}`}>
                Time Limit: <span className={isElegant ? 'text-purple-600' : 'text-neon-purple'}>1 hour</span>
              </p>
            </div>
          </div>

          <button
            onClick={() => setHasStarted(true)}
            className={`w-full py-4 rounded-lg font-bold text-lg transition-all duration-300 ${
              isElegant
                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 shadow-lg hover:shadow-xl'
                : 'bg-neon-blue bg-opacity-20 border-2 border-neon-blue text-neon-blue hover:bg-opacity-30 shadow-[0_0_15px_rgba(0,240,255,0.3)] hover:shadow-[0_0_25px_rgba(0,240,255,0.5)]'
            }`}
          >
            Start Quiz
          </button>
        </div>
      </div>
    );
  }

  const question = questions[currentQuestion];
  const isCurrentSectionComplete = sections.find(s => s.name === currentSection)?.completed;

  return (
    <div className={`min-h-screen px-4 py-8 ${isElegant ? 'bg-gradient-to-br from-blue-50 to-purple-50' : 'bg-gray-900 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900'}`}>
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className={`p-4 rounded-lg flex justify-between items-center ${isElegant ? 'bg-white shadow-lg' : 'glass border border-gray-700'}`}>
          <div>
            <p className={`font-semibold ${isElegant ? 'text-gray-800' : 'text-white'}`}>{user?.team_name}</p>
            <p className={`text-sm ${isElegant ? 'text-gray-600' : 'text-gray-400'}`}>
              Total: {totalAnswered}/{questions.length} answered
            </p>
          </div>
          <div className="text-right">
            <p className={`text-sm ${isElegant ? 'text-gray-600' : 'text-gray-400'}`}>Time Remaining</p>
            <p className={`text-2xl font-bold ${timeRemaining < 300 ? 'text-red-500' : (isElegant ? 'text-blue-600' : 'text-neon-blue')}`}>
              {formatTime(timeRemaining)}
            </p>
          </div>
        </div>
      </div>

      {/* Section Navigation Bar */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className={`p-3 rounded-lg flex gap-2 ${isElegant ? 'bg-white shadow-md' : 'glass border border-gray-700'}`}>
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
                className={`flex-1 py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all text-center ${
                  isCompleted
                    ? (isElegant ? 'bg-green-100 text-green-700 border-2 border-green-400' : 'bg-green-500 bg-opacity-20 text-green-400 border-2 border-green-500')
                    : isActive
                    ? (isElegant ? 'bg-blue-500 text-white shadow-md' : 'bg-neon-blue bg-opacity-30 text-neon-blue border-2 border-neon-blue')
                    : (isElegant ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700')
                }`}
              >
                <div>{sName}</div>
                <div className="text-[10px] opacity-75">
                  {isCompleted ? '✓ Done' : `${answeredInSection}/${sectionQs.length}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section Header */}
      <div className="max-w-4xl mx-auto mb-4">
        <div className={`p-3 rounded-lg flex justify-between items-center ${isElegant ? 'bg-blue-50 border border-blue-200' : 'bg-gray-800 bg-opacity-60 border border-neon-blue'}`}>
          <h3 className={`font-bold text-lg ${isElegant ? 'text-blue-700' : 'text-neon-blue'}`}>
            {currentSection ? SECTION_LABELS[currentSection] : 'All Sections Complete'}
          </h3>
          <span className={`text-sm font-semibold ${isElegant ? 'text-blue-600' : 'text-gray-300'}`}>
            {currentSection ? `${sectionAnsweredCount} / ${currentSectionQs.length} answered` : ''}
          </span>
        </div>
      </div>

      {/* All Complete — Show Submit */}
      {allSectionsComplete && (
        <div className="max-w-4xl mx-auto mb-6">
          <div className={`p-6 rounded-xl text-center ${isElegant ? 'bg-green-50 border-2 border-green-400' : 'bg-green-500 bg-opacity-10 border-2 border-green-500'}`}>
            <p className={`text-lg font-bold mb-4 ${isElegant ? 'text-green-700' : 'text-green-400'}`}>
              🎉 All sections complete! You can now submit your quiz.
            </p>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className={`px-10 py-4 rounded-lg font-bold text-lg transition-all duration-300 disabled:opacity-50 ${
                isElegant
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 shadow-lg'
                  : 'bg-green-500 bg-opacity-20 border-2 border-green-500 text-green-400 hover:bg-opacity-30 shadow-[0_0_15px_rgba(0,255,0,0.3)]'
              }`}
            >
              {submitting ? 'Submitting...' : '🚀 Submit Quiz'}
            </button>
          </div>
        </div>
      )}

      {/* Question Card (only show if current section is active) */}
      {currentSection && question && (
        <div className="max-w-4xl mx-auto">
          <div className={`p-8 rounded-2xl ${isElegant ? 'bg-white shadow-2xl' : 'glass border-2 border-neon-blue shadow-[0_0_20px_rgba(0,240,255,0.2)]'}`}>
            {/* Question Header */}
            <div className="flex justify-between items-center mb-6">
              <span className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                isElegant 
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                  : 'bg-neon-blue bg-opacity-20 border border-neon-blue text-neon-blue'
              }`}>
                {question.category}
              </span>
              <span className={`text-sm ${isElegant ? 'text-gray-600' : 'text-gray-400'}`}>
                Question {localIndex + 1} of {currentSectionQs.length}
              </span>
            </div>

            {/* Question Text */}
            <h3 className={`text-xl font-semibold mb-6 ${isElegant ? 'text-gray-800' : 'text-white'}`}>
              {question.question_text}
            </h3>

            {/* Options */}
            <div className="space-y-3">
              {['A', 'B', 'C', 'D'].map((option) => (
                <button
                  key={option}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={isCurrentSectionComplete}
                  className={`w-full p-4 rounded-lg text-left transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${
                    selectedAnswer === option
                      ? (isElegant
                          ? 'bg-blue-500 text-white border-2 border-blue-600 shadow-lg'
                          : 'bg-neon-blue bg-opacity-30 border-2 border-neon-blue text-white shadow-[0_0_15px_rgba(0,240,255,0.4)]')
                      : (isElegant
                          ? 'bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 text-gray-800'
                          : 'bg-gray-800 bg-opacity-50 hover:bg-opacity-70 border-2 border-gray-700 text-gray-300')
                  }`}
                >
                  <span className="font-semibold mr-3">{option}.</span>
                  {question[`option_${option.toLowerCase()}`]}
                </button>
              ))}
            </div>

            {/* Navigation */}
            <div className="mt-8 flex justify-between items-center">
              <button
                onClick={handlePrevious}
                disabled={localIndex === 0}
                className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isElegant
                    ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    : 'bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700'
                }`}
              >
                ← Previous
              </button>

              {localIndex === currentSectionQs.length - 1 ? (
                <button
                  onClick={handleCompleteSection}
                  disabled={completingSection}
                  className={`px-8 py-3 rounded-lg font-bold transition-all duration-300 disabled:opacity-50 ${
                    sectionAnsweredCount < currentSectionQs.length
                      ? (isElegant ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gray-700 border-2 border-gray-600 text-gray-500 cursor-not-allowed')
                      : (isElegant
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 shadow-lg'
                        : 'bg-green-500 bg-opacity-20 border-2 border-green-500 text-green-400 hover:bg-opacity-30 shadow-[0_0_15px_rgba(0,255,0,0.3)]')
                  }`}
                >
                  {completingSection ? 'Completing...' : sectionAnsweredCount < currentSectionQs.length ? `Answer all (${sectionAnsweredCount}/${currentSectionQs.length})` : `Complete ${currentSection} ✓`}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 ${
                    isElegant
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-neon-blue bg-opacity-20 border-2 border-neon-blue text-neon-blue hover:bg-opacity-30'
                  }`}
                >
                  Next →
                </button>
              )}
            </div>
          </div>

          {/* Question Grid (section-scoped) */}
          <div className={`mt-6 p-6 rounded-xl ${isElegant ? 'bg-white shadow-lg' : 'glass border border-gray-700'}`}>
            <h4 className={`text-sm font-semibold mb-3 ${isElegant ? 'text-gray-700' : 'text-gray-300'}`}>
              {currentSection} Questions
            </h4>
            <div className="grid grid-cols-10 gap-2">
              {currentSectionQs.map((q, idx) => {
                const globalIdx = sectionStartIndex + idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentQuestion(globalIdx)}
                    className={`aspect-square rounded-lg text-sm font-semibold transition-all ${
                      globalIdx === currentQuestion
                        ? (isElegant ? 'bg-blue-500 text-white' : 'bg-neon-blue text-gray-900')
                        : answers[q.id] || q.selected_answer
                        ? (isElegant ? 'bg-green-100 text-green-700' : 'bg-green-500 bg-opacity-30 text-green-300 border border-green-500')
                        : (isElegant ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
