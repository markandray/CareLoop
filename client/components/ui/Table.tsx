import React from 'react';

export interface TableProps {
  headers: React.ReactNode[];
  children: React.ReactNode;
  caption?: string;
  className?: string;
}

export function Table({
  headers,
  children,
  caption,
  className = '',
}: TableProps) {
  return (
    <div
      className={`overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-sm ${className}`}
    >
      <table className="min-w-full divide-y divide-slate-200 text-xs text-slate-700">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                scope="col"
                className="ps-4 pe-4 py-3 text-start whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>
      </table>
    </div>
  );
}
