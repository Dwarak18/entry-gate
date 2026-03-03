import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/store';

export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated, role, user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
  };

  const handleContinue = () => {
    if (role === 'admin') {
      navigate('/admin/dashboard');
    } else {
      navigate('/quiz');
    }
  };

  return (
    <div className="min-h-screen bg-surface-dim">
      <div className="relative z-10 container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          {/* Header */}
          <div className="mb-12 animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-on-surface mb-3">
              MCQ Competition
            </h1>
            <p className="text-base text-on-surface-variant">
              Test your programming knowledge across multiple languages
            </p>
            <div className="mt-4 h-px w-48 mx-auto bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
          </div>

          {/* Logged-in Banner */}
          {isAuthenticated && (
            <div className="mb-8 animate-slide-up">
              <div className="surface-1 rounded-3xl p-6 shadow-elevated-2 border border-primary/15">
                <p className="text-on-surface-variant text-sm mb-1">Logged in as</p>
                <p className="text-lg font-bold text-primary mb-4">
                  {role === 'admin' ? 'Admin' : user?.team_name || user?.team_id || 'Team'}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleContinue}
                    className="btn-primary px-8 py-3 rounded-2xl font-semibold"
                  >
                    {role === 'admin' ? 'Go to Dashboard' : 'Continue to Quiz'} →
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-8 py-3 rounded-2xl font-medium surface-2 text-on-surface-variant hover:text-error border border-outline-variant hover:border-error/30 transition-all duration-200"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cards - show login options only when not logged in */}
          {!isAuthenticated && (
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <div className="surface-1 rounded-3xl p-8 shadow-elevated-2 hover:shadow-elevated-3 hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-primary-container border border-primary/20">
                <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-on-surface">Enter Team ID</h3>
              <p className="mb-6 text-on-surface-variant text-sm">
                Enter your Team ID to start the competition
              </p>
              <button
                onClick={() => navigate('/login')}
                className="btn-primary w-full px-8 py-3 rounded-2xl font-semibold"
              >
                Start Test →
              </button>
            </div>

            <div className="surface-1 rounded-3xl p-8 shadow-elevated-2 hover:shadow-elevated-3 hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-secondary-container border border-secondary/20">
                <svg className="w-7 h-7 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-on-surface">Admin Panel</h3>
              <p className="mb-6 text-on-surface-variant text-sm">
                Manage teams, view results, and export data
              </p>
              <button
                onClick={() => navigate('/admin/login')}
                className="btn-secondary w-full px-8 py-3 rounded-2xl font-semibold"
              >
                Admin Login
              </button>
            </div>
          </div>
          )}

          {/* Features */}
          <div className="surface-1 rounded-3xl p-8 shadow-elevated-1">
            <h2 className="text-xl font-semibold mb-6 text-on-surface">Competition Features</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-primary-container border border-primary/10">
                <div className="text-3xl font-bold mb-1 text-primary font-mono">50</div>
                <div className="text-xs text-on-surface-variant">Total Questions</div>
              </div>
              <div className="p-4 rounded-2xl bg-secondary-container border border-secondary/10">
                <div className="text-3xl font-bold mb-1 text-secondary font-mono">50</div>
                <div className="text-xs text-on-surface-variant">Per Team</div>
              </div>
              <div className="p-4 rounded-2xl bg-warning-container border border-warning/10">
                <div className="text-3xl font-bold mb-1 text-warning font-mono">60</div>
                <div className="text-xs text-on-surface-variant">Minutes</div>
              </div>
              <div className="p-4 rounded-2xl bg-success-container border border-success/10">
                <div className="text-3xl font-bold mb-1 text-success font-mono">4</div>
                <div className="text-xs text-on-surface-variant">Languages</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
