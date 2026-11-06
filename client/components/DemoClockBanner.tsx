'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { DemoClockDtoSchema, type DemoClockDto } from '@careloop/shared';

export function DemoClockBanner() {
  const [clock, setClock] = useState<DemoClockDto | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkClock = async () => {
      try {
        const data = await apiFetch('/api/v1/demo/clock', {
          method: 'GET',
          schema: DemoClockDtoSchema,
          skipAuthRedirect: true,
        });
        if (isMounted) {
          setClock(data);
        }
      } catch {
        if (isMounted) {
          setClock(null);
        }
      }
    };

    void checkClock();
    const interval = setInterval(() => {
      void checkClock();
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!clock?.isSimulated) {
    return null;
  }

  const formattedDate = new Date(clock.now).toLocaleString();

  return (
    <div
      role="status"
      className="bg-amber-400 text-amber-950 ps-4 pe-4 py-2 text-xs font-medium flex items-center justify-between border-b border-amber-500"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-800 animate-pulse" />
        <span>
          <strong>Demo simulated time active:</strong> {formattedDate}
        </span>
      </div>
      <span className="text-[11px] opacity-80">
        Offset: {Math.round(clock.offsetMs / 60000)} min
      </span>
    </div>
  );
}
