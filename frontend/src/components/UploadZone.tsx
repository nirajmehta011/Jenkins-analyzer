import { useCallback, useRef, useState } from 'react';
import { formatFileSize } from '../utils/formatters';

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isAnalyzing: boolean;
}

const ACCEPTED_EXTENSIONS = ['.zip', '.log', '.txt', '.gz'];
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

export default function UploadZone({ onFileSelect, isAnalyzing }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported format "${ext}". Please use .zip, .log, .txt, or .gz`;
    }
    if (file.size > MAX_SIZE) {
      return `File is ${formatFileSize(file.size)} — exceeds 100 MB limit`;
    }
    return null;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSelectedFile(file);

    if (file.name.endsWith('.zip')) {
      setIsExtracting(true);
      // Brief delay to show extraction UI
      await new Promise((r) => setTimeout(r, 100));
      setIsExtracting(false);
    }

    onFileSelect(file);
  }, [onFileSelect, validateFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full">
      <div
        id="upload-zone"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative group cursor-pointer rounded-2xl border-2 border-dashed
          transition-all duration-200 ease-out
          ${isDragging
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]'
            : selectedFile
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-600 bg-slate-800/50 hover:border-indigo-500/50 hover:bg-slate-800'
          }
          ${isAnalyzing ? 'pointer-events-none opacity-60' : ''}
          p-8 text-center
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.log,.txt,.gz"
          onChange={handleInputChange}
          className="hidden"
          id="file-input"
        />

        {isExtracting ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-indigo-300 font-medium">Extracting ZIP...</p>
          </div>
        ) : selectedFile ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-lg">{selectedFile.name}</p>
              <p className="text-slate-400 text-sm mt-1">{formatFileSize(selectedFile.size)}</p>
            </div>
            <p className="text-slate-500 text-xs">Click or drag to replace</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-700/50 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
              <svg className="w-8 h-8 text-slate-400 group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-lg">Drop your Jenkins log here</p>
              <p className="text-slate-400 text-sm mt-1">or click to browse</p>
            </div>
            <div className="flex gap-2 mt-1">
              {ACCEPTED_EXTENSIONS.map((ext) => (
                <span key={ext} className="px-2.5 py-1 rounded-md bg-slate-700/60 text-slate-400 text-xs font-mono">
                  {ext}
                </span>
              ))}
            </div>
            <p className="text-slate-500 text-xs">Max 100 MB</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
