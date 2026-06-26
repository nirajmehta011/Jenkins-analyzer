import { useState, useCallback } from 'react';
import { preprocessLogClient, estimateLogComplexity } from '../services/logPreprocessor';
import { extractZipFile, isZipFile } from '../services/zipExtractor';

interface LogInfo {
  originalSize: number;
  processedSize: number;
  lineCount: number;
  estimatedSuites: number;
  estimatedFailures: number;
  isZip: boolean;
  extractedFileCount?: number;
}

interface UseLogParserReturn {
  logInfo: LogInfo | null;
  isProcessing: boolean;
  processFile: (file: File) => Promise<void>;
  reset: () => void;
}

export function useLogParser(): UseLogParserReturn {
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      let rawText: string;
      let extractedFileCount: number | undefined;

      if (isZipFile(file)) {
        rawText = await extractZipFile(file);
        extractedFileCount = (rawText.match(/=== FILE: /g) || []).length;
      } else {
        rawText = await file.text();
      }

      const processed = preprocessLogClient(rawText);
      const complexity = estimateLogComplexity(processed);

      setLogInfo({
        originalSize: file.size,
        processedSize: new Blob([processed]).size,
        lineCount: complexity.lineCount,
        estimatedSuites: complexity.estimatedSuites,
        estimatedFailures: complexity.estimatedFailures,
        isZip: isZipFile(file),
        extractedFileCount,
      });
    } catch (err) {
      console.error('Error processing file:', err);
      setLogInfo(null);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLogInfo(null);
    setIsProcessing(false);
  }, []);

  return { logInfo, isProcessing, processFile, reset };
}
