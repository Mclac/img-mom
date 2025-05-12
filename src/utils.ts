import { Message } from "grammy/types";

// 生成 UTC 日期目录名 (YYYYMMDD)
export const genDateDirName = () => {
  const date = new Date();
  const pad = (val: number) => val.toString().padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('');
};

export const isOwner = (userId?: number) => {
  // ✅ 将环境变量强制转换为数字
  const ownerId = Number(self.TG_BOT_OWNER_ID);
  if (isNaN(ownerId)) {
    throw new Error('TG_BOT_OWNER_ID 必须是有效数字');
  }
  return userId === ownerId;
};

// 检查消息是否来自私聊
export const isInPrivateChat = (message: Message) => {
  return message.chat.type === 'private';
};