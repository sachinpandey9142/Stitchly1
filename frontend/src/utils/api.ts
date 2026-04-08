import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export const api = {
  async request(endpoint: string, options: RequestInit = {}) {
    const token = await AsyncStorage.getItem('auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const url = `${BASE_URL}/api${endpoint}`;
    const response = await fetch(url, { ...options, headers });
    const raw = await response.text();
    let data: any = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (!response.ok) {
      const detail =
        data && typeof data === 'object' && 'detail' in data
          ? String((data as { detail: unknown }).detail)
          : typeof data === 'string' && data.trim().length > 0
            ? data
            : `Request failed (${response.status})`;

      throw new Error(detail);
    }

    return data ?? {};
  },

  get(endpoint: string) {
    return this.request(endpoint);
  },

  post(endpoint: string, body: any) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  put(endpoint: string, body: any) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  delete(endpoint: string) {
    return this.request(endpoint, { method: 'DELETE' });
  },
};
