import { ChannelSettingsModal, CreateChannelModal } from './ChannelModals';
import { CreateCategoryModal } from './CreateCategoryModal';
import { AddFriendModal } from './AddFriendModal';
import { BanMemberModal } from './BanMemberModal';
import { ConfirmModal } from './ConfirmModal';
import { ProfileModal } from './ProfileModal';
import { CreateServerModal, InviteModal, JoinServerModal } from './ServerModals';
import { NewDmModal, UserProfileModal } from './UserModals';
import { Lightbox } from '../media/Lightbox';
import { GuildSettingsModal } from '../../features/settings/GuildSettingsModal';
import { UserSettingsModal } from '../../features/settings/UserSettingsModal';

/** Renders every dialog; each one opens itself based on the UI store. */
export function ModalHost() {
  return (
    <>
      <CreateServerModal />
      <JoinServerModal />
      <GuildSettingsModal />
      <UserSettingsModal />
      <InviteModal />
      <CreateChannelModal />
      <CreateCategoryModal />
      <ChannelSettingsModal />
      <ProfileModal />
      <UserProfileModal />
      <NewDmModal />
      <ConfirmModal />
      <BanMemberModal />
      <AddFriendModal />
      <Lightbox />
    </>
  );
}
