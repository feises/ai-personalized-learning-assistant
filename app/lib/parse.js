'use strict';
// 文本提取：TXT / MD / PDF（文本型）/ DOCX。全部零依赖实现。
// 说明：扫描版 PDF 不引入 OCR，提取为空时给出明确状态，由界面提示学生换可复制文本的版本。
const fs = require('fs');
const zlib = require('zlib');

function fromTxt(buf) { return buf.toString('utf8'); }

/* ------------------------------- PDF ------------------------------- */
function inflateMaybe(buf) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { const out = fn(buf); if (out && out.length) return out; } catch (e) { /* 继续尝试 */ }
  }
  return null;
}

function decodePdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += ' ';
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

function textFromContentStream(content) {
  const src = content.toString('latin1');
  const parts = [];
  // 逐个操作符扫描：Tj / TJ 取文本，Td/TD/T* 换行
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[[^\]]*\]|T\*|Td|TD|Tj|TJ|ET/g;
  let m;
  let line = '';
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    if (tok === 'T*' || tok === 'Td' || tok === 'TD' || tok === 'ET') {
      if (line.trim()) { parts.push(line.trim()); line = ''; }
      continue;
    }
    if (tok === 'Tj' || tok === 'TJ') continue;
    if (tok.startsWith('[')) {
      const inner = tok.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g) || [];
      for (const piece of inner) line += piece.startsWith('(') ? decodePdfString(piece.slice(1, -1)) : hexToString(piece);
    } else if (tok.startsWith('(')) {
      line += decodePdfString(tok.slice(1, -1));
    } else if (tok.startsWith('<')) {
      line += hexToString(tok);
    }
  }
  if (line.trim()) parts.push(line.trim());
  return parts.join('\n');
}
function hexToString(h) {
  const hex = h.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (code >= 32 && code < 127) out += String.fromCharCode(code);
    else if (code === 10 || code === 13) out += '\n';
  }
  if (out.length >= 4 && !/[a-zA-Z]/.test(out)) return ''; // 大概率是 CID 编码的乱码，丢弃
  return out;
}

function fromPdf(buf) {
  const chunks = [];
  const marker = Buffer.from('stream');
  let idx = 0;
  while (idx < buf.length) {
    const s = buf.indexOf(marker, idx);
    if (s < 0) break;
    let start = s + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf(Buffer.from('endstream'), start);
    if (e < 0) break;
    let end = e;
    if (buf[end - 1] === 0x0a) end--;
    if (buf[end - 1] === 0x0d) end--;
    const raw = buf.slice(start, end);
    const inflated = inflateMaybe(raw);
    const target = inflated || raw;
    const text = textFromContentStream(target);
    if (text && text.replace(/\s/g, '').length > 20) chunks.push(text);
    idx = e + 9;
  }
  const text = chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const hasImage = /\/Subtype\s*\/Image/.test(buf.toString('latin1'));
  return { text, scanned: text.replace(/\s/g, '').length < 120 && hasImage };
}

/* ------------------------------ DOCX ------------------------------ */
function unzipEntry(buf, wantSuffix) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的压缩包（未找到目录）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name.endsWith(wantSuffix)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('压缩包内缺少 ' + wantSuffix);
}

function xmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fromDocx(buf) { return { text: xmlToText(unzipEntry(buf, 'word/document.xml').toString('utf8')), scanned: false }; }

/* ------------------------------ 入口 ------------------------------ */
const SUPPORTED = ['pdf', 'txt', 'md', 'docx'];
const MAX_BYTES = 200 * 1024 * 1024;

function extract(filePath, ext) {
  const e = String(ext || '').toLowerCase().replace('.', '');
  if (!SUPPORTED.includes(e)) return { ok: false, reason: '格式不支持', detail: '当前支持 PDF / TXT / DOCX / MD。' };
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) return { ok: false, reason: '文件过大', detail: '单个文件请控制在 200MB 以内。' };
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (err) { return { ok: false, reason: '文件读取失败', detail: err.message }; }
  try {
    let r;
    if (e === 'pdf') r = fromPdf(buf);
    else if (e === 'docx') r = fromDocx(buf);
    else r = { text: fromTxt(buf), scanned: false };
    const text = (r.text || '').replace(/\u0000/g, '').trim();
    if (!text) {
      return {
        ok: false,
        reason: r.scanned ? '这份 PDF 是扫描件，无法提取文字' : '没有提取到文字内容',
        detail: r.scanned ? '请改为上传可复制文字的版本。' : '请确认文件内容不是空白页或纯图片。'
      };
    }
    const bad = (text.match(/[\uFFFD]/g) || []).length / Math.max(1, text.length);
    if (bad > 0.05) return { ok: false, reason: '文字提取质量较差', detail: '文件可能是加密或特殊编码的 PDF，请换一份试试。' };
    return { ok: true, text, charCount: text.length, scanned: !!r.scanned, bytes: stat.size };
  } catch (err) {
    return { ok: false, reason: e === 'docx' ? 'DOCX 解析失败' : 'PDF 解析失败', detail: String(err.message || err) };
  }
}

module.exports = { extract, SUPPORTED, MAX_BYTES };
