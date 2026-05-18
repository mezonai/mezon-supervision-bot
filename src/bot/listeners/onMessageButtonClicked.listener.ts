import { OnEvent } from '@nestjs/event-emitter';
import { Events } from 'mezon-sdk';
import { Injectable } from '@nestjs/common';
import { RoleService } from '../commands/selfAssignableRoles/role.service';

@Injectable()
export class ListenerMessageButtonClicked {
  constructor(private roleService: RoleService) {}

  @OnEvent(Events.MessageButtonClicked)
  async hanndleButtonForm(data) {
    try {
      const args = data.button_id.split('_');
      const buttonConfirmType = args[0];
      switch (buttonConfirmType) {
        case 'role':
          this.handleSelectRole(data);
          break;
        default:
          break;
      }
    } catch (error) {
      console.log('hanndleButtonForm ERROR', error);
    }
  }

  async handleSelectRole(data) {
    try {
      await this.roleService.handleSelectRole(data);
    } catch (error) {
      console.log('ERORR handleSelectRole', error);
    }
  }
}
