export const MAX_UPLOAD_BYTES = 5_242_880; // 5 MiB

export type SupportedExtension = 'xml' | 'xlsx' | 'csv' | 'pdf' | 'png' | 'jpg' | 'webp';

export interface ValidatedFile {
  buffer: Buffer;
  sanitizedFilename: string;
  extension: SupportedExtension;
  detectedMime: string;
  sizeBytes: number;
}

export class FileTooLargeError extends Error {
  public readonly statusCode = 413;

  constructor(message = 'Arquivo excede o limite máximo permitido de 5 MiB.') {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

export class UnsupportedFileTypeError extends Error {
  public readonly statusCode = 415;

  constructor(message = 'Tipo de arquivo não suportado. Formatos aceitos: xml, xlsx, csv, pdf, png, jpg, webp.') {
    super(message);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class MagicBytesMismatchError extends Error {
  public readonly statusCode = 400;

  constructor(message = 'Assinatura binária (magic bytes) ou conteúdo incompatível com a extensão declarada.') {
    super(message);
    this.name = 'MagicBytesMismatchError';
  }
}

export class XxeRejectedError extends Error {
  public readonly statusCode = 400;

  constructor(message = 'XML rejeitado pela proteção anti-XXE: declarações <!DOCTYPE> ou <!ENTITY> não são permitidas.') {
    super(message);
    this.name = 'XxeRejectedError';
  }
}

export const XXE_DTD_OR_ENTITY_RE = /<!\s*(DOCTYPE|ENTITY)\b/i;

const MIME_BY_EXTENSION: Record<SupportedExtension, string> = {
  xml: 'application/xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const MZ_SIGNATURE = Buffer.from([0x4d, 0x5a]);

function startsWithBytes(buffer: Buffer, signature: Buffer, offset = 0): boolean {
  if (buffer.byteLength < offset + signature.byteLength) {
    return false;
  }
  return buffer.subarray(offset, offset + signature.byteLength).equals(signature);
}

function isWebp(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) {
    return false;
  }
  return (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function hasKnownBinaryMagic(buffer: Buffer): boolean {
  return (
    startsWithBytes(buffer, MZ_SIGNATURE) ||
    startsWithBytes(buffer, ZIP_SIGNATURE) ||
    startsWithBytes(buffer, PNG_SIGNATURE) ||
    startsWithBytes(buffer, JPEG_SIGNATURE) ||
    startsWithBytes(buffer, PDF_SIGNATURE) ||
    isWebp(buffer)
  );
}

function decodeStrictUtf8(buffer: Buffer): string {
  if (buffer.includes(0x00)) {
    throw new MagicBytesMismatchError('Arquivo texto contém bytes nulos inválidos.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new MagicBytesMismatchError('Arquivo texto não possui codificação UTF-8 válida.');
  }
}

export function sanitizeUploadFilename(filename: string): string {
  const withoutControls = filename.replace(/[\x00-\x1f\x7f]/g, '');
  const segments = withoutControls.split(/[/\\]+/).filter((part) => part.length > 0 && part !== '.' && part !== '..');
  const base = (segments[segments.length - 1] ?? 'upload').trim();
  return base.length > 0 ? base : 'upload';
}

function resolveExtension(sanitizedFilename: string): SupportedExtension {
  const dotIdx = sanitizedFilename.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === sanitizedFilename.length - 1) {
    throw new UnsupportedFileTypeError();
  }
  const rawExt = sanitizedFilename.slice(dotIdx + 1).toLowerCase();
  if (rawExt === 'jpeg') {
    return 'jpg';
  }
  if (
    rawExt === 'xml' ||
    rawExt === 'xlsx' ||
    rawExt === 'csv' ||
    rawExt === 'pdf' ||
    rawExt === 'png' ||
    rawExt === 'jpg' ||
    rawExt === 'webp'
  ) {
    return rawExt;
  }
  throw new UnsupportedFileTypeError();
}

export function validateUploadedFile(
  buffer: Buffer,
  filename: string,
  _declaredMime = '',
): ValidatedFile {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new FileTooLargeError();
  }
  if (buffer.byteLength === 0) {
    throw new MagicBytesMismatchError('Arquivo vazio não é permitido.');
  }

  const sanitizedFilename = sanitizeUploadFilename(filename);
  const extension = resolveExtension(sanitizedFilename);

  switch (extension) {
    case 'xlsx': {
      if (!startsWithBytes(buffer, ZIP_SIGNATURE)) {
        throw new MagicBytesMismatchError('Arquivo .xlsx inválido: assinatura ZIP (PK\\x03\\x04) ausente.');
      }
      break;
    }
    case 'pdf': {
      if (!startsWithBytes(buffer, PDF_SIGNATURE)) {
        throw new MagicBytesMismatchError('Arquivo .pdf inválido: cabeçalho %PDF- ausente.');
      }
      break;
    }
    case 'png': {
      if (!startsWithBytes(buffer, PNG_SIGNATURE)) {
        throw new MagicBytesMismatchError('Arquivo .png inválido: assinatura PNG ausente.');
      }
      break;
    }
    case 'jpg': {
      if (!startsWithBytes(buffer, JPEG_SIGNATURE)) {
        throw new MagicBytesMismatchError('Arquivo .jpg/.jpeg inválido: assinatura JPEG ausente.');
      }
      break;
    }
    case 'webp': {
      if (!isWebp(buffer)) {
        throw new MagicBytesMismatchError('Arquivo .webp inválido: assinatura RIFF/WEBP ausente.');
      }
      break;
    }
    case 'xml': {
      if (hasKnownBinaryMagic(buffer)) {
        throw new MagicBytesMismatchError('Arquivo .xml contém assinatura binária inválida.');
      }
      const text = decodeStrictUtf8(buffer);
      const stripped = text.replace(/^\uFEFF/, '').trimStart();
      if (!stripped.startsWith('<')) {
        throw new MagicBytesMismatchError('Arquivo .xml deve iniciar com marcação XML (<).');
      }
      if (XXE_DTD_OR_ENTITY_RE.test(stripped)) {
        throw new XxeRejectedError();
      }
      break;
    }
    case 'csv': {
      if (hasKnownBinaryMagic(buffer)) {
        throw new MagicBytesMismatchError('Arquivo .csv contém assinatura binária inválida.');
      }
      const text = decodeStrictUtf8(buffer);
      if (text.trim().length === 0) {
        throw new MagicBytesMismatchError('Arquivo .csv vazio.');
      }
      break;
    }
  }

  return {
    buffer,
    sanitizedFilename,
    extension,
    detectedMime: MIME_BY_EXTENSION[extension],
    sizeBytes: buffer.byteLength,
  };
}
