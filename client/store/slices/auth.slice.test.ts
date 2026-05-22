import authReducer, {
  tokenReceived,
  profileLoaded,
  setBranding,
  setFirstLoginDone,
  logout,
} from './auth.slice';
import type { MeResponse, BrandingConfig } from '../types';

const profile: MeResponse = {
  userId:       'user-1',
  email:        'doctor@hospital.com',
  role:         'DOCTOR',
  tenantId:     'tenant-1',
  isFirstLogin: false,
};

const branding: BrandingConfig = {
  displayName:  'City Hospital',
  primaryColor: '#1A73E8',
  logoUrl:      null,
};

describe('authSlice reducers', () => {
  it('starts with unauthenticated state', () => {
    const state = authReducer(undefined, { type: '@@INIT' });
    expect(state.token).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('tokenReceived — stores token and marks authenticated', () => {
    const state = authReducer(undefined, tokenReceived('jwt-abc'));
    expect(state.token).toBe('jwt-abc');
    expect(state.isAuthenticated).toBe(true);
    expect(state.profile).toBeNull(); // profile not yet loaded
  });

  it('profileLoaded — stores full user profile', () => {
    let state = authReducer(undefined, tokenReceived('jwt-abc'));
    state     = authReducer(state, profileLoaded(profile));
    expect(state.profile).toEqual(profile);
    expect(state.profile?.email).toBe('doctor@hospital.com');
    expect(state.profile?.role).toBe('DOCTOR');
    expect(state.profile?.tenantId).toBe('tenant-1');
  });

  it('setBranding — stores branding config with displayName and primaryColor', () => {
    let state = authReducer(undefined, tokenReceived('jwt-abc'));
    state     = authReducer(state, profileLoaded(profile));
    state     = authReducer(state, setBranding(branding));
    expect(state.branding?.displayName).toBe('City Hospital');
    expect(state.branding?.primaryColor).toBe('#1A73E8');
  });

  it('setFirstLoginDone — clears isFirstLogin flag on profile', () => {
    const firstLoginProfile: MeResponse = { ...profile, isFirstLogin: true };
    let state = authReducer(undefined, tokenReceived('jwt-abc'));
    state     = authReducer(state, profileLoaded(firstLoginProfile));
    expect(state.profile?.isFirstLogin).toBe(true);
    state     = authReducer(state, setFirstLoginDone());
    expect(state.profile?.isFirstLogin).toBe(false);
  });

  it('setFirstLoginDone — no-op when profile is null', () => {
    const state = authReducer(undefined, setFirstLoginDone());
    expect(state.profile).toBeNull(); // no crash
  });

  it('logout — resets entire auth state', () => {
    let state = authReducer(undefined, tokenReceived('jwt-abc'));
    state     = authReducer(state, profileLoaded(profile));
    state     = authReducer(state, setBranding(branding));
    state     = authReducer(state, logout());
    expect(state.token).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.branding).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('SUPER_ADMIN has null tenantId in profile', () => {
    const superAdminProfile: MeResponse = {
      userId:       'sa-1',
      email:        'admin@platform.com',
      role:         'SUPER_ADMIN',
      tenantId:     null,
      isFirstLogin: false,
    };
    let state = authReducer(undefined, tokenReceived('jwt-sa'));
    state     = authReducer(state, profileLoaded(superAdminProfile));
    expect(state.profile?.tenantId).toBeNull();
    expect(state.profile?.role).toBe('SUPER_ADMIN');
  });
});
