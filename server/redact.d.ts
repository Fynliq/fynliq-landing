export declare const REDACTED: string;
export interface RedactedPage { text: string; removed: Record<string, number>; keptLines: number }
export declare function redactPage(text: string): RedactedPage;
export declare function redactDocuments(documents: { name?: string; pages: string[] }[]): {
  pages: string[];
  keptLines: number;
  removed: Record<string, number>;
}[];
export declare function fixOcrNumbers(line: string): string;
