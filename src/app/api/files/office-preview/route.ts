import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt']);

/**
 * Convert office files (docx/xlsx/pptx) to HTML for preview.
 * PDF is handled client-side via iframe + /api/files/raw.
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  const baseDir = request.nextUrl.searchParams.get('baseDir');

  if (!filePath) {
    return Response.json({ error: 'path parameter is required' }, { status: 400 });
  }

  const resolved = path.resolve(filePath);
  const homeDir = os.homedir();
  const allowedBase = baseDir ? path.resolve(baseDir) : homeDir;

  if (!resolved.startsWith(allowedBase) && !resolved.startsWith(homeDir)) {
    return Response.json({ error: 'Access denied: path outside allowed directory' }, { status: 403 });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!OFFICE_EXTENSIONS.has(ext)) {
    return Response.json({ error: `Unsupported file type: ${ext}` }, { status: 400 });
  }

  try {
    await fs.access(resolved);
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const html = await convertToHtml(resolved, ext);
    return Response.json({ html, fileName: path.basename(resolved), ext });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to convert file';
    return Response.json({ error: message }, { status: 500 });
  }
}

async function convertToHtml(filePath: string, ext: string): Promise<string> {
  switch (ext) {
    case '.docx':
      return convertDocx(filePath);
    case '.xlsx':
      return convertXlsx(filePath);
    case '.pptx':
      return convertPptx(filePath);
    case '.doc':
    case '.xls':
    case '.ppt':
      return `<div style="padding:40px;text-align:center;color:#888;">
        <p style="font-size:16px;margin-bottom:8px;">旧版 Office 格式 (${ext})</p>
        <p style="font-size:13px;">仅支持预览 .docx / .xlsx / .pptx 格式</p>
      </div>`;
    default:
      throw new Error(`Unsupported extension: ${ext}`);
  }
}

async function convertDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.convertToHtml({ buffer });
  return result.value;
}

async function convertXlsx(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const buffer = await fs.readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const html = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${sheetName}` });
    sheets.push(
      `<div class="sheet-tab">${escapeHtml(sheetName)}</div>${html}`
    );
  }
  return sheets.join('<hr style="margin:16px 0;border-color:#e5e7eb;">');
}

// ---------- PPTX types ----------

interface PptxShape {
  x: number;      // percentage of slide width
  y: number;      // percentage of slide height
  w: number;      // percentage of slide width
  h: number;      // percentage of slide height
  paragraphs: PptxParagraph[];
  bgColor?: string;
  borderColor?: string;
}

interface PptxParagraph {
  runs: PptxRun[];
  align?: string;   // l | ctr | r | just
  bulletChar?: string;
  bulletNum?: boolean;
  level: number;
}

interface PptxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;   // pt
  color?: string;      // hex without #
  fontFamily?: string;
}

interface SlideData {
  shapes: PptxShape[];
  bgColor?: string;
  slideWidthPt: number;  // slide width in points, for font scaling
}

// Standard slide dimensions in EMU (English Metric Units)
// 1 inch = 914400 EMU. Default 10"×7.5"
const DEFAULT_SLIDE_W = 9144000;
const DEFAULT_SLIDE_H = 6858000;

async function convertPptx(filePath: string): Promise<string> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  // Read slide dimensions from presentation.xml
  let slideW = DEFAULT_SLIDE_W;
  let slideH = DEFAULT_SLIDE_H;
  const presEntry = entries.find(e => e.entryName === 'ppt/presentation.xml');
  if (presEntry) {
    const presXml = presEntry.getData().toString('utf-8');
    const sldSzMatch = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
    if (sldSzMatch) {
      slideW = parseInt(sldSzMatch[1]);
      slideH = parseInt(sldSzMatch[2]);
    }
  }

  // Parse slide layout/master for default text styles (optional, best-effort)
  // Collect slide entries sorted by number
  const slideEntries = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  if (slideEntries.length === 0) {
    return '<div style="padding:40px;text-align:center;color:#888;">无法解析幻灯片内容</div>';
  }

  // Parse slide layout rels to find layout backgrounds
  const layoutBgs = new Map<string, string>();
  for (const entry of entries) {
    if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(entry.entryName)) {
      const xml = entry.getData().toString('utf-8');
      const bg = extractBgColor(xml);
      if (bg) layoutBgs.set(entry.entryName, bg);
    }
  }

  const slides: string[] = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const xml = slideEntries[i].getData().toString('utf-8');
    const slideData = parseSlide(xml, slideW, slideH);

    // Try to get layout background if slide has no bg
    if (!slideData.bgColor) {
      const relPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
      const relEntry = entries.find(e => e.entryName === relPath);
      if (relEntry) {
        const relXml = relEntry.getData().toString('utf-8');
        const layoutMatch = relXml.match(/Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"/);
        if (layoutMatch) {
          slideData.bgColor = layoutBgs.get(`ppt/slideLayouts/${layoutMatch[1]}`);
        }
      }
    }

    slides.push(renderSlideHtml(slideData, i + 1, slideEntries.length));
  }

  return slides.join('');
}

function parseSlide(xml: string, slideW: number, slideH: number): SlideData {
  const shapes: PptxShape[] = [];
  const bgColor = extractBgColor(xml);

  // Extract all shape trees: <p:sp> elements
  const spRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  let spMatch;
  while ((spMatch = spRegex.exec(xml)) !== null) {
    const spXml = spMatch[0];
    const shape = parseShape(spXml, slideW, slideH);
    if (shape && shape.paragraphs.some(p => p.runs.length > 0)) {
      shapes.push(shape);
    }
  }

  // Also extract group shapes <p:grpSp> — flatten their children
  const grpRegex = /<p:grpSp\b[\s\S]*?<\/p:grpSp>/g;
  let grpMatch;
  while ((grpMatch = grpRegex.exec(xml)) !== null) {
    const grpXml = grpMatch[0];
    const innerSpRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let innerMatch;
    while ((innerMatch = innerSpRegex.exec(grpXml)) !== null) {
      const shape = parseShape(innerMatch[0], slideW, slideH);
      if (shape && shape.paragraphs.some(p => p.runs.length > 0)) {
        shapes.push(shape);
      }
    }
  }

  return { shapes, bgColor, slideWidthPt: slideW / 12700 };
}

function parseShape(spXml: string, slideW: number, slideH: number): PptxShape | null {
  // Extract transform: <a:off x="..." y="..."/><a:ext cx="..." cy="..."/>
  const offMatch = spXml.match(/<a:off[^>]*x="(\d+)"[^>]*y="(\d+)"/);
  const extMatch = spXml.match(/<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);

  // Default to full-width if no transform
  const x = offMatch ? parseInt(offMatch[1]) : 0;
  const y = offMatch ? parseInt(offMatch[2]) : 0;
  const w = extMatch ? parseInt(extMatch[1]) : slideW;
  const h = extMatch ? parseInt(extMatch[2]) : slideH;

  // Shape background — only from <p:spPr> (shape properties), not from text runs
  const spPrMatch = spXml.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/);
  let bgColor: string | undefined;
  let borderColor: string | undefined;
  if (spPrMatch) {
    const spPr = spPrMatch[1];
    // Background fill (not inside <a:ln>)
    const fillMatch = spPr.match(/<a:solidFill>\s*<a:srgbClr val="([A-Fa-f0-9]{6})"/);
    // Make sure this fill is not inside <a:ln> (border)
    const lnStart = spPr.indexOf('<a:ln');
    if (fillMatch && (lnStart === -1 || fillMatch.index! < lnStart)) {
      bgColor = `#${fillMatch[1]}`;
    }
    // Border
    const lnMatch = spPr.match(/<a:ln[^>]*>([\s\S]*?)<\/a:ln>/);
    if (lnMatch) {
      const lnColorMatch = lnMatch[1].match(/<a:srgbClr val="([A-Fa-f0-9]{6})"/);
      if (lnColorMatch) borderColor = `#${lnColorMatch[1]}`;
    }
  }

  // Extract text body <p:txBody>
  const txBodyMatch = spXml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
  if (!txBodyMatch) return null;
  const txBody = txBodyMatch[1];

  const paragraphs = parseParagraphs(txBody);

  return {
    x: (x / slideW) * 100,
    y: (y / slideH) * 100,
    w: (w / slideW) * 100,
    h: (h / slideH) * 100,
    paragraphs,
    bgColor,
    borderColor,
  };
}

function parseParagraphs(txBody: string): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];

  // Split by <a:p> ... </a:p>
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(txBody)) !== null) {
    const pContent = pMatch[1];
    const paragraph = parseParagraph(pContent);
    paragraphs.push(paragraph);
  }

  return paragraphs;
}

function parseParagraph(pContent: string): PptxParagraph {
  // Paragraph properties <a:pPr>
  const pPrMatch = pContent.match(/<a:pPr([^>]*?)(?:\/>|>([\s\S]*?)<\/a:pPr>)/);
  let align: string | undefined;
  let bulletChar: string | undefined;
  let bulletNum = false;
  let level = 0;

  if (pPrMatch) {
    const attrs = pPrMatch[1] || '';
    const inner = pPrMatch[2] || '';

    const algMatch = attrs.match(/algn="(\w+)"/);
    if (algMatch) align = algMatch[1];

    const lvlMatch = attrs.match(/lvl="(\d+)"/);
    if (lvlMatch) level = parseInt(lvlMatch[1]);

    // Bullet: <a:buChar char="●"/>
    const buCharMatch = inner.match(/<a:buChar[^>]*char="([^"]+)"/);
    if (buCharMatch) bulletChar = buCharMatch[1];

    // Auto-numbered: <a:buAutoNum/>
    if (/<a:buAutoNum/.test(inner)) bulletNum = true;

    // Default bullet (no buNone means bullets may be inherited)
  }

  // Parse runs <a:r>
  const runs: PptxRun[] = [];
  const rRegex = /<a:r>([\s\S]*?)<\/a:r>/g;
  let rMatch;
  while ((rMatch = rRegex.exec(pContent)) !== null) {
    const rContent = rMatch[1];
    const run = parseRun(rContent);
    if (run) runs.push(run);
  }

  // Also handle <a:fld> (field, like slide number) or <a:br> (line break)
  // <a:fld> contains text runs too
  const fldRegex = /<a:fld[^>]*>([\s\S]*?)<\/a:fld>/g;
  let fldMatch;
  while ((fldMatch = fldRegex.exec(pContent)) !== null) {
    const fldContent = fldMatch[1];
    const textMatch = fldContent.match(/<a:t>([\s\S]*?)<\/a:t>/);
    if (textMatch && textMatch[1].trim()) {
      runs.push({ text: textMatch[1] });
    }
  }

  return { runs, align, bulletChar, bulletNum, level };
}

function parseRun(rContent: string): PptxRun | null {
  const textMatch = rContent.match(/<a:t>([\s\S]*?)<\/a:t>/);
  if (!textMatch) return null;

  const text = textMatch[1];
  const run: PptxRun = { text };

  // Run properties <a:rPr>
  const rPrMatch = rContent.match(/<a:rPr([^>]*?)(?:\/>|>([\s\S]*?)<\/a:rPr>)/);
  if (rPrMatch) {
    const attrs = rPrMatch[1] || '';
    const inner = rPrMatch[2] || '';

    if (/\bb="1"/.test(attrs)) run.bold = true;
    if (/\bi="1"/.test(attrs)) run.italic = true;
    if (/\bu="sng"/.test(attrs)) run.underline = true;

    const szMatch = attrs.match(/\bsz="(\d+)"/);
    if (szMatch) run.fontSize = parseInt(szMatch[1]) / 100; // hundredths of pt → pt

    // Color: <a:solidFill><a:srgbClr val="RRGGBB"/></a:solidFill>
    const colorMatch = inner.match(/<a:srgbClr val="([A-Fa-f0-9]{6})"/);
    if (colorMatch) run.color = colorMatch[1];

    // Font: <a:latin typeface="Arial"/>
    const fontMatch = inner.match(/<a:latin[^>]*typeface="([^"]+)"/);
    if (fontMatch) run.fontFamily = fontMatch[1];
  }

  return run;
}

function extractBgColor(xml: string): string | undefined {
  // <p:bg><p:bgPr><a:solidFill><a:srgbClr val="RRGGBB"/>
  const bgMatch = xml.match(/<p:bg\b[\s\S]*?<a:srgbClr val="([A-Fa-f0-9]{6})"/);
  return bgMatch ? `#${bgMatch[1]}` : undefined;
}

/** Convert pt to vw relative to slide width, so fonts scale with the canvas */
function ptToVw(pt: number, slideWidthPt: number): string {
  return `${((pt / slideWidthPt) * 100).toFixed(2)}vw`;
}

