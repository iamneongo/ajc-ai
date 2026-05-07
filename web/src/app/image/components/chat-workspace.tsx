"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChatComposer } from "@/app/image/components/chat-composer";
import { ChatMessages } from "@/app/image/components/chat-messages";
import { ChatSidebar } from "@/app/image/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createWorkspaceResponse,
  type WorkspaceRequestMessage,
} from "@/lib/api";
import {
  clearChatConversations,
  deleteChatConversation,
  listChatConversations,
  saveChatConversation,
  saveChatConversations,
  type ChatAttachment,
  type ChatConversation,
  type ChatImage,
  type ChatMessage,
} from "@/store/chat-conversations";

const ACTIVE_CHAT_CONVERSATION_STORAGE_KEY =
  "chatgpt2api:chat_active_conversation_id";
const CHAT_MODEL_STORAGE_KEY = "chatgpt2api:chat_last_model";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 20) {
    return trimmed || "Cuộc trò chuyện mới";
  }
  return `${trimmed.slice(0, 20)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("vi-VN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pickFallbackConversationId(conversations: ChatConversation[]) {
  return conversations[0]?.id ?? null;
}

function sortChatConversations(conversations: ChatConversation[]) {
  return [...conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Đọc ảnh đính kèm thất bại"));
    reader.readAsDataURL(file);
  });
}

function attachmentFromFile(
  file: File,
  dataUrl: string,
  index: number,
): ChatAttachment {
  return {
    id: `${createId()}-${index}`,
    name: file.name || `attachment-${index + 1}.png`,
    type: file.type || "image/png",
    dataUrl,
  };
}

function imageFromResponse(
  item: { b64_json?: string; url?: string; revised_prompt?: string },
  index: number,
): ChatImage | null {
  const b64 = String(item.b64_json || "").trim();
  const url = String(item.url || "").trim();
  const src = b64 ? `data:image/png;base64,${b64}` : url;
  if (!src) {
    return null;
  }
  return {
    id: `generated-${createId()}-${index}`,
    dataUrl: src,
    url: url || undefined,
    revised_prompt: String(item.revised_prompt || "").trim() || undefined,
  };
}

function responseImagesToMessageImages(
  items: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>,
) {
  return items
    .map((item, index) => imageFromResponse(item, index))
    .filter((image): image is ChatImage => Boolean(image));
}

function recoverInterruptedChats(conversations: ChatConversation[]) {
  let changed = false;
  const nextItems = conversations.map((conversation) => {
    const messages = conversation.messages.map((message) => {
      if (message.status !== "pending") {
        return message;
      }
      changed = true;
      return {
        ...message,
        status: "error" as const,
        content:
          message.content || "Phản hồi đã bị gián đoạn do trang được tải lại.",
        error:
          "Phản hồi trước đó chưa hoàn tất. Bạn có thể gửi lại tin nhắn này.",
      };
    });
    if (
      !messages.some(
        (message, index) => message !== conversation.messages[index],
      )
    ) {
      return conversation;
    }
    return {
      ...conversation,
      updatedAt: new Date().toISOString(),
      messages,
    };
  });
  return { changed, items: nextItems };
}

function messageParts(message: ChatMessage) {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  const content = message.content.trim();
  if (content) {
    parts.push({ type: "text", text: content });
  }
  for (const attachment of message.attachments || []) {
    parts.push({
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    });
  }
  for (const image of message.images || []) {
    parts.push({
      type: "image_url",
      image_url: { url: image.dataUrl },
    });
  }
  return parts;
}

function conversationMessagesForApi(
  messages: ChatMessage[],
): WorkspaceRequestMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "assistant" && message.status !== "done") {
      return [];
    }
    const parts = messageParts(message);
    if (parts.length === 0) {
      return [];
    }
    if (parts.length === 1 && parts[0].type === "text") {
      return [{ role: message.role, content: parts[0].text }];
    }
    return [{ role: message.role, content: parts }];
  });
}

function assistantMessageFallbackText(
  mode: "text" | "image_generate" | "image_edit",
  imageCount: number,
) {
  if (mode === "image_generate" && imageCount > 0) {
    return imageCount > 1
      ? `Đã tạo xong ${imageCount} ảnh.`
      : "Đã tạo xong ảnh.";
  }
  if (mode === "image_edit" && imageCount > 0) {
    return imageCount > 1
      ? `Đã chỉnh xong ${imageCount} ảnh.`
      : "Đã chỉnh xong ảnh.";
  }
  return "";
}

function friendlyChatErrorMessage(value: string) {
  const message = String(value || "");
  const lower = message.toLowerCase();
  if (
    lower.includes("no available text account") ||
    lower.includes("/backend-anon/conversation failed: status=403")
  ) {
    return "AJC AI hiện chưa có tài khoản nguồn khả dụng để trò chuyện. Hãy nhập access_token ở mục Quản lý tài khoản trước.";
  }
  if (lower.includes("image file is required for image edit")) {
    return "Không tìm thấy ảnh nguồn để chỉnh sửa. Hãy đính kèm ảnh hoặc yêu cầu tạo ảnh mới trước.";
  }
  if (
    lower.includes("authenticated upstream account required for image input")
  ) {
    return "Tài khoản nguồn hiện chưa sẵn sàng để đọc ảnh đính kèm. Hãy kiểm tra lại access_token trong Quản lý tài khoản.";
  }
  if (
    lower.includes("upstream image request was rejected temporarily") ||
    (lower.includes("status=403") &&
      (lower.includes("/backend-api/f/conversation") ||
        lower.includes("/backend-api/f/conversation/prepare") ||
        lower.includes("/backend-api/files") ||
        lower.includes("image_upload")))
  ) {
    return "Dịch vụ tạo ảnh đang tạm thời từ chối yêu cầu. Hệ thống sẽ tự thử lại ngắn hạn; nếu vẫn lỗi, hãy chờ vài giây rồi gửi lại.";
  }
  return message;
}

export function ChatWorkspace() {
  const conversationsRef = useRef<ChatConversation[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chatPrompt, setChatPrompt] = useState("");
  const [chatModel, setChatModel] = useState("auto");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<
    { type: "one"; id: string } | { type: "all" } | null
  >(null);

  const selectedConversation = useMemo(
    () =>
      conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const deleteConfirmTitle =
    deleteConfirm?.type === "all" ? "Xóa toàn bộ lịch sử" : "Xóa hội thoại";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "Bạn có chắc muốn xóa toàn bộ lịch sử trò chuyện không? Hành động này không thể khôi phục."
      : "Bạn có chắc muốn xóa hội thoại này không? Hành động này không thể khôi phục.";

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedModel =
          typeof window !== "undefined"
            ? window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
            : null;
        if (storedModel) {
          setChatModel(storedModel);
        }

        const items = await listChatConversations();
        const recovered = recoverInterruptedChats(items);
        if (recovered.changed) {
          await saveChatConversations(recovered.items);
        }
        if (cancelled) {
          return;
        }

        const nextItems = recovered.items;
        conversationsRef.current = nextItems;
        setConversations(nextItems);
        const storedConversationId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_CHAT_CONVERSATION_STORAGE_KEY)
            : null;
        const nextSelectedConversationId =
          (storedConversationId &&
          nextItems.some(
            (conversation) => conversation.id === storedConversationId,
          )
            ? storedConversationId
            : null) ?? pickFallbackConversationId(nextItems);
        setSelectedConversationId(nextSelectedConversationId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Đọc lịch sử trò chuyện thất bại";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesViewportRef.current?.scrollTo({
      top: messagesViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    selectedConversation?.updatedAt,
    selectedConversation?.messages.length,
    selectedConversation,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(
        ACTIVE_CHAT_CONVERSATION_STORAGE_KEY,
        selectedConversationId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_CHAT_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window !== "undefined" && chatModel) {
      window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatModel);
    }
  }, [chatModel]);

  useEffect(() => {
    if (
      selectedConversationId &&
      !conversations.some((item) => item.id === selectedConversationId)
    ) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = useCallback(
    async (conversation: ChatConversation) => {
      const nextConversations = sortChatConversations([
        conversation,
        ...conversationsRef.current.filter(
          (item) => item.id !== conversation.id,
        ),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      await saveChatConversation(conversation);
    },
    [],
  );

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ChatConversation | null) => ChatConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current =
        conversationsRef.current.find((item) => item.id === conversationId) ??
        null;
      const nextConversation = updater(current);
      const nextConversations = sortChatConversations([
        nextConversation,
        ...conversationsRef.current.filter(
          (item) => item.id !== conversationId,
        ),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveChatConversation(nextConversation);
      }
    },
    [],
  );

  const resetComposer = useCallback(() => {
    setChatPrompt("");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleCreateDraft = useCallback(() => {
    setSelectedConversationId(null);
    resetComposer();
    textareaRef.current?.focus();
  }, [resetComposer]);

  const handleSelectConversation = useCallback((id: string) => {
    const conversation = conversationsRef.current.find(
      (item) => item.id === id,
    );
    setSelectedConversationId(id);
    if (conversation?.model) {
      setChatModel(conversation.model);
    }
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      const nextConversations = conversationsRef.current.filter(
        (item) => item.id !== id,
      );
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (selectedConversationId === id) {
        setSelectedConversationId(
          pickFallbackConversationId(nextConversations),
        );
      }

      try {
        await deleteChatConversation(id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Xóa hội thoại thất bại";
        toast.error(message);
        const items = await listChatConversations();
        conversationsRef.current = items;
        setConversations(items);
      }
    },
    [selectedConversationId],
  );

  const handleClearHistory = useCallback(async () => {
    try {
      await clearChatConversations();
      conversationsRef.current = [];
      setConversations([]);
      setSelectedConversationId(null);
      resetComposer();
      toast.success("Đã xóa toàn bộ lịch sử trò chuyện");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Xóa lịch sử thất bại";
      toast.error(message);
    }
  }, [resetComposer]);

  const openDeleteConversationConfirm = useCallback((id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  }, []);

  const openClearHistoryConfirm = useCallback(() => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    await handleDeleteConversation(target.id);
  }, [deleteConfirm, handleClearHistory, handleDeleteConversation]);

  const handleAttachmentChange = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    try {
      const nextAttachments = await Promise.all(
        files.map(async (file, index) =>
          attachmentFromFile(file, await readFileAsDataUrl(file), index),
        ),
      );
      setAttachments((current) => [...current, ...nextAttachments]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Đọc ảnh đính kèm thất bại";
      toast.error(message);
    }
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const prompt = chatPrompt.trim();
    if (!prompt && attachments.length === 0) {
      toast.error("Vui lòng nhập nội dung hoặc đính kèm ảnh");
      return;
    }
    if (isSending) {
      return;
    }

    const targetConversation = selectedConversationId
      ? (conversationsRef.current.find(
          (conversation) => conversation.id === selectedConversationId,
        ) ?? null)
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: prompt,
      createdAt: now,
      status: "done",
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    const pendingAssistantMessage: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: now,
      status: "pending",
    };
    const baseConversation: ChatConversation = targetConversation
      ? {
          ...targetConversation,
          model: chatModel,
          updatedAt: now,
          messages: [
            ...targetConversation.messages,
            userMessage,
            pendingAssistantMessage,
          ],
        }
      : {
          id: conversationId,
          title: buildConversationTitle(prompt),
          model: chatModel,
          createdAt: now,
          updatedAt: now,
          messages: [userMessage, pendingAssistantMessage],
        };

    const requestMessages = conversationMessagesForApi([
      ...(targetConversation?.messages ?? []),
      userMessage,
    ]);

    setSelectedConversationId(conversationId);
    resetComposer();
    setIsSending(true);
    await persistConversation(baseConversation);

    try {
      const response = await createWorkspaceResponse(requestMessages, {
        model: chatModel,
      });
      const responseImages = responseImagesToMessageImages(
        response.images || [],
      );
      const assistantText =
        String(response.message?.content || "").trim() ||
        assistantMessageFallbackText(response.mode, responseImages.length);
      await updateConversation(conversationId, (current) => {
        const conversation = current ?? baseConversation;
        return {
          ...conversation,
          model: chatModel,
          updatedAt: new Date().toISOString(),
          messages: conversation.messages.map((message) =>
            message.id === pendingAssistantMessage.id
              ? {
                  ...message,
                  content: assistantText,
                  images:
                    responseImages.length > 0 ? responseImages : undefined,
                  status:
                    assistantText || responseImages.length > 0
                      ? "done"
                      : "error",
                  error:
                    assistantText || responseImages.length > 0
                      ? undefined
                      : "Phản hồi rỗng từ hệ thống.",
                }
              : message,
          ),
        };
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Gửi tin nhắn thất bại";
      const message = friendlyChatErrorMessage(rawMessage);
      await updateConversation(conversationId, (current) => {
        const conversation = current ?? baseConversation;
        return {
          ...conversation,
          model: chatModel,
          updatedAt: new Date().toISOString(),
          messages: conversation.messages.map((item) =>
            item.id === pendingAssistantMessage.id
              ? {
                  ...item,
                  content: "Đã xảy ra lỗi khi lấy phản hồi.",
                  status: "error",
                  error: message,
                }
              : item,
          ),
        };
      });
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [
    attachments,
    chatModel,
    chatPrompt,
    isSending,
    persistConversation,
    resetComposer,
    selectedConversationId,
    updateConversation,
  ]);

  return (
    <>
      <section className="grid flex-1 min-h-0 grid-cols-1 gap-2 overflow-hidden px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:gap-3 sm:px-3 sm:pb-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden h-full min-h-0 border-r border-stone-200/70 pr-3 lg:block">
          <ChatSidebar
            conversations={conversations}
            isLoadingHistory={isLoadingHistory}
            selectedConversationId={selectedConversationId}
            onCreateDraft={handleCreateDraft}
            onClearHistory={openClearHistoryConfirm}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={openDeleteConversationConfirm}
            formatConversationTime={formatConversationTime}
          />
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="flex h-[min(82dvh,760px)] w-[92vw] max-w-[460px] flex-col overflow-hidden rounded-[32px] border-white/80 bg-white p-0 shadow-[0_32px_110px_-38px_rgba(15,23,42,0.45)] sm:rounded-[36px]">
            <DialogHeader className="px-6 pt-7 pb-4 sm:px-8">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
                <History className="size-5" />
                Lịch sử
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8">
              <ChatSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={() => {
                  handleCreateDraft();
                  setIsHistoryOpen(false);
                }}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={(id) => {
                  handleSelectConversation(id);
                  setIsHistoryOpen(false);
                }}
                onDeleteConversation={openDeleteConversationConfirm}
                formatConversationTime={formatConversationTime}
                hideActionButtons
              />
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex min-h-0 flex-col gap-2 sm:gap-4">
          <div className="flex items-center justify-between gap-2 px-1 lg:hidden">
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-2xl border-stone-200 bg-white/90 text-stone-700 shadow-sm"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History className="mr-2 size-4" />
              Lịch sử ({conversations.length})
            </Button>
            <Button
              className="h-10 rounded-2xl bg-stone-950 text-white shadow-sm"
              onClick={handleCreateDraft}
            >
              <Plus className="size-4" />
              Mới
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-2xl border-stone-200 bg-white/85 px-3 text-stone-600 shadow-sm"
              onClick={openClearHistoryConfirm}
              disabled={conversations.length === 0}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div
            ref={messagesViewportRef}
            className="hide-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto px-1 py-2 sm:px-4 sm:py-4"
          >
            <ChatMessages
              selectedConversation={selectedConversation}
              formatConversationTime={formatConversationTime}
            />
          </div>

          <ChatComposer
            prompt={chatPrompt}
            model={chatModel}
            isSending={isSending}
            attachments={attachments}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
            onPromptChange={setChatPrompt}
            onModelChange={setChatModel}
            onSubmit={handleSubmit}
            onPickAttachment={() => fileInputRef.current?.click()}
            onAttachmentChange={handleAttachmentChange}
            onRemoveAttachment={handleRemoveAttachment}
          />
        </div>
      </section>

      {deleteConfirm ? (
        <Dialog
          open
          onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}
        >
          <DialogContent showCloseButton={false} className="rounded-2xl p-6">
            <DialogHeader className="gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Hủy
              </Button>
              <Button
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => void handleConfirmDelete()}
              >
                Xác nhận xóa
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
