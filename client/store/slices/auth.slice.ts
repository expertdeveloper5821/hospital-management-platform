import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { MeResponse, BrandingConfig } from '../types';

interface AuthState {
  token:          string | null;
  profile:        MeResponse | null; // populated from GET /api/auth/me after login
  branding:       BrandingConfig | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  token:          null,
  profile:        null,
  branding:       null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Called after login succeeds — stores token; profile populated by profileLoaded
    tokenReceived(state, action: PayloadAction<string>) {
      state.token          = action.payload;
      state.isAuthenticated = true;
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
    },
  },
});

export const {
  tokenReceived,
  profileLoaded,
  setBranding,
  setFirstLoginDone,
  logout,
} = authSlice.actions;

export default authSlice.reducer;
