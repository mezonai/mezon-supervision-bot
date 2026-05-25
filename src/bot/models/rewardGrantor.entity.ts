import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TABLE } from '../constants/tables';

@Index(['clan_id'])
@Index(['rewarder_id', 'clan_id'], { unique: true })
@Entity(TABLE.REWARD_GRANTOR)
export class RewardGrantor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  rewarder_id: string;

  @Column({ type: 'text' })
  clan_id: string;

  @Column({ type: 'text', nullable: true })
  granted_by: string;

  @Column({ type: 'bigint', default: () => 'extract(epoch from now()) * 1000' })
  createdAt: number;
}
