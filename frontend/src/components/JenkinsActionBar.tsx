import { useState } from 'react';
import type { TestCase } from '../types/analysis';
import {
  loadIntegrationConfig,
  extractTestId,
  buildJenkinsBuildUrl,
} from '../utils/integrationConfig';

interface JenkinsActionBarProps {
  cases: TestCase[];
  selectedCaseIds: Set<string>;
  onConfigClick: () => void;
}

export default function JenkinsActionBar({
  cases,
  selectedCaseIds,
  onConfigClick,
}: JenkinsActionBarProps) {
  const [copied, setCopied] = useState(false);

  if (selectedCaseIds.size === 0) return null;

  const config = loadIntegrationConfig();
  const isConfigured = config.jenkinsBaseUrl && config.jenkinsJobPath;
  const paramName = config.jenkinsTestIdParam || 'MULTIPLE_GROUPS';

  const selectedCases = cases.filter((c) => selectedCaseIds.has(c.id));
  const testIds = selectedCases
    .map((c) => extractTestId(c.name))
    .filter((id): id is string => id !== null);
  const testIdValue = testIds.join(',');

  const handleRerun = () => {
    if (!isConfigured) {
      onConfigClick();
      return;
    }

    // Jenkins' manual parameter-confirmation form doesn't read query-string
    // values into its input fields — that's only honored by
    // /buildWithParameters, which triggers the build immediately with no
    // review step, which this feature deliberately avoids. So the test IDs
    // are copied to the clipboard for the user to paste into the form
    // themselves, rather than relying on a prefill Jenkins doesn't do.
    navigator.clipboard.writeText(testIdValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      // Clipboard access denied — the job page still opens; the IDs are
      // still visible in the action bar to copy manually.
    });

    const url = buildJenkinsBuildUrl(config, testIds);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 flex flex-col gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-300">
              {selectedCaseIds.size} case{selectedCaseIds.size === 1 ? '' : 's'} selected
            </span>
            {testIds.length > 0 && (
              <span className="text-xs text-slate-500 font-mono">
                ({testIds.join(', ')})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isConfigured && (
              <button
                onClick={onConfigClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 text-sm
                         bg-amber-500/20 hover:bg-amber-500/30 transition-colors border border-amber-500/30"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2.25m0 0v2.25m0-4.5v4.5m0-15a9 9 0 110 18 9 9 0 010-18z" />
                </svg>
                Configure Jenkins
              </button>
            )}

            <button
              onClick={handleRerun}
              disabled={testIds.length === 0}
              title={testIds.length === 0 ? 'No valid test IDs found' : `Copies test IDs to your clipboard and opens the build form — Jenkins doesn't support prefilling this field from a URL, so paste them into ${paramName} yourself`}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold text-white text-sm
                       bg-gradient-to-r from-indigo-500 to-violet-600
                       hover:from-indigo-400 hover:to-violet-500
                       disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                       shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40
                       transition-all duration-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {copied ? '✓ Copied to clipboard' : 'Copy IDs + Open Jenkins'}
            </button>
          </div>
        </div>
        {copied && (
          <p className="text-[11px] text-slate-500 text-center">
            Paste into the <code className="font-mono text-slate-400">{paramName}</code> field on the build form, then click Build.
          </p>
        )}
      </div>
    </div>
  );
}
