import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
  reauthenticateWithCredential,
  EmailAuthProvider,
  verifyBeforeUpdateEmail,
  updatePassword,
  User,
} from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';

const firebaseApp = initializeApp(environment.firebase);
const auth = getAuth(firebaseApp);

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);

  readonly currentUser = signal<User | null>(null);
  readonly loading = signal(true);

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.currentUser.set(user);
      this.loading.set(false);
    });
  }

  async login(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async register(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    // Force token refresh so the 'name' claim reflects the chosen displayName.
    // Without this, the cached token (generated before updateProfile) has name=""
    // and the backend would fall back to a random "User1234" username.
    await cred.user.getIdToken(true);
    return cred;
  }

  async resetPassword(email: string) {
    return sendPasswordResetEmail(auth, email);
  }

  /** Keeps Firebase Auth's `displayName` in sync with the editable Firestore
   *  name. The app itself never reads `currentUser().displayName` as a name
   *  source (it's frozen at whatever was typed at signup) — this exists so
   *  the two don't silently diverge for anything outside the app that might
   *  read it (Firebase console, future integrations, etc.). */
  async updateDisplayName(displayName: string) {
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName });
    }
  }

  /** Re-proves the user's identity with their current password — Firebase
   *  requires this immediately before any sensitive change (email, password)
   *  if the session isn't "recent", which it usually isn't by the time
   *  someone finds their way to Settings. */
  private async _reauthenticate(currentPassword: string): Promise<void> {
    const user = auth.currentUser;
    if (!user?.email) throw { code: 'auth/no-current-user' };
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  }

  /** Sends a verification link to the new address; the account's email only
   *  changes once that link is clicked, so a typo can't lock anyone out. */
  async changeEmail(newEmail: string, currentPassword: string): Promise<void> {
    await this._reauthenticate(currentPassword);
    await verifyBeforeUpdateEmail(auth.currentUser!, newEmail);
  }

  async changePassword(newPassword: string, currentPassword: string): Promise<void> {
    await this._reauthenticate(currentPassword);
    await updatePassword(auth.currentUser!, newPassword);
  }

  async logout() {
    await signOut(auth);
    this.router.navigate(['/login']);
  }

  async getToken(): Promise<string | null> {
    return this.currentUser()?.getIdToken() ?? null;
  }

  isLoggedIn(): boolean {
    return !!this.currentUser();
  }
}
