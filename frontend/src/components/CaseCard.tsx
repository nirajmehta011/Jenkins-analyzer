import { useState } from 'react';
import type { TestCase } from '../types/analysis';
import CreateTicketModal from './CreateTicketModal';

interface CaseCardProps {
  testCase: TestCase;
}

const IMAGE_URL_PATTERN = /\.(png|jpe?g|gif|webp)$/i;

function isImageUrl(url: string): boolean {
  return IMAGE_URL_PATTERN.test(url.split('?')[0]);
}

const STATUS_STYLES: Record<string, { dot: string; bg: string }> = {
  PASSED: { dot: 'bg-emerald-400', bg: 'border-emerald-500/20' },
  FAILED: { dot: 'bg-red-400', bg: 'border-red-500/20' },
  ERROR: { dot: 'bg-rose-400', bg: 'border-rose-500/20' },
  SKIPPED: { dot: 'bg-amber-400', bg: 'border-amber-500/20' },
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-600/20 text-red-300 ring-1 ring-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/30',
  MEDIUM: 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30',
  LOW: 'bg-slate-500/20 text-slate-400 ring-1 ring-slate-500/30',
};

const COMPLEXITY_STYLES: Record<string, string> = {
  LOW: 'bg-emerald-500/20 text-emerald-300',
  MEDIUM: 'bg-amber-500/20 text-amber-300',
  HIGH: 'bg-red-500/20 text-red-300',
};

