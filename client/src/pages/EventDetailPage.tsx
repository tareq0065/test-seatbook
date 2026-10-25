import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [rows, setRows] = useState<any[][]>([]);
  const [selectedSeat, setSelectedSeat] = useState<any>(null);
  const [availableCount, setAvailableCount] = useState(0);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const [activeHold, setActiveHold] = useState<{
    seatId: number;
    label: string;
    expiresAt: string;
    remainingSeconds: number;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchEvent = () => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    fetch(`${API_URL}/events/${id}`, { headers })
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to load event');
        }
        return res.json();
      })
      .then((data) => {
        setEvent(data);

        const grouped: any[][] = [];
        data.seats.forEach((seat: any) => {
          if (!grouped[seat.row]) grouped[seat.row] = [];
          grouped[seat.row].push(seat);
        });
        setRows(grouped);

        let count = 0;
        let userHeldSeat: any = null;

        data.seats.forEach((seat: any) => {
          if (seat.available) count++;
          if (seat.heldByMe && seat.remainingSeconds > 0) {
            userHeldSeat = seat;
          }
        });
        setAvailableCount(count);

        if (userHeldSeat) {
          setSelectedSeat(userHeldSeat);
          setActiveHold({
            seatId: userHeldSeat.id,
            label: userHeldSeat.label,
            expiresAt: userHeldSeat.holdExpiresAt,
            remainingSeconds: userHeldSeat.remainingSeconds,
          });
        }
      })
      .catch((err) => {
        console.error('Error fetching event:', err);
      });
  };

  useEffect(() => {
    fetchEvent();
  }, [id]);

  // Live countdown timer effect
  useEffect(() => {
    if (!activeHold || activeHold.remainingSeconds <= 0) return;

    const interval = setInterval(() => {
      setActiveHold((prev) => {
        if (!prev) return null;
        const nextSeconds = prev.remainingSeconds - 1;
        if (nextSeconds <= 0) {
          clearInterval(interval);
          setToast({ type: 'error', message: '⏳ Your 10-minute hold has expired! The seat has returned to sale.' });
          setTimeout(() => setToast(null), 4000);
          setSelectedSeat(null);
          fetchEvent();
          return null;
        }
        return { ...prev, remainingSeconds: nextSeconds };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeHold?.seatId, activeHold !== null]);

  const handleHold = async () => {
    if (!selectedSeat) {
      setToast({ type: 'error', message: 'Please select an available seat first! 🪑' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/events/${id}/seats/${selectedSeat.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        setActiveHold({
          seatId: selectedSeat.id,
          label: selectedSeat.label,
          expiresAt: data.hold.expiresAt,
          remainingSeconds: data.hold.remainingSeconds,
        });
        setToast({ type: 'success', message: `⏳ Seat ${selectedSeat.label} is held for 10 minutes!` });
        setTimeout(() => setToast(null), 3000);
        fetchEvent();
      } else {
        setToast({ type: 'error', message: '😢 ' + (data.error || 'Failed to hold seat') });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err: any) {
      setToast({ type: 'error', message: 'Network error while placing hold' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!selectedSeat) return;

    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/events/${id}/seats/${selectedSeat.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setActiveHold(null);
        setSelectedSeat(null);
        setToast({ type: 'success', message: 'Seat hold released. The seat is available again.' });
        setTimeout(() => setToast(null), 3000);
        fetchEvent();
      } else {
        const data = await res.json();
        setToast({ type: 'error', message: data.error || 'Failed to release hold' });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err) {
      console.error('Error releasing hold:', err);
    } finally {
      setActionLoading(false);
    }
  };

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

    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ seatId: selectedSeat.id }),
      });
      const data = await res.json();

      if (res.ok) {
        setToast({ type: 'success', message: `🎉 Woohoo! Seat ${selectedSeat.label} is confirmed!` });
        setTimeout(() => setToast(null), 3000);
        setActiveHold(null);
        setSelectedSeat(null);
        fetchEvent();
      } else {
        setToast({ type: 'error', message: '😢 ' + (data.error || 'Failed to book seat') });
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err: any) {
      setToast({ type: 'error', message: 'Network error while booking seat' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setActionLoading(false);
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

  const isCurrentSeatHeldByMe =
    selectedSeat && (selectedSeat.heldByMe || (activeHold && activeHold.seatId === selectedSeat.id));

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

          {/* Seat Status Legend */}
          <div className="flex flex-wrap items-center justify-center gap-6 mb-8 text-xs font-semibold text-white/70 bg-white/5 p-4 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-md bg-gradient-to-br from-[#a855f7] to-[#6366f1]"></div>
              <span>Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-md bg-gradient-to-br from-[#ec4899] to-[#f97316] ring-2 ring-pink-400"></div>
              <span>Selected / Your Hold</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-md bg-gradient-to-br from-[#f59e0b]/40 to-[#d97706]/50 border border-amber-500/50 flex items-center justify-center text-[10px]">⏳</div>
              <span>Held by Others (10m)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-md bg-white/10 border border-white/10"></div>
              <span>Booked</span>
            </div>
          </div>

          <div className="w-full h-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] mb-10 opacity-60"></div>
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-3 justify-center">
                {row.map((seat: any) => {
                  const isSelected = selectedSeat?.id === seat.id;
                  const isHeldByMe = seat.heldByMe || (activeHold && activeHold.seatId === seat.id);
                  const isHeldByOther = seat.status === 'HELD' && !isHeldByMe;
                  const isBooked = seat.status === 'BOOKED' || (!seat.available && seat.status !== 'HELD');
                  const isSelectable = seat.available || isHeldByMe;

                  let seatStyle = 'bg-gradient-to-br from-[#a855f7]/60 to-[#6366f1]/60 hover:from-[#a855f7] hover:to-[#6366f1] text-white hover:scale-110 cursor-pointer shadow-md';
                  let seatTitle = `Seat ${seat.label} - Available`;

                  if (isSelected || isHeldByMe) {
                    seatStyle = 'bg-gradient-to-br from-[#ec4899] to-[#f97316] text-white ring-2 ring-pink-400 shadow-lg shadow-pink-500/50 scale-110 cursor-pointer';
                    seatTitle = isHeldByMe
                      ? `Seat ${seat.label} - Held by you (${activeHold?.remainingSeconds || seat.remainingSeconds || 600}s remaining)`
                      : `Seat ${seat.label} - Selected`;
                  } else if (isHeldByOther) {
                    seatStyle = 'bg-gradient-to-br from-[#f59e0b]/25 to-[#d97706]/35 border border-amber-500/40 text-amber-200/90 cursor-not-allowed opacity-90';
                    seatTitle = `Seat ${seat.label} - Held by another attendee (10-minute hold)`;
                  } else if (isBooked) {
                    seatStyle = 'bg-white/5 border border-white/5 text-white/20 cursor-not-allowed';
                    seatTitle = `Seat ${seat.label} - Booked`;
                  }

                  return (
                    <button
                      key={seat.id}
                      type="button"
                      title={seatTitle}
                      disabled={!isSelectable && !isSelected}
                      onClick={() => {
                        if (isSelectable) {
                          setSelectedSeat(seat);
                        }
                      }}
                      className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300 ${seatStyle}`}
                    >
                      {seat.label}
                      {isHeldByOther && (
                        <span className="absolute -top-1.5 -right-1.5 text-[10px] bg-amber-500 text-black px-1 rounded-full font-extrabold shadow">
                          ⏳
                        </span>
                      )}
                      {isHeldByMe && (
                        <span className="absolute -top-1.5 -right-1.5 text-[10px] bg-pink-500 text-white px-1 rounded-full font-extrabold shadow animate-pulse">
                          ⏳
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-8 h-fit">
          <h3 className="text-xl font-bold mb-6">Order Summary 🧾</h3>

          {/* Active 10-Minute Hold Countdown Banner */}
          {activeHold && selectedSeat && activeHold.seatId === selectedSeat.id && (
            <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-pink-500/20 to-purple-500/20 border border-pink-500/40 text-center shadow-lg shadow-pink-500/10">
              <div className="text-xs uppercase font-bold tracking-wider text-pink-300 flex items-center justify-center gap-1">
                <span>⏳</span> 10-Minute Hold Active
              </div>
              <div className="text-3xl font-extrabold text-white my-2 font-mono tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-pink-300 to-amber-200">
                {String(Math.floor(activeHold.remainingSeconds / 60)).padStart(2, '0')}:
                {String(activeHold.remainingSeconds % 60).padStart(2, '0')}
              </div>
              <div className="text-xs text-white/70">
                Seat <span className="text-white font-bold">{activeHold.label}</span> is held exclusively for you.
              </div>
            </div>
          )}

          <div className="space-y-4 text-white/70">
            <div className="flex justify-between">
              <span>Seat</span>
              <span className="font-bold text-white">{selectedSeat ? selectedSeat.label : '—'}</span>
            </div>
            {isCurrentSeatHeldByMe && (
              <div className="flex justify-between text-xs text-amber-300">
                <span>Hold Status</span>
                <span className="font-bold">Reserved ({Math.floor((activeHold?.remainingSeconds || 600) / 60)}m left)</span>
              </div>
            )}
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

          {/* Dynamic Action Buttons based on Hold State */}
          {isPast ? (
            <button
              disabled
              className="mt-8 w-full py-4 rounded-2xl bg-white/10 text-white/40 font-bold text-lg cursor-not-allowed"
            >
              Event Has Ended ⏰
            </button>
          ) : isCurrentSeatHeldByMe ? (
            <div className="mt-8 space-y-3">
              <button
                disabled={actionLoading}
                onClick={handleBook}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#22c55e] via-[#16a34a] to-[#15803d] font-bold text-lg text-white hover:scale-[1.02] hover:shadow-2xl hover:shadow-green-500/40 transition-all duration-300 disabled:opacity-50"
              >
                {actionLoading ? 'Confirming...' : `Confirm Booking ($${total.toFixed(2)}) 🎟️`}
              </button>
              <button
                disabled={actionLoading}
                onClick={handleRelease}
                className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-medium text-sm transition-all duration-300"
              >
                Release Seat Hold
              </button>
            </div>
          ) : selectedSeat && selectedSeat.available ? (
            <div className="mt-8 space-y-3">
              <button
                disabled={actionLoading}
                onClick={handleHold}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#f59e0b] via-[#ec4899] to-[#a855f7] font-bold text-lg text-white hover:scale-[1.02] hover:shadow-2xl hover:shadow-pink-500/40 transition-all duration-300 disabled:opacity-50"
              >
                {actionLoading ? 'Holding...' : `Hold Seat for 10 Mins ⏳`}
              </button>
              <button
                disabled={actionLoading}
                onClick={handleBook}
                className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-medium text-sm transition-all duration-300"
              >
                Or Book Directly ($${total.toFixed(2)}) 🎟️
              </button>
            </div>
          ) : (
            <button
              disabled
              className="mt-8 w-full py-4 rounded-2xl bg-white/10 text-white/40 font-bold text-lg cursor-not-allowed"
            >
              {selectedSeat ? 'Seat Unavailable' : 'Select a Seat to Begin 🪑'}
            </button>
          )}

          <p className="mt-4 text-center text-xs text-white/40">🔒 10-minute hold guarantee · Secure checkout</p>
        </div>
      </div>
    </div>
  );
}
