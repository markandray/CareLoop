'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getRoleLandingRoute } from '../lib/auth';
import { useSession } from '../lib/session';

export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace(getRoleLandingRoute(user.role));
      } else {
        router.replace('/login');
      }
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div
        role="status"
        aria-label="Loading CareLoop"
        className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent"
      />
    </div>
  );
}
