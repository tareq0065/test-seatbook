import { useState, FormEvent } from 'react';
import GradientButton from '../components/GradientButton';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await fetch(`http://localhost:4000/auth/${isLogin ? 'login' : 'register'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isLogin ? { email, password } : { email, password, name }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.message || data.error);
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = '/';
  };

  return (
    <div className="flex justify-center py-10">
      <div className="glass rounded-3xl p-10 w-[440px] glow">
        <div className="text-center mb-8">
          <div className="text-6xl animate-float">🎟️</div>
          <h1 className="mt-4 text-4xl font-extrabold">
            {isLogin ? 'Welcome ' : 'Join '}
            <span className="gradient-text">{isLogin ? 'Back!' : 'Seatbook!'}</span>
          </h1>
          <p className="mt-2 text-white/50">
            {isLogin ? 'Sign in to continue your journey ✨' : 'Start booking amazing events today 🚀'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <input
              placeholder="👤 Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
            />
          )}
          <input
            placeholder="📧 Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
          />
          <input
            type="password"
            placeholder="🔒 Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
          />
          {error && <p className="text-[#fca5a5] text-sm">⚠️ {error}</p>}
          <GradientButton type="submit">{isLogin ? 'Sign In 🚀' : 'Create Account ✨'}</GradientButton>
        </form>
        <p className="mt-6 text-center text-white/50">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <span onClick={() => setIsLogin(!isLogin)} className="text-[#a855f7] cursor-pointer hover:underline">
            {isLogin ? 'Sign up' : 'Sign in'}
          </span>
        </p>
      </div>
    </div>
  );
}
