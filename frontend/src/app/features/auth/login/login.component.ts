import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email, this.password);
      this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(this._friendlyError(e.code));
    } finally {
      this.loading.set(false);
    }
  }

  private _friendlyError(code: string): string {
    const map: Record<string, string> = {
      'auth/invalid-credential': 'Email o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese email.',
      'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    };
    return map[code] ?? 'Error al iniciar sesión.';
  }
}
