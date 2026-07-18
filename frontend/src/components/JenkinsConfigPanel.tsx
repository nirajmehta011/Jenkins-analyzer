import { useState } from 'react';
import type { IntegrationConfig } from '../utils/integrationConfig';
import {
  loadIntegrationConfig,
  saveIntegrationConfig,
} from '../utils/integrationConfig';

interface JenkinsConfigPanelProps {
  onClose: () => void;
}

export default function JenkinsConfigPanel({ onClose }: JenkinsConfigPanelProps) {
  const [config, setConfig] = useState<IntegrationConfig>(loadIntegrationConfig);
  const [saved, setSaved] = useState(false);

  const updateConfig = (patch: Partial<IntegrationConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
  };

  const save = () => {
    saveIntegrationConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isConfigured = config.jenkinsBaseUrl && config.jenkinsJobPath;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">🔧 Jenkins Configuration</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400">
            Configure your Jenkins instance to enable the "Re-run Selected Cases" feature.
          </p>

          {/* Jenkins Base URL */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
              Jenkins Base URL
            </label>
            <input
              type="url"
              placeholder="https://jenkins.example.com"
              value={config.jenkinsBaseUrl}
              onChange={(e) => updateConfig({ jenkinsBaseUrl: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              The base URL of your Jenkins instance (without trailing slash)
            </p>
          </div>

          {/* Jenkins Job Path */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
              Job Path
            </label>
            <input
              type="text"
              placeholder="job/digital-ui-automation"
              value={config.jenkinsJobPath}
              onChange={(e) => updateConfig({ jenkinsJobPath: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              The full job path segment as it appears in your Jenkins job's own URL, including the leading
              "job/" — e.g. <code className="font-mono text-slate-400">job/digital-ui-automation</code>. For a
              job nested in folders, Jenkins repeats it per level:{' '}
              <code className="font-mono text-slate-400">job/team-folder/job/digital-ui-automation</code>.
            </p>
          </div>

          {/* Test ID Parameter Name */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1">
              Test ID Parameter Name
            </label>
            <input
              type="text"
              placeholder="MULTIPLE_GROUPS"
              value={config.jenkinsTestIdParam}
              onChange={(e) => updateConfig({ jenkinsTestIdParam: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <p className="text-xs text-slate-500 mt-1">
              The build parameter your job uses to accept a comma-separated list of test IDs. Defaults to{' '}
              <code className="font-mono text-slate-400">MULTIPLE_GROUPS</code>, but this is job-specific —
              check your job's own parameter list if re-runs aren't picking up the right tests.
            </p>
          </div>

          {/* Preview */}
          {isConfigured && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-indigo-400 mb-1">Preview</p>
              <p className="text-xs text-slate-400 font-mono break-all">
                {config.jenkinsBaseUrl}/{config.jenkinsJobPath}/build?{config.jenkinsTestIdParam || 'MULTIPLE_GROUPS'}=...
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={save}
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-white text-sm
                       bg-gradient-to-r from-indigo-500 to-violet-600
                       hover:from-indigo-400 hover:to-violet-500
                       transition-all duration-200"
            >
              {saved ? '✓ Saved' : 'Save Configuration'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-slate-300 text-sm
                       bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
