'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // Match the post-login redirect on the /login page: admins +
    // staff land on the back-office, clients on the portal. Without
    // this, an admin with a restored session who hits the root URL
    // lands on /dashboard and has to click Admin → every time.
    router.replace(
      user.role === 'admin' || user.role === 'staff' ? '/admin' : '/dashboard',
    );
  }, [loading, user, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-ink-400">
      Loading…
    </main>
  );
}
