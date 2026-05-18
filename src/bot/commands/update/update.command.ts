import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { ChannelMessage } from 'mezon-sdk';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { UserCacheService } from 'src/bot/services/user-cache.service';
import { PermissionService } from 'src/bot/services/permission.service';

@Command('update')
export class UpdateCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private userCacheService: UserCacheService,
    private permissionService: PermissionService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    if (!this.permissionService.isAdmin(message.sender_id || '')) return;

    const messageChannel = await this.getChannelMessage(message);

    if (args[0] === 'up') {
      const userId = args[1];
      const amountStr = args[2];
      const isNumber = !isNaN(Number(amountStr));
      if (!isNumber) {
        return messageChannel?.reply({ t: 'Amount invalid!' });
      }

      const user = await this.userCacheService.getUserFromCache(userId);
      if (!user) {
        return messageChannel?.reply({ t: 'Not found user!' });
      }

      const amount = +user.amount + Number(amountStr);
      user.amount = amount;
      await this.userCacheService.updateUserCache(userId, user);

      return messageChannel?.reply({
        t: `Cộng ${amountStr} cho user ${userId} thành công!`,
      });
    }

    if (args[0] === 'down') {
      const userId = args[1];
      const amountStr = args[2];
      const isNumber = !isNaN(Number(amountStr));
      if (!isNumber) {
        return messageChannel?.reply({ t: 'Amount invalid!' });
      }

      const user = await this.userCacheService.getUserFromCache(userId);
      if (!user) {
        return messageChannel?.reply({ t: 'Not found user!' });
      }

      const amount = +user.amount - Number(amountStr);
      user.amount = amount;
      await this.userCacheService.updateUserCache(userId, user);

      return messageChannel?.reply({
        t: `Trừ ${amountStr} cho user ${userId} thành công!`,
      });
    }

    return messageChannel?.reply({
      t: 'Câu lệnh không hợp lệ. Dùng: up, down',
    });
  }
}
