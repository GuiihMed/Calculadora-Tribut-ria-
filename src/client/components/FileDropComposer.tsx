import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  FileSpreadsheet,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

export const MAX_UPLOAD_BYTES = 5_242_880; // 5 MiB
export const MAX_FILES_PER_BATCH = 5;
export const ACCEPTED_EXTENSIONS = [
  '.xlsx',
  '.csv',
  '.xml',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const;

export const ACCEPTED_FILE_INPUT = ACCEPTED_EXTENSIONS.join(',');

export const DEFAULT_QUICK_PROMPTS = [
  'Simular NF-e Regime Regular',
  'Comparar Simples vs Regular (2027)',
  'Validar NCM x cClassTrib',
  'Calcular Fator R',
] as const;

export interface StagedAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  status: 'staged' | 'uploading' | 'uploaded' | 'error';
  draftId?: string;
  error?: string;
}

export interface FileValidationResult {
  validFiles: File[];
  errors: string[];
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getLowerExtension(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx <= 0) {
    return '';
  }
  return filename.slice(dotIdx).toLowerCase();
}

export function validateSelectedFiles(
  incomingFiles: File[],
  existingCount = 0,
): FileValidationResult {
  const errors: string[] = [];
  const validFiles: File[] = [];

  if (existingCount + incomingFiles.length > MAX_FILES_PER_BATCH) {
    errors.push(
      `Limite máximo de ${MAX_FILES_PER_BATCH} arquivos por lote excedido (selecionados: ${incomingFiles.length}, já anexados: ${existingCount}).`,
    );
    return { validFiles: [], errors };
  }

  for (const file of incomingFiles) {
    const ext = getLowerExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
      errors.push(
        `Arquivo "${file.name}" possui extensão não suportada. Formatos aceitos: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      );
      continue;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      errors.push(
        `Arquivo "${file.name}" (${formatFileSize(file.size)}) excede o limite máximo de 5 MiB (5.242.880 bytes).`,
      );
      continue;
    }

    validFiles.push(file);
  }

  return { validFiles, errors };
}

export interface FileDropComposerProps {
  attachments?: StagedAttachment[];
  isUploading?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  quickPrompts?: readonly string[];
  onFilesSelected?: (files: File[]) => void | Promise<void>;
  onRemoveAttachment?: (id: string) => void;
  onSend: (message: string) => void | Promise<void>;
}

export function FileDropComposer({
  attachments: controlledAttachments,
  isUploading = false,
  isStreaming = false,
  disabled = false,
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  onFilesSelected,
  onRemoveAttachment,
  onSend,
}: FileDropComposerProps) {
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [internalAttachments, setInternalAttachments] = useState<StagedAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();
  const dragDepthRef = useRef(0);

  const isControlled = controlledAttachments !== undefined;
  const activeAttachments = isControlled ? controlledAttachments : internalAttachments;
  const isBusy = disabled || isStreaming || isUploading;

  const processIncomingFiles = (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const incoming = Array.from(fileList);
    const { validFiles, errors } = validateSelectedFiles(incoming, activeAttachments.length);
    setValidationErrors(errors);

    if (validFiles.length === 0) {
      return;
    }

    if (!isControlled) {
      const nextStaged: StagedAttachment[] = validFiles.map((file, idx) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${idx}`,
        name: file.name,
        sizeBytes: file.size,
        status: 'staged',
      }));
      setInternalAttachments((prev) => [...prev, ...nextStaged]);
    }

    void onFilesSelected?.(validFiles);
  };

  const handleRemove = (id: string) => {
    setValidationErrors([]);
    if (isControlled) {
      onRemoveAttachment?.(id);
    } else {
      setInternalAttachments((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handleSubmit = (overrideMessage?: string) => {
    if (isBusy) {
      return;
    }

    const raw = overrideMessage !== undefined ? overrideMessage : text;
    const trimmed = raw.trim();
    const messageToSend =
      trimmed || (activeAttachments.length > 0 ? 'Analisar os documentos anexados.' : '');

    if (!messageToSend) {
      return;
    }

    if (overrideMessage === undefined) {
      setText('');
      if (!isControlled) {
        setInternalAttachments([]);
      }
    }
    setValidationErrors([]);
    void onSend(messageToSend);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    processIncomingFiles(e.dataTransfer?.files ?? null);
  };

  const canSend = !isBusy && (text.trim().length > 0 || activeAttachments.length > 0);

  return (
    <div
      data-testid="file-drop-zone"
      className={`composer ${isDragging ? 'composer--dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {validationErrors.length > 0 && (
        <div className="banner banner--danger composer__alert" role="alert">
          <span className="composer__alert-content">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{validationErrors.join(' ')}</span>
          </span>
        </div>
      )}

      {quickPrompts.length > 0 && (
        <div className="composer__quick-prompts" aria-label="Cenários rápidos de simulação">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="chip-btn"
              disabled={isBusy}
              onClick={() => handleSubmit(prompt)}
            >
              <Sparkles size={12} aria-hidden="true" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      )}

      {activeAttachments.length > 0 && (
        <ul className="composer__attachments" aria-label="Documentos anexados">
          {activeAttachments.map((item) => (
            <li
              key={item.id}
              className={`attachment-chip ${item.status === 'error' ? 'attachment-chip--error' : ''}`}
            >
              <FileSpreadsheet size={13} aria-hidden="true" />
              <span className="attachment-chip__name">{item.name}</span>
              <span className="attachment-chip__size tabular-nums">
                {formatFileSize(item.sizeBytes)}
              </span>
              {item.status === 'uploading' && (
                <span className="badge badge--info">Enviando...</span>
              )}
              {item.status === 'uploaded' && (
                <span className="badge badge--success">Prévia pronta</span>
              )}
              <button
                type="button"
                className="attachment-chip__remove"
                aria-label={`Remover ${item.name}`}
                disabled={isUploading}
                onClick={() => handleRemove(item.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="composer__input-box">
        <label htmlFor={textareaId} className="sr-only">
          Descreva a operação fiscal ou envie sua dúvida ao Copiloto Gemini
        </label>
        <textarea
          id={textareaId}
          rows={2}
          className="composer__textarea"
          placeholder="Descreva a operação (NCM, CST, cClassTrib, UF, data) ou arraste XML, XLSX, CSV, PDF ou imagem..."
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="composer__toolbar">
          <div className="composer__toolbar-left">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_INPUT}
              className="composer__file-input"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                processIncomingFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={isUploading || disabled || activeAttachments.length >= MAX_FILES_PER_BATCH}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} aria-hidden="true" />
              <span>Anexar documento / planilha</span>
            </button>

            <span
              className="badge badge--success composer__privacy-badge"
              title="Chamadas ao Gemini usam store: false e mascaramento local de CPF/CNPJ/chaves"
            >
              <ShieldCheck size={12} aria-hidden="true" />
              <span>store: false • PII Mascarado</span>
            </span>
          </div>

          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!canSend}
            onClick={() => handleSubmit()}
          >
            <Send size={14} aria-hidden="true" />
            <span>{isStreaming ? 'Processando...' : 'Enviar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
