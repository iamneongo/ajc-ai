"use client";

import { ArrowUp, ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { type ClipboardEvent, type RefObject } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ChatComposerProps = {
  prompt: string;
  model: string;
  isSending: boolean;
  attachments: Array<{ name: string; dataUrl: string }>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onPickAttachment: () => void;
  onAttachmentChange: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (index: number) => void;
};

const chatModelOptions = [
  { value: "auto", label: "Tự động" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5-3-mini", label: "GPT-5.3 Mini" },
];

export function ChatComposer({
  prompt,
  model,
  isSending,
  attachments,
  textareaRef,
  fileInputRef,
  onPromptChange,
  onModelChange,
  onSubmit,
  onPickAttachment,
  onAttachmentChange,
  onRemoveAttachment,
}: ChatComposerProps) {
  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void onAttachmentChange(imageFiles);
  };

  return (
    <div className="shrink-0 flex justify-center px-1 sm:px-0">
      <div style={{ width: "min(980px, 100%)" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void onAttachmentChange(Array.from(event.target.files || []));
          }}
        />

        {attachments.length > 0 ? (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1 sm:mb-3 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {attachments.map((image, index) => (
              <div
                key={`${image.name}-${index}`}
                className="relative size-14 shrink-0 sm:size-16"
              >
                <div className="size-14 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 sm:size-16">
                  <img
                    src={image.dataUrl}
                    alt={image.name || `Ảnh đính kèm ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-stone-300 hover:text-stone-800"
                  aria-label={`Xóa ảnh đính kèm ${image.name || index + 1}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_14px_60px_-42px_rgba(15,23,42,0.45)] sm:rounded-[32px] sm:shadow-none">
          <div
            className="relative cursor-text"
            onClick={() => {
              textareaRef.current?.focus();
            }}
          >
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onPaste={handleTextareaPaste}
              placeholder={
                attachments.length > 0
                  ? "Hỏi về ảnh, hoặc mô tả cách bạn muốn chỉnh sửa / biến đổi nó"
                  : "Hỏi bất cứ điều gì, hoặc yêu cầu tạo ảnh. Nhấn Enter để gửi"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              className="min-h-[82px] resize-none rounded-[24px] border-0 bg-transparent px-4 pt-4 pb-2 text-[15px] leading-6 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0 sm:min-h-[148px] sm:rounded-[32px] sm:px-6 sm:pt-6 sm:pb-20 sm:leading-7"
            />

            <div
              className="rounded-b-[24px] border-t border-stone-100 bg-white px-3 pb-3 pt-2 sm:absolute sm:inset-x-0 sm:bottom-0 sm:rounded-b-none sm:border-t-0 sm:bg-gradient-to-t sm:from-white sm:via-white/95 sm:to-transparent sm:px-6 sm:pb-4 sm:pt-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-end justify-between gap-2 sm:gap-3">
                <div className="hide-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:pb-0">
                  <button
                    type="button"
                    onClick={onPickAttachment}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 shadow-none transition hover:border-stone-300 hover:bg-stone-50 sm:h-10 sm:text-sm"
                  >
                    <ImagePlus className="size-3.5 sm:size-4" />
                    {attachments.length > 0 ? "Thêm ảnh" : "Đính kèm ảnh"}
                  </button>

                  <div className="w-[160px] shrink-0 sm:w-[190px]">
                    <Select value={model} onValueChange={onModelChange}>
                      <SelectTrigger className="h-9 rounded-full border-stone-200 bg-white px-3 text-xs text-stone-700 shadow-none sm:h-10 sm:text-sm">
                        <SelectValue placeholder="Chọn mô hình" />
                      </SelectTrigger>
                      <SelectContent>
                        {chatModelOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 rounded-full bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
                    <Sparkles className="size-3.5" />
                    Tự động chat, tạo ảnh hoặc chỉnh ảnh trong cùng hội thoại
                  </div>

                  {isSending ? (
                    <div className="flex shrink-0 items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      Đang trả lời
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void onSubmit()}
                  disabled={!prompt.trim() || isSending}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 sm:size-11"
                  aria-label="Gửi tin nhắn"
                >
                  <ArrowUp className="size-3.5 sm:size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