export default function CaseCard({ testCase: tc }: CaseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['error', 'rootCause', 'evidence']));
  const [showTicketModal, setShowTicketModal] = useState(false);

  const statusStyle = STATUS_STYLES[tc.status] || STATUS_STYLES.FAILED;

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: select & copy
    });
  };

  return (
    <div
      id={`case-${tc.id}`}
      className={`
        border rounded-xl overflow-hidden transition-all duration-150 ease-out
        ${statusStyle.bg}
        ${isExpanded ? 'bg-slate-800/80' : 'bg-slate-800/40 hover:bg-slate-800/60'}
      `}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusStyle.dot}`} />

        {/* Test name */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{tc.name}</p>
          {tc.suite && (
            <p className="text-xs text-slate-500 truncate font-mono">{tc.suite}</p>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 shrink-0">
          {tc.isHookFailure && (
            <span
              className="px-2 py-0.5 rounded-md bg-red-600/25 text-red-300 text-xs font-semibold ring-1 ring-red-500/40"
              title="A setup/teardown hook failed — this can silently block every other test in the same suite"
            >
              ⚙ Setup Hook
            </span>
          )}
          {tc.attemptCount !== null && tc.attemptCount > 1 && (
            <span className="px-2 py-0.5 rounded-md bg-slate-700 text-slate-300 text-xs font-medium" title="Number of execution attempts detected in this log">
              🔁 {tc.attemptCount} attempts
            </span>
          )}
          {tc.isFlaky && (
            <span className="px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-300 text-xs font-medium">
              ⚠ Flaky
            </span>
          )}
          {tc.isCascading && (
            <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-xs font-medium">
              🔗 Cascade
            </span>
          )}
          {tc.severity && (
            <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${SEVERITY_STYLES[tc.severity]}`}>
              {tc.severity}
            </span>
          )}
          {tc.category && (
            <span className="px-2 py-0.5 rounded-md bg-slate-700 text-slate-300 text-xs font-mono">
              {tc.category}
            </span>
          )}
          {tc.duration && (
            <span className="text-xs text-slate-500 font-mono">{tc.duration}</span>
          )}
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50">
          {/* Debug context: test-account email + artifact links (screenshot/HTML diff/etc).
              Shown up front, uncollapsed — this is usually the fastest path for QE
              to jump straight to visual evidence or confirm which account hit the failure. */}
          {(tc.testUserEmail || tc.relatedLinks.length > 0) && (
            <div className="pt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {tc.testUserEmail && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-700/60 text-slate-300 text-xs font-mono">
                    👤 {tc.testUserEmail}
                  </span>
                )}
                {tc.relatedLinks.filter((link) => !isImageUrl(link.url)).map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/15 text-indigo-300 text-xs font-medium hover:bg-indigo-500/25 transition-colors"
                  >
                    🔗 {link.label}
                  </a>
                ))}
              </div>

              {/* Screenshot thumbnails — click through to full size */}
              {tc.relatedLinks.filter((link) => isImageUrl(link.url)).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tc.relatedLinks.filter((link) => isImageUrl(link.url)).map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block w-28 h-20 rounded-lg overflow-hidden border border-slate-700 hover:border-indigo-500/60 transition-colors"
                      title={`${link.label} — click to view full size`}
                    >
                      <img
                        src={link.url}
                        alt={link.label}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-slate-200 px-1.5 py-0.5 truncate">
                        {link.label}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {tc.errorMessage && (
            <CollapsibleSection
              title="Error Message"
              isOpen={expandedSections.has('error')}
              onToggle={() => toggleSection('error')}
            >
              <div className="relative group">
                <pre className="font-mono text-xs text-red-300 bg-red-500/5 rounded-lg p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
                  {tc.errorMessage}
                </pre>
                <button
                  onClick={() => copyToClipboard(tc.errorMessage || '')}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity
                           p-1 rounded bg-slate-700 text-slate-400 hover:text-white"
                  title="Copy"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                </button>
              </div>
            </CollapsibleSection>
          )}

          {/* Stack frames */}
          {tc.stackFrames.length > 0 && (
            <CollapsibleSection
              title={`Stack Trace (${tc.stackFrames.length} frames)`}
              isOpen={expandedSections.has('stack')}
              onToggle={() => toggleSection('stack')}
            >
              <pre className="font-mono text-xs text-slate-300 bg-slate-900/50 rounded-lg p-3 overflow-x-auto max-h-48">
                {tc.stackFrames.slice(0, 5).join('\n')}
                {tc.stackFrames.length > 5 && `\n... +${tc.stackFrames.length - 5} more frames`}
              </pre>
            </CollapsibleSection>
          )}

          {/* Symptom vs Cause */}
          {tc.symptomVsCause && (
            <CollapsibleSection
              title="Symptom vs Cause"
              isOpen={expandedSections.has('symptomCause')}
              onToggle={() => toggleSection('symptomCause')}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-red-400 mb-1">Symptom</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{tc.symptomVsCause.symptom}</p>
                </div>
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-indigo-400 mb-1">Root Cause</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{tc.symptomVsCause.cause}</p>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Root cause */}
          {tc.rootCause && (
            <CollapsibleSection
              title="Root Cause Analysis"
              isOpen={expandedSections.has('rootCause')}
              onToggle={() => toggleSection('rootCause')}
            >
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{tc.rootCause}</p>
              </div>
            </CollapsibleSection>
          )}

          {/* Fix suggestion */}
          {tc.fixSuggestion ? (
            <CollapsibleSection
              title="Fix Suggestion (AI)"
              isOpen={expandedSections.has('fix')}
              onToggle={() => toggleSection('fix')}
            >
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-sm text-slate-200">{tc.fixSuggestion}</p>
                {tc.fixComplexity && (
                  <span className={`
                    inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium
                    ${COMPLEXITY_STYLES[tc.fixComplexity]}
                  `}>
                    Complexity: {tc.fixComplexity}
                  </span>
                )}
              </div>
            </CollapsibleSection>
          ) : (tc.status === 'FAILED' || tc.status === 'ERROR') ? (
            <div className="mt-2 flex items-center gap-2 p-2.5 bg-indigo-500/5 border border-indigo-500/15 rounded-lg">
              <span className="text-indigo-400 text-sm">🤖</span>
              <span className="text-xs text-indigo-300/70">
                Click <strong>"Get AI Fix Suggestions"</strong> above for AI-powered fix recommendations
              </span>
            </div>
          ) : null}

          {/* Create ticket */}
          {(tc.status === 'FAILED' || tc.status === 'ERROR') && (
            <button
              onClick={() => setShowTicketModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200
                       bg-slate-700 hover:bg-slate-600 transition-colors border border-slate-600"
            >
              📋 Create Ticket
            </button>
          )}

          {/* Log evidence */}
          {(tc.logEvidenceQuote || tc.evidenceContext) && (
            <CollapsibleSection
              title="Log Evidence"
              isOpen={expandedSections.has('evidence')}
              onToggle={() => toggleSection('evidence')}
            >
              <div className="space-y-2.5">
                {/* Steps leading up to the failure — what the test was doing right before it broke */}
                {tc.evidenceContext && tc.evidenceContext.precedingSteps.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Leading up to failure</p>
                    <div className="space-y-1">
                      {tc.evidenceContext.precedingSteps.map((step, idx) => (
                        <p key={idx} className="font-mono text-[11px] text-slate-500 truncate" title={step}>
                          {step}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expected vs Received — scannable diff instead of buried prose */}
                {tc.evidenceContext && (tc.evidenceContext.expected || tc.evidenceContext.received) && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80 mb-1">Expected</p>
                      <p className="font-mono text-xs text-emerald-200 break-words">{tc.evidenceContext.expected ?? '—'}</p>
                    </div>
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/80 mb-1">Received</p>
                      <p className="font-mono text-xs text-red-200 break-words">{tc.evidenceContext.received ?? '—'}</p>
                    </div>
                  </div>
                )}

                {/* Page + duration at a glance */}
                {tc.evidenceContext && (tc.evidenceContext.pageUrl || tc.evidenceContext.duration) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {tc.evidenceContext.pageUrl && (
                      <a
                        href={tc.evidenceContext.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-700/50 text-slate-300 text-[11px] hover:text-indigo-300 transition-colors max-w-full truncate"
                        title={tc.evidenceContext.pageUrl}
                      >
                        🌐 {tc.evidenceContext.pageUrl.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                    {tc.evidenceContext.duration && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700/50 text-slate-400 text-[11px]">
                        ⏱ {tc.evidenceContext.duration}
                      </span>
                    )}
                  </div>
                )}

                {tc.logEvidenceQuote && (
                  <blockquote className="font-mono text-xs text-slate-400 italic bg-slate-900/50 rounded-lg p-3 border-l-2 border-indigo-500">
                    {tc.logEvidenceQuote}
                  </blockquote>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Cascading group indicator */}
          {tc.isCascading && tc.cascadeGroupId && (
            <div className="flex items-center gap-2 p-3 bg-violet-500/10 border border-violet-500/20 rounded-lg">
              <span className="text-violet-400">🔗</span>
              <span className="text-sm text-violet-300">
                Part of cascade group <code className="font-mono text-xs bg-violet-500/20 px-1.5 py-0.5 rounded">{tc.cascadeGroupId}</code>
                — fix the root cause to unblock all tests in this group
              </span>
            </div>
          )}

          {/* Confidence indicator */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
            <span className="text-xs text-slate-500">
              Parser Confidence: <span className={`font-medium ${
                tc.parserConfidence === 'HIGH' ? 'text-emerald-400' :
                tc.parserConfidence === 'MEDIUM' ? 'text-amber-400' : 'text-red-400'
              }`}>{tc.parserConfidence}</span>
            </span>
            <span className="text-xs text-slate-600 font-mono">{tc.id}</span>
          </div>
        </div>
      )}

      {showTicketModal && (
        <CreateTicketModal testCase={tc} onClose={() => setShowTicketModal(false)} />
      )}
    </div>
  );
}

// Collapsible section sub-component
function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors mb-1.5"
      >
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {isOpen && <div className="ml-4">{children}</div>}
    </div>
  );
}
