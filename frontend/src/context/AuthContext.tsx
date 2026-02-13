import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../utils/api';

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  city: string;
  pincode: string;
  address: string;
  location: string;
  rating: number;
  rating_count: number;
  status: string;
  specialities: string[];
  experience: string;
  working_hours: Record<string, string>;
  profile_photo: string;
};

type RegisterData = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        const userData = await api.get('/auth/me');
        setUser(userData);
      }
    } catch {
      await AsyncStorage.removeItem('auth_token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const data = await api.post('/auth/login', { email, password });
    await AsyncStorage.setItem('auth_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (registerData: RegisterData) => {
    const data = await api.post('/auth/register', registerData);
    await AsyncStorage.setItem('auth_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await AsyncStorage.removeItem('auth_token');
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const userData = await api.get('/auth/me');
      setUser(userData);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
