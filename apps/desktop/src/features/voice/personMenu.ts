import type { VoiceState } from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { useAudioStore } from '../../app/stores/audio';
import { setPlaybackVolume } from '../../lib/voice-session';

export function openPersonMenu(state: VoiceState, guildId: string, at: { x: number; y: number }) {
  const setGain = (gain: number) => {
    const { userVolumes } = useAudioStore.getState().prefs;
    useAudioStore.getState().setPrefs({ userVolumes: { ...userVolumes, [state.user.id]: gain } });
    setPlaybackVolume(state.user.id, gain);
  };
  const guild = useChatStore.getState().guildDetails[guildId];

  useUiStore.getState().openPersonContextMenu({
    at,
    state,
    guildId,
    canModerate: !!guild && (guild.isOwner || (guild.myPermissions & (Permission.MuteMembers | Permission.MoveMembers)) !== 0),
    gain: useAudioStore.getState().prefs.userVolumes[state.user.id] ?? 1,
    onVolume: setGain,
    onProfile: () => useUiStore.getState().openUserProfile(state.user.id, guildId, at),
  });
}
