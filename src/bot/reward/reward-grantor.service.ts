import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RewardGrantor } from '../models/rewardGrantor.entity';
import { User } from '../models/user.entity';

export interface RewardGrantorListEntry {
  rewarderId: string;
  displayName: string;
  grantedBy: string | null;
  createdAt: number;
}

@Injectable()
export class RewardGrantorService {
  constructor(
    @InjectRepository(RewardGrantor)
    private rewardGrantorRepository: Repository<RewardGrantor>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async isRewardGrantor(rewarderId: string, clanId: string): Promise<boolean> {
    if (!rewarderId || !clanId) return false;

    const count = await this.rewardGrantorRepository.count({
      where: { rewarder_id: rewarderId, clan_id: clanId },
    });
    return count > 0;
  }

  async listByClan(clanId: string): Promise<RewardGrantorListEntry[]> {
    const rows = await this.rewardGrantorRepository.find({
      where: { clan_id: clanId },
      order: { createdAt: 'ASC' },
    });

    if (rows.length === 0) return [];

    const userIds = rows.map((row) => row.rewarder_id);
    const users = await this.userRepository
      .createQueryBuilder('u')
      .where('u.user_id IN (:...userIds)', { userIds })
      .getMany();
    const userById = new Map(users.map((user) => [user.user_id, user]));

    return rows.map((row) => {
      const user = userById.get(row.rewarder_id);
      return {
        rewarderId: row.rewarder_id,
        displayName:
          user?.clan_nick || user?.username || row.rewarder_id,
        grantedBy: row.granted_by,
        createdAt: Number(row.createdAt) || 0,
      };
    });
  }

  async addRewarders(
    clanId: string,
    identities: string[],
    grantedBy: string,
  ): Promise<{ added: string[]; skipped: string[]; notFound: string[] }> {
    const added: string[] = [];
    const skipped: string[] = [];
    const notFound: string[] = [];

    for (const identity of identities) {
      const rewarderId = await this.resolveIdentity(identity);
      if (!rewarderId) {
        notFound.push(identity);
        continue;
      }

      const existing = await this.rewardGrantorRepository.findOne({
        where: { rewarder_id: rewarderId, clan_id: clanId },
      });
      if (existing) {
        skipped.push(identity);
        continue;
      }

      await this.rewardGrantorRepository.save({
        rewarder_id: rewarderId,
        clan_id: clanId,
        granted_by: grantedBy,
        createdAt: Date.now(),
      });
      added.push(identity);
    }

    return { added, skipped, notFound };
  }

  async removeRewarders(
    clanId: string,
    identities: string[],
  ): Promise<{ removed: string[]; notFound: string[] }> {
    const removed: string[] = [];
    const notFound: string[] = [];

    for (const identity of identities) {
      const rewarderId = await this.resolveIdentity(identity);
      if (!rewarderId) {
        notFound.push(identity);
        continue;
      }

      const result = await this.rewardGrantorRepository.delete({
        rewarder_id: rewarderId,
        clan_id: clanId,
      });

      if (!result.affected) {
        notFound.push(identity);
        continue;
      }

      removed.push(identity);
    }

    return { removed, notFound };
  }

  private async resolveIdentity(identity: string): Promise<string | null> {
    const trimmed = identity.trim().replace(/,+$/, '');
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    const byId = await this.userRepository.findOne({
      where: { user_id: trimmed },
    });
    if (byId) return byId.user_id;

    const byUsername = await this.userRepository
      .createQueryBuilder('u')
      .where('LOWER(u.username) = LOWER(:username)', { username: trimmed })
      .getOne();
    if (byUsername) return byUsername.user_id;

    return null;
  }
}
