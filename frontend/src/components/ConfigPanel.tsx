import type { ProjectConfig, AnalysisOptions } from '../types/analysis';

interface ConfigPanelProps {
  config: ProjectConfig;
  options: AnalysisOptions;
  onConfigChange: (config: ProjectConfig) => void;
  onToggleOption: (key: keyof AnalysisOptions) => void;
  disabled?: boolean;
}

const PROJECT_TYPES = ['Spring Boot', 'Django', 'React', 'Android', 'Node', 'TypeScript', 'Python', 'Go', 'Other'];
const TEST_FRAMEWORKS = ['JUnit 5', 'JUnit 4', 'TestNG', 'pytest', 'Jest', 'Mocha', 'Playwright', 'Cypress', 'Go test', 'Other'];

const OPTION_LABELS: Record<keyof AnalysisOptions, { label: string; description: string }> = {
  enableRootCause: { label: 'Root Cause', description: 'Deep analysis of why each test failed' },
  enableFixSuggestion: { label: 'Fix Suggestions', description: 'Actionable fix recommendations' },
  enableGrouping: { label: 'Cascading Groups', description: 'Group failures with shared root cause' },
  enableSeverity: { label: 'Severity', description: 'Classify by impact level' },
  enableFlaky: { label: 'Flaky Detection', description: 'Identify intermittent test failures' },
  enableDiff: { label: 'Diff Mode', description: 'Compare with previous build' },
};

export default function ConfigPanel({
  config,
  options,
  onConfigChange,
  onToggleOption,
  disabled = false,
}: ConfigPanelProps) {
  const updateConfig = (field: keyof ProjectConfig, value: string) => {
    onConfigChange({ ...config, [field]: value });
  };

  return (
    <div id="config-panel" className="space-y-5">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Project Configuration</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="project-type" className="block text-xs font-medium text-slate-400 mb-1.5">
            Project Type
          </label>
          <select
            id="project-type"
            value={config.projectType}
            onChange={(e) => updateConfig('projectType', e.target.value)}
            disabled={disabled}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {PROJECT_TYPES.map((pt) => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="test-framework" className="block text-xs font-medium text-slate-400 mb-1.5">
            Test Framework
          </label>
          <select
            id="test-framework"
            value={config.testFramework}
            onChange={(e) => updateConfig('testFramework', e.target.value)}
            disabled={disabled}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {TEST_FRAMEWORKS.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="environment" className="block text-xs font-medium text-slate-400 mb-1.5">
            Environment
          </label>
          <input
            id="environment"
            type="text"
            value={config.environment}
            onChange={(e) => updateConfig('environment', e.target.value)}
            disabled={disabled}
            placeholder="e.g. CI/Docker, staging"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          />
        </div>

        <div>
          <label htmlFor="known-flaky" className="block text-xs font-medium text-slate-400 mb-1.5">
            Known Flaky Tests
          </label>
          <input
            id="known-flaky"
            type="text"
            value={config.knownFlaky}
            onChange={(e) => updateConfig('knownFlaky', e.target.value)}
            disabled={disabled}
            placeholder="Comma-separated test names"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="failed-cases-input" className="block text-xs font-medium text-slate-400 mb-1.5">
            Failed Test Cases List (Optional)
          </label>
          <textarea
            id="failed-cases-input"
            value={config.failedCasesInput || ''}
            onChange={(e) => updateConfig('failedCasesInput', e.target.value)}
            disabled={disabled}
            placeholder="Paste list of failed tests here (one per line, e.g. To verify Zero Rating Submit Feedback/ NM-T5391)&#10;If empty, falls back to automatic 'fail ' keyword detection."
            rows={4}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-mono resize-y"
          />
        </div>
      </div>

      <div className="pt-3 border-t border-slate-700/50">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Analysis Options</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(Object.keys(OPTION_LABELS) as (keyof AnalysisOptions)[]).map((key) => (
            <label
              key={key}
              htmlFor={`option-${key}`}
              className={`
                flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all duration-150
                ${options[key]
                  ? 'border-indigo-500/40 bg-indigo-500/10'
                  : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                id={`option-${key}`}
                type="checkbox"
                checked={options[key]}
                onChange={() => onToggleOption(key)}
                disabled={disabled}
                className="mt-0.5 w-4 h-4 rounded border-slate-500 text-indigo-500 focus:ring-indigo-500 bg-slate-700"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-white block">{OPTION_LABELS[key].label}</span>
                <span className="text-xs text-slate-400 block mt-0.5">{OPTION_LABELS[key].description}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
