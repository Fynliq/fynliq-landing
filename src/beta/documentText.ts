/**
 * Reads a PDF or screenshot on the student's own device and returns its text,
 * page by page. Nothing here sends anything anywhere: the file bytes stay in
 * the browser, and only the redacted text produced from this is uploaded.
 *
 * PDFs with a text layer (the FAFSA Submission Summary from studentaid.gov,
 * most portal "print to PDF" exports) are read directly. Images and scanned
 * PDFs go through OCR. Both libraries load on demand, so the landing page does
 * not pay for them.
 */

const MAX_PAGES = 12;

export type ReadProgress = (message: string) => void;

type Ocr = (image: Blob | HTMLCanvasElement) => Promise<string>;

async function createOcr(): Promise<{ read: Ocr; done: () => Promise<void> }> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  return {
    read: async (image) => (await worker.recognize(image)).data.text,
    done: async () => { await worker.terminate(); },
  };
}

/**
 * Makes a screenshot easier for OCR to read. Phone screenshots are often in
 * dark mode, and OCR reads light text on a dark background badly, so the image
 * is converted to grayscale and inverted when it is mostly dark. Small images
 * are scaled up. Runs entirely on the device.
 */
async function prepareImage(file: Blob): Promise<HTMLCanvasElement | Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 1000 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width * scale;
  canvas.height = bitmap.height * scale;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { bitmap.close(); return file; }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = gray;
    total += gray;
  }
  if (total / (px.length / 4) < 128) {
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

interface PositionedText { str: string; x: number; y: number }

/** Rebuilds visual lines from pdf.js text items, which arrive as loose fragments. */
export function itemsToLines(items: PositionedText[]): string {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - item.y) < 3) line.push(item);
    else lines.push([item]);
  }
  return lines
    .map((line) => line.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' '))
    .join('\n');
}

async function readPdf(file: File, progress: ReadProgress, ocr: () => Promise<Ocr>): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    const count = Math.min(pdf.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n += 1) {
      progress(`Reading page ${n} of ${count}`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PositionedText[] = [];
      for (const item of content.items) {
        if ('str' in item) items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
      let text = itemsToLines(items);

      // A scanned page has no text layer: render it and read the pixels instead.
      if (text.replace(/\s/g, '').length < 20) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          text = await (await ocr())(canvas);
        }
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push(text);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * Text for each file, one string per page. Throws if a file cannot be read.
 */
export async function readDocuments(files: File[], progress: ReadProgress = () => {}): Promise<string[][]> {
  let engine: { read: Ocr; done: () => Promise<void> } | null = null;
  const ocr = async () => {
    if (!engine) {
      progress('Loading the text reader');
      engine = await createOcr();
    }
    return engine.read;
  };

  try {
    const results: string[][] = [];
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        results.push(await readPdf(file, progress, ocr));
      } else {
        progress(`Reading ${file.name}`);
        results.push([await (await ocr())(await prepareImage(file))]);
      }
    }
    return results;
  } finally {
    if (engine) await (engine as { done: () => Promise<void> }).done();
  }
}
