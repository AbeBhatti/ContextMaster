import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { api } from "../../lib/api";
import type { DocumentRecord, KnowledgeBase } from "../../lib/types";
import { ALLOWED_DOC_TYPES, MAX_DOC_SIZE_MB } from "../../lib/constants";

interface DocumentUploadProps {
  workspaceId: string;
  knowledgeBases: KnowledgeBase[];
  defaultKbId?: string;
  onUploaded: (doc: DocumentRecord) => void;
}

export function DocumentUpload({
  workspaceId,
  knowledgeBases,
  defaultKbId,
  onUploaded,
}: DocumentUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKb, setSelectedKb] = useState<string>(
    defaultKbId ?? knowledgeBases[0]?.id ?? ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validate = (file: File): string | null => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_DOC_TYPES.includes(ext)) {
      return `Unsupported file type. Allowed: ${ALLOWED_DOC_TYPES.join(", ")}`;
    }
    if (file.size > MAX_DOC_SIZE_MB * 1024 * 1024) {
      return `File too large. Max ${MAX_DOC_SIZE_MB} MB.`;
    }
    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const validation = validate(file);
    if (validation) {
      setError(validation);
      return;
    }
    if (!selectedKb) {
      setError("Pick a knowledge base first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const doc = await api.documents.upload(workspaceId, file, selectedKb);
      onUploaded(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const showKbPicker = !defaultKbId && knowledgeBases.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {showKbPicker && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
          <span>Upload to:</span>
          <select
            value={selectedKb}
            onChange={(e) => setSelectedKb(e.target.value)}
            className="flex-1 rounded-md border bg-cream-50 px-2 py-1 text-[12.5px] text-ink-800 outline-none"
            style={{ borderColor: "rgba(24,24,27,0.18)" }}
          >
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`cursor-pointer rounded-[10px] border-[1.5px] border-dashed p-6 text-center transition-colors ${
          dragOver ? "bg-cream-200" : "bg-cream-100 hover:bg-cream-200"
        }`}
        style={{
          borderColor: dragOver
            ? "rgba(24,24,27,0.4)"
            : "rgba(24,24,27,0.20)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_DOC_TYPES.map((e) => `.${e}`).join(",")}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-[13px] text-ink-700">
            <Loader2 size={14} className="animate-spin" />
            Uploading & processing…
          </div>
        ) : (
          <>
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-cream-300 text-ink-500">
              <Upload size={16} />
            </div>
            <div className="text-[13px] font-semibold text-ink-800">
              Drop a file, or click to choose
            </div>
            <div className="mt-1 text-[12px] text-ink-500">
              {ALLOWED_DOC_TYPES.join(", ").toUpperCase()} — up to{" "}
              {MAX_DOC_SIZE_MB} MB
            </div>
          </>
        )}
      </div>
      {error && (
        <div className="text-[12px] text-danger">{error}</div>
      )}
    </div>
  );
}
