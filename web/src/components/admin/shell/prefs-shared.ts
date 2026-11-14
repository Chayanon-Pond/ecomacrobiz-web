/** Shared by the server layout (bootstrap script) and client prefs hooks. No "use client". */
export const PREF_KEYS = {
  theme: "adm.theme",
  sidebar: "adm.sidebar",
  leadsView: "adm.leadsView",
} as const;

/** Inline <script> body (app/admin/layout.tsx): applies prefs before first paint. */
export const ADMIN_PREFS_BOOTSTRAP = `try{var d=document.documentElement,s=window.localStorage;d.dataset.admTheme=s.getItem("${PREF_KEYS.theme}")==="light"?"light":"dark";if(s.getItem("${PREF_KEYS.sidebar}")==="collapsed")d.dataset.admSidebar="collapsed";else delete d.dataset.admSidebar}catch(e){}`;

