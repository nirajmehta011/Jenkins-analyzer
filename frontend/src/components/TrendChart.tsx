import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { TestCase, FailureCategory } from '../types/analysis';

interface TrendChartProps {
  cases: TestCase[];
  onCategoryClick: (category: FailureCategory) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  NullPointerException: '#ef4444',
  AssertionError: '#f97316',
  Timeout: '#eab308',
  ConnectionError: '#3b82f6',
  ConfigError: '#8b5cf6',
  DependencyError: '#ec4899',
  SetupFailure: '#14b8a6',
  DataError: '#f59e0b',
  EnvironmentError: '#6366f1',
  RaceCondition: '#d946ef',
  AuthError: '#f43f5e',
  NetworkError: '#0ea5e9',
  Unknown: '#6b7280',
};

export default function TrendChart({ cases, onCategoryClick }: TrendChartProps) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tc of cases) {
      if (tc.status === 'FAILED' || tc.status === 'ERROR') {
        const cat = tc.category || 'Unknown';
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [cases]);

  if (data.length === 0) {
    return null;
  }

  return (
    <div id="trend-chart" className="bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700/50 p-5">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
        Failure Categories
      </h3>
      <div style={{ width: '100%', height: Math.max(200, data.length * 40) }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 20, bottom: 0, left: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
            <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#475569' }} />
            <YAxis
              type="category"
              dataKey="category"
              width={140}
              tick={{ fill: '#cbd5e1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f1f5f9',
                fontSize: '13px',
              }}
              cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              cursor="pointer"
              onClick={(entry: { category: string }) => {
                if (entry?.category) {
                  onCategoryClick(entry.category as FailureCategory);
                }
              }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.category}
                  fill={CATEGORY_COLORS[entry.category] || '#6b7280'}
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
