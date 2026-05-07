"use client";

import localforage from "localforage";

export type ChatModel = string;
export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageStatus = "done" | "pending" | "error";

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
};

export type ChatImage = {
  id: string;
  dataUrl: string;
  url?: string;
  revised_prompt?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  attachments?: ChatAttachment[];
  images?: ChatImage[];
  error?: string;
};

export type ChatConversation = {
  id: string;
  title: string;
  model: ChatModel;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const chatConversationStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "chat_conversations",
});

const CHAT_CONVERSATIONS_KEY = "items";
let chatConversationWriteQueue: Promise<void> = Promise.resolve();

function hasLegacyInlineAssistantImages(
  conversations: Array<ChatConversation & Record<string, unknown>>,
) {
  return conversations.some((conversation) => {
    if (!Array.isArray(conversation.messages)) {
      return false;
    }
    return conversation.messages.some((message) => {
      const images =
        message &&
        typeof message === "object" &&
        Array.isArray((message as Record<string, unknown>).images)
          ? ((message as Record<string, unknown>).images as Array<
              ChatImage & Record<string, unknown>
            >)
          : [];
      return images.some((image) => {
        const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : "";
        const url = typeof image.url === "string" ? image.url : "";
        return Boolean(url) && dataUrl !== url;
      });
    });
  });
}

function normalizeAttachment(
  attachment: ChatAttachment & Record<string, unknown>,
  fallbackIndex: number,
): ChatAttachment | null {
  const dataUrl =
    typeof attachment.dataUrl === "string" ? attachment.dataUrl : "";
  if (!dataUrl) {
    return null;
  }
  return {
    id: String(attachment.id || `attachment-${fallbackIndex}`),
    name: String(attachment.name || `attachment-${fallbackIndex}.png`),
    type: String(attachment.type || "image/png"),
    dataUrl,
  };
}

function normalizeImage(
  image: ChatImage & Record<string, unknown>,
  fallbackIndex: number,
): ChatImage | null {
  const url = typeof image.url === "string" && image.url ? image.url : "";
  const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : "";
  const preferredSrc = url || dataUrl;
  if (!preferredSrc) {
    return null;
  }
  return {
    id: String(image.id || `image-${fallbackIndex}`),
    dataUrl: preferredSrc,
    url: url || undefined,
    revised_prompt:
      typeof image.revised_prompt === "string" && image.revised_prompt
        ? image.revised_prompt
        : undefined,
  };
}

function normalizeMessage(
  message: ChatMessage & Record<string, unknown>,
): ChatMessage {
  const role =
    message.role === "assistant" ||
    message.role === "system" ||
    message.role === "user"
      ? message.role
      : "user";
  const status =
    message.status === "pending" ||
    message.status === "error" ||
    message.status === "done"
      ? message.status
      : "done";

  return {
    id: String(message.id || `${Date.now()}`),
    role,
    content: String(message.content || ""),
    createdAt: String(message.createdAt || new Date().toISOString()),
    status,
    attachments: Array.isArray(message.attachments)
      ? message.attachments
          .map((attachment, index) =>
            normalizeAttachment(
              attachment as ChatAttachment & Record<string, unknown>,
              index,
            ),
          )
          .filter((attachment): attachment is ChatAttachment =>
            Boolean(attachment),
          )
      : undefined,
    images: Array.isArray(message.images)
      ? message.images
          .map((image, index) =>
            normalizeImage(image as ChatImage & Record<string, unknown>, index),
          )
          .filter((image): image is ChatImage => Boolean(image))
      : undefined,
    error: typeof message.error === "string" ? message.error : undefined,
  };
}

function normalizeConversation(
  conversation: ChatConversation & Record<string, unknown>,
): ChatConversation {
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map((message) =>
        normalizeMessage(message as ChatMessage & Record<string, unknown>),
      )
    : [];
  const lastMessage = messages[messages.length - 1];

  return {
    id: String(conversation.id || `${Date.now()}`),
    title: String(conversation.title || "Cuộc trò chuyện mới"),
    model: String(conversation.model || "auto"),
    createdAt: String(
      conversation.createdAt ||
        lastMessage?.createdAt ||
        new Date().toISOString(),
    ),
    updatedAt: String(
      conversation.updatedAt ||
        lastMessage?.createdAt ||
        new Date().toISOString(),
    ),
    messages,
  };
}

function sortChatConversations(
  conversations: ChatConversation[],
): ChatConversation[] {
  return [...conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function getTimestamp(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickLatestConversation(
  current: ChatConversation,
  next: ChatConversation,
) {
  return getTimestamp(next.updatedAt) >= getTimestamp(current.updatedAt)
    ? next
    : current;
}

function queueChatConversationWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = chatConversationWriteQueue.then(operation);
  chatConversationWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readStoredChatConversations(): Promise<ChatConversation[]> {
  const items =
    (await chatConversationStorage.getItem<
      Array<ChatConversation & Record<string, unknown>>
    >(CHAT_CONVERSATIONS_KEY)) || [];
  return items.map(normalizeConversation);
}

export async function loadChatConversations(): Promise<{
  items: ChatConversation[];
  needsCompaction: boolean;
}> {
  const storedItems =
    (await chatConversationStorage.getItem<
      Array<ChatConversation & Record<string, unknown>>
    >(CHAT_CONVERSATIONS_KEY)) || [];
  return {
    items: storedItems.map(normalizeConversation),
    needsCompaction: hasLegacyInlineAssistantImages(storedItems),
  };
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  return sortChatConversations(await readStoredChatConversations());
}

export async function saveChatConversations(
  conversations: ChatConversation[],
): Promise<void> {
  await queueChatConversationWrite(async () => {
    const items = await readStoredChatConversations();
    const conversationMap = new Map(items.map((item) => [item.id, item]));
    for (const conversation of conversations.map(normalizeConversation)) {
      const current = conversationMap.get(conversation.id);
      conversationMap.set(
        conversation.id,
        current ? pickLatestConversation(current, conversation) : conversation,
      );
    }
    await chatConversationStorage.setItem(
      CHAT_CONVERSATIONS_KEY,
      sortChatConversations([...conversationMap.values()]),
    );
  });
}

export async function saveChatConversation(
  conversation: ChatConversation,
): Promise<void> {
  await queueChatConversationWrite(async () => {
    const items = await readStoredChatConversations();
    const nextConversation = normalizeConversation(conversation);
    const current = items.find((item) => item.id === nextConversation.id);
    const persistedConversation = current
      ? pickLatestConversation(current, nextConversation)
      : nextConversation;
    const nextItems = sortChatConversations([
      persistedConversation,
      ...items.filter((item) => item.id !== persistedConversation.id),
    ]);
    await chatConversationStorage.setItem(CHAT_CONVERSATIONS_KEY, nextItems);
  });
}

export async function deleteChatConversation(id: string): Promise<void> {
  await queueChatConversationWrite(async () => {
    const items = await readStoredChatConversations();
    await chatConversationStorage.setItem(
      CHAT_CONVERSATIONS_KEY,
      items.filter((item) => item.id !== id),
    );
  });
}

export async function clearChatConversations(): Promise<void> {
  await queueChatConversationWrite(async () => {
    await chatConversationStorage.removeItem(CHAT_CONVERSATIONS_KEY);
  });
}
