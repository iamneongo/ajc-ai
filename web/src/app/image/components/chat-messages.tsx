"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  ImageIcon,
  LoaderCircle,
  MessageSquareText,
  TriangleAlert,
  User2,
} from "lucide-react";

import { ImageLightbox } from "@/components/image-lightbox";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/store/chat-conversations";

type ChatMessagesProps = {
  selectedConversation: ChatConversation | null;
  formatConversationTime: (value: string) => string;
};

export function ChatMessages({
  selectedConversation,
  formatConversationTime,
}: ChatMessagesProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxImages, setLightboxImages] = useState<
    Array<{ id: string; src: string }>
  >([]);
  const currentLightboxItems = useMemo(() => lightboxImages, [lightboxImages]);

  const imageSource = (image: { dataUrl: string; url?: string }) =>
    image.url || image.dataUrl;

  const openLightbox = (
    images: Array<{ id: string; src: string }>,
    index: number,
  ) => {
    if (images.length === 0) {
      return;
    }
    setLightboxImages(images);
    setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
    setLightboxOpen(true);
  };

  if (!selectedConversation || selectedConversation.messages.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center px-4 py-10">
        <div className="max-w-xl rounded-[28px] border border-dashed border-stone-200 bg-white/70 px-6 py-8 text-center shadow-[0_14px_50px_-42px_rgba(15,23,42,0.35)]">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-stone-950 text-white">
            <MessageSquareText className="size-5" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-stone-950">
            Bắt đầu một cuộc trò chuyện mới
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Bạn có thể hỏi đáp bình thường ngay trong panel này. Phần chat dùng
            chung pool tài khoản với khu tạo ảnh, nhưng lịch sử được lưu riêng
            để dễ theo dõi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-1 pb-4 pt-1 sm:px-3">
      <ImageLightbox
        images={currentLightboxItems}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {selectedConversation.messages.map((message) => {
        const isUser = message.role === "user";
        const isPending = message.status === "pending";
        const isError = message.status === "error";
        const attachmentLightboxImages =
          message.attachments?.map((item) => ({
            id: item.id,
            src: item.dataUrl,
          })) || [];
        const generatedImages =
          message.images?.map((item) => ({
            id: item.id,
            src: imageSource(item),
          })) ||
          [];
        return (
          <div
            key={message.id}
            className={cn(
              "flex w-full",
              isUser ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "flex max-w-[92%] gap-3 sm:max-w-[82%]",
                isUser ? "flex-row-reverse" : "flex-row",
              )}
            >
              <div
                className={cn(
                  "mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl",
                  isUser
                    ? "bg-stone-950 text-white"
                    : "bg-stone-100 text-stone-600",
                )}
              >
                {isUser ? (
                  <User2 className="size-4" />
                ) : (
                  <Bot className="size-4" />
                )}
              </div>

              <div
                className={cn(
                  "rounded-[26px] px-4 py-3 shadow-[0_14px_50px_-42px_rgba(15,23,42,0.45)]",
                  isUser
                    ? "bg-stone-950 text-white"
                    : isError
                      ? "border border-rose-200 bg-rose-50 text-rose-900"
                      : "bg-white text-stone-900",
                )}
              >
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] opacity-70">
                  <span>{isUser ? "Bạn" : "Trợ lý"}</span>
                  <span>·</span>
                  <span>{formatConversationTime(message.createdAt)}</span>
                </div>

                {isPending ? (
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    <LoaderCircle className="size-4 animate-spin" />
                    Đang trả lời...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {message.content ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-7 sm:text-[15px]">
                        {message.content}
                      </p>
                    ) : null}

                    {message.attachments && message.attachments.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {message.attachments.map((image, index) => (
                          <button
                            key={image.id}
                            type="button"
                            onClick={() =>
                              openLightbox(attachmentLightboxImages, index)
                            }
                            className="group overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 text-left transition hover:border-stone-300"
                          >
                            <img
                              src={image.dataUrl}
                              alt={image.name || `Ảnh đính kèm ${index + 1}`}
                              className="h-28 w-full object-cover"
                            />
                            <div className="truncate px-3 py-2 text-xs text-stone-500">
                              {image.name || `Ảnh đính kèm ${index + 1}`}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.images && message.images.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-400">
                          <ImageIcon className="size-3.5" />
                          Kết quả hình ảnh
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {message.images.map((image, index) => (
                            <button
                              key={image.id}
                              type="button"
                              onClick={() =>
                                openLightbox(generatedImages, index)
                              }
                              className="group overflow-hidden rounded-3xl border border-stone-200 bg-stone-50 text-left transition hover:border-stone-300"
                            >
                              <img
                                src={imageSource(image)}
                                alt={`Ảnh tạo ra ${index + 1}`}
                                className="w-full object-cover"
                              />
                              {image.revised_prompt ? (
                                <div className="line-clamp-2 px-3 py-2 text-xs leading-5 text-stone-500">
                                  {image.revised_prompt}
                                </div>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {!message.content &&
                    (!message.attachments ||
                      message.attachments.length === 0) &&
                    (!message.images || message.images.length === 0) &&
                    isError ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-7 sm:text-[15px]">
                        Không nhận được phản hồi từ hệ thống.
                      </p>
                    ) : null}
                    {isError && message.error ? (
                      <div className="flex items-start gap-2 rounded-2xl bg-white/80 px-3 py-2 text-xs leading-5 text-rose-700">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span>{message.error}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
