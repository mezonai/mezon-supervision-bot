import {
  EmbedProps,
  MEZON_EMBED_AUTHOR,
  MEZON_EMBED_FOOTER,
} from '../constants/configs';
import { getRandomColor } from './helps';

export const EMBED_COLOR = {
  SUCCESS: '#57F287',
  ERROR: '#ED4245',
} as const;

export type BotEmbedOptions = {
  title: string;
  description?: string;
  fields?: EmbedProps['fields'];
  color?: string;
  image?: EmbedProps['image'];
};

let botAuthorIconUrl: string | undefined;

export function setBotAuthorIconUrl(url: string) {
  if (url?.trim()) {
    botAuthorIconUrl = url.trim();
  }
}

function resolveEmbedAuthor(): EmbedProps['author'] {
  if (!botAuthorIconUrl) {
    return { name: MEZON_EMBED_AUTHOR.name };
  }

  return {
    name: MEZON_EMBED_AUTHOR.name,
    icon_url: botAuthorIconUrl,
    url: botAuthorIconUrl,
  };
}

export function buildBotEmbed(options: BotEmbedOptions): EmbedProps {
  return {
    color: options.color ?? getRandomColor(),
    title: options.title,
    ...(options.description !== undefined && { description: options.description }),
    ...(options.fields?.length && { fields: options.fields }),
    ...(options.image && { image: options.image }),
    author: resolveEmbedAuthor(),
    timestamp: new Date().toISOString(),
    footer: MEZON_EMBED_FOOTER,
  };
}

export function buildBotEmbedPayload(options: BotEmbedOptions) {
  return { embed: [buildBotEmbed(options)] };
}

export function buildPermissionDeniedPayload(commandTitle: string) {
  return buildBotEmbedPayload({
    title: commandTitle,
    description: 'You do not have permission to use this command.',
    color: EMBED_COLOR.ERROR,
  });
}

export function buildErrorPayload(commandTitle: string, description: string) {
  return buildBotEmbedPayload({
    title: commandTitle,
    description,
    color: EMBED_COLOR.ERROR,
  });
}
