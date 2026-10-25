import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  }

  return (
    <nav className="sticky top-0 z-50 glass">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-2xl font-extrabold gradient-text">
          ✨ Seatbook
        </Link>
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className={`text-sm font-medium transition-all duration-300 hover:text-[#a855f7] ${
              location.pathname === '/' ? 'text-[#a855f7]' : 'text-white/70'
            }`}
          >
            🎉 Events
          </Link>
          {user && (
            <Link
              to="/my-bookings"
              className={`text-sm font-medium transition-all duration-300 hover:text-[#a855f7] ${
                location.pathname === '/my-bookings' ? 'text-[#a855f7]' : 'text-white/70'
              }`}
            >
              🎟️ My Bookings
            </Link>
          )}
          {user?.role === 'ORGANIZER' && (
            <Link
              to="/events/new"
              className={`text-sm font-medium transition-all duration-300 hover:text-[#a855f7] ${
                location.pathname === '/events/new' ? 'text-[#a855f7]' : 'text-white/70'
              }`}
            >
              ➕ Create Event
            </Link>
          )}
          {user ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] flex items-center justify-center font-bold">
                {user.name[0]}
              </div>
              <button onClick={logout} className="text-sm text-white/50 hover:text-white transition-all duration-300">
                Logout
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="px-5 py-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] text-sm font-semibold hover:scale-105 transition-all duration-300 shadow-lg shadow-purple-500/30"
            >
              Get Started 🚀
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