function renderSlideHtml(slide: SlideData, num: number, total: number): string {
  const bg = slide.bgColor || '#FFFFFF';

  let shapesHtml = '';
  for (const shape of slide.shapes) {
    shapesHtml += renderShapeHtml(shape, slide.slideWidthPt);
  }

  return `<div class="slide-wrapper">
    <div class="slide-number">${num} / ${total}</div>
    <div class="slide" style="background:${bg};">
      ${shapesHtml}
    </div>
  </div>`;
}

function renderShapeHtml(shape: PptxShape, slideWidthPt: number): string {
  let style = `left:${shape.x}%;top:${shape.y}%;width:${shape.w}%;height:${shape.h}%;`;
  if (shape.bgColor) style += `background:${shape.bgColor};`;
  if (shape.borderColor) style += `border:1px solid ${shape.borderColor};`;

  let inner = '';
  let bulletIndex = 1;
  for (const para of shape.paragraphs) {
    if (para.runs.length === 0) {
      inner += '<div class="sp">&nbsp;</div>';
      continue;
    }

    let textAlign = 'left';
    if (para.align === 'ctr') textAlign = 'center';
    else if (para.align === 'r') textAlign = 'right';
    else if (para.align === 'just') textAlign = 'justify';

    // Scale indent proportionally: 20pt per level → vw
    const indentVw = ptToVw(para.level * 20, slideWidthPt);
    let prefix = '';
    if (para.bulletChar) {
      prefix = `<span class="bullet">${escapeHtml(para.bulletChar)}</span> `;
    } else if (para.bulletNum) {
      prefix = `<span class="bullet">${bulletIndex}.</span> `;
      bulletIndex++;
    }

    let runsHtml = '';
    for (const run of para.runs) {
      let rs = '';
      if (run.fontSize) rs += `font-size:${ptToVw(run.fontSize, slideWidthPt)};`;
      if (run.color) rs += `color:#${run.color};`;
      if (run.fontFamily) rs += `font-family:'${run.fontFamily}',sans-serif;`;
      if (run.bold) rs += 'font-weight:700;';
      if (run.italic) rs += 'font-style:italic;';
      if (run.underline) rs += 'text-decoration:underline;';

      runsHtml += rs
        ? `<span style="${rs}">${escapeHtml(run.text)}</span>`
        : escapeHtml(run.text);
    }

    inner += `<div class="sp" style="text-align:${textAlign};padding-left:${indentVw};">${prefix}${runsHtml}</div>`;
  }

  return `<div class="shape" style="${style}">${inner}</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
