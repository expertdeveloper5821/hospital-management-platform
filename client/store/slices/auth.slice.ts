import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { MeResponse, BrandingConfig } from '../types';

const TOKEN_KEY = 'hms_token';

interface AuthState {
  token:           string | null;
  profile:         MeResponse | null;
  branding:        BrandingConfig | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  token:           null,
  profile:         null,
  branding:        null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    tokenReceived(state, action: PayloadAction<string>) {
      state.token          = action.payload;
      state.isAuthenticated = true;
      // Persist so page-refresh does not force re-login
      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, action.payload);
      }
    },
    profileLoaded(state, action: PayloadAction<MeResponse>) {
      state.profile = action.payload;
    },
    setBranding(state, action: PayloadAction<BrandingConfig>) {
      state.branding = action.payload;
    },
    setFirstLoginDone(state) {
      if (state.profile) {
        state.profile.isFirstLogin = false;
      }
    },
    logout(state) {
      state.token          = null;
      state.profile        = null;
      state.branding       = null;
      state.isAuthenticated = false;
      if (typeof window !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
      }
    },
  },
});

export const TOKEN_STORAGE_KEY = TOKEN_KEY;

export const {
  tokenReceived,
  profileLoaded,
  setBranding,
  setFirstLoginDone,
  logout,
} = authSlice.actions;

export default authSlice.reducer;
