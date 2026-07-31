import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      navigate('/admin/buildings');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 360 }}>
      <h1>Admin Login</h1>
      <form onSubmit={handleSubmit} className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            style={{ flex: 1 }}
          />
        </div>
        <button type="submit" className="primary" disabled={submitting || !password}>
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
