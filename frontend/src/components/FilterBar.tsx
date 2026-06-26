import type { TestStatus, FailureCategory, Severity } from '../types/analysis';

interface FilterBarProps {
  activeStatusFilter: TestStatus | 'ALL';
  activeCategoryFilter: FailureCategory | 'ALL';
  activeSeverityFilter: Severity | 'ALL';
  flakyOnly: boolean;
  cascadingOnly: boolean;
  availableCategories: FailureCategory[];
  onStatusChange: (status: TestStatus | 'ALL') => void;
  onCategoryChange: (category: FailureCategory | 'ALL') => void;
  onSeverityChange: (severity: Severity | 'ALL') => void;
  onFlakyToggle: () => void;
  onCascadingToggle: () => void;
  activeFilterCount: number;
}

const STATUS_OPTIONS: { value: TestStatus | 'ALL'; label: string; color: string }[] = [
  { value: 'ALL', label: 'All', color: 'bg-slate-600' },
  { value: 'FAILED', label: 'Failed', color: 'bg-red-500' },
  { value: 'ERROR', label: 'Error', color: 'bg-rose-500' },
  { value: 'PASSED', label: 'Passed', color: 'bg-emerald-500' },
  { value: 'SKIPPED', label: 'Skipped', color: 'bg-amber-500' },
];

const SEVERITY_OPTIONS: { value: Severity | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Any severity' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

export default function FilterBar({
  activeStatusFilter,
  activeCategoryFilter,
  activeSeverityFilter,
  flakyOnly,
  cascadingOnly,
  availableCategories,
  onStatusChange,
  onCategoryChange,
  onSeverityChange,
  onFlakyToggle,
  onCascadingToggle,
  activeFilterCount,
}: FilterBarProps) {
  return (
    <div id="filter-bar" className="space-y-3">
      {/* Status filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider mr-1">Status</span>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            id={`filter-status-${opt.value.toLowerCase()}`}
            onClick={() => onStatusChange(opt.value)}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
              ${activeStatusFilter === opt.value
                ? `${opt.color} text-white shadow-lg`
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
              }
            `}
          >
            {opt.label}
          </button>
        ))}

        {/* Severity dropdown */}
        <select
          id="filter-severity"
          value={activeSeverityFilter}
          onChange={(e) => onSeverityChange(e.target.value as Severity | 'ALL')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-400
                   border border-slate-700 focus:ring-1 focus:ring-indigo-500 outline-none"
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Toggle filters */}
        <button
          id="filter-flaky"
          onClick={onFlakyToggle}
          className={`
            px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
            ${flakyOnly
              ? 'bg-orange-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }
          `}
        >
          ⚠ Flaky only
        </button>
        <button
          id="filter-cascading"
          onClick={onCascadingToggle}
          className={`
            px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
            ${cascadingOnly
              ? 'bg-violet-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }
          `}
        >
          🔗 Cascading only
        </button>

        {activeFilterCount > 0 && (
          <span className="ml-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium">
            {activeFilterCount} active
          </span>
        )}
      </div>

      {/* Category filters (only show if categories are present) */}
      {availableCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider mr-1">Category</span>
          <button
            onClick={() => onCategoryChange('ALL')}
            className={`
              px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
              ${activeCategoryFilter === 'ALL'
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }
            `}
          >
            All
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={`
                px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
                ${activeCategoryFilter === cat
                  ? 'bg-indigo-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }
              `}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
