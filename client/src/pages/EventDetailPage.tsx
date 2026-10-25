import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [rows, setRows] = useState<any[][]>([]);
  const [selectedSeat, setSelectedSeat] = useState<any>(null);
  const [availableCount, setAvailableCount] = useState(0);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  const fetchEvent = () => {
    fetch(`http://localhost:4000/events/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setEvent(data);

        const grouped: any[][] = [];
        data.seats.forEach((seat: any) => {
          if (!grouped[seat.row]) grouped[seat.row] = [];
          grouped[seat.row].push(seat);
        });
        setRows(grouped);

        let count = 0;
        data.seats.forEach((seat: any) => {
          if (seat.available) count++;
        });
        setAvailableCount(count);
      });
  };

  useEffect(() => {
    fetchEvent();
  }, [id]);

  const handleBook = async () => {
    if (!selectedSeat) {
      setToast({ type: 'error', message: 'Please select a seat first! 🪑' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const res = await fetch('http://localhost:4000/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ seatId: selectedSeat.id }),
    });
    const data = await res.json();

    if (res.ok) {
      setToast({ type: 'success', message: `🎉 Woohoo! Seat ${selectedSeat.label} is yours!` });
      setTimeout(() => setToast(null), 3000);
      setSelectedSeat(null);
      fetchEvent();
    } else {
      setToast({ type: 'error', message: '😢 ' + data.error });
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="w-16 h-16 border-4 border-[#ec4899] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-6 text-white/60 animate-pulse">Loading event... 🎭</p>
      </div>
    );
  }

  const price = parseFloat(event.price.replace('$', ''));
  const serviceFee = price * 0.05;
  const total = price + serviceFee;
  const isPast = new Date(event.startsAt) < new Date();
  const percentBooked = Math.round(((event.seats.length - availableCount) / event.seats.length) * 100);

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-24 right-6 z-50 px-6 py-4 rounded-2xl shadow-2xl font-medium ${
            toast.type === 'success'
              ? 'bg-gradient-to-r from-[#22c55e] to-[#16a34a]'
              : 'bg-gradient-to-r from-[#ef4444] to-[#dc2626]'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="rounded-3xl p-10 bg-gradient-to-br from-[#a855f7]/30 via-[#ec4899]/20 to-[#f97316]/20 border border-white/10 glow">
        <span className="px-3 py-1 rounded-full bg-[#a855f7]/30 text-[#d8b4fe] text-xs font-bold">
          {isPast ? '⏰ ENDED' : '✨ LIVE NOW'}
        </span>
        <h1 className="mt-4 text-5xl font-extrabold">{event.title}</h1>
        <p className="mt-4 text-white/60 text-lg">{event.description}</p>
        <div className="mt-6 flex gap-6 text-white/70">
          <span>📍 {event.venue}</span>
          <span>📅 {new Date(event.startsAt).toDateString()}</span>
          <span>👤 {event.organizer.name}</span>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-3 gap-8">
        <div className="col-span-2 glass rounded-3xl p-8">
          <h2 className="text-2xl font-bold mb-2">
            Choose Your <span className="gradient-text">Perfect Seat</span> 🪑
          </h2>
          <p className="text-white/50 mb-6">
            {availableCount} of {event.seats.length} available · {percentBooked}% booked 🔥
          </p>
          <div className="w-full h-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] mb-10 opacity-60"></div>
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-3 justify-center">
                {row.map((seat: any) => (
                  <div
                    key={seat.id}
                    onClick={() => setSelectedSeat(seat)}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold cursor-pointer transition-all duration-300 hover:scale-110 ${
                      selectedSeat?.id === seat.id
                        ? 'bg-gradient-to-br from-[#ec4899] to-[#f97316] shadow-lg shadow-pink-500/50 scale-110'
                        : seat.available
                        ? 'bg-gradient-to-br from-[#a855f7]/60 to-[#6366f1]/60 hover:from-[#a855f7] hover:to-[#6366f1]'
                        : 'bg-gradient-to-br from-[#a855f7]/20 to-[#6366f1]/20 text-white/30'
                    }`}
                  >
                    {seat.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-8 h-fit">
          <h3 className="text-xl font-bold mb-6">Order Summary 🧾</h3>
          <div className="space-y-4 text-white/70">
            <div className="flex justify-between">
              <span>Seat</span>
              <span className="font-bold text-white">{selectedSeat ? selectedSeat.label : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Ticket</span>
              <span>${price.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Service fee (5%)</span>
              <span>${serviceFee.toFixed(2)}</span>
            </div>
            <div className="border-t border-white/10 pt-4 flex justify-between text-xl font-bold text-white">
              <span>Total</span>
              <span className="gradient-text">${total.toFixed(2)}</span>
            </div>
          </div>
          <button
            onClick={handleBook}
            className="mt-8 w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg hover:scale-[1.02] hover:shadow-2xl hover:shadow-pink-500/40 transition-all duration-300"
          >
            Book Now 🎟️
          </button>
          <p className="mt-4 text-center text-xs text-white/40">🔒 Secure checkout · Instant confirmation</p>
        </div>
      </div>
    </div>
  );
}
