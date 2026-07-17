import { useState } from 'react';
import type { TestCase } from '../types/analysis';
import { generateTicketTitle, generateTicketBody } from '../utils/ticketContent';
import {
  loadIntegrationConfig,
  saveIntegrationConfig,
  buildGithubIssueUrl,
  buildJiraCreateUrl,
  type IntegrationConfig,
} from '../utils/integrationConfig';

interface CreateTicketModalProps {
  testCase: TestCase;
  onClose: () => void;
}

type CopyTarget = 'title' | 'body' | null;

export default function CreateTicketModal({ testCase, onClose }: CreateTicketModalProps) {
  const [config, setConfig] = useState<IntegrationConfig>(loadIntegrationConfig);
  const [showSettings, setShowSettings] = useState(
    !config.githubOwner && !config.githubRepo && !config.jiraBaseUrl
  );
  const [copied, setCopied] = useState<CopyTarget>(null);

  const title = generateTicketTitle(testCase);
  const body = generateTicketBody(testCase);

  const updateConfig = (patch: Partial<IntegrationConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveIntegrationConfig(next);
  };

  const copy = (target: CopyTarget, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(target);
      setTimeout(() => setCopied(null), 1800);
    }).catch(() => {
      // Clipboard access denied — the text is still visible/selectable in the textarea below
    });
  };

  const githubUrl = buildGithubIssueUrl(config, title, body);
  const jiraUrl = buildJiraCreateUrl(config);

  const openJira = () => {
    // Jira's create-issue form doesn't reliably prefill from a URL, so copy
    // the body first and open the page for the user to paste it in.
    copy('body', body);
    if (jiraUrl) window.open(jiraUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">📋 Create Ticket — {testCase.id}</h3>
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
          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Title</label>
              <button
                onClick={() => copy('title', title)}
                className="text-xs text-indigo-300 hover:text-indigo-200 transition-colors"
              >
                {copied === 'title' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <input
              readOnly
              value={title}
              onFocus={(e) => e.target.select()}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Description (Markdown)</label>
              <button
                onClick={() => copy('body', body)}
                className="text-xs text-indigo-300 hover:text-indigo-200 transition-colors"
              >
                {copied === 'body' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={body}
              onFocus={(e) => e.target.select()}
              rows={12}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono resize-y"
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <a
              href={githubUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (!githubUrl) e.preventDefault(); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                githubUrl
                  ? 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
              title={githubUrl ? 'Opens a pre-filled GitHub issue' : 'Configure a GitHub repo below first'}
            >
              🐙 Open Pre-filled GitHub Issue
            </a>
            <button
              onClick={openJira}
              disabled={!jiraUrl}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                jiraUrl
                  ? 'bg-blue-600/80 text-white hover:bg-blue-600'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
              title={jiraUrl ? 'Copies the description and opens Jira — paste it in' : 'Configure a Jira URL below first'}
            >
              🔷 Copy + Open Jira
            </button>
          </div>
          {jiraUrl && (
            <p className="text-[11px] text-slate-500">
              Jira doesn't support pre-filling the create form reliably — this copies the description to your clipboard and opens the create page. Just paste it in.
            </p>
          )}

          {/* Settings */}
          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="text-xs text-slate-400 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${showSettings ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              ⚙ Configure GitHub / Jira (saved locally, one-time)
            </button>
            {showSettings && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">GitHub Owner</label>
                  <input
                    value={config.githubOwner}
                    onChange={(e) => updateConfig({ githubOwner: e.target.value })}
                    placeholder="e.g. nirajmehta011"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">GitHub Repo</label>
                  <input
                    value={config.githubRepo}
                    onChange={(e) => updateConfig({ githubRepo: e.target.value })}
                    placeholder="e.g. Jenkins-analyzer"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">Jira Base URL</label>
                  <input
                    value={config.jiraBaseUrl}
                    onChange={(e) => updateConfig({ jiraBaseUrl: e.target.value })}
                    placeholder="https://yourcompany.atlassian.net"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">Jira Project Key</label>
                  <input
                    value={config.jiraProjectKey}
                    onChange={(e) => updateConfig({ jiraProjectKey: e.target.value })}
                    placeholder="e.g. QA"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
