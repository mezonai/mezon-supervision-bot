import { OnEvent } from '@nestjs/event-emitter';
import { ChannelMessage, Events } from 'mezon-sdk';
import { CommandBase } from '../base/command.handle';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ListenerChannelMessage {
  private readonly logger = new Logger(ListenerChannelMessage.name);

  constructor(private commandBase: CommandBase) {}

  @OnEvent(Events.ChannelMessage)
  async handleCommand(message: ChannelMessage) {
    if (message.code) return; // Do not support case edit message
    try {
      const content = message.content?.t;
      if (typeof content !== 'string' || !content.trim()) return;

      if (content.trim()[0] !== '*') return;

      this.logger.debug(
        `command ${content.trim().slice(0, 64)} sender=${message.sender_id}`,
      );
      await this.commandBase.execute(content, message);
    } catch (e) {
      this.logger.error('Command handler failed', e);
    }
  }
}
