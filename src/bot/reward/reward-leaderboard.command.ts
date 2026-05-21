import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { RewardService } from './reward.service';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

@Command('leaderboard')
export class RewardLeaderboardCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private rewardService: RewardService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const limit = this.parseLimit(args[0]);
    const entries = await this.rewardService.getPointsLeaderboard(limit);
    const senderId = String(message.sender_id || '');
    const selfRank = senderId
      ? await this.rewardService.getUserPointsRank(senderId)
      : null;

    const lines: string[] = [
      `🏆 Bảng xếp hạng reward points (top ${limit})`,
      '',
    ];

    if (entries.length === 0) {
      lines.push('Chưa có user nào có points.');
    } else {
      for (const entry of entries) {
        lines.push(
          `${entry.rank}. ${entry.displayName} — ${entry.amount.toLocaleString('vi-VN')} points`,
        );
      }
    }

    if (selfRank) {
      lines.push(
        '',
        `📍 Bạn: #${selfRank.rank} — ${selfRank.amount.toLocaleString('vi-VN')} points`,
      );
    }

    const content = lines.join('\n');
    return this.replyToMessage(message, {
      t: content,
      mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
    });
  }

  private parseLimit(raw: string | undefined): number {
    if (!raw) return DEFAULT_LIMIT;
    const n = Number(raw);
    if (isNaN(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
  }
}
