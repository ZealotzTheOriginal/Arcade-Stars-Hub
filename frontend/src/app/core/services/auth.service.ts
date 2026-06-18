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
