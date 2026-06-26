interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export default function SearchBar({ value, onChange, resultCount, totalCount }: SearchBarProps) {
  return (
    <div id="search-bar" className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </div>
      <input
        id="search-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search test cases by name, suite, or error..."
        className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-20 py-2.5 text-sm text-white
                 placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                 transition-colors"
      />
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
        <span className="text-xs text-slate-500 font-mono">
          {resultCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}
