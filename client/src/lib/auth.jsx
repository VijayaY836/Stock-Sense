import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api.get('/auth/me').then(setUser).catch(logout).finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo(() => ({
    user,
    loading,
    isManager: user?.role === 'manager',
    signIn({ token, user }) { tokenStore.set(token); setUser(user); },
    updateUser(u, token) { if (token) tokenStore.set(token); setUser(u); },
    logout,
  }), [user, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
