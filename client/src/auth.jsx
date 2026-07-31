import { createContext, useContext, useEffect, useState } from 'react';
import { AUTH_EXPIRED_EVENT, api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAdmin, setIsAdmin] = useState(null); // null = loading

  useEffect(() => {
    api.session().then((s) => setIsAdmin(s.isAdmin)).catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      setIsAdmin(false);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  async function login(password) {
    await api.login(password);
    setIsAdmin(true);
  }

  async function logout() {
    await api.logout();
    setIsAdmin(false);
  }

  return <AuthContext.Provider value={{ isAdmin, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
