import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import LoadingScreen from '../src/components/LoadingScreen';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      if (user) {
        const role = user.role;
        if (role === 'customer') router.replace('/(customer)');
        else if (role === 'tailor') router.replace('/(tailor)');
        else if (role === 'delivery') router.replace('/(delivery)');
        else if (role === 'admin') router.replace('/(admin)');
        else router.replace('/(auth)/login');
      } else {
        router.replace('/(auth)/login');
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [user, loading]);

  return <LoadingScreen />;
}
