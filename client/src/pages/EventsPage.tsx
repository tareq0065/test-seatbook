import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [totalSeatsLeft, setTotalSeatsLeft] = useState(0);
  const [filtered, setFiltered] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/events`)
      .then((res) => res.json())
      .then((data) => {
        setEvents(data);
        setFiltered(data);
        let total = 0;
        for (let i = 0; i < data.length; i++) {
          total += data[i].seatsLeft;
        }
        setTotalSeatsLeft(total);
        setLoading(false);
      })
      .catch(() => {
        setError('Oops! Something went wrong 😢');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setFiltered(
      events.filter(
        (e) =>
          e.title.toLowerCase().includes(search.toLowerCase()) || e.venue.toLowerCase().includes(search.toLowerCase())
      )
    );
  }, [search, events]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="w-16 h-16 border-4 border-[#a855f7] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-6 text-white/60 animate-pulse">Loading amazing events... ✨</p>
      </div>
    );
  }

  const featured = filtered[0];

  return (
    <div>
      <section className="text-center py-16">
        <span className="px-4 py-1 rounded-full bg-[#a855f7]/20 text-[#d8b4fe] text-sm font-medium">
          🚀 The future of seat booking
        </span>
        <h1 className="mt-6 text-6xl font-extrabold leading-tight">
          Discover <span className="gradient-text">Amazing</span> Events
        </h1>
        <p className="mt-4 text-xl text-white/60 max-w-2xl mx-auto">
          Book your perfect seat in seconds. Seamless, effortless, and powered by cutting-edge technology. 🎉
        </p>
        <div className="mt-10 flex justify-center gap-6">
          <div className="glass rounded-2xl px-8 py-5">
            <div className="text-3xl font-bold gradient-text">{events.length}</div>
            <div className="text-white/50 text-sm">Events</div>
          </div>
          <div className="glass rounded-2xl px-8 py-5">
            <div className="text-3xl font-bold gradient-text">{totalSeatsLeft}</div>
            <div className="text-white/50 text-sm">Seats Available</div>
          </div>
          <div className="glass rounded-2xl px-8 py-5">
            <div className="text-3xl font-bold gradient-text">100%</div>
            <div className="text-white/50 text-sm">Satisfaction</div>
          </div>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search events..."
          className="mt-10 w-full max-w-xl px-6 py-4 rounded-2xl glass text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#a855f7]"
        />
      </section>

      {error && (
        <div className="mb-8 p-4 rounded-2xl bg-[#ef4444]/20 border border-[#ef4444]/40 text-[#fca5a5]">{error}</div>
      )}

      {featured && (
        <Link to={`/events/${featured.id}`}>
          <div className="mb-12 p-10 rounded-3xl bg-gradient-to-br from-[#a855f7]/30 via-[#ec4899]/20 to-[#f97316]/20 border border-white/10 hover:scale-[1.01] transition-all duration-500 glow">
            <span className="px-3 py-1 rounded-full bg-[#f97316] text-xs font-bold">🔥 FEATURED</span>
            <h2 className="mt-4 text-4xl font-bold">{featured.title}</h2>
            <p className="mt-2 text-white/60">📍 {featured.venue}</p>
            <p className="text-white/60">
              📅{' '}
              {new Date(featured.startsAt).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <div className="mt-6 flex items-center gap-4">
              <span className="text-3xl font-extrabold gradient-text">{featured.price}</span>
              <span className="px-3 py-1 rounded-full bg-[#22c55e]/20 text-[#86efac] text-sm">
                {featured.seatsLeft} seats left
              </span>
            </div>
          </div>
        </Link>
      )}

      <h2 className="text-3xl font-bold mb-6">
        All <span className="gradient-text">Events</span> 🎊
      </h2>
      <div className="grid grid-cols-3 gap-6">
        {filtered.map((event) => (
          <Link to={`/events/${event.id}`} key={event.id}>
            <div className="glass rounded-3xl p-6 hover:scale-105 hover:shadow-2xl hover:shadow-purple-500/20 transition-all duration-300 h-full">
              <div className="h-32 rounded-2xl bg-gradient-to-br from-[#a855f7] via-[#ec4899] to-[#f97316] flex items-center justify-center text-5xl animate-float">
                🎭
              </div>
              <h3 className="mt-4 text-xl font-bold">{event.title}</h3>
              <p className="mt-1 text-white/50 text-sm">📍 {event.venue}</p>
              <p className="text-white/50 text-sm">
                📅{' '}
                {new Date(event.startsAt).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-2xl font-extrabold gradient-text">{event.price}</span>
                <span className="px-3 py-1 rounded-full bg-[#22c55e]/20 text-[#86efac] text-sm">
                  {event.seatsLeft} seats left
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-white/40">
          <div className="text-6xl">🤷</div>
          <p className="mt-4">No events found</p>
        </div>
      )}
    </div>
  );
}
