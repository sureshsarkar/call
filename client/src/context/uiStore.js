import { create } from 'zustand';

// UI-only state shared between the sidebar tabs and other screens.
export const useUiStore = create((set) => ({
  tab: 'chats', // chats | contacts | online | calls | alerts | me
  setTab: (tab) => set({ tab }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  installEvent: null, // deferred beforeinstallprompt event (Android/desktop Chrome)
  setInstallEvent: (installEvent) => set({ installEvent }),
  installed: false,
  setInstalled: (installed) => set({ installed }),
}));
