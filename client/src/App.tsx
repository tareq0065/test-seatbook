import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import MyBookingsPage from './pages/MyBookingsPage';
import LoginPage from './pages/LoginPage';
import CreateEventPage from './pages/CreateEventPage';

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/new" element={<CreateEventPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/my-bookings" element={<MyBookingsPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </main>
      <footer className="text-center text-white/40 text-sm py-10">
        Made with 💜 by the Seatbook team · © {new Date().getFullYear()}
      </footer>
    </div>
  );
}
