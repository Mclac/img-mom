import { Bot, InlineKeyboard } from 'grammy/web';
import BackblazeB2 from './oss/backblazeB2';
import CloudflareR2 from './oss/cloudflareR2';
import { isInPrivateChat, isOwner } from './utils';
import { OSSProvider } from './oss/interface';

const supportProviders: Record<string, new () => OSSProvider> = {
  BackblazeB2,
  CloudflareR2,
};

const bot = new Bot(self.TG_BOT_TOKEN);


bot.use((ctx, next) => {
  console.log(JSON.stringify(ctx.update, null, 2));
  return next();
});


bot.command('start', (ctx) => ctx.reply('Welcome to use ImgMom'));


bot.command('help', async (ctx) => {
  const commands = await ctx.api.getMyCommands();
  const info = commands.reduce((acc, val) => `${acc}/${val.command} - ${val.description}\n`, '');
  return ctx.reply(info);
});


bot.use(async (ctx, next) => {
  if (['true', true].includes(self.TG_BOT_ALLOW_ANYONE)) {
    return next();
  }

  const userId = ctx.from?.id;
  console.log('[DEBUG] 当前用户 ID:', userId);
  console.log('[DEBUG] 配置的 Owner ID:', Number(self.TG_BOT_OWNER_ID));

  if (!isOwner(userId)) {
    console.error('[ERROR] 用户 ID 不匹配');
    return ctx.reply("无权限操作");
  }
  await next();
});


bot.command('settings', async (ctx) => {
  const buttons = [
    ...Object.keys(supportProviders).map(provider => InlineKeyboard.text(provider, provider)),
    InlineKeyboard.text('None', 'None')
  ];
  const keyboard = InlineKeyboard.from([buttons]);
  return ctx.reply('Choose OSS Provider:', { reply_markup: keyboard });
});


bot.on('callback_query:data', async (ctx) => {
  const data = (ctx.callbackQuery as any).data;
  const username = ctx.callbackQuery.from.username;

  switch (data) {
    case 'confirm_overwrite': {
      const key = `pending_upload_${username}`;
      const pendingUpload = await self.KV_IMG_MOM.get(key);
      if (!pendingUpload) return ctx.reply('No pending upload found.');
      const { providerName, filePath, fileName, fileType, customPath, tgImgUrl } = JSON.parse(pendingUpload);
      const providerClass = supportProviders[providerName];
      if (!providerClass) return ctx.reply('Invalid provider.');
      try {
        const res = await fetch(`https://api.telegram.org/file/bot${self.TG_BOT_TOKEN}/${filePath}`);
        if (!res.ok) return ctx.reply('Failed to fetch file from Telegram');
        const fileData = await res.arrayBuffer();
        const provider = new providerClass();
        const uploadedPath = await provider.uploadImage(fileData, fileName, fileType, customPath);
        const fullUrl = provider.getURL(uploadedPath);
        await self.KV_IMG_MOM.delete(key);
        return ctx.reply(`Successfully overwritten!\nTelegram: ${tgImgUrl}\n${providerName}: ${fullUrl}`);
      } catch (err: any) {
        console.error(err);
        return ctx.reply('Upload failed: ' + err.message);
      }
    }
    case 'cancel_overwrite': {
      const key = `pending_upload_${username}`;
      await self.KV_IMG_MOM.delete(key);
      return ctx.reply('Upload cancelled.');
    }
    default: {
      const provider = data;
      const key = `oss_provider_${username}`;
      provider === 'None' ? await self.KV_IMG_MOM.delete(key) : await self.KV_IMG_MOM.put(key, provider);
      return ctx.reply(`OSS Provider set to: ${provider}`);
    }
  }
});


bot.on(['message:photo', 'message:document'], async (ctx) => {
  if (!isInPrivateChat(ctx.message)) return;

  const file = await ctx.getFile();
  const caption = ctx.message.caption?.startsWith('/') ? ctx.message.caption.slice(1) : ctx.message.caption;
  const tgImgUrl = `https://${self.host}/img/${file.file_id}`;


  const userId = ctx.message.from?.id;
  if (!isOwner(userId)) {
    return ctx.reply(`Image uploaded to Telegram: ${tgImgUrl}`);
  }

  const providerName = await self.KV_IMG_MOM.get(`oss_provider_${ctx.message.from.username}`) ?? '';
  const providerClass = supportProviders[providerName];
  if (!providerClass) return ctx.reply(`Image uploaded to Telegram: ${tgImgUrl}`);

  try {
    const res = await fetch(`https://api.telegram.org/file/bot${self.TG_BOT_TOKEN}/${file.file_path}`);
    if (!res.ok) return ctx.reply('Failed to download file');
    const fileData = await res.arrayBuffer();
    const provider = new providerClass();
    const fileType = file.file_path?.split('.').pop() || '';

    if (caption) {
      const exists = await provider.checkFileExists(caption);
      if (exists) {
        const pendingUpload = {
          providerName,
          filePath: file.file_path,
          fileName: file.file_unique_id,
          fileType,
          customPath: caption,
          tgImgUrl
        };
        await self.KV_IMG_MOM.put(`pending_upload_${ctx.message.from.username}`, JSON.stringify(pendingUpload), { expirationTtl: 300 });
        const keyboard = InlineKeyboard.from([[InlineKeyboard.text('Yes', 'confirm_overwrite'), InlineKeyboard.text('No', 'cancel_overwrite')]]);
        return ctx.reply(`File "${caption}" exists. Overwrite?`, { reply_markup: keyboard });
      }
    }

    const uploadedPath = await provider.uploadImage(fileData, file.file_unique_id, fileType, caption);
    const fullUrl = provider.getURL(uploadedPath);
    return ctx.reply(`Uploaded!\nTelegram: ${tgImgUrl}\n${providerName}: ${fullUrl}`);
  } catch (err: any) {
    console.error(err);
    return ctx.reply('Upload failed: ' + err.message);
  }
});

export default bot;